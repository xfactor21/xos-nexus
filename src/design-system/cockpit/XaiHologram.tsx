import { useEffect, useRef, useState } from 'react';
import { useCoreGraph } from '../../stores/coreGraph';
import { playSound } from '../../lib/sound';

/**
 * Cockpit redesign — xAI hologram: persistent, autonomous presence in every
 * room (bottom-right, outside the right wing). Canvas-rendered gyroscope-
 * orb (3 tilted rotating rings + pulsing core) matching the reference
 * mockup's drawHolo(). Held back from Amendment v0.4 specifically until the
 * design-system overhaul landed — this is that overhaul, so it's built now.
 *
 * Autonomous triggers use REAL coreGraph state, not fake timers:
 *  (a)/(b) a stale project (coreGraph's already-computed `isStale`, derived
 *      from days since last node activity) doubles as both "suggestion
 *      pending" and "project untouched N days" — they're the same
 *      underlying signal in this data model, there's no separate
 *      suggestions table to invent a second one from.
 *  (c) daily briefing — fires once per calendar day (localStorage-gated).
 *  (d) new edge discovered — fires when coreGraph.edges grows *during* the
 *      session (explicitly not on the initial hydrate load, which would
 *      false-fire on every app open for pre-existing edges).
 */
interface Trigger { text: string; }

function pickAutonomousTrigger(): Trigger | null {
  const { projects, edges } = useCoreGraph.getState();
  const stale = projects.find((p) => p.isStale);
  if (stale) return { text: `${stale.name} hasn't moved in a while, Captain. Want me to surface it?` };
  const lastBriefingKey = 'xos-last-briefing-date';
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(lastBriefingKey) !== today) {
    localStorage.setItem(lastBriefingKey, today);
    return { text: `Good to see you, Captain. ${projects.length} projects in orbit, ${edges.length} known relationships.` };
  }
  return null;
}

export default function XaiHologram() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const raf = useRef<number>(0);
  const rot = useRef(0);
  const talk = useRef(0); // 0..1, drives core brighten + faster spin while "thinking"
  const [caption, setCaption] = useState<string | null>(null);
  const [arriving, setArriving] = useState(true);
  const edgesLenRef = useRef<number | null>(null);

  // Arrival animation — rings spin up from zero, distinct from a summon.
  useEffect(() => {
    const t = setTimeout(() => setArriving(false), 900);
    return () => clearTimeout(t);
  }, []);

  function fireCaption(text: string, ms = 5000) {
    talk.current = 1;
    setCaption(text);
    playSound('xai');
    setTimeout(() => setCaption(null), ms);
  }

  // Autonomous triggers: check shortly after mount (daily briefing / stale
  // project), then watch for edges growing mid-session (new relationship
  // discovered).
  useEffect(() => {
    const t = setTimeout(() => {
      const trigger = pickAutonomousTrigger();
      if (trigger) fireCaption(trigger.text);
    }, 2200);
    const unsub = useCoreGraph.subscribe((s) => {
      if (edgesLenRef.current === null) {
        edgesLenRef.current = s.edges.length;
        return;
      }
      if (s.edges.length > edgesLenRef.current) {
        fireCaption('New relationship discovered — I linked two of your nodes.');
      }
      edgesLenRef.current = s.edges.length;
    });
    return () => {
      clearTimeout(t);
      unsub();
    };
  }, []);

  // "Thinking" state — classify-capture calls in flight speed up the spin
  // and pulse the core magenta. Dispatched as a plain window event from
  // copilotClient callers so this component doesn't need prop-drilling
  // through every capture surface.
  useEffect(() => {
    function onThinking() {
      talk.current = 1;
    }
    window.addEventListener('xos-xai-thinking', onThinking);
    return () => window.removeEventListener('xos-xai-thinking', onThinking);
  }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    const cx = cv?.getContext('2d');
    if (!cv || !cx) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function draw() {
      if (!cv || !cx) return;
      cx.clearRect(0, 0, 58, 68);
      if (!reducedMotion) rot.current += 0.015 + talk.current * 0.025;
      if (talk.current > 0) talk.current = Math.max(0, talk.current - 0.01);
      const fl = 0.85 + Math.random() * 0.15;
      const cx2 = 29, cy2 = 32, R = 20;
      ([[1, 0.38, 'rgba(255,45,120,'], [0.75, 0.95, 'rgba(139,92,246,'], [0.55, 0.55, 'rgba(0,245,255,']] as [number, number, string][]).forEach((c, i) => {
        cx.save();
        cx.translate(cx2, cy2);
        cx.rotate(rot.current * (i % 2 ? -1 : 1) + i * 1.1);
        cx.scale(c[0], c[1]);
        cx.beginPath();
        cx.arc(0, 0, R, 0, 6.29);
        cx.strokeStyle = c[2] + 0.55 * fl + ')';
        cx.lineWidth = 1.5;
        cx.stroke();
        cx.restore();
      });
      const g = cx.createRadialGradient(cx2, cy2, 0, cx2, cy2, 8 + talk.current * 6);
      g.addColorStop(0, `rgba(255,220,240,${fl})`);
      g.addColorStop(0.4, 'rgba(255,45,120,.55)');
      g.addColorStop(1, 'transparent');
      cx.fillStyle = g;
      cx.beginPath();
      cx.arc(cx2, cy2, 10 + talk.current * 6, 0, 6.29);
      cx.fill();
      raf.current = requestAnimationFrame(draw);
    }
    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  return (
    <div className={`xaiHolo ${arriving ? 'arriving' : ''}`}>
      {caption && (
        <div className="xaiHoloCap">
          <b>◈ xAI</b>
          {caption}
        </div>
      )}
      <canvas ref={canvasRef} width={58} height={68} className="xaiHoloCv" aria-hidden="true" />
      <div className="xaiHoloScan" aria-hidden="true" />
      <div className="xaiHoloBase" />
    </div>
  );
}
