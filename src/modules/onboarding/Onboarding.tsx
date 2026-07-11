import { useEffect, useRef } from 'react';
import Icon from '../../design-system/icons/Icon';

type Mode = 'full' | 'returning';

/**
 * Amendment v0.6 step 1: this file's cinematic scene engine builds scenes as
 * raw HTML strings assigned via `.innerHTML` (a canvas/DOM sequencer, not
 * React JSX) — the shared `<Icon>` component is a React component and can't
 * be interpolated into those strings. Where the target is `.innerHTML`
 * (which *does* accept markup), these small inline-SVG string builders
 * mirror the exact same lucide-react path data + stroke/glow treatment the
 * shared Icon component uses, so the rendered result is visually identical.
 * Where the target is `.textContent` (plain text only, no markup allowed —
 * see `obsClick`'s star-hint tooltip below), the glyph is simply stripped.
 */
function svgIconHtml(paths: string, size = 13, glowVar: string | null = '--cyan'): string {
  const color = glowVar ? `var(${glowVar})` : 'var(--text-dim)';
  const glow = glowVar ? `filter:drop-shadow(0 0 2px ${color}) drop-shadow(0 0 6px ${color});` : '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em;color:${color};${glow}">${paths}</svg>`;
}
// xAI presence glyph — same path data as design-system/icons/XaiGlyph.tsx.
const XAI_SVG = svgIconHtml('<path d="M12 2 L20 12 L12 22 L4 12 Z"/><path d="M12 2 L12 22 M4 12 L20 12" stroke-opacity="0.55"/><circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none"/>', 13);
// chevron-right — same path data as lucide-react's ChevronRight (registry's "chevronRight").
const CHEVRON_RIGHT_SVG = svgIconHtml('<path d="m9 18 6-6-6-6"/>', 13);
// square (mission checkbox) — same path data as lucide-react's Square (registry's "square"), no glow (a checklist glyph, not a brand/status marker).
const SQUARE_SVG = svgIconHtml('<rect width="18" height="18" x="3" y="3" rx="2"/>', 12, null);

/**
 * ONBOARDING — Step 7 ("Persistent Launch Sequence + Returning-Captain
 * Flow"). Ported from `xos-flight-simulator.html` (the "source of truth for
 * look/feel" per the handoff doc): same 12-scene cinematic engine (canvas
 * starfield, cockpit canopy chrome, xAI hologram, synthesized audio), same
 * scene content and pacing. Two differences from a 1:1 port, both
 * deliberate:
 *
 * 1. No "TAP TO BEGIN" gate screen. The standalone prototype needed a
 *    manual link to demo both the first-run and returning-Captain paths in
 *    one file with no persistence available. In production, App.tsx already
 *    knows which path to take (from the real `has_completed_onboarding`
 *    flag) before this component ever mounts, so playback starts
 *    immediately in the right mode.
 *
 * 2. The prototype's `after(ms, fn)` scheduler stored a *single* shared
 *    timer handle and called `clearTimeout` on it before every new
 *    schedule — so of the several `after(...)` calls made back-to-back at
 *    the top of a scene function (all in the same synchronous tick), only
 *    the LAST one actually survives to fire; the earlier ones get
 *    cancelled before they ever run. In the prototype this silently drops
 *    the early-scene beats (e.g. scene1's "INITIALIZING… NEURAL CORE" text
 *    and mid-burst never actually show — only the final "cut to scene2"
 *    fires). That's a scheduling bug, not a deliberate pacing choice: nothing
 *    in the scene design implies those beats should be skipped, and this
 *    port aims for "more depth than the prototype," not less. Here every
 *    `after()` call gets its own independent, tracked timeout (scoped to
 *    the current scene and cleared on scene transition/unmount so a
 *    manually-skipped scene's dialogue can't bleed into the next one), so
 *    every written beat actually plays.
 */

const TOTAL_SCENES = 12;

export default function Onboarding({ mode, onComplete }: { mode: Mode; onComplete: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const holoCvRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLDivElement>(null);
  const holoWrapRef = useRef<HTMLDivElement>(null);
  const holoCapRef = useRef<HTMLDivElement>(null);
  const cockpitRef = useRef<HTMLDivElement>(null);
  const bridgeGlowRef = useRef<HTMLDivElement>(null);
  const blackoutRef = useRef<HTMLDivElement>(null);
  const starHintRef = useRef<HTMLDivElement>(null);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const cv = canvasRef.current;
    const hCv = holoCvRef.current;
    const scene = sceneRef.current;
    const dotsEl = dotsRef.current;
    const holoWrap = holoWrapRef.current;
    const holoCap = holoCapRef.current;
    const cockpit = cockpitRef.current;
    const bridgeGlow = bridgeGlowRef.current;
    const blackout = blackoutRef.current;
    const starHint = starHintRef.current;
    if (!cv || !hCv || !scene || !dotsEl || !holoWrap || !holoCap || !cockpit || !bridgeGlow || !blackout || !starHint) {
      return;
    }
    const ctx = cv.getContext('2d');
    const hx = hCv.getContext('2d');
    if (!ctx || !hx) return;

    let cancelled = false;
    let rafId = 0;
    let holoRafId = 0;
    const allTimeouts = new Set<number>();
    let sceneTimeouts: number[] = [];

    function after(ms: number, fn: () => void) {
      const id = window.setTimeout(() => {
        allTimeouts.delete(id);
        if (!cancelled) fn();
      }, ms);
      allTimeouts.add(id);
      sceneTimeouts.push(id);
      return id;
    }
    function clearSceneTimeouts() {
      sceneTimeouts.forEach((id) => {
        clearTimeout(id);
        allTimeouts.delete(id);
      });
      sceneTimeouts = [];
    }

    // ===== WORLD ENGINE =====
    let W = 0;
    let H = 0;
    function resize() {
      W = cv!.width = window.innerWidth;
      H = cv!.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    type BgStar = { x: number; y: number; r: number; tw: number; sp: number };
    type WorldStar = { x: number; y: number; r: number; targetR: number; alpha: number; hue: string; label: string; ph: number };
    type Edge = { a: number; b: number; prog: number; hue: string };
    type Particle = { x: number; y: number; vx: number; vy: number; size: number; hue: string; life: number; decay: number; target?: [number, number]; pull?: number; drag?: number };

    let bgStars: BgStar[] = [];
    let worldStars: WorldStar[] = [];
    let edges: Edge[] = [];
    let parts: Particle[] = [];
    let tGlobal = 0;
    const env = { zoom: 1, panX: 0, panY: 0, bright: 0, neb: [10, 16, 28] as number[], warp: 0, _rate: 0.02 };
    const envT = { zoom: 1, panX: 0, panY: 0, bright: 0, neb: [10, 16, 28] as number[], warp: 0 };

    function seedBg(n: number) {
      bgStars = [];
      for (let i = 0; i < n; i++) {
        bgStars.push({ x: (Math.random() - 0.5) * 2.4, y: (Math.random() - 0.5) * 2.4, r: 0.4 + Math.random() * 1.3, tw: Math.random() * 6.28, sp: 0.5 + Math.random() });
      }
    }
    seedBg(260);

    function lerp(a: number, b: number, r: number) {
      return a + (b - a) * r;
    }
    function setEnv(target: Partial<typeof envT>, rate?: number) {
      Object.assign(envT, target);
      env._rate = rate ?? 0.03;
    }
    function stepEnv() {
      const r = env._rate || 0.02;
      env.zoom = lerp(env.zoom, envT.zoom, r);
      env.panX = lerp(env.panX, envT.panX, r * 0.8);
      env.panY = lerp(env.panY, envT.panY, r * 0.8);
      env.bright = lerp(env.bright, envT.bright, r * 1.2);
      env.warp = lerp(env.warp, envT.warp, 0.06);
      for (let i = 0; i < 3; i++) env.neb[i] = lerp(env.neb[i], envT.neb[i], r);
    }

    function loop() {
      tGlobal += 0.016;
      stepEnv();
      const wob = 0.15;
      const px = env.panX + Math.sin(tGlobal * 0.09) * wob * 20;
      const py = env.panY + Math.cos(tGlobal * 0.07) * wob * 14;

      ctx!.fillStyle = '#000';
      ctx!.fillRect(0, 0, W, H);
      const neb = env.neb;
      const g = ctx!.createRadialGradient(W * 0.5 + px * 0.3, H * 0.42 + py * 0.3, 20, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
      g.addColorStop(0, `rgba(${neb[0]},${neb[1]},${neb[2]},${0.55 + env.bright * 0.35})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx!.fillStyle = g;
      ctx!.fillRect(0, 0, W, H);
      ctx!.fillStyle = 'rgba(0,0,0,0.30)';
      ctx!.fillRect(0, 0, W, H);

      ctx!.save();
      ctx!.translate(W / 2, H / 2);
      ctx!.scale(env.zoom, env.zoom);
      ctx!.translate(-W / 2 + px, -H / 2 + py);

      bgStars.forEach((s) => {
        const b = 0.2 + env.bright * 0.5 + 0.35 * Math.sin(tGlobal * s.sp + s.tw);
        const x = W / 2 + s.x * W;
        const y = H / 2 + s.y * H;
        ctx!.globalAlpha = Math.max(0, b);
        ctx!.fillStyle = '#bfe9ff';
        ctx!.beginPath();
        ctx!.arc(x, y, s.r, 0, 6.29);
        ctx!.fill();
        if (env.warp > 0.05) {
          ctx!.globalAlpha = Math.max(0, b) * env.warp;
          ctx!.strokeStyle = '#bfe9ff';
          ctx!.lineWidth = s.r * 0.8;
          const dx = (x - W / 2) * env.warp * 1.4;
          const dy = (y - H / 2) * env.warp * 1.4;
          ctx!.beginPath();
          ctx!.moveTo(x, y);
          ctx!.lineTo(x + dx, y + dy);
          ctx!.stroke();
        }
      });

      edges.forEach((e) => {
        e.prog = Math.min(1, e.prog + 0.02);
        const a = worldStars[e.a];
        const b = worldStars[e.b];
        if (!a || !b) return;
        const x2 = a.x + (b.x - a.x) * e.prog;
        const y2 = a.y + (b.y - a.y) * e.prog;
        ctx!.strokeStyle = e.hue || '#00F5FF';
        ctx!.globalAlpha = 0.35 + 0.15 * Math.sin(tGlobal * 2);
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(x2, y2);
        ctx!.stroke();
      });

      worldStars.forEach((s) => {
        s.r += (s.targetR - s.r) * 0.06;
        const puls = 1 + 0.08 * Math.sin(tGlobal * 2 + s.ph);
        ctx!.globalAlpha = Math.min(1, s.alpha);
        const gg = ctx!.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * puls * 4);
        gg.addColorStop(0, s.hue);
        gg.addColorStop(0.25, s.hue + '99');
        gg.addColorStop(1, 'transparent');
        ctx!.fillStyle = gg;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r * puls * 4, 0, 6.29);
        ctx!.fill();
        ctx!.fillStyle = '#fff';
        ctx!.globalAlpha = Math.min(1, s.alpha * 1.2);
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r * puls, 0, 6.29);
        ctx!.fill();
      });

      parts = parts.filter((p) => p.life > 0);
      parts.forEach((p) => {
        p.life -= p.decay;
        p.x += p.vx;
        p.y += p.vy;
        if (p.target) {
          p.vx += (p.target[0] - p.x) * (p.pull ?? 0.01);
          p.vy += (p.target[1] - p.y) * (p.pull ?? 0.01);
        }
        p.vx *= p.drag ?? 1;
        p.vy *= p.drag ?? 1;
        ctx!.globalAlpha = Math.max(0, p.life);
        ctx!.fillStyle = p.hue;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size, 0, 6.29);
        ctx!.fill();
      });
      ctx!.restore();
      ctx!.globalAlpha = 1;
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);

    function burstFromRect(rect: { left: number; top: number; width: number; height: number }, target: [number, number], hue: string, count: number) {
      for (let i = 0; i < count; i++) {
        const x = rect.left + Math.random() * rect.width;
        const y = rect.top + Math.random() * rect.height;
        parts.push({ x, y, vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6, size: 0.8 + Math.random() * 1.6, hue, life: 1, decay: 0.006 + Math.random() * 0.004, target, pull: 0.012 + Math.random() * 0.01, drag: 0.97 });
      }
    }
    function ember(x: number, y: number, hue: string, count = 30, spread = 2.2) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * 6.28;
        const sp = Math.random() * spread;
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: 0.6 + Math.random() * 1.6, hue, life: 1, decay: 0.012 + Math.random() * 0.01, drag: 0.96 });
      }
    }
    function addStar(x: number, y: number, hue: string, label: string) {
      worldStars.push({ x, y, r: 0, targetR: 5.5, alpha: 0, hue, label, ph: Math.random() * 6.28 });
      return worldStars.length - 1;
    }

    // ===== HOLOGRAM =====
    hCv.width = 96;
    hCv.height = 112;
    let hRot = 0;
    let holoTalk = 0;
    function drawHolo() {
      hx!.clearRect(0, 0, 96, 112);
      const cx = 48;
      const cy = 54;
      const R = 28;
      hRot += 0.012 + holoTalk * 0.02;
      if (holoTalk > 0) holoTalk -= 0.01;
      const flick = 0.85 + Math.random() * 0.15;
      ([[1, 0.35, 'rgba(0,245,255,'], [0.8, 0.9, 'rgba(139,92,246,'], [0.55, 0.55, 'rgba(0,245,255,']] as [number, number, string][]).forEach((cfg, i) => {
        const [sx, sy, col] = cfg;
        hx!.save();
        hx!.translate(cx, cy);
        hx!.rotate(hRot * (i % 2 ? -1 : 1) + i * 1.1);
        hx!.scale(sx, sy);
        hx!.beginPath();
        hx!.arc(0, 0, R, 0, 6.29);
        hx!.strokeStyle = col + 0.55 * flick + ')';
        hx!.lineWidth = 1.4;
        hx!.stroke();
        hx!.restore();
      });
      const g = hx!.createRadialGradient(cx, cy, 0, cx, cy, 10 + holoTalk * 8);
      g.addColorStop(0, 'rgba(220,250,255,' + flick + ')');
      g.addColorStop(0.5, 'rgba(0,245,255,.55)');
      g.addColorStop(1, 'transparent');
      hx!.fillStyle = g;
      hx!.beginPath();
      hx!.arc(cx, cy, 12 + holoTalk * 8, 0, 6.29);
      hx!.fill();
      holoRafId = requestAnimationFrame(drawHolo);
    }
    holoRafId = requestAnimationFrame(drawHolo);

    function holoShow() {
      holoWrap!.classList.add('on');
    }
    function holoHide() {
      holoWrap!.classList.remove('on');
    }
    let holoSayTimeout: number | undefined;
    function holoSay(text: string, dur = 3200) {
      holoCap!.innerHTML = `<b>${XAI_SVG} xAI</b>` + text;
      holoCap!.classList.add('on');
      holoTalk = 1;
      if (holoSayTimeout) clearTimeout(holoSayTimeout);
      holoSayTimeout = window.setTimeout(() => holoCap!.classList.remove('on'), dur);
      allTimeouts.add(holoSayTimeout);
    }

    // ===== AUDIO =====
    let actx: AudioContext | null = null;
    let humOsc: OscillatorNode | null = null;
    let humGain: GainNode | null = null;
    let beatTimer: number | undefined;
    let padOsc: OscillatorNode | null = null;
    let padGain: GainNode | null = null;
    function initAudio() {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        actx = new AC();
        humGain = actx.createGain();
        humGain.gain.value = 0.028;
        humGain.connect(actx.destination);
        humOsc = actx.createOscillator();
        humOsc.type = 'sine';
        humOsc.frequency.value = 54;
        humOsc.connect(humGain);
        humOsc.start();
        const lfo = actx.createOscillator();
        lfo.frequency.value = 0.08;
        const lfoGain = actx.createGain();
        lfoGain.gain.value = 0.012;
        lfo.connect(lfoGain);
        lfoGain.connect(humGain.gain);
        lfo.start();
      } catch {
        // Audio is an enhancement, not a requirement — silently proceed
        // without it if the browser blocks AudioContext.
        actx = null;
      }
    }
    function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.05, delay = 0) {
      if (!actx) return;
      const t0 = actx.currentTime + delay;
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(actx.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }
    function heartbeat() {
      tone(70, 0.18, 'sine', 0.09, 0);
      tone(58, 0.22, 'sine', 0.07, 0.16);
    }
    function startHeartbeats() {
      beatTimer = window.setInterval(heartbeat, 2400);
      heartbeat();
    }
    function stopHeartbeats() {
      clearInterval(beatTimer);
    }
    function chime() {
      tone(660, 1.1, 'sine', 0.05);
      tone(990, 1.3, 'sine', 0.03, 0.08);
      tone(1320, 1.6, 'triangle', 0.02, 0.18);
    }
    function blip() {
      tone(300, 0.12, 'square', 0.02);
    }
    function swell() {
      if (!actx) return;
      padOsc = actx.createOscillator();
      padGain = actx.createGain();
      padOsc.type = 'sawtooth';
      padOsc.frequency.value = 110;
      padGain.gain.value = 0;
      padOsc.connect(padGain);
      padGain.connect(actx.destination);
      padOsc.start();
      const t0 = actx.currentTime;
      padGain.gain.linearRampToValueAtTime(0.025, t0 + 1.6);
      padGain.gain.linearRampToValueAtTime(0, t0 + 4.2);
      padOsc.frequency.linearRampToValueAtTime(220, t0 + 3.5);
      const stopId = window.setTimeout(() => {
        try {
          padOsc?.stop();
        } catch {
          /* already stopped */
        }
      }, 4400);
      allTimeouts.add(stopId);
    }

    // ===== SCENE SEQUENCE =====
    let curScene = 0;
    function dots() {
      dotsEl!.innerHTML = '';
      for (let i = 1; i <= TOTAL_SCENES; i++) {
        const e = document.createElement('div');
        e.className = 'fs-dot' + (i < curScene ? ' past' : i === curScene ? ' now' : '');
        dotsEl!.appendChild(e);
      }
    }
    function setScene(html: string, clickable = false, onReady?: () => void) {
      scene!.classList.toggle('click', clickable);
      scene!.style.opacity = '0';
      after(450, () => {
        scene!.innerHTML = html;
        scene!.style.transition = 'opacity 1s';
        scene!.style.opacity = '1';
        if (onReady) onReady();
      });
    }
    function cut(fn: () => void, dur = 900) {
      blackout!.classList.add('on');
      after(dur, () => {
        fn();
        after(60, () => blackout!.classList.remove('on'));
      });
    }
    function finish() {
      if (cancelled) return;
      onCompleteRef.current();
    }

    function beginReturning() {
      clearSceneTimeouts();
      curScene = TOTAL_SCENES;
      dots();
      setEnv({ zoom: 1, panX: 0, panY: 6, bright: 0.5, neb: [8, 16, 30], warp: 0 }, 0.03);
      cockpit!.classList.add('on');
      holoShow();
      setScene('');
      after(500, () => holoSay('Welcome back, Captain.', 1600));
      after(2200, () => holoSay('Neural Core online. Your universe is waiting.', 2400));
      after(4700, () => {
        setScene(`<button id="fsCta" class="fs-cta">ENTER xOS ${CHEVRON_RIGHT_SVG}</button>`, true, () => {
          document.getElementById('fsCta')?.addEventListener('click', finish);
        });
      });
    }

    function scene1() {
      clearSceneTimeouts();
      curScene = 1;
      dots();
      setEnv({ zoom: 1, panX: 0, panY: 0, bright: 0, neb: [6, 10, 18], warp: 0 }, 0.02);
      setScene('');
      after(1600, () => {
        setScene('<div class="fs-line" style="animation-delay:0s">INITIALIZING…</div><div class="fs-line big fs-beat" style="animation-delay:.3s">NEURAL CORE</div>');
        startHeartbeats();
      });
      after(6200, () => {
        stopHeartbeats();
        const r = { left: W * 0.35, top: H * 0.42, width: W * 0.3, height: 60 };
        burstFromRect(r, [W / 2, -80], '#00F5FF', 70);
        setScene('');
      });
      after(7600, () => cut(scene2, 1000));
    }

    function scene2() {
      clearSceneTimeouts();
      curScene = 2;
      dots();
      cockpit!.classList.add('on');
      setEnv({ zoom: 1.05, panX: 0, panY: -6, bright: 0.5, neb: [10, 22, 42], warp: 0 }, 0.012);
      setScene('');
      after(1400, () => {
        addStar(W / 2, H * 0.36, '#00F5FF', 'THE FIRST STAR');
        setScene('<div class="fs-line hint" style="animation-delay:.2s">SYSTEMS STABLE</div>');
      });
      after(4400, scene3);
    }

    function scene3() {
      clearSceneTimeouts();
      curScene = 3;
      dots();
      setEnv({ zoom: 1.0, panX: 6, panY: 0, bright: 0.55, neb: [10, 22, 42], warp: 0 }, 0.015);
      holoShow();
      setScene('<button id="fsBeginBtn" style="animation-delay:4.3s">BEGIN</button>', true, () => {
        document.getElementById('fsBeginBtn')?.addEventListener('click', scene4);
      });
      after(200, () => holoSay('Welcome back, Captain.', 1500));
      after(1900, () => holoSay('Neural Core online.', 1500));
      after(3400, () => holoSay('Ready when you are.', 2200));
      blip();
      after(1900, blip);
      after(3400, blip);
    }

    function scene4() {
      clearSceneTimeouts();
      curScene = 4;
      dots();
      holoCap!.classList.remove('on');
      setEnv({ zoom: 1.12, panX: 0, panY: 4, bright: 0.22, neb: [6, 12, 26], warp: 0 }, 0.02);
      setScene(
        '<div class="fs-line big" style="animation-delay:.1s;font-size:clamp(16px,4vw,26px)">WHAT ARE YOU CREATING?</div>' +
          '<div id="fsInputWrap" style="animation-delay:.6s" class="fs-line"><input id="fsQinput" placeholder="type here…" autocomplete="off" autofocus></div>',
        true,
        () => {
          const inp = document.getElementById('fsQinput') as HTMLInputElement | null;
          inp?.focus();
          inp?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && inp.value.trim()) scene5(inp.value.trim());
          });
        },
      );
    }

    let projectName = 'StudyHive';
    function scene5(name: string) {
      clearSceneTimeouts();
      projectName = name;
      curScene = 5;
      dots();
      const inp = document.getElementById('fsQinput');
      const r = inp ? inp.getBoundingClientRect() : { left: W * 0.4, top: H * 0.5, width: W * 0.2, height: 30 };
      setScene('');
      burstFromRect(r, [W / 2, H * 0.44], '#00F5FF', 110);
      setEnv({ zoom: 1.1, panX: 0, panY: 0, bright: 0.9, neb: [14, 34, 54], warp: 0 }, 0.03);
      after(900, () => {
        chime();
        const idx = addStar(W / 2, H * 0.44, '#00F5FF', name.toUpperCase());
        worldStars[idx].targetR = 7;
        worldStars[idx].alpha = 1;
        ember(W / 2, H * 0.44, '#00F5FF', 46, 3.2);
        holoSay('Every universe begins with a single idea.', 3200);
      });
      after(4600, scene6);
    }

    function scene6() {
      clearSceneTimeouts();
      curScene = 6;
      dots();
      setEnv({ zoom: 0.92, panX: 0, panY: -8, bright: 0.55, neb: [10, 20, 42], warp: 0 }, 0.01);
      const hub = 0;
      after(300, () => {
        const i1 = addStar(W * 0.4, H * 0.3, '#8B5CF6', 'IDEA');
        worldStars[i1].alpha = 1;
        ember(W * 0.4, H * 0.3, '#8B5CF6', 18, 2);
        edges.push({ a: hub, b: i1, prog: 0, hue: '#8B5CF6' });
      });
      after(1400, () => {
        const i2 = addStar(W * 0.62, H * 0.56, '#FF2D78', 'TASK');
        worldStars[i2].alpha = 1;
        ember(W * 0.62, H * 0.56, '#FF2D78', 18, 2);
        edges.push({ a: hub, b: i2, prog: 0, hue: '#FF2D78' });
      });
      after(1900, () => holoSay("I'm discovering relationships.", 3000));
      after(5600, scene7);
    }

    const consoleList = ['NAVIGATION', 'PROJECTS', 'STUDIO', 'MISSION CONTROL', 'ARCHIVE', 'OBSERVATORY'];
    function scene7() {
      clearSceneTimeouts();
      curScene = 7;
      dots();
      bridgeGlow!.classList.add('on');
      setEnv({ zoom: 1, panX: 0, panY: 0, bright: 0.7, neb: [10, 20, 40], warp: 0 }, 0.02);
      setScene('<div class="fs-line" style="animation-delay:.1s">SHIP SYSTEMS ONLINE</div><div id="fsConsoles"></div>', true, () => {
        const box = document.getElementById('fsConsoles');
        if (!box) return;
        consoleList.forEach((c, i) => {
          const el = document.createElement('div');
          el.className = 'fs-console';
          el.textContent = c;
          box.appendChild(el);
          after(700 + i * 380, () => {
            el.classList.add('lit');
            blip();
          });
          if (c === 'OBSERVATORY') {
            after(700 + i * 380 + 500, () => {
              el.classList.add('pick');
              el.addEventListener('click', scene8);
            });
          }
        });
        after(700 + consoleList.length * 380 + 600, () => {
          const h = document.createElement('div');
          h.className = 'fs-line hint';
          h.style.marginTop = '16px';
          h.style.animationDelay = '0s';
          h.textContent = 'TAP OBSERVATORY TO CONTINUE';
          box.after(h);
        });
      });
    }

    function scene8() {
      clearSceneTimeouts();
      curScene = 8;
      dots();
      setScene('');
      bridgeGlow!.classList.remove('on');
      cockpit!.classList.add('open');
      holoHide();
      chime();
      swell();
      setEnv({ zoom: 3.2, panX: 0, panY: -10, bright: 1, neb: [16, 40, 70], warp: 1 }, 0.045);
      after(1700, () => {
        setEnv({ zoom: 1, panX: 0, panY: 0, bright: 0.85, neb: [10, 26, 48], warp: 0 }, 0.05);
        cockpit!.classList.remove('on');
      });
      after(2600, scene9);
    }

    function obsClick(e: MouseEvent) {
      const cx = (e.clientX - W / 2) / env.zoom + W / 2 - env.panX;
      const cy = (e.clientY - H / 2) / env.zoom + H / 2 - env.panY;
      let hit: WorldStar | null = null;
      worldStars.forEach((s) => {
        if (Math.hypot(s.x - cx, s.y - cy) < 26) hit = s;
      });
      if (hit) {
        const h = hit as WorldStar;
        // textContent is plain-text-only (no markup allowed) — the ✦ glyph
        // is simply dropped rather than swapped for an <Icon>.
        starHint!.textContent = h.label;
        starHint!.style.left = e.clientX + 12 + 'px';
        starHint!.style.top = e.clientY - 10 + 'px';
        starHint!.style.opacity = '1';
        after(1800, () => (starHint!.style.opacity = '0'));
      }
    }
    function scene9() {
      clearSceneTimeouts();
      curScene = 9;
      dots();
      setEnv({ zoom: 1, panX: 0, panY: 0, bright: 0.85, neb: [10, 26, 48], warp: 0 }, 0.02);
      setScene(
        '<div class="fs-line" style="animation-delay:.2s;color:var(--cyan-dim);letter-spacing:4px">' +
          projectName.toUpperCase() +
          '</div><div class="fs-line hint" style="animation-delay:.6s">TAP A STAR TO EXPLORE</div>',
      );
      cv!.onclick = obsClick;
      after(5200, scene10);
    }

    function scene10() {
      cv!.onclick = null;
      clearSceneTimeouts();
      curScene = 10;
      dots();
      holoShow();
      setEnv({ zoom: 1.15, panX: -30, panY: -14, bright: 0.9, neb: [10, 26, 48], warp: 0 }, 0.02);
      setScene('');
      after(200, () => holoSay('Interesting…', 1400));
      after(1700, () => holoSay('This idea connects to something you created earlier.', 3200));
      after(1000, () => {
        if (worldStars.length >= 3) {
          edges.push({ a: 1, b: 2, prog: 0, hue: '#00F5FF' });
          ember(worldStars[1].x, worldStars[1].y, '#00F5FF', 20, 1.6);
        }
      });
      after(5600, scene11);
    }

    function scene11() {
      clearSceneTimeouts();
      curScene = 11;
      dots();
      holoCap!.classList.remove('on');
      setEnv({ zoom: 0.94, panX: 0, panY: 0, bright: 0.6, neb: [8, 18, 36], warp: 0 }, 0.02);
      setScene(
        '<div class="fs-line" style="animation-delay:.1s;letter-spacing:4px">MISSION</div>' +
          '<div id="fsMissions">' +
          `<div class="fs-mcard" style="animation-delay:.5s"><span>${SQUARE_SVG}</span> Design your first feature</div>` +
          `<div class="fs-mcard" style="animation-delay:.9s"><span>${SQUARE_SVG}</span> Capture three ideas</div>` +
          `<div class="fs-mcard" style="animation-delay:1.3s"><span>${SQUARE_SVG}</span> Complete one milestone</div>` +
          '</div>',
      );
      after(5200, scene12);
    }

    function scene12() {
      clearSceneTimeouts();
      curScene = 12;
      dots();
      setEnv({ zoom: 1, panX: 0, panY: 6, bright: 0.45, neb: [8, 16, 30], warp: 0 }, 0.012);
      cockpit!.classList.remove('open');
      cockpit!.classList.add('on');
      setScene('');
      after(900, () => holoSay('Good work today, Captain.', 1800));
      after(2900, () => holoSay('Your universe is growing.', 2600));
      after(5200, () => {
        setScene(`<button id="fsCta" class="fs-cta">ENTER xOS ${CHEVRON_RIGHT_SVG}</button>`, true, () => {
          document.getElementById('fsCta')?.addEventListener('click', finish);
        });
      });
    }

    initAudio();
    if (mode === 'full') {
      scene1();
    } else {
      beginReturning();
    }
    dots();

    return () => {
      cancelled = true;
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(holoRafId);
      allTimeouts.forEach((id) => clearTimeout(id));
      if (holoSayTimeout) clearTimeout(holoSayTimeout);
      clearInterval(beatTimer);
      cv!.onclick = null;
      try {
        padOsc?.stop();
      } catch {
        /* already stopped */
      }
      try {
        humOsc?.stop();
      } catch {
        /* already stopped */
      }
      try {
        actx?.close();
      } catch {
        /* already closed */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <div id="fsRoot" ref={rootRef}>
      <canvas id="fsFx" ref={canvasRef} />
      <div id="fsVignette" />
      <div id="fsBridgeGlow" ref={bridgeGlowRef} />
      <div id="fsCockpit" ref={cockpitRef}>
        <div className="fs-panel l" />
        <div className="fs-panel r" />
      </div>
      <div id="fsBlackout" ref={blackoutRef} />
      <div id="fsLabel">
        xOS <em>//</em> FLIGHT SIMULATOR
      </div>
      <div id="fsHoloWrap" ref={holoWrapRef}>
        <canvas id="fsHoloCv" ref={holoCvRef} />
        <div id="fsHoloBase" />
      </div>
      <div id="fsHoloCap" ref={holoCapRef} />
      <div id="fsScene" ref={sceneRef} />
      <div id="fsSkip" onClick={() => onCompleteRef.current()}>
        SKIP <Icon name="chevronRight" size={12} />
      </div>
      <div id="fsDots" ref={dotsRef} />
      <div id="fsStarHint" ref={starHintRef} />
    </div>
  );
}
