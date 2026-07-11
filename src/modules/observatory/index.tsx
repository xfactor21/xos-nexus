import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as RMouseEvent, TouchEvent as RTouchEvent, WheelEvent as RWheelEvent } from 'react';
import { useCoreGraph } from '../../stores/coreGraph';
import Icon from '../../design-system/icons/Icon';
import type { IconName } from '../../design-system/icons/registry';

type ViewMode = 'const' | 'neural' | 'time' | 'mission';

interface Star {
  x: number;
  y: number;
  s: number;
  b: number;
  hue: string;
  nm: string;
  age: number;
  mission: boolean;
  hub?: boolean;
  tw: number;
}

interface Nebula {
  cx: number;
  cy: number;
  r: number;
  hue: [number, number, number]; // rgb
  alpha: number;
}

interface Comet {
  aIdx: number;
  bIdx: number;
  t: number; // 0..1 progress
  hue: string;
}

/**
 * THE OBSERVATORY — ported 1:1 from xos-prototype.html (#uni canvas engine,
 * seed(), drawUni(), pan/pinch/zoom handlers, obsView chip switcher), then
 * extended per Blueprint v0.3 Amendment v0.2's flagship bar for this room
 * ("a real galaxy exploration sim — Elite Dangerous' galaxy map / No Man's
 * Sky-caliber depth, scale, real navigation"):
 *
 *  - Zoom-based depth reveal: the existing pan/pinch/wheel zoom gesture now
 *    has real semantic tiers — zoomed out (z<1.3) shows only project "hub"
 *    stars (the galaxy view); zoomed in (1.3–2.3) reveals individual node
 *    stars (the system view); double-clicking a star focuses+flies the
 *    camera to it and reveals its "moons" — nodes connected to it by a real
 *    edge, orbiting live (the star view). This isn't three different UIs,
 *    it's the same star field with tier-gated rendering + one extra layer.
 *  - Real travel, not a toggle: focusing a star eases the camera (ox/oy/z)
 *    toward it over ~700ms instead of snapping — an actual flight, not an
 *    instant cut. Un-focusing eases back out the same way.
 *  - Comet events: when the live graph gains a genuinely new edge (diffed
 *    against the previous edge-id set, not simulated), a real comet
 *    animates between its two stars over ~1.1s.
 *  - Procedural nebula coloring: soft background clouds per project,
 *    colored from that project's actual `health` (0-100), not fixed hexes.
 *  - Draggable timeline scrub in Timeline view, replacing the previous
 *    auto-loop-only phase with a real scrubbable range input (auto-loop
 *    remains available via a toggle).
 *  - Shareable snapshot export — the canvas already contains everything
 *    rendered, so export is a genuine `toBlob` capture, not a mockup.
 */
export default function Observatory({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewMode>('const');
  const U = useRef({ z: 1, ox: 0, oy: 0, t: 0 });
  const stars = useRef<Star[]>([]);
  const cons = useRef<[number, number][]>([]);
  const web = useRef<[number, number][]>([]);
  const nebulae = useRef<Nebula[]>([]);
  const comets = useRef<Comet[]>([]);
  const prevEdgeIds = useRef<Set<string> | null>(null);
  const raf = useRef<number>(0);
  const viewRef = useRef<ViewMode>('const');
  viewRef.current = view;

  // real travel: camera flight state + which star (if any) is focused
  const focusIdx = useRef<number | null>(null);
  const flight = useRef<null | { from: { ox: number; oy: number; z: number }; to: { ox: number; oy: number; z: number }; t: number; dur: number }>(null);
  const moonSeeds = useRef<Map<number, { angle: number; r: number; speed: number }>>(new Map());
  const [focused, setFocused] = useState(false); // mirrors focusIdx for the "◂ ZOOM OUT" affordance

  // draggable timeline scrub
  const [autoTime, setAutoTime] = useState(true);
  const [scrubPhase, setScrubPhase] = useState(0);
  const scrubRef = useRef(0);

  const projects = useCoreGraph((s) => s.projects);
  const nodes = useCoreGraph((s) => s.nodes);
  const edges = useCoreGraph((s) => s.edges);

  // seed — re-runs whenever the live graph changes (hydrate or realtime)
  useEffect(() => {
    const S: Star[] = [];
    const C: [number, number][] = [];
    const N: Nebula[] = [];
    const starIndexByNodeId = new Map<string, number>();
    const dayOf = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

    projects.forEach((p, i) => {
      const angle = (i / Math.max(1, projects.length)) * 6.283 - Math.PI / 2;
      const cx = 0.5 + Math.cos(angle) * 0.24;
      const cy = 0.5 + Math.sin(angle) * 0.2;
      const bright = Math.max(0.2, p.health / 100);
      const projNodes = nodes.filter((n) => n.project_id === p.id);
      const first = S.length;

      projNodes.forEach((n) => {
        const a = Math.random() * 6.28,
          r = 0.045 + Math.random() * 0.12;
        starIndexByNodeId.set(n.id, S.length);
        S.push({
          x: cx + Math.cos(a) * r,
          y: cy + Math.sin(a) * r * 0.8,
          s: 1.2 + Math.random() * 2.2,
          b: bright * (0.5 + Math.random() * 0.5),
          hue: p.color,
          nm: p.name.toUpperCase() + ' · ' + n.title,
          age: Math.min(4, Math.floor(dayOf(n.created_at) / 7) + 1),
          mission: n.ai_classified,
          tw: Math.random() * 6.28,
        });
      });
      if (S.length > first) C.push([first, first + Math.floor((S.length - first) / 2)]);

      starIndexByNodeId.set('__hub__' + p.id, S.length);
      S.push({ x: cx, y: cy, s: 4.4, b: bright, hue: p.color, nm: p.name.toUpperCase() + ' — PROJECT HEART', age: p.isStale ? 3 : 1, mission: !p.isStale, hub: true, tw: 0 });
      if (S.length > first + 1) C.push([first, S.length - 1]);

      // procedural nebula: real project health drives hue (healthy = cyan/
      // green, ailing = amber/red) and size drives with how many nodes it has.
      const healthT = Math.max(0, Math.min(1, p.health / 100));
      const hue: [number, number, number] = [Math.round(255 - healthT * 210), Math.round(70 + healthT * 175), Math.round(90 + healthT * 90)];
      N.push({ cx, cy, r: 0.1 + Math.min(0.16, projNodes.length * 0.012), hue, alpha: 0.16 + healthT * 0.1 });
    });

    // Nodes not attached to any project — the prototype's "uncharted thought" field.
    nodes
      .filter((n) => !n.project_id)
      .forEach((n) => {
        starIndexByNodeId.set(n.id, S.length);
        S.push({
          x: Math.random(),
          y: Math.random(),
          s: 0.6 + Math.random(),
          b: 0.14 + Math.random() * 0.2,
          hue: '#7ad9e0',
          nm: 'UNCHARTED THOUGHT · ' + n.title,
          age: Math.min(4, Math.floor(dayOf(n.created_at) / 7) + 1),
          mission: n.ai_classified,
          tw: Math.random() * 6.28,
        });
      });

    // Real edges become constellation lines wherever both endpoints are stars.
    edges.forEach((e) => {
      const a = starIndexByNodeId.get(e.from_node);
      const b = starIndexByNodeId.get(e.to_node);
      if (a !== undefined && b !== undefined) C.push([a, b]);
    });

    stars.current = S;
    cons.current = C;
    web.current = C;
    nebulae.current = N;

    // comet events — diff against the previously-seen edge id set; only
    // genuinely new edges (not the initial hydrate) trigger a comet.
    const nextIds = new Set(edges.map((e) => e.id));
    if (prevEdgeIds.current) {
      edges.forEach((e) => {
        if (prevEdgeIds.current!.has(e.id)) return;
        const a = starIndexByNodeId.get(e.from_node);
        const b = starIndexByNodeId.get(e.to_node);
        if (a === undefined || b === undefined) return;
        comets.current.push({ aIdx: a, bIdx: b, t: 0, hue: '#FFB800' });
      });
    }
    prevEdgeIds.current = nextIds;
  }, [projects, nodes, edges]);

  function resize() {
    const cv = canvasRef.current,
      sec = sectionRef.current;
    if (!cv || !sec) return;
    cv.width = sec.clientWidth;
    cv.height = sec.clientHeight;
  }

  function sx(cv: HTMLCanvasElement, st: Star) {
    const u = U.current;
    return (st.x * cv.width + u.ox) * u.z + (cv.width * (1 - u.z)) / 2;
  }
  function sy(cv: HTMLCanvasElement, st: Star) {
    const u = U.current;
    return (st.y * cv.height + u.oy) * u.z + (cv.height * (1 - u.z)) / 2;
  }

  /** Real travel: eases the camera toward centering `idx` (or back to the
   * identity camera when idx is null) instead of snapping — an actual
   * flight with easing, matching the amendment's "real travel, not toggle"
   * directive applied to star-level navigation. */
  function flyTo(idx: number | null) {
    const cv = canvasRef.current;
    if (!cv) return;
    const from = { ...U.current };
    let to: { ox: number; oy: number; z: number };
    if (idx === null) {
      to = { ox: 0, oy: 0, z: 1 };
    } else {
      const st = stars.current[idx];
      const z = 2.6;
      // solve ox/oy directly from sx/sy's own formula so the target star
      // lands exactly at canvas center under the target zoom:
      //   (st.x*cv.width + ox)*z + cv.width*(1-z)/2 = cv.width/2
      to = {
        ox: (cv.width / 2 - (cv.width * (1 - z)) / 2) / z - st.x * cv.width,
        oy: (cv.height / 2 - (cv.height * (1 - z)) / 2) / z - st.y * cv.height,
        z,
      };
    }
    flight.current = { from, to, t: 0, dur: 0.7 };
    focusIdx.current = idx;
    setFocused(idx !== null);
    if (idx !== null) {
      // seed stable per-focus orbit params for this star's moons
      moonSeeds.current = new Map();
      cons.current.forEach(([a, b]) => {
        const other = a === idx ? b : b === idx ? a : null;
        if (other === null) return;
        if (!moonSeeds.current.has(other)) {
          moonSeeds.current.set(other, { angle: Math.random() * 6.28, r: 34 + Math.random() * 26, speed: 0.4 + Math.random() * 0.5 });
        }
      });
    }
  }

  useEffect(() => {
    resize();
    const onResize = () => {
      if (sectionRef.current?.classList.contains('on')) resize();
    };
    addEventListener('resize', onResize);

    function easeInOut(t: number) {
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    function draw() {
      const cv = canvasRef.current;
      const ux = cv?.getContext('2d');
      if (!cv || !ux) return;
      const u = U.current;
      u.t += 0.016;

      // advance camera flight easing
      if (flight.current) {
        const f = flight.current;
        f.t = Math.min(1, f.t + 0.016 / f.dur);
        const e = easeInOut(f.t);
        u.ox = f.from.ox + (f.to.ox - f.from.ox) * e;
        u.oy = f.from.oy + (f.to.oy - f.from.oy) * e;
        u.z = f.from.z + (f.to.z - f.from.z) * e;
        if (f.t >= 1) flight.current = null;
      }

      ux.fillStyle = '#05080D';
      ux.fillRect(0, 0, cv.width, cv.height);

      // procedural nebula clouds, behind everything — real health-driven color
      nebulae.current.forEach((n) => {
        const X = (n.cx * cv.width + u.ox) * u.z + (cv.width * (1 - u.z)) / 2;
        const Y = (n.cy * cv.height + u.oy) * u.z + (cv.height * (1 - u.z)) / 2;
        const R = n.r * Math.min(cv.width, cv.height) * u.z;
        const g = ux.createRadialGradient(X, Y, 0, X, Y, R);
        const [r, gg, b] = n.hue;
        g.addColorStop(0, `rgba(${r},${gg},${b},${n.alpha})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ux.fillStyle = g;
        ux.globalAlpha = 1;
        ux.beginPath();
        ux.arc(X, Y, R, 0, 6.29);
        ux.fill();
      });

      const ph = autoTime ? (u.t / 2.2) % 5 : scrubRef.current;
      const v = viewRef.current;
      // zoom-based depth reveal tiers — galaxy (hub-only) / system (stars) / star (focused, moons)
      const tier: 'galaxy' | 'system' | 'star' = focusIdx.current !== null ? 'star' : u.z < 1.3 ? 'galaxy' : 'system';

      if (v === 'const' || v === 'mission' || v === 'time') {
        cons.current.forEach(([a, b]) => {
          const A = stars.current[a],
            B = stars.current[b];
          if (!A || !B) return;
          if (tier === 'galaxy' && !A.hub && !B.hub) return; // galaxy view: only hub-to-hub/adjacent lines
          if (v === 'time' && (A.age > ph || B.age > ph)) return;
          const al = v === 'mission' ? ((A.mission || B.mission) ? 0.35 : 0.05) : 0.22 * Math.min(A.b, B.b) + 0.06;
          ux.strokeStyle = A.hue;
          ux.globalAlpha = al;
          ux.lineWidth = 0.7;
          ux.beginPath();
          ux.moveTo(sx(cv, A), sy(cv, A));
          ux.lineTo(sx(cv, B), sy(cv, B));
          ux.stroke();
        });
      }
      if (v === 'neural') {
        ux.globalAlpha = 0.16;
        ux.lineWidth = 0.6;
        cons.current.forEach(([a, b]) => {
          const A = stars.current[a],
            B = stars.current[b];
          if (!A || !B) return;
          ux.strokeStyle = '#00F5FF';
          ux.beginPath();
          ux.moveTo(sx(cv, A), sy(cv, A));
          ux.lineTo(sx(cv, B), sy(cv, B));
          ux.stroke();
        });
        web.current.forEach(([a, b], i) => {
          const A = stars.current[a],
            B = stars.current[b];
          if (!A || !B) return;
          ux.strokeStyle = '#8B5CF6';
          ux.globalAlpha = 0.3 + 0.15 * Math.sin(u.t * 2 + i);
          ux.beginPath();
          ux.moveTo(sx(cv, A), sy(cv, A));
          ux.lineTo(sx(cv, B), sy(cv, B));
          ux.stroke();
        });
      }
      stars.current.forEach((st, idx) => {
        if (v === 'time' && st.age > ph) return;
        if (tier === 'galaxy' && !st.hub) return; // galaxy view: hub stars only
        if (tier === 'star' && idx !== focusIdx.current && !moonSeeds.current.has(idx)) return; // star view: focused star + its moons only
        let b = st.b * (0.75 + 0.25 * Math.sin(u.t * 1.7 + st.tw));
        if (v === 'mission') b *= st.mission ? 1.25 : 0.14;
        ux.globalAlpha = Math.min(1, b);
        ux.fillStyle = st.hue;

        let X = sx(cv, st),
          Y = sy(cv, st);
        const moon = tier === 'star' ? moonSeeds.current.get(idx) : undefined;
        if (moon && focusIdx.current !== null) {
          const focal = stars.current[focusIdx.current];
          const fX = sx(cv, focal),
            fY = sy(cv, focal);
          moon.angle += moon.speed * 0.016;
          X = fX + Math.cos(moon.angle) * moon.r;
          Y = fY + Math.sin(moon.angle) * moon.r * 0.7;
          ux.strokeStyle = st.hue;
          ux.globalAlpha = 0.25;
          ux.lineWidth = 0.6;
          ux.beginPath();
          ux.moveTo(fX, fY);
          ux.lineTo(X, Y);
          ux.stroke();
          ux.globalAlpha = Math.min(1, b);
        }

        const S = (moon ? Math.max(2, st.s * 0.9) : st.s) * (moon ? 1 : u.z);
        ux.beginPath();
        ux.arc(X, Y, S, 0, 6.29);
        ux.fill();
        if (st.hub || S > 3) {
          ux.globalAlpha = b * 0.25;
          ux.beginPath();
          ux.arc(X, Y, S * 3, 0, 6.29);
          ux.fill();
        }
        if (moon) {
          ux.globalAlpha = 0.8;
          ux.font = '8px Share Tech Mono';
          ux.fillStyle = st.hue;
          ux.fillText(st.nm.split(' · ').pop() ?? st.nm, X + 8, Y + 3);
        }
      });
      if (v !== 'neural' && tier !== 'star') {
        ux.globalAlpha = 0.85;
        ux.font = '9px Share Tech Mono';
        stars.current
          .filter((s) => s.hub)
          .forEach((st) => {
            if (v === 'time' && st.age > ph) return;
            if (v === 'mission' && !st.mission) return;
            ux.fillStyle = st.hue;
            ux.fillText(st.nm.split(' —')[0], sx(cv, st) + 10, sy(cv, st) + 3);
          });
      }
      if (v === 'time') {
        ux.globalAlpha = 0.9;
        ux.fillStyle = '#607080';
        ux.font = '9px Share Tech Mono';
        // Canvas 2D fillText — non-JSX context, glyph stripped (Amendment v0.6 step 1)
        ux.fillText('SPRINT ' + Math.min(4, Math.ceil(ph)) + (autoTime ? ' — FLYING THROUGH HISTORY' : ' — SCRUBBING'), 12, cv.height - 34);
      }

      // comet events — a real comet animates between two stars whenever a
      // genuinely new edge appears in the live graph (spawned in the seed
      // effect above, advanced/drawn here every frame).
      comets.current = comets.current.filter((c) => c.t < 1);
      comets.current.forEach((c) => {
        c.t += 0.016 / 1.1;
        const A = stars.current[c.aIdx],
          B = stars.current[c.bIdx];
        if (!A || !B) return;
        const ax = sx(cv, A),
          ay = sy(cv, A),
          bx = sx(cv, B),
          by = sy(cv, B);
        const cx = ax + (bx - ax) * c.t,
          cy = ay + (by - ay) * c.t;
        const grad = ux.createLinearGradient(ax, ay, cx, cy);
        grad.addColorStop(0, 'rgba(255,184,0,0)');
        grad.addColorStop(1, c.hue);
        ux.strokeStyle = grad;
        ux.globalAlpha = 0.8;
        ux.lineWidth = 1.4;
        ux.beginPath();
        ux.moveTo(ax, ay);
        ux.lineTo(cx, cy);
        ux.stroke();
        ux.globalAlpha = 1;
        ux.fillStyle = c.hue;
        ux.beginPath();
        ux.arc(cx, cy, 2.4, 0, 6.29);
        ux.fill();
      });

      ux.globalAlpha = 1;
      raf.current = requestAnimationFrame(draw);
    }
    raf.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf.current);
      removeEventListener('resize', onResize);
    };
  }, [autoTime]);

  useEffect(() => {
    if (active) setTimeout(resize, 50);
  }, [active]);

  // drag / pinch / wheel
  const drag = useRef<[number, number] | null>(null);
  const pinch = useRef<{ d: number; z: number } | null>(null);
  function pt(e: RMouseEvent | RTouchEvent | TouchEvent | MouseEvent): [number, number] {
    const t = 'touches' in e && e.touches.length ? e.touches[0] : (e as MouseEvent);
    return [t.clientX, t.clientY];
  }
  function onDown(e: RMouseEvent | RTouchEvent) {
    if ('touches' in e && e.touches.length === 2) {
      pinch.current = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), z: U.current.z };
    } else drag.current = pt(e);
  }
  function onMove(e: RMouseEvent | RTouchEvent) {
    if (pinch.current && 'touches' in e && e.touches.length === 2) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      U.current.z = Math.min(3, Math.max(0.5, (pinch.current.z * d) / pinch.current.d));
      return;
    }
    if (!drag.current) return;
    const p = pt(e);
    U.current.ox += (p[0] - drag.current[0]) / U.current.z;
    U.current.oy += (p[1] - drag.current[1]) / U.current.z;
    drag.current = p;
  }
  function onUp() {
    drag.current = null;
    pinch.current = null;
  }
  function hitTest(e: RMouseEvent): number | null {
    const cv = canvasRef.current;
    if (!cv) return null;
    const r = cv.getBoundingClientRect(),
      mx = e.clientX - r.left,
      my = e.clientY - r.top;
    let hitIdx: number | null = null;
    stars.current.forEach((st, i) => {
      if (Math.hypot(sx(cv, st) - mx, sy(cv, st) - my) < Math.max(10, st.s * U.current.z * 2.4)) hitIdx = i;
    });
    return hitIdx;
  }
  function onClick(e: RMouseEvent) {
    const cv = canvasRef.current;
    if (!cv) return;
    const idx = hitTest(e);
    const tip = tipRef.current;
    if (idx !== null && tip) {
      const h = stars.current[idx];
      const r = cv.getBoundingClientRect(),
        mx = e.clientX - r.left,
        my = e.clientY - r.top;
      // DOM textContent — non-JSX context, glyphs stripped (Amendment v0.6 step 1)
      tip.textContent = h.nm + (h.mission ? ' · TODAY' : '') + (h.b < 0.4 ? ' · DIMMING' : '');
      tip.style.left = Math.min(mx + 14, cv.width - 180) + 'px';
      tip.style.top = my - 8 + 'px';
      tip.style.opacity = '1';
      setTimeout(() => {
        if (tip) tip.style.opacity = '0';
      }, 2400);
    }
  }
  function onDblClick(e: RMouseEvent) {
    const idx = hitTest(e);
    flyTo(idx); // double-clicking empty space (idx null) flies back out
  }
  function onWheel(e: RWheelEvent) {
    U.current.z = Math.min(3, Math.max(0.5, U.current.z * (e.deltaY < 0 ? 1.1 : 0.9)));
  }

  async function exportSnapshot() {
    const cv = canvasRef.current;
    if (!cv) return;
    const blob = await new Promise<Blob | null>((resolve) => cv.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xos-observatory-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <section ref={sectionRef} className={`room fullroom ${active ? 'on' : ''}`} id="r-obs">
      <canvas
        ref={canvasRef}
        id="uni"
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onTouchStart={onDown}
        onTouchMove={onMove}
        onTouchEnd={onUp}
        onClick={onClick}
        onDoubleClick={onDblClick}
        onWheel={onWheel}
      />
      <div id="obsHead">
        <h1>THE OBSERVATORY</h1>
        <p>"WHAT IS MY MIND CREATING?"</p>
      </div>
      <div id="views">
        {(
          [
            ['const', 'sparkles', 'CONSTELLATION'],
            ['neural', 'neuralCore', 'NEURAL'],
            ['time', 'hourglass', 'TIMELINE'],
            ['mission', 'mission', 'MISSION'],
          ] as [ViewMode, IconName, string][]
        ).map(([v, icon, label]) => (
          <span key={v} className={`chip ${view === v ? 'on' : ''}`} onClick={() => setView(v)}>
            <Icon name={icon} size={12} /> {label}
          </span>
        ))}
        <span className="chip" onClick={exportSnapshot} title="export a PNG snapshot of the current view">
          <Icon name="camera" size={12} /> SNAPSHOT
        </span>
        {focused && (
          <span className="chip on" onClick={() => flyTo(null)}>
            <Icon name="chevronLeft" size={12} /> ZOOM OUT
          </span>
        )}
      </div>
      {view === 'time' && (
        <div id="obsScrub">
          <span className={`chip ${autoTime ? 'on' : ''}`} onClick={() => setAutoTime((v) => !v)}>
            {autoTime ? (
              <>
                <Icon name="play" size={12} /> AUTO
              </>
            ) : (
              <>
                <Icon name="hand" size={12} /> MANUAL
              </>
            )}
          </span>
          <input
            type="range"
            min={0}
            max={4}
            step={0.01}
            value={scrubPhase}
            disabled={autoTime}
            onChange={(e) => {
              const v = +e.target.value;
              setScrubPhase(v);
              scrubRef.current = v;
            }}
          />
          <span className="obsScrubLabel">SPRINT {Math.min(4, Math.ceil(scrubRef.current))}</span>
        </div>
      )}
      <div id="starTip" ref={tipRef} />
    </section>
  );
}
