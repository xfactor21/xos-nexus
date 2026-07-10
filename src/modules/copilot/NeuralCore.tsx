import { useEffect, useRef, useState } from 'react';
import { liveClassify, offlineClassify, offlineCommit } from '../../lib/copilotClient';

const modules = [
  { id: 'capture', ic: '💭', nm: 'CAPTURE' },
  { id: 'projects', ic: '📂', nm: 'PROJECTS' },
  { id: 'focus', ic: '🎯', nm: 'FOCUS' },
  { id: 'studio', ic: '🎨', nm: 'STUDIO' },
  { id: 'roadmaps', ic: '🗺', nm: 'ROADMAPS' },
  { id: 'bugs', ic: '🐞', nm: 'BUGS' },
  { id: 'releases', ic: '📦', nm: 'RELEASES' },
  { id: 'vault', ic: '🗄', nm: 'VAULT' },
  { id: 'comms', ic: '📡', nm: 'COMMS' },
];
const projs = [
  { id: 'p-sh', ic: '🐝', nm: 'STUDYHIVE' },
  { id: 'p-mu', ic: '🎵', nm: 'MUSIC' },
  { id: 'p-we', ic: '🌐', nm: 'WEBSITE' },
  { id: 'p-no', ic: '📖', nm: 'NOVEL' },
];
const slugToProj: Record<string, string> = { studyhive: 'p-sh', music: 'p-mu', website: 'p-we', novel: 'p-no' };
const allMeta = [...modules, ...projs];

/** NEURAL CORE — ported 1:1 from xos-prototype.html: the "living mass" blob
 * canvas (drawCore), radial node layout (layoutCore), SVG routing-line
 * animation, and coreCapture() which calls the real classify-capture Edge
 * Function via lib/copilotClient's liveClassify(), falling back to the
 * offline mock classifier exactly as the prototype does. */
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
  const [msg, setMsg] = useState('');
  const [stats, setStats] = useState('147 NODES · 312 EDGES · CORE LEARNING');
  const [thought, setThought] = useState('');

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

    const mkNode = (d: { id: string; ic: string; nm: string }, cls: string, onClick: () => void) => {
      const [x, y] = pos[d.id];
      const el = document.createElement('div');
      el.className = 'cnode ' + cls;
      el.id = 'n-' + d.id;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.innerHTML = `<span class="bub">${d.ic}</span><span class="nm">${d.nm}</span>`;
      el.onclick = onClick;
      stage.appendChild(el);
    };
    modules.forEach((m) => mkNode(m, 'mod', () => window.dispatchEvent(new CustomEvent('xos-go', { detail: m.id }))));
    projs.forEach((p) => mkNode(p, 'proj', () => window.dispatchEvent(new CustomEvent('xos-go', { detail: 'projects' }))));

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
      const layers = [
        { hue: '138,92,246', ph: 0, sc: 1.22, al: 0.3 },
        { hue: '255,45,120', ph: 2.1, sc: 1.1, al: 0.26 },
        { hue: '255,184,0', ph: 4.2, sc: 1.0, al: 0.16 },
        { hue: '0,245,255', ph: 1.05, sc: 0.92, al: 0.55 },
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
      cc.strokeStyle = 'rgba(0,245,255,.5)';
      cc.lineWidth = 1.1;
      cc.globalAlpha = 0.5 + 0.3 * Math.sin(t * 1.3);
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
        p.a += p.sp * 0.012;
        const wob = 1 + 0.08 * Math.sin(t * 2 + p.a * 3);
        const x = cx + Math.cos(p.a) * p.r * orbBase * wob,
          y = cy + Math.sin(p.a) * p.r * orbBase * 0.8 * wob;
        cc.globalAlpha = 0.5 + 0.4 * Math.sin(t * 3 + p.a * 5);
        cc.fillStyle = p.hue;
        cc.beginPath();
        cc.arc(x, y, p.s, 0, 6.29);
        cc.fill();
      });
      if (Math.random() < 0.05) cStreams.current.push({ a: Math.random() * 6.29, d: 1, hue: ['#00F5FF', '#FF2D78', '#8B5CF6'][Math.floor(Math.random() * 3)] });
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
    setMsg('◈ xAI is thinking…');
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
      const projId = slugToProj[first.project_slug ?? ''] || 'p-sh';
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
        const tag = liveResult!.liveAI ? '◈ xAI (LIVE)' : '◈ xAI (KEY NOT SET)';
        setMsg(`${tag} · ${first.kind.toUpperCase()} → ${path.slice(1).map(nameOf).join(' → ')} · "${first.reasoning}"`);
        setTimeout(() => setMsg(''), 5200);
        setStats(liveResult!.liveAI ? 'LIVE NODE WRITTEN TO SUPABASE · CORE LEARNING' : 'NODE WRITTEN (fallback mode) · SET ANTHROPIC_API_KEY FOR LIVE AI');
      }, t);
      return;
    }

    // fallback: local mock classifier — Step 3 also writes a real node here
    // now (fire-and-forget; the animation below isn't gated on it) so a
    // capture still shows up live in Projects/Observatory even when live AI
    // is unavailable, instead of just being a visual-only demo.
    offlineCommit(v).catch((err) => console.error('coreCapture: offline fallback write failed', err));
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
      setMsg(`◈ ${c.label} (OFFLINE MOCK) → ${path.slice(1).map(nameOf).join(' → ')} · NODE CREATED`);
      setTimeout(() => setMsg(''), 3600);
      setStats('148 NODES · 314 EDGES · CORE LEARNING');
    }, t);
  }

  return (
    <section className={`room fullroom ${active ? 'on' : ''}`} id="r-core">
      <canvas ref={cvRef} id="coreCv" />
      <div id="coreStage" ref={stageRef}>
        <svg id="lines" ref={svgRef} />
        <div id="coreGreet">
          <h1>GOOD EVENING, CAPTAIN</h1>
          <p id="coreStats">{stats}</p>
        </div>
      </div>
      <div id="capWrap">
        <div id="capMsg">{msg}</div>
        <div id="capBar">
          <input
            id="thought"
            placeholder="Tell the Core anything…"
            autoComplete="off"
            value={thought}
            onChange={(e) => setThought(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && coreCapture()}
          />
          <button onClick={coreCapture}>◈</button>
        </div>
      </div>
    </section>
  );
}
