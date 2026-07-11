import { useEffect, useRef } from 'react';

/**
 * xOS Design System — Amendment v0.6 step 3 ("ambient living-background
 * system"). Root-cause per the amendment: "Only 2 rooms feel alive — ambient
 * background confined to Observatory/Neural Core." Those two rooms' canvases
 * are load-bearing data visualizations (star positions ARE project/node
 * data — see observatory/index.tsx and copilot/NeuralCore.tsx), not
 * decoration, so they keep their own bespoke implementations. Focus Time
 * already has a purely-decorative warp-starfield canvas that's the closest
 * existing thing to a generic ambient field — this component generalizes
 * that pattern (seeded particle drift, single canvas, RAF loop, cheap
 * resize handling) so every OTHER room can share one implementation instead
 * of each hand-rolling its own.
 *
 * Usage: render as the first child of a `.room.ambient` container, with the
 * room's real content wrapped in a sibling `.roomInner` div so it paints
 * above the canvas (see design-system.css's Step 3 section for the
 * position/z-index contract). Pick a `mood` per room per the amendment's own
 * examples ("Bug Tracker slightly warmer, Design Studio more chromatic,
 * Focus Time deeper/calmer blue") — same universe, different region, never
 * a flat solid panel.
 */

export type AmbientMood = 'cyan' | 'purple' | 'magenta' | 'amber' | 'warm' | 'coolBlue' | 'chromatic';

interface AmbientFieldProps {
  /** Per-room mood-tint — see AmbientMood. Defaults to 'cyan' (the base palette hue). */
  mood?: AmbientMood;
  /** Particle count. Lower for text-dense rooms (settings, comms), higher for spacious ones. */
  density?: number;
  /** Subtle mouse-parallax response (Amendment v0.6 step 4) — off by default so step 3
   * rooms get plain drift; step 4 turns this on room-by-room once depth work lands. */
  parallax?: boolean;
  /** RoomOutlet keeps every room mounted and toggles visibility via CSS (see its own doc
   * comment) — pass the room's own `active` prop through so this canvas skips its
   * per-frame particle/redraw work while hidden instead of animating an invisible room. */
  active?: boolean;
}

function hueFor(mood: AmbientMood): number {
  switch (mood) {
    case 'cyan': return 190;
    case 'purple': return 262;
    case 'magenta': return 328;
    case 'amber': return 36;
    case 'warm': return 18 + Math.random() * 26; // amber→red band, varies per particle
    case 'coolBlue': return 208 + Math.random() * 18;
    case 'chromatic': return Math.random() * 360; // Design Studio: full-spectrum, on-theme with a color tool
  }
}

interface Particle {
  x: number; // 0..1 normalized
  y: number;
  r: number;
  vx: number;
  vy: number;
  hue: number;
  baseAlpha: number;
  phase: number; // twinkle phase offset
}

/** Sizes the canvas's backing pixel buffer off its rendered box. Shared by
 * the mount-time resize and the activate-time resize below — a real bug
 * caught via screenshot: RoomOutlet mounts every room simultaneously and
 * toggles visibility via `display:none`/`block` (see its own doc comment),
 * so an inactive room's canvas measures 0×0 at mount time; without also
 * re-measuring the moment a room becomes active, it stays permanently 0×0
 * even after the room is shown (no native resize event fires just from a
 * CSS display change). */
function resizeCanvas(cv: HTMLCanvasElement | null): void {
  if (!cv) return;
  const rect = cv.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = rect.width * dpr;
  cv.height = rect.height * dpr;
  const cc = cv.getContext('2d');
  cc?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export default function AmbientField({ mood = 'cyan', density = 34, parallax = false, active = true }: AmbientFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const raf = useRef<number>(0);
  const particles = useRef<Particle[]>([]);
  const pointer = useRef({ x: 0, y: 0 }); // -1..1, current eased position
  const pointerTarget = useRef({ x: 0, y: 0 });
  const reducedMotion = useRef(false);
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
    if (active) resizeCanvas(canvasRef.current);
  }, [active]);

  useEffect(() => {
    reducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    particles.current = Array.from({ length: density }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.6 + Math.random() * 1.6,
      vx: (Math.random() - 0.5) * 0.00012,
      vy: (Math.random() - 0.5) * 0.00012,
      hue: hueFor(mood),
      baseAlpha: 0.15 + Math.random() * 0.35,
      phase: Math.random() * Math.PI * 2,
    }));

    // The canvas is `position:fixed;inset:0` (design-system.css) so CSS
    // alone already stretches it to the full viewport — reading size off
    // getBoundingClientRect() (post-CSS-layout) rather than the parent
    // room's clientWidth avoids a real bug: the room's own box is capped at
    // max-width:1100px, and setting `cv.style.width` explicitly would
    // override the `inset:0` sizing and shrink the field to that 1100px
    // column instead of the full screen. If this room isn't active yet
    // (display:none — see RoomOutlet), the rect is 0×0 here; the `active`
    // effect above re-measures once it actually becomes visible.
    function resize() {
      resizeCanvas(canvasRef.current);
    }
    resize();

    function onPointerMove(e: PointerEvent) {
      const cv = canvasRef.current;
      if (!cv) return;
      const rect = cv.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      pointerTarget.current = {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: ((e.clientY - rect.top) / rect.height) * 2 - 1,
      };
    }
    if (parallax) window.addEventListener('pointermove', onPointerMove);

    let t = 0;
    function draw() {
      const cv = canvasRef.current;
      const cc = cv?.getContext('2d');
      // hidden rooms stay mounted (RoomOutlet keeps every room's canvas/RAF
      // state alive across navigation) but skip the actual per-frame work.
      if (cv && cc && activeRef.current) {
        const w = cv.clientWidth, h = cv.clientHeight;
        cc.clearRect(0, 0, w, h);
        // read the user's neon-intensity token once per frame, not per particle
        const glow = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--glow')) || 1;

        // ease the parallax offset toward the pointer target — a real,
        // continuous response rather than a snap (Amendment v0.6 step 4).
        pointer.current.x += (pointerTarget.current.x - pointer.current.x) * 0.04;
        pointer.current.y += (pointerTarget.current.y - pointer.current.y) * 0.04;
        const px = parallax ? pointer.current.x * 10 : 0;
        const py = parallax ? pointer.current.y * 6 : 0;

        t += reducedMotion.current ? 0 : 1;
        particles.current.forEach((p) => {
          if (!reducedMotion.current) {
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < -0.02 || p.x > 1.02) p.vx *= -1;
            if (p.y < -0.02 || p.y > 1.02) p.vy *= -1;
          }
          const twinkle = reducedMotion.current ? 1 : 0.55 + 0.45 * Math.sin(t * 0.01 + p.phase);
          const cx = p.x * w + px;
          const cy = p.y * h + py;
          cc.beginPath();
          cc.fillStyle = `hsla(${p.hue}, 85%, 68%, ${p.baseAlpha * twinkle * 0.6 * glow})`;
          cc.arc(cx, cy, p.r, 0, Math.PI * 2);
          cc.fill();
        });
      }
      raf.current = requestAnimationFrame(draw);
    }
    raf.current = requestAnimationFrame(draw);

    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener('resize', resize);
      if (parallax) window.removeEventListener('pointermove', onPointerMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mood, density, parallax]);

  return <canvas className="ambientField" ref={canvasRef} aria-hidden="true" />;
}
