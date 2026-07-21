import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { liveClassify, offlineClassify } from '../../lib/copilotClient';
import { commitOrQueue } from '../../lib/offlineSync';
import { useCoreGraph } from '../../stores/coreGraph';
import { ROOMS } from '../../core/rooms';
import { pendingCaptureCount } from '../../lib/localDb';
import Icon from '../../design-system/icons/Icon';
import type { IconName } from '../../design-system/icons/registry';

const modules: { id: string; ic: IconName; nm: string }[] = [
  { id: 'capture', ic: 'neuralCapture', nm: 'CAPTURE' },
  { id: 'projects', ic: 'projects', nm: 'PROJECTS' },
  { id: 'focus', ic: 'focusTime', nm: 'FOCUS' },
  { id: 'studio', ic: 'designStudio', nm: 'STUDIO' },
  { id: 'roadmaps', ic: 'roadmaps', nm: 'ROADMAPS' },
  { id: 'bugs', ic: 'bugTracker', nm: 'BUGS' },
  { id: 'releases', ic: 'releases', nm: 'RELEASES' },
  { id: 'vault', ic: 'memoryVault', nm: 'VAULT' },
  { id: 'comms', ic: 'comms', nm: 'COMMS' },
];
// NOTE: this used to be a hardcoded 4-entry demo array (StudyHive/Music/
// Website/Novel) that rendered on the ring for EVERY account regardless of
// real data — a brand-new, genuinely empty account still saw "StudyHive"
// etc. here, which is exactly the "old data won't go away" bug reported.
// The ring is now built from the real `useCoreGraph` project list inside
// the component (see `projs` there) — a fresh account with zero projects
// renders zero project nodes on the ring, honestly.

const KIND_ICON: Record<string, IconName> = {
  capture: 'neuralCapture', task: 'checkCircle', note: 'note', doc: 'file', bug: 'bugTracker', idea: 'idea',
  design: 'designStudio', roadmap_item: 'roadmaps', release: 'releases', conversation: 'comms',
};

function relTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** NEURAL CORE — "a sci-fi command bridge HUD" (Amendment v0.2). Ported from
 * xos-prototype.html's "living mass" blob canvas (drawCore), radial node
 * layout (layoutCore), SVG routing-line animation, and coreCapture(), then
 * uplifted with real bridge-HUD instrumentation: a live briefing line + node
 * count driven by the actual graph, a rotating recent-activity ticker, a
 * docking-flight transition when jumping to a room instead of an instant
 * teleport, mood/health color grading of the blob itself from real project
 * vitals + workload, and a Cmd/Ctrl+K command palette scoped to the Core
 * ("...without leaving the Core" — Amendment v0.2 places this directive
 * under Neural Core specifically, not as a global OS overlay). */
export default function NeuralCore({ active }: { active: boolean }) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const raf = useRef<number>(0);
  const cT = useRef(0);
  const cParts = useRef(
    Array.from({ length: 46 }, (_, i) => ({
      a: Math.random() * 6.28,
      r: 0.16 + Math.random() * 0.1,
      sp: (0.2 + Math.random() * 0.5) * (Math.random() < 0.5 ? 1 : -1),
      s: 0.6 + Math.random() * 1.6,
      hue: ['#00F5FF', '#8B5CF6', '#FF2D78', '#FFB800'][i % 4],
    })),
  );
  const cStreams = useRef<{ a: number; d: number; hue: string }[]>([]);
  const nodePos = useRef<Record<string, [number, number]>>({});
  /** Real project-health + 24h node-creation "workload" — read every frame
   * by the draw loop to grade the blob's color/energy, refreshed whenever
   * live graph data changes (kept in a ref so the RAF loop, set up once,
   * doesn't need to be torn down/restarted on every data update). */
  const moodRef = useRef({ health: 70, workload: 0 });
  const [msg, setMsg] = useState<ReactNode>('');
  const [statsOverride, setStatsOverride] = useState<string | null>(null);
  const [thought, setThought] = useState('');
  const [tickIdx, setTickIdx] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteSel, setPaletteSel] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const paletteInputRef = useRef<HTMLInputElement>(null);

  const projects = useCoreGraph((s) => s.projects);
  const nodes = useCoreGraph((s) => s.nodes);
  const edges = useCoreGraph((s) => s.edges);

  // Real project ring data (replaces the old hardcoded StudyHive/Music/
  // Website/Novel demo array) — a brand-new account with zero real projects
  // now renders zero project nodes here, honestly, instead of fake ones.
  const projs = useMemo<{ id: string; ic: IconName; nm: string }[]>(
    () => projects.map((p) => ({ id: p.id, ic: (p.icon || 'projects') as IconName, nm: p.name.toUpperCase() })),
    [projects],
  );
  const allMeta = useMemo(() => [...modules, ...projs], [projs]);
  // Real project_slug -> project_id lookup for routing a freshly-classified
  // capture node to the right project ring node (replaces the old hardcoded
  // slugToProj map that only knew about the 4 fake demo projects).
  const slugToProj = useMemo(() => {
    const m: Record<string, string> = {};
    projects.forEach((p) => {
      m[p.slug] = p.id;
    });
    return m;
  }, [projects]);

  useEffect(() => {
    const avgHealth = projects.length ? projects.reduce((s, p) => s + p.health, 0) / projects.length : 70;
    const dayAgo = Date.now() - 86400000;
    const workload = nodes.filter((n) => new Date(n.created_at).getTime() > dayAgo).length;
    moodRef.current = { health: avgHealth, workload };
  }, [projects, nodes]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return 'STILL AWAKE, CAPTAIN';
    if (h < 12) return 'GOOD MORNING, CAPTAIN';
    if (h < 18) return 'GOOD AFTERNOON, CAPTAIN';
    return 'GOOD EVENING, CAPTAIN';
  }, []);

  const liveStats = useMemo(() => {
    const openBugs = nodes.filter((n) => n.kind === 'bug' && n.status !== 'done' && n.status !== 'archived').length;
    const activeProjects = projects.filter((p) => p.status === 'active').length;
    return `${nodes.length} NODE${nodes.length === 1 ? '' : 'S'} · ${edges.length} EDGE${edges.length === 1 ? '' : 'S'} · ${activeProjects} PROJECT${activeProjects === 1 ? '' : 'S'} ACTIVE${openBugs ? ` · ${openBugs} BUG${openBugs === 1 ? '' : 'S'} OPEN` : ''} · CORE LEARNING`;
  }, [nodes, edges, projects]);
  const displayStats = statsOverride ?? liveStats;

  const briefing = useMemo(() => {
    if (!projects.length) return 'The graph is quiet — capture a thought below to begin.';
    const dayAgo = Date.now() - 86400000;
    const recent = nodes.filter((n) => new Date(n.created_at).getTime() > dayAgo);
    const stalest = [...projects].sort((a, b) => b.idleDays - a.idleDays)[0];
    const healthiest = [...projects].sort((a, b) => b.health - a.health)[0];
    const parts: string[] = [];
    if (recent.length) parts.push(`${recent.length} new node${recent.length === 1 ? '' : 's'} in the last day`);
    if (stalest?.isStale) parts.push(`${stalest.name} has gone quiet — ${stalest.idleDays}d dark`);
    else if (healthiest) parts.push(`${healthiest.name} is running healthiest at ${Math.round(healthiest.health)}%`);
    return parts.length ? parts.join(' · ') : 'All systems nominal.';
  }, [projects, nodes]);

  const recentActivity = useMemo(
    () => [...nodes].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 8),
    [nodes],
  );
  useEffect(() => {
    if (recentActivity.length < 2) return;
    const id = setInterval(() => setTickIdx((i) => (i + 1) % recentActivity.length), 4000);
    return () => clearInterval(id);
  }, [recentActivity.length]);
  const tickerNode = recentActivity.length ? recentActivity[tickIdx % recentActivity.length] : null;

  // Ambient thought-particle queue (Step 8's local outbox). Only ever
  // non-zero inside the packaged Tauri shell — pendingCaptureCount()
  // rejects on the web build, so this degrades to "render nothing" there
  // rather than crashing or showing a permanently-empty widget.
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const n = await pendingCaptureCount();
        if (alive) setPendingCount(n);
      } catch {
        if (alive) setPendingCount(0);
      }
    }
    poll();
    const id = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  function blobR(a: number, t: number, R: number) {
    return R * (1 + 0.1 * Math.sin(3 * a + t * 1.1) + 0.06 * Math.sin(5 * a - t * 1.7) + 0.05 * Math.sin(2 * a + t * 0.6) + 0.05 * Math.sin(t * 0.9) + 0.16 * Math.max(0, Math.sin(t * 0.45)) ** 6 * Math.sin(7 * a + t * 3));
  }

  function coreResize() {
    const stage = document.getElementById('r-core');
    const cv = cvRef.current;
    if (!stage || !cv) return;
    cv.width = stage.clientWidth;
    cv.height = stage.clientHeight;
  }

  /** Replaces the old instant `xos-go` dispatch: a small glowing ghost eases
   * from the core center to the clicked node's real screen position over
   * 350ms (CSS transition, since #coreStage's nodes are plain DOM), then
   * fires navigation — a real docking-flight beat instead of a teleport. */
  function dockAndGo(navId: string, posId: string) {
    pulse(posId);
    const stage = stageRef.current;
    const core = nodePos.current.core;
    const dest = nodePos.current[posId];
    if (!stage || !core || !dest) {
      window.dispatchEvent(new CustomEvent('xos-go', { detail: navId }));
      return;
    }
    const ghost = document.createElement('div');
    ghost.className = 'dockPulse';
    ghost.style.left = core[0] + 'px';
    ghost.style.top = core[1] + 'px';
    stage.appendChild(ghost);
    requestAnimationFrame(() => {
      ghost.style.left = dest[0] + 'px';
      ghost.style.top = dest[1] + 'px';
      ghost.classList.add('arrived');
    });
    setTimeout(() => {
      ghost.remove();
      window.dispatchEvent(new CustomEvent('xos-go', { detail: navId }));
    }, 350);
  }

  function layoutCore() {
    const stage = stageRef.current;
    const svg = svgRef.current;
    if (!stage || !svg) return;
    stage.querySelectorAll('.cnode').forEach((x) => x.remove());
    const W = stage.clientWidth,
      H = stage.clientHeight,
      cx = W / 2,
      cy = H / 2;
    const rIn = Math.min(W, H) * 0.31,
      rOut = Math.min(W, H) * 0.465;
    const pos: Record<string, [number, number]> = { core: [cx, cy] };
    modules.forEach((m, i) => {
      const a = (i / modules.length) * 6.29 - Math.PI / 2;
      pos[m.id] = [cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn];
    });
    projs.forEach((p, i) => {
      const a = (i / projs.length) * 6.29 - Math.PI / 4;
      pos[p.id] = [cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut];
    });
    nodePos.current = pos;

    const mkNode = (d: { id: string; ic: IconName; nm: string }, cls: string, onClick: () => void) => {
      const [x, y] = pos[d.id];
      const el = document.createElement('div');
      el.className = 'cnode ' + cls;
      el.id = 'n-' + d.id;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      // Raw DOM innerHTML — non-JSX context, the <Icon> React component can't be
      // mounted here, so the bubble glyph is intentionally omitted (Amendment
      // v0.6 step 1 non-JSX carve-out). `d.ic` is kept as an IconName on the
      // data for a future JSX-based node renderer.
      el.innerHTML = `<span class="bub"></span><span class="nm">${d.nm}</span>`;
      el.onclick = onClick;
      stage.appendChild(el);
    };
    modules.forEach((m) => mkNode(m, 'mod', () => dockAndGo(m.id, m.id)));
    projs.forEach((p) => mkNode(p, 'proj', () => dockAndGo('projects', p.id)));

    svg.innerHTML = '';
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const faint = (a: [number, number], b: [number, number], c = 'rgba(0,245,255,.09)') => {
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', String(a[0]));
      l.setAttribute('y1', String(a[1]));
      l.setAttribute('x2', String(b[0]));
      l.setAttribute('y2', String(b[1]));
      l.setAttribute('stroke', c);
      l.setAttribute('stroke-width', '1');
      svg.appendChild(l);
    };
    modules.forEach((m) => faint(pos.core, pos[m.id]));
    projs.forEach((p) => faint(pos.core, pos[p.id], 'rgba(139,92,246,.12)'));
  }

  useEffect(() => {
    coreResize();
    layoutCore();
    function draw() {
      const cv = cvRef.current;
      const cc = cv?.getContext('2d');
      if (!cv || !cc) return;
      cT.current += 0.016;
      const t = cT.current;
      const W = cv.width,
        H = cv.height,
        cx = W / 2,
        cy = H / 2,
        R = Math.min(W, H) * 0.115;
      cc.fillStyle = '#05080D';
      cc.fillRect(0, 0, W, H);
      cc.globalAlpha = 0.5;
      const halo = cc.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 4.4);
      halo.addColorStop(0, 'rgba(0,245,255,.14)');
      halo.addColorStop(0.4, 'rgba(139,92,246,.07)');
      halo.addColorStop(1, 'transparent');
      cc.globalAlpha = 1;
      cc.fillStyle = halo;
      cc.beginPath();
      cc.arc(cx, cy, R * 4.4, 0, 6.29);
      cc.fill();
      cc.globalCompositeOperation = 'lighter';

      // Mood/health color grading: healthT drives the dominant layer's hue
      // (red = unhealthy -> cyan/green = healthy, the same mapping
      // Observatory uses for project-health nebulae, so the Core's own
      // "vitals" read consistently with the rest of the OS). workloadT
      // drives the amber "activity" layer's brightness and the particle
      // energy below — both computed from the real graph, not fixed.
      const mood = moodRef.current;
      const healthT = Math.max(0, Math.min(1, mood.health / 100));
      const domHue = `${Math.round(255 - healthT * 210)},${Math.round(70 + healthT * 175)},${Math.round(90 + healthT * 90)}`;
      const workloadT = Math.max(0, Math.min(1.4, mood.workload / 8));

      // Cockpit glow-system pass: heavier plasma glow layers — mg/pu/pk/cy
      // alphas bumped to .52/.44/.32/.68 per the brief. The amber
      // (workload) and domHue (health) layers are a separate, working
      // mood-grading system — not part of the brief's fixed palette — so
      // they keep their own formulas and just ride along underneath.
      const layers = [
        { hue: '138,92,246', ph: 0, sc: 1.22, al: 0.44 }, // pu
        { hue: '255,45,120', ph: 2.1, sc: 1.1, al: 0.52 }, // mg
        { hue: '255,184,0', ph: 4.2, sc: 1.0, al: 0.16 + workloadT * 0.08 },
        { hue: domHue, ph: 1.05, sc: 0.92, al: 0.4 + healthT * 0.25 },
      ];
      layers.forEach((L) => {
        cc.beginPath();
        for (let i = 0; i <= 72; i++) {
          const a = (i / 72) * 6.29,
            r = blobR(a + L.ph, t + L.ph, R * L.sc);
          const x = cx + Math.cos(a) * r,
            y = cy + Math.sin(a) * r;
          i ? cc.lineTo(x, y) : cc.moveTo(x, y);
        }
        cc.closePath();
        const g = cc.createRadialGradient(cx - R * 0.25, cy - R * 0.25, R * 0.1, cx, cy, R * L.sc * 1.25);
        g.addColorStop(0, `rgba(${L.hue},${L.al})`);
        g.addColorStop(0.75, `rgba(${L.hue},${L.al * 0.5})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        cc.fillStyle = g;
        cc.fill();
      });
      cc.globalCompositeOperation = 'source-over';
      const dh = cc.createRadialGradient(cx, cy, 0, cx, cy, R * 0.55);
      dh.addColorStop(0, 'rgba(2,6,10,.95)');
      dh.addColorStop(0.75, 'rgba(2,6,10,.55)');
      dh.addColorStop(1, 'transparent');
      cc.fillStyle = dh;
      cc.beginPath();
      cc.arc(cx, cy, R * 0.55, 0, 6.29);
      cc.fill();
      // Plasma rim — brief spec: lineWidth 2, magenta .95, globalAlpha
      // 0.65 + 0.3*sin(t*1.3).
      cc.strokeStyle = 'rgba(255,45,120,.95)';
      cc.lineWidth = 2;
      cc.globalAlpha = 0.65 + 0.3 * Math.sin(t * 1.3);
      cc.beginPath();
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * 6.29,
          r = blobR(a + 1.05, t + 1.05, R * 0.92);
        const x = cx + Math.cos(a) * r,
          y = cy + Math.sin(a) * r;
        i ? cc.lineTo(x, y) : cc.moveTo(x, y);
      }
      cc.closePath();
      cc.stroke();
      cc.globalAlpha = 1;
      const orbBase = Math.min(W, H);
      cParts.current.forEach((p) => {
        p.a += p.sp * 0.012 * (1 + workloadT * 0.6);
        const wob = 1 + 0.08 * Math.sin(t * 2 + p.a * 3);
        const x = cx + Math.cos(p.a) * p.r * orbBase * wob,
          y = cy + Math.sin(p.a) * p.r * orbBase * 0.8 * wob;
        cc.globalAlpha = 0.5 + 0.4 * Math.sin(t * 3 + p.a * 5);
        cc.fillStyle = p.hue;
        cc.beginPath();
        cc.arc(x, y, p.s, 0, 6.29);
        cc.fill();
      });
      if (Math.random() < 0.05 + workloadT * 0.05) cStreams.current.push({ a: Math.random() * 6.29, d: 1, hue: ['#00F5FF', '#FF2D78', '#8B5CF6'][Math.floor(Math.random() * 3)] });
      cStreams.current = cStreams.current.filter((s) => s.d > 0.12);
      cStreams.current.forEach((s) => {
        s.d -= 0.016;
        const x = cx + Math.cos(s.a) * s.d * orbBase * 0.42,
          y = cy + Math.sin(s.a) * s.d * orbBase * 0.34;
        cc.globalAlpha = (1 - s.d) * 0.9;
        cc.fillStyle = s.hue;
        cc.beginPath();
        cc.arc(x, y, 1.6, 0, 6.29);
        cc.fill();
      });
      cc.globalAlpha = 1;
      raf.current = requestAnimationFrame(draw);
    }
    raf.current = requestAnimationFrame(draw);
    const onResize = () => {
      coreResize();
      layoutCore();
    };
    addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf.current);
      removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (active) setTimeout(() => { coreResize(); layoutCore(); }, 50);
  }, [active]);

  // Real project data from hydrate() typically arrives asynchronously after
  // mount — re-layout the ring once it does (or changes) so the outer ring
  // genuinely reflects the signed-in account's projects, not just whatever
  // was present at the very first render.
  useEffect(() => {
    if (active) layoutCore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projs, active]);

  // Command palette (Cmd/Ctrl+K) — scoped to fire only while the Core room
  // is active, per the Amendment's own placement of this directive under
  // Neural Core ("jump to any room without leaving the Core").
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteQuery('');
        setPaletteOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  useEffect(() => {
    if (paletteOpen) setTimeout(() => paletteInputRef.current?.focus(), 30);
  }, [paletteOpen]);

  useEffect(() => {
    setPaletteSel(0);
  }, [paletteQuery, paletteOpen]);

  const filteredRooms = ROOMS.filter((r) => r.name.toLowerCase().includes(paletteQuery.trim().toLowerCase()));

  function goToRoom(id: string) {
    setPaletteOpen(false);
    window.dispatchEvent(new CustomEvent('xos-go', { detail: id }));
  }

  function paletteKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setPaletteOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setPaletteSel((i) => Math.min(i + 1, Math.max(0, filteredRooms.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setPaletteSel((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      const room = filteredRooms[paletteSel];
      if (room) goToRoom(room.id);
    }
  }

  function pulse(id: string) {
    const el = document.getElementById('n-' + id);
    if (!el) return;
    el.classList.add('hot');
    setTimeout(() => el.classList.remove('hot'), 900);
  }
  function animLine(a: [number, number], b: [number, number], color: string) {
    const svg = svgRef.current;
    if (!svg) return;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', String(a[0]));
    l.setAttribute('y1', String(a[1]));
    l.setAttribute('x2', String(b[0]));
    l.setAttribute('y2', String(b[1]));
    l.setAttribute('class', 'flowline');
    l.setAttribute('stroke', color);
    l.style.color = color;
    l.setAttribute('stroke-dasharray', String(len));
    l.setAttribute('stroke-dashoffset', String(len));
    l.style.animation = 'flow .38s ease-out forwards, fadeline .8s ease 1.5s forwards';
    svg.appendChild(l);
    setTimeout(() => l.remove(), 3600);
  }
  function nameOf(id: string) {
    return allMeta.find((m) => m.id === id)?.nm ?? id;
  }

  async function coreCapture() {
    const v = thought.trim();
    if (!v) return;
    setThought('');
    setMsg(
      <>
        <Icon name="xai" size={12} /> xAI is thinking…
      </>,
    );
    let liveResult: Awaited<ReturnType<typeof liveClassify>> | null = null;
    try {
      liveResult = await liveClassify(v);
    } catch {
      liveResult = null;
    }

    const capBar = document.getElementById('capBar');
    const stage = stageRef.current;
    if (!capBar || !stage) return;
    const bar = capBar.getBoundingClientRect(),
      st = stage.getBoundingClientRect();

    if (liveResult?.nodes?.length) {
      const first = liveResult.nodes[0];
      const projId = slugToProj[first.project_slug ?? ''] || projects[0]?.id || 'core';
      const hops = ['capture'];
      if (first.kind === 'bug') hops.push('bugs');
      if (first.kind === 'design') hops.push('studio');
      if (first.kind === 'roadmap_item') hops.push('roadmaps');
      if (!hops.includes('projects')) hops.splice(1, 0, 'projects');
      const path = ['core', ...hops.slice(1), projId];
      animLine([bar.left + bar.width / 2 - st.left, bar.top - st.top], nodePos.current.core, '#FF2D78');
      let t = 350;
      for (let i = 0; i < path.length - 1; i++) {
        const a = nodePos.current[path[i]],
          b = nodePos.current[path[i + 1]];
        const col = i === path.length - 2 ? '#8B5CF6' : '#00F5FF';
        setTimeout(() => {
          animLine(a, b, col);
          pulse(path[i + 1]);
        }, t);
        t += 420;
      }
      setTimeout(() => {
        // msg is a ReactNode (see AuthGate.tsx's `notice` for the same pattern) —
        // the xAI presence glyph AND the path-breadcrumb arrows both render as
        // real <Icon> components now (Amendment v0.6 step 1: zero raw glyphs,
        // including in rendered prose).
        setMsg(
          <>
            <Icon name="xai" size={12} /> xAI ({liveResult!.liveAI ? 'LIVE' : 'KEY NOT SET'}) · {first.kind.toUpperCase()} <Icon name="arrowRight" size={10} />{' '}
            {path.slice(1).map(nameOf).map((name, i) => (
              <span key={i}>
                {i > 0 && <Icon name="arrowRight" size={10} />} {name}
              </span>
            ))}{' '}
            · "{first.reasoning}"
          </>,
        );
        setTimeout(() => setMsg(''), 5200);
        setStatsOverride(liveResult!.liveAI ? 'LIVE NODE WRITTEN TO SUPABASE · CORE LEARNING' : 'NODE WRITTEN (fallback mode) · SET ANTHROPIC_API_KEY FOR LIVE AI');
        setTimeout(() => setStatsOverride(null), 4500);
      }, t);
      return;
    }

    // fallback: local mock classifier — Step 3 also writes a real node here
    // now (fire-and-forget; the animation below isn't gated on it) so a
    // capture still shows up live in Projects/Observatory even when live AI
    // is unavailable, instead of just being a visual-only demo. Step 8:
    // commitOrQueue additionally queues to local SQLite (inside the Tauri
    // shell only) instead of losing the capture if Supabase itself is
    // unreachable.
    commitOrQueue(v).catch((err) => console.error('coreCapture: offline fallback write failed', err));
    const c = offlineClassify(v);
    const path = ['core', ...c.hops.slice(1), c.proj];
    animLine([bar.left + bar.width / 2 - st.left, bar.top - st.top], nodePos.current.core, '#FF2D78');
    let t = 350;
    for (let i = 0; i < path.length - 1; i++) {
      const a = nodePos.current[path[i]],
        b = nodePos.current[path[i + 1]];
      const col = i === path.length - 2 ? '#8B5CF6' : '#00F5FF';
      setTimeout(() => {
        animLine(a, b, col);
        pulse(path[i + 1]);
      }, t);
      t += 420;
    }
    setTimeout(() => {
      setMsg(
        <>
          <Icon name={c.label.icon} size={12} /> {c.label.text} (OFFLINE MOCK) <Icon name="arrowRight" size={10} />{' '}
          {path.slice(1).map(nameOf).map((name, i) => (
            <span key={i}>
              {i > 0 && <Icon name="arrowRight" size={10} />} {name}
            </span>
          ))}{' '}
          · NODE CREATED
        </>,
      );
      setTimeout(() => setMsg(''), 3600);
      setStatsOverride('NODE QUEUED (offline mock) · CORE LEARNING');
      setTimeout(() => setStatsOverride(null), 4500);
    }, t);
  }

  return (
    <section className={`room fullroom ${active ? 'on' : ''}`} id="r-core">
      <canvas ref={cvRef} id="coreCv" />
      <div id="coreStage" ref={stageRef}>
        <svg id="lines" ref={svgRef} />
        <div id="coreGreet">
          <h1>{greeting}</h1>
          <p id="coreStats">{displayStats}</p>
          <p id="coreBriefing">{briefing}</p>
          {tickerNode && (
            <p id="coreTicker" key={tickerNode.id}>
              <Icon name={KIND_ICON[tickerNode.kind] ?? 'xai'} size={12} /> {(tickerNode.title || tickerNode.body || '').slice(0, 48)} · {relTime(tickerNode.created_at)}
            </p>
          )}
        </div>
      </div>
      <div id="capWrap">
        {pendingCount > 0 && (
          <div id="pendingQueue" title={`${pendingCount} thought${pendingCount === 1 ? '' : 's'} queued offline`}>
            {Array.from({ length: Math.min(pendingCount, 6) }).map((_, i) => (
              <span key={i} className="pendingDot" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
            <span className="pendingLabel">{pendingCount} QUEUED OFFLINE</span>
          </div>
        )}
        <div id="capMsg">{msg}</div>
        <div id="capBar">
          <input
            id="thought"
            placeholder="Tell the Core anything… (Cmd+K to jump anywhere)"
            autoComplete="off"
            value={thought}
            onChange={(e) => setThought(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && coreCapture()}
          />
          <button onClick={coreCapture}>
            <Icon name="xai" size={16} glow="cyan" />
          </button>
        </div>
      </div>
      {paletteOpen && (
        <div id="cmdPaletteOverlay" onClick={() => setPaletteOpen(false)}>
          <div id="cmdPalette" onClick={(e) => e.stopPropagation()}>
            <input
              ref={paletteInputRef}
              id="cmdPaletteInput"
              placeholder="Jump to a room…"
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
              onKeyDown={paletteKeyDown}
            />
            <div id="cmdPaletteList">
              {filteredRooms.length === 0 && <div className="cmdEmpty">No rooms match "{paletteQuery}"</div>}
              {filteredRooms.map((r, i) => (
                <div
                  key={r.id}
                  className={`cmdRow ${i === paletteSel ? 'sel' : ''}`}
                  onMouseEnter={() => setPaletteSel(i)}
                  onClick={() => goToRoom(r.id)}
                >
                  <span className="cmdIcon">{r.icon}</span>
                  <span className="cmdName">{r.name}</span>
                  <span className="cmdSection">{r.section}</span>
                </div>
              ))}
            </div>
            <div id="cmdPaletteHint">
              <Icon name="arrowUp" size={10} />
              <Icon name="arrowDown" size={10} /> navigate · <Icon name="enter" size={10} /> jump · esc close
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
