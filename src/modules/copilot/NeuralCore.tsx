import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { liveClassify, offlineClassify } from '../../lib/copilotClient';
import { commitOrQueue } from '../../lib/offlineSync';
import { useCoreGraph } from '../../stores/coreGraph';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../lib/supabase';
import { ROOMS } from '../../core/rooms';
import { pendingCaptureCount } from '../../lib/localDb';
import Icon from '../../design-system/icons/Icon';
import DataIcon from '../../design-system/icons/DataIcon';
import type { IconName } from '../../design-system/icons/registry';
import AiReviewPanel from './AiReviewPanel';

/** A node's persisted position + optional group, keyed by node id (same ids
 * used in nodePos.current: module ids, project ids). Persisted to
 * localStorage per-owner (part A.3) so a Captain's manual layout survives a
 * reload — the radial layout in layoutCore() is only ever the fallback for
 * an id with no saved entry. */
type SavedLayout = Record<string, { x: number; y: number; groupId?: string }>;
const GROUP_DIST = 40; // px — part A.4's "within ~40px" grouping threshold
const DRAG_THRESHOLD = 4; // px — part A.1's "genuine drag" vs click cutoff

function layoutKey(ownerId: string | null) {
  return `xos-corepos-${ownerId ?? 'anon'}`;
}
function loadLayout(ownerId: string | null): SavedLayout {
  try {
    const raw = localStorage.getItem(layoutKey(ownerId));
    return raw ? (JSON.parse(raw) as SavedLayout) : {};
  } catch {
    return {};
  }
}
function saveLayout(ownerId: string | null, layout: SavedLayout) {
  try {
    localStorage.setItem(layoutKey(ownerId), JSON.stringify(layout));
  } catch {
    /* best-effort — a full/blocked localStorage shouldn't break dragging */
  }
}
/** Settings' "RESET NEURAL CORE LAYOUT" row calls this directly — a Captain
 * who drags everything into an unreadable pile needs a real way back to the
 * default radial layout without wiping any actual data (nodes/edges/tags
 * are untouched; this only clears the persisted x/y/groupId positions). */
export function resetCoreLayout(ownerId: string | null) {
  try {
    localStorage.removeItem(layoutKey(ownerId));
  } catch {
    /* best-effort */
  }
}

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
  // Item #5 — ring node icons. layoutCore() builds nodes as raw DOM (see
  // mkNode below), so the shared <DataIcon> component (the exact same
  // icon-rendering logic Projects room uses for its cards — see
  // projects/index.tsx) is mounted into each node's `.bub` span via its own
  // small React root rather than reimplemented as a second icon system.
  // Roots are tracked here so layoutCore() can unmount them before their
  // DOM nodes are torn down on re-layout (resize, active toggle, real
  // project data arriving) — otherwise every re-layout would leak roots.
  const bubRoots = useRef<Map<string, Root>>(new Map());
  // Part A — drag interactivity. `lineEl` maps a module/project node id to
  // its SVG <line> element (core -> that node): since the core anchor never
  // moves, redrawing a dragged node's line only ever needs updating that
  // one line's x2/y2, no full re-layout. `groupOf` maps a node id to its
  // groupId (part A.4's proximity grouping) and is kept in sync with what's
  // persisted to localStorage. `savedLayout` mirrors the same localStorage
  // blob so drag handlers (registered once per mkNode call, not
  // re-registered on every render) always read/write the latest state.
  const lineEl = useRef<Map<string, SVGLineElement>>(new Map());
  const groupOf = useRef<Record<string, string>>({});
  const savedLayout = useRef<SavedLayout>({});
  const [panelId, setPanelId] = useState<string | null>(null);
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
  const graphOwnerId = useCoreGraph((s) => s.ownerId);
  const authUserId = useAuthStore((s) => s.user?.id);
  const ownerId = graphOwnerId ?? authUserId ?? null;
  const updateNodeTitle = useCoreGraph((s) => s.updateNodeTitle);
  const updateNodeTags = useCoreGraph((s) => s.updateNodeTags);
  const createEdge = useCoreGraph((s) => s.createEdge);
  const deleteEdge = useCoreGraph((s) => s.deleteEdge);
  const confirmEdge = useCoreGraph((s) => s.confirmEdge);
  const correctEdge = useCoreGraph((s) => s.correctEdge);
  const confirmNodeTags = useCoreGraph((s) => s.confirmNodeTags);
  const [showAiReview, setShowAiReview] = useState(false);

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
    // Unmount every bub icon root BEFORE the DOM nodes they're mounted into
    // are removed — React roots don't clean themselves up just because
    // their container left the document.
    // Deferred via setTimeout rather than unmounted synchronously here:
    // calling root.unmount() synchronously inside an effect (especially
    // under StrictMode's mount->cleanup->remount double-invoke) can race
    // React's own in-flight render/commit for this root ("Attempted to
    // synchronously unmount a root while React was already rendering"),
    // which was found to corrupt paint for the rest of the page, not just
    // this component — a real bug, not just a console warning.
    const rootsToUnmount = Array.from(bubRoots.current.values());
    bubRoots.current.clear();
    setTimeout(() => rootsToUnmount.forEach((root) => root.unmount()), 0);
    stage.querySelectorAll('.cnode').forEach((x) => x.remove());
    const W = stage.clientWidth,
      H = stage.clientHeight,
      cx = W / 2,
      cy = H / 2;
    const rIn = Math.min(W, H) * 0.31,
      rOut = Math.min(W, H) * 0.465;
    // Part A.3: read any persisted position for this owner first — the
    // computed radial position below is only ever the fallback for a
    // module/project id with no saved entry (a brand-new node, or a
    // Captain who's never dragged anything).
    const saved = loadLayout(ownerId);
    savedLayout.current = saved;
    groupOf.current = {};
    Object.entries(saved).forEach(([id, v]) => {
      if (v.groupId) groupOf.current[id] = v.groupId;
    });
    const pos: Record<string, [number, number]> = { core: [cx, cy] };
    modules.forEach((m, i) => {
      const a = (i / modules.length) * 6.29 - Math.PI / 2;
      const fallback: [number, number] = [cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn];
      pos[m.id] = saved[m.id] ? [saved[m.id].x, saved[m.id].y] : fallback;
    });
    projs.forEach((p, i) => {
      const a = (i / projs.length) * 6.29 - Math.PI / 4;
      const fallback: [number, number] = [cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut];
      pos[p.id] = saved[p.id] ? [saved[p.id].x, saved[p.id].y] : fallback;
    });
    nodePos.current = pos;
    lineEl.current.clear();

    /** Redraws just the one line touching a dragged node (core -> node) —
     * called on every pointermove while dragging, never a full re-layout. */
    const redrawLine = (id: string) => {
      const line = lineEl.current.get(id);
      const p = nodePos.current[id];
      if (!line || !p) return;
      line.setAttribute('x2', String(p[0]));
      line.setAttribute('y2', String(p[1]));
    };

    /** Part A.4 — proximity grouping. Persisted alongside position; halo
     * class toggled on both members. Regenerates a fresh groupId the first
     * time two ungrouped nodes meet so distinct pairs don't collide. */
    const checkGrouping = (id: string, x: number, y: number) => {
      let nearestId: string | null = null;
      let nearestDist = GROUP_DIST;
      Object.entries(nodePos.current).forEach(([otherId, [ox, oy]]) => {
        if (otherId === id || otherId === 'core') return;
        const d = Math.hypot(x - ox, y - oy);
        if (d < nearestDist) {
          nearestDist = d;
          nearestId = otherId;
        }
      });
      const el = document.getElementById('n-' + id);
      if (nearestId) {
        const nid: string = nearestId;
        const gid = groupOf.current[nid] || groupOf.current[id] || `grp-${id}-${nid}`;
        groupOf.current[id] = gid;
        groupOf.current[nid] = gid;
        el?.classList.add('grouped');
        document.getElementById('n-' + nid)?.classList.add('grouped');
      } else {
        delete groupOf.current[id];
        el?.classList.remove('grouped');
        // Only ungroup the halo visually if no OTHER node still shares this
        // node's former group.
      }
    };

    /** Builds the full persisted layout object from current in-memory
     * positions + groups and writes it to localStorage — called once per
     * drag gesture (pointerup), not on every pointermove. */
    const persist = () => {
      const layout: SavedLayout = {};
      [...modules, ...projs].forEach((d) => {
        const p = nodePos.current[d.id];
        if (!p) return;
        layout[d.id] = { x: p[0], y: p[1], groupId: groupOf.current[d.id] };
      });
      savedLayout.current = layout;
      saveLayout(ownerId, layout);
    };

    const mkNode = (d: { id: string; ic: IconName; nm: string }, cls: string, onClick: () => void, onDoubleClick: () => void) => {
      const [x, y] = pos[d.id];
      const el = document.createElement('div');
      el.className = 'cnode ' + cls + (groupOf.current[d.id] ? ' grouped' : '');
      el.id = 'n-' + d.id;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.innerHTML = `<span class="bub"></span><span class="nm">${d.nm}</span>`;
      el.ondblclick = (e) => {
        e.stopPropagation();
        onDoubleClick();
      };
      // Part A.1/A.2 — real pointer-driven drag. A genuine drag (moved past
      // DRAG_THRESHOLD) updates position + redraws only this node's line and
      // suppresses the click (no dockAndGo); a near-zero-movement
      // pointerdown/up is treated as a real click and opens the details
      // panel instead of navigating immediately (dockAndGo/onDoubleClick
      // remain available as the panel's explicit "Go to room" action, or a
      // literal double-click on the node itself).
      let startX = 0,
        startY = 0,
        startPosX = 0,
        startPosY = 0,
        dragging = false;
      el.addEventListener('pointerdown', (e: PointerEvent) => {
        e.stopPropagation();
        startX = e.clientX;
        startY = e.clientY;
        const cur = nodePos.current[d.id];
        startPosX = cur[0];
        startPosY = cur[1];
        dragging = false;
        el.setPointerCapture(e.pointerId);

        const onMove = (e2: PointerEvent) => {
          const dx = e2.clientX - startX,
            dy = e2.clientY - startY;
          if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
            dragging = true;
            el.classList.add('dragging');
          }
          if (dragging) {
            const nx = startPosX + dx,
              ny = startPosY + dy;
            nodePos.current[d.id] = [nx, ny];
            el.style.left = nx + 'px';
            el.style.top = ny + 'px';
            redrawLine(d.id);
            checkGrouping(d.id, nx, ny);
          }
        };
        const onUp = (e2: PointerEvent) => {
          try {
            el.releasePointerCapture(e2.pointerId);
          } catch {
            /* already released */
          }
          el.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerup', onUp);
          el.classList.remove('dragging');
          if (dragging) {
            persist();
          } else {
            onClick();
          }
        };
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
      });
      stage.appendChild(el);
      // Mount the exact same DataIcon component Projects room renders its
      // project/classification glyphs with (see projects/index.tsx) into
      // the bubble — reused, not reimplemented, per the fix requirement.
      const bubEl = el.querySelector('.bub');
      if (bubEl) {
        const root = createRoot(bubEl);
        bubRoots.current.set(d.id, root);
        root.render(<DataIcon value={d.ic} size={cls === 'proj' ? 15 : 14} glow={cls === 'proj' ? 'purple' : 'cyan'} />);
      }
    };
    modules.forEach((m) => mkNode(m, 'mod', () => { setShowAiReview(false); setPanelId(m.id); }, () => dockAndGo(m.id, m.id)));
    projs.forEach((p) => mkNode(p, 'proj', () => { setShowAiReview(false); setPanelId(p.id); }, () => dockAndGo('projects', p.id)));

    svg.innerHTML = '';
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const faint = (id: string, a: [number, number], b: [number, number], c = 'rgba(0,245,255,.09)') => {
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', String(a[0]));
      l.setAttribute('y1', String(a[1]));
      l.setAttribute('x2', String(b[0]));
      l.setAttribute('y2', String(b[1]));
      l.setAttribute('stroke', c);
      l.setAttribute('stroke-width', '1');
      svg.appendChild(l);
      lineEl.current.set(id, l);
    };
    modules.forEach((m) => faint(m.id, pos.core, pos[m.id]));
    projs.forEach((p) => faint(p.id, pos.core, pos[p.id], 'rgba(139,92,246,.12)'));
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
      bubRoots.current.forEach((root) => root.unmount());
      bubRoots.current.clear();
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
  }, [projs, active, ownerId]);

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
        <button
          id="coreAiReviewBtn"
          title="Review xAI's tags & associations — accept, correct, or reject what it's done on its own"
          onClick={() => { setPanelId(null); setShowAiReview(true); }}
        >
          <Icon name="tag" size={13} glow="cyan" /> REVIEW xAI
        </button>
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
      {panelId && (
        <NodePanel
          isProject={projs.some((p) => p.id === panelId)}
          name={allMeta.find((m) => m.id === panelId)?.nm ?? panelId}
          groupId={groupOf.current[panelId]}
          groupMembers={
            groupOf.current[panelId]
              ? allMeta.filter((m) => m.id !== panelId && groupOf.current[m.id] === groupOf.current[panelId]).map((m) => m.nm)
              : []
          }
          nodes={nodes.filter((n) => n.project_id === panelId)}
          edges={edges}
          onClose={() => setPanelId(null)}
          onGoToRoom={() => {
            const isMod = modules.some((m) => m.id === panelId);
            dockAndGo(isMod ? panelId : 'projects', panelId);
            setPanelId(null);
          }}
          onRenameProject={async (name) => {
            const { error } = await supabase.from('projects').update({ name }).eq('id', panelId);
            if (error) console.error('rename project failed', error);
          }}
          updateNodeTitle={updateNodeTitle}
          updateNodeTags={updateNodeTags}
          createEdge={createEdge}
          deleteEdge={deleteEdge}
        />
      )}
      {showAiReview && (
        <AiReviewPanel
          nodes={nodes}
          edges={edges}
          onClose={() => setShowAiReview(false)}
          confirmEdge={confirmEdge}
          correctEdge={correctEdge}
          deleteEdge={deleteEdge}
          confirmNodeTags={confirmNodeTags}
          updateNodeTags={updateNodeTags}
        />
      )}
    </section>
  );
}

/** Part A.2/B — the slide-in details panel opened by clicking (not
 * dragging) a ring node. `dockAndGo`/room navigation stays available as an
 * explicit "Go to room" action here (or a literal double-click on the node
 * itself) rather than firing immediately on click, per the brief.
 *
 * Editing (rename/tags/associations) only applies to real graph nodes:
 * module ring icons are app routes, not database rows, so a module's panel
 * is read-only info + navigation. A project ring icon's panel lists the
 * real captured nodes filed under that project (from coreGraph.nodes) —
 * each independently editable via the coreGraph methods from part B — plus
 * an associations editor between them (createEdge/deleteEdge), which is
 * also the real signal fed back into future AI classification (part C). */
function NodePanel({
  isProject,
  name,
  groupId,
  groupMembers,
  nodes,
  edges,
  onClose,
  onGoToRoom,
  onRenameProject,
  updateNodeTitle,
  updateNodeTags,
  createEdge,
  deleteEdge,
}: {
  isProject: boolean;
  name: string;
  groupId?: string;
  groupMembers: string[];
  nodes: import('../../core/types').NodeRecord[];
  edges: import('../../core/types').EdgeRecord[];
  onClose: () => void;
  onGoToRoom: () => void;
  onRenameProject: (name: string) => void;
  updateNodeTitle: (id: string, title: string) => Promise<void>;
  updateNodeTags: (id: string, tags: string[]) => Promise<void>;
  createEdge: (from: string, to: string, relation?: import('../../core/types').EdgeRecord['relation']) => Promise<void>;
  deleteEdge: (id: string) => Promise<void>;
}) {
  const [projectName, setProjectName] = useState(name);
  const [addFrom, setAddFrom] = useState(nodes[0]?.id ?? '');
  const [addTo, setAddTo] = useState(nodes[1]?.id ?? '');

  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeName = (id: string) => nodes.find((n) => n.id === id)?.title || id;

  return (
    <div id="corePanelOverlay" onClick={onClose}>
      <aside id="corePanel" onClick={(e) => e.stopPropagation()}>
        <div id="corePanelHead">
          {isProject ? (
            <input
              id="corePanelName"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onBlur={() => projectName.trim() && projectName !== name && onRenameProject(projectName.trim())}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <h3>{name}</h3>
          )}
          <button id="corePanelClose" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>

        {groupId && groupMembers.length > 0 && (
          <div className="corePanelSection">
            <div className="corePanelLabel">GROUPED WITH</div>
            <div className="corePanelChips">
              {groupMembers.map((gm) => (
                <span key={gm} className="corePanelChip">{gm}</span>
              ))}
            </div>
          </div>
        )}

        {isProject ? (
          <>
            <div className="corePanelSection">
              <div className="corePanelLabel">NODES IN THIS PROJECT ({nodes.length})</div>
              {nodes.length === 0 && <div className="corePanelEmpty">Nothing captured here yet.</div>}
              <div className="corePanelNodeList">
                {nodes.map((n) => (
                  <PanelNodeRow
                    key={n.id}
                    node={n}
                    edges={edges}
                    nodeName={nodeName}
                    updateNodeTitle={updateNodeTitle}
                    updateNodeTags={updateNodeTags}
                    deleteEdge={deleteEdge}
                  />
                ))}
              </div>
            </div>
            {nodes.length > 1 && (
              <div className="corePanelSection">
                <div className="corePanelLabel">ADD ASSOCIATION</div>
                <div className="corePanelAddRow">
                  <select value={addFrom} onChange={(e) => setAddFrom(e.target.value)}>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>{n.title || n.kind}</option>
                    ))}
                  </select>
                  <Icon name="link" size={12} />
                  <select value={addTo} onChange={(e) => setAddTo(e.target.value)}>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>{n.title || n.kind}</option>
                    ))}
                  </select>
                  <button
                    disabled={!addFrom || !addTo || addFrom === addTo}
                    onClick={() => createEdge(addFrom, addTo, 'relates_to')}
                  >
                    <Icon name="plus" size={12} />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="corePanelSection">
            <div className="corePanelEmpty">
              System module — not a data record, so there&apos;s nothing here to rename or tag. {nodeIds.size} node{nodeIds.size === 1 ? '' : 's'} route through it.
            </div>
          </div>
        )}

        <div className="corePanelFoot">
          <button id="corePanelGo" onClick={onGoToRoom}>
            GO TO ROOM <Icon name="chevronRight" size={12} />
          </button>
        </div>
      </aside>
    </div>
  );
}

/** One editable row inside a project's node list — title (blur-to-save),
 * tags (chip input), and its own associations (edges touching it) with
 * remove buttons. Kept as its own component so each row owns its local
 * edit-buffer state independently. */
function PanelNodeRow({
  node,
  edges,
  nodeName,
  updateNodeTitle,
  updateNodeTags,
  deleteEdge,
}: {
  node: import('../../core/types').NodeRecord;
  edges: import('../../core/types').EdgeRecord[];
  nodeName: (id: string) => string;
  updateNodeTitle: (id: string, title: string) => Promise<void>;
  updateNodeTags: (id: string, tags: string[]) => Promise<void>;
  deleteEdge: (id: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(node.title);
  const [tagInput, setTagInput] = useState('');
  const tags = ((node.metadata as Record<string, unknown> | undefined)?.tags as string[] | undefined) ?? [];
  const touching = edges.filter((e) => e.from_node === node.id || e.to_node === node.id);

  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) return;
    updateNodeTags(node.id, [...tags, t]);
    setTagInput('');
  }
  function removeTag(t: string) {
    updateNodeTags(node.id, tags.filter((x) => x !== t));
  }

  return (
    <div className="corePanelNodeRow">
      <input
        className="corePanelNodeTitle"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== node.title && updateNodeTitle(node.id, title.trim())}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <div className="corePanelChips">
        {tags.map((t) => (
          <span key={t} className="corePanelChip">
            {t} <span className="corePanelChipX" onClick={() => removeTag(t)}>×</span>
          </span>
        ))}
        <input
          className="corePanelTagInput"
          placeholder="+ tag"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTag()}
          onBlur={addTag}
        />
      </div>
      {touching.length > 0 && (
        <div className="corePanelAssoc">
          {touching.map((e) => {
            const otherId = e.from_node === node.id ? e.to_node : e.from_node;
            return (
              <span key={e.id} className="corePanelAssocRow">
                <Icon name="link" size={10} /> {nodeName(otherId)}
                <span className="corePanelChipX" onClick={() => deleteEdge(e.id)}>×</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
