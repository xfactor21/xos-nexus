import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as RMouseEvent, TouchEvent as RTouchEvent, WheelEvent as RWheelEvent } from 'react';

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

/** THE OBSERVATORY — ported 1:1 from xos-prototype.html (#uni canvas engine,
 * seed(), drawUni(), pan/pinch/zoom handlers, obsView chip switcher). */
export default function Observatory({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewMode>('const');
  const U = useRef({ z: 1, ox: 0, oy: 0, t: 0 });
  const stars = useRef<Star[]>([]);
  const cons = useRef<[number, number][]>([]);
  const web = useRef<[number, number][]>([]);
  const raf = useRef<number>(0);
  const viewRef = useRef<ViewMode>('const');
  viewRef.current = view;

  // seed — runs once
  useEffect(() => {
    const gal = [
      { nm: 'STUDYHIVE', cx: 0.3, cy: 0.34, hue: '#00F5FF', n: 14, bright: 1, age: 1 },
      { nm: 'MUSIC', cx: 0.72, cy: 0.3, hue: '#FF2D78', n: 8, bright: 0.7, age: 2 },
      { nm: 'WEBSITE', cx: 0.26, cy: 0.72, hue: '#FFB800', n: 6, bright: 0.32, age: 3 },
      { nm: 'NOVEL', cx: 0.72, cy: 0.7, hue: '#8B5CF6', n: 10, bright: 0.85, age: 2 },
    ];
    const S: Star[] = [];
    const C: [number, number][] = [];
    gal.forEach((g) => {
      const first = S.length;
      for (let i = 0; i < g.n; i++) {
        const a = Math.random() * 6.28,
          r = 0.045 + Math.random() * 0.12;
        S.push({
          x: g.cx + Math.cos(a) * r,
          y: g.cy + Math.sin(a) * r * 0.8,
          s: 1.2 + Math.random() * 2.2,
          b: g.bright * (0.5 + Math.random() * 0.5),
          hue: g.hue,
          nm: g.nm + ' · NODE ' + (i + 1),
          age: g.age + Math.floor(Math.random() * 3),
          mission: Math.random() < 0.18,
          tw: Math.random() * 6.28,
        });
      }
      for (let i = first; i < S.length - 1; i++) C.push([i, i + 1]);
      C.push([first, first + Math.floor(g.n / 2)]);
      S.push({ x: g.cx, y: g.cy, s: 4.4, b: g.bright, hue: g.hue, nm: g.nm + ' — PROJECT HEART', age: g.age, mission: g.bright > 0.6, hub: true, tw: 0 });
      C.push([first, S.length - 1]);
    });
    for (let i = 0; i < 90; i++)
      S.push({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random(), b: 0.14 + Math.random() * 0.2, hue: '#7ad9e0', nm: 'UNCHARTED THOUGHT', age: 1 + Math.floor(Math.random() * 4), mission: false, tw: Math.random() * 6.28 });
    stars.current = S;
    cons.current = C;
    web.current = [[3, 18], [9, 30], [22, 35], [5, 40], [15, 33], [1, 28]];
  }, []);

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

  useEffect(() => {
    resize();
    const onResize = () => {
      if (sectionRef.current?.classList.contains('on')) resize();
    };
    addEventListener('resize', onResize);

    function draw() {
      const cv = canvasRef.current;
      const ux = cv?.getContext('2d');
      if (!cv || !ux) return;
      const u = U.current;
      u.t += 0.016;
      ux.fillStyle = '#05080D';
      ux.fillRect(0, 0, cv.width, cv.height);
      const ph = (u.t / 2.2) % 5;
      const v = viewRef.current;
      if (v === 'const' || v === 'mission' || v === 'time') {
        cons.current.forEach(([a, b]) => {
          const A = stars.current[a],
            B = stars.current[b];
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
      stars.current.forEach((st) => {
        if (v === 'time' && st.age > ph) return;
        let b = st.b * (0.75 + 0.25 * Math.sin(u.t * 1.7 + st.tw));
        if (v === 'mission') b *= st.mission ? 1.25 : 0.14;
        ux.globalAlpha = Math.min(1, b);
        ux.fillStyle = st.hue;
        const X = sx(cv, st),
          Y = sy(cv, st),
          S = st.s * u.z;
        ux.beginPath();
        ux.arc(X, Y, S, 0, 6.29);
        ux.fill();
        if (st.hub || S > 3) {
          ux.globalAlpha = b * 0.25;
          ux.beginPath();
          ux.arc(X, Y, S * 3, 0, 6.29);
          ux.fill();
        }
      });
      if (v !== 'neural') {
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
        ux.fillText('⌛ SPRINT ' + Math.min(4, Math.ceil(ph)) + ' — FLYING THROUGH HISTORY', 12, cv.height - 12);
      }
      ux.globalAlpha = 1;
      raf.current = requestAnimationFrame(draw);
    }
    raf.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf.current);
      removeEventListener('resize', onResize);
    };
  }, []);

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
  function onClick(e: RMouseEvent) {
    const cv = canvasRef.current;
    if (!cv) return;
    const r = cv.getBoundingClientRect(),
      mx = e.clientX - r.left,
      my = e.clientY - r.top;
    let hit: Star | null = null;
    stars.current.forEach((st) => {
      if (Math.hypot(sx(cv, st) - mx, sy(cv, st) - my) < Math.max(10, st.s * U.current.z * 2.4)) hit = st;
    });
    const tip = tipRef.current;
    if (hit && tip) {
      const h = hit as Star;
      tip.textContent = '✦ ' + h.nm + (h.mission ? ' · ▸ TODAY' : '') + (h.b < 0.4 ? ' · DIMMING' : '');
      tip.style.left = Math.min(mx + 14, cv.width - 180) + 'px';
      tip.style.top = my - 8 + 'px';
      tip.style.opacity = '1';
      setTimeout(() => {
        if (tip) tip.style.opacity = '0';
      }, 2400);
    }
  }
  function onWheel(e: RWheelEvent) {
    U.current.z = Math.min(3, Math.max(0.5, U.current.z * (e.deltaY < 0 ? 1.1 : 0.9)));
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
        onWheel={onWheel}
      />
      <div id="obsHead">
        <h1>THE OBSERVATORY</h1>
        <p>"WHAT IS MY MIND CREATING?"</p>
      </div>
      <div id="views">
        {(
          [
            ['const', '✨ CONSTELLATION'],
            ['neural', '🧠 NEURAL'],
            ['time', '⌛ TIMELINE'],
            ['mission', '▸ MISSION'],
          ] as [ViewMode, string][]
        ).map(([v, label]) => (
          <span key={v} className={`chip ${view === v ? 'on' : ''}`} onClick={() => setView(v)}>
            {label}
          </span>
        ))}
      </div>
      <div id="starTip" ref={tipRef} />
    </section>
  );
}
