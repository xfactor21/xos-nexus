import { useEffect, useRef } from 'react';

/**
 * Cockpit redesign — global ambient particle field. Replaces the 9 separate
 * per-room <AmbientField> instances from Amendment v0.6 step 3 with ONE
 * canvas mounted once in Shell.tsx, always running behind every room (the
 * brief's literal requirement: "throughout every room at all times", not
 * gated per-room). 80-100 slow-drifting particles in mg/pu/cy, matching the
 * reference mockup's #particles canvas 1:1 (same particle count, same drift
 * speed, same trail-fade technique via a low-alpha fillRect each frame
 * instead of clearRect, which is what gives the particles their soft
 * streak/glow trail rather than a hard-edged dot).
 */
const HUES = ['255,45,120', '139,92,246', '0,245,255'];

interface Particle {
  x: number; y: number; r: number; dx: number; dy: number; hue: string; tw: number;
}

export default function GlobalParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const raf = useRef<number>(0);

  useEffect(() => {
    const cv = canvasRef.current;
    const cc = cv?.getContext('2d');
    if (!cv || !cc) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let W = 0, H = 0;
    let pts: Particle[] = [];
    function seed() {
      pts = Array.from({ length: 90 }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.4 + Math.random() * 1.4,
        dx: (Math.random() - 0.5) * 0.28, dy: (Math.random() - 0.5) * 0.18,
        hue: HUES[Math.floor(Math.random() * HUES.length)],
        tw: Math.random() * 6.28,
      }));
    }
    function resize() {
      if (!cv) return;
      W = cv.width = window.innerWidth;
      H = cv.height = window.innerHeight;
      seed();
    }
    resize();
    window.addEventListener('resize', resize);

    let t = 0;
    function draw() {
      if (!cv || !cc) return;
      t += reducedMotion ? 0 : 0.016;
      const glow = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--glow')) || 1;
      // Low-alpha fill instead of clearRect — leaves a soft fading trail
      // behind each particle, matching the reference mockup's technique.
      cc.fillStyle = 'rgba(5,8,13,0.35)';
      cc.fillRect(0, 0, W, H);
      pts.forEach((p) => {
        if (!reducedMotion) {
          p.x += p.dx; p.y += p.dy;
          if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
          if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
        }
        const b = (0.15 + 0.25 * Math.sin(t * 1.4 + p.tw)) * glow;
        cc.globalAlpha = b;
        cc.fillStyle = `rgba(${p.hue},1)`;
        cc.beginPath();
        cc.arc(p.x, p.y, p.r, 0, 6.29);
        cc.fill();
      });
      cc.globalAlpha = 1;
      raf.current = requestAnimationFrame(draw);
    }
    raf.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas className="globalParticles" ref={canvasRef} aria-hidden="true" />;
}
