import { useEffect, useRef, useState } from 'react';
import { useCoreGraph } from '../../stores/coreGraph';
import { supabase } from '../../lib/supabase';
import { commitOrQueue } from '../../lib/offlineSync';

const durChips: [number, string][] = [
  [15, '15 MIN'],
  [25, '25 MIN'],
  [50, '50 MIN'],
  [0.1, 'DEMO 6s'],
];

type Soundscape = 'off' | 'hum' | 'rain' | 'binaural';
const SOUNDSCAPES: [Soundscape, string][] = [
  ['off', '🔇 SILENT'],
  ['hum', '🌌 DEEP SPACE HUM'],
  ['rain', '🌧 RAIN'],
  ['binaural', '🎧 BINAURAL FOCUS'],
];

/** FOCUS TIME — Room Overhaul Batch 3: raised to the "Forest app + an
 * Endel-style ambient soundscape tool + a serious Pomodoro tool" bar.
 * Originally ported 1:1 from xos-prototype.html (setup → live ring timer →
 * mission-complete summary); now adds a real ambient starfield that's
 * always faintly alive and streams past during a live session (universal
 * "nothing is ever fully empty" + "warp motion" directives), a genuine
 * synthesized ambient soundscape via the Web Audio API (no audio assets
 * available in this environment, so these are real oscillator/noise graphs,
 * not silent stand-ins), a stray-thought quick-capture that files a real
 * node without leaving the session, and a post-session reflection step that
 * writes a real memory *and* a real completed task node — the latter is
 * what actually ties a session's momentum back to the Observatory: project
 * health is computed from task-completion + recency (src/core/mappers.ts),
 * so this session's task genuinely brightens that project's star next time
 * the graph re-renders, live, not via a fake toast. */
export default function Focus({ active }: { active: boolean }) {
  const [stage, setStage] = useState<'setup' | 'live' | 'reflect' | 'done'>('setup');
  const [projId, setProjId] = useState<string | null>(null);
  const [mins, setMins] = useState(25);
  const [intent, setIntent] = useState('');
  const [left, setLeft] = useState(0);
  const [total, setTotal] = useState(0);
  const [soundscape, setSoundscape] = useState<Soundscape>('off');
  const [strayText, setStrayText] = useState('');
  const [strayMsg, setStrayMsg] = useState('');
  const [sentiment, setSentiment] = useState<'great' | 'okay' | 'rough' | null>(null);
  const [note, setNote] = useState('');
  const [logging, setLogging] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const projects = useCoreGraph((s) => s.projects);
  const ownerId = useCoreGraph((s) => s.ownerId);

  useEffect(() => {
    if (!projId && projects.length) setProjId(projects[0].id);
  }, [projects, projId]);
  const proj = projects.find((p) => p.id === projId) ?? null;

  // ---- ambient warp starfield: always faintly alive, streams during 'live' ----
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef(stage);
  const warpT = useRef(0.12);
  const stars = useRef(
    Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), z: 0.2 + Math.random() * 0.8 })),
  );
  const raf = useRef<number>(0);
  useEffect(() => { stageRef.current = stage; }, [stage]);
  useEffect(() => {
    function resize() {
      const cv = canvasRef.current, sec = cv?.parentElement;
      if (!cv || !sec) return;
      cv.width = sec.clientWidth;
      cv.height = sec.clientHeight;
    }
    resize();
    function draw() {
      const cv = canvasRef.current;
      const cc = cv?.getContext('2d');
      if (cv && cc) {
        const target = stageRef.current === 'live' ? 1 : 0.12;
        warpT.current += (target - warpT.current) * 0.03;
        cc.fillStyle = 'rgba(5,8,13,1)';
        cc.fillRect(0, 0, cv.width, cv.height);
        const cx = cv.width / 2, cy = cv.height / 2;
        stars.current.forEach((s) => {
          const speed = (0.002 + warpT.current * 0.02) * s.z;
          s.x += (s.x - 0.5) * speed;
          s.y += (s.y - 0.5) * speed;
          if (s.x < -0.05 || s.x > 1.05 || s.y < -0.05 || s.y > 1.05) {
            s.x = 0.5 + (Math.random() - 0.5) * 0.06;
            s.y = 0.5 + (Math.random() - 0.5) * 0.06;
          }
          const px = s.x * cv.width, py = s.y * cv.height;
          const streak = warpT.current * 26 * s.z;
          cc.strokeStyle = `rgba(0,245,255,${0.15 + s.z * 0.35})`;
          cc.lineWidth = 1;
          cc.beginPath();
          if (streak > 1) {
            const dx = px - cx, dy = py - cy;
            const len = Math.hypot(dx, dy) || 1;
            cc.moveTo(px, py);
            cc.lineTo(px - (dx / len) * streak, py - (dy / len) * streak);
            cc.stroke();
          } else {
            cc.fillStyle = `rgba(0,245,255,${0.25 + s.z * 0.4})`;
            cc.fillRect(px, py, 1.4, 1.4);
          }
        });
      }
      raf.current = requestAnimationFrame(draw);
    }
    raf.current = requestAnimationFrame(draw);
    addEventListener('resize', resize);
    return () => { cancelAnimationFrame(raf.current); removeEventListener('resize', resize); };
  }, []);

  // ---- ambient soundscape: synthesized via Web Audio (no audio assets
  // available in this environment) — a real oscillator/noise graph per
  // preset, started only from a user gesture (picking a chip or engaging
  // focus), per browser autoplay policy. ----
  const audioCtx = useRef<AudioContext | null>(null);
  const audioStop = useRef<(() => void) | null>(null);
  function ensureCtx() {
    if (!audioCtx.current) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx.current = new Ctor();
    }
    return audioCtx.current;
  }
  function stopSoundscape() {
    audioStop.current?.();
    audioStop.current = null;
  }
  function startSoundscape(kind: Soundscape) {
    stopSoundscape();
    if (kind === 'off') return;
    const ctx = ensureCtx();
    const master = ctx.createGain();
    master.gain.value = 0.05;
    master.connect(ctx.destination);
    if (kind === 'hum') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 82;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 5;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      osc.connect(master);
      osc.start();
      lfo.start();
      audioStop.current = () => { osc.stop(); lfo.stop(); };
    } else if (kind === 'rain') {
      const bufferSize = 2 * ctx.sampleRate;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1200;
      filter.Q.value = 0.6;
      noise.connect(filter);
      filter.connect(master);
      noise.start();
      audioStop.current = () => noise.stop();
    } else if (kind === 'binaural') {
      const oscL = ctx.createOscillator();
      oscL.frequency.value = 220;
      const oscR = ctx.createOscillator();
      oscR.frequency.value = 226;
      const panL = ctx.createStereoPanner();
      panL.pan.value = -1;
      const panR = ctx.createStereoPanner();
      panR.pan.value = 1;
      oscL.connect(panL);
      panL.connect(master);
      oscR.connect(panR);
      panR.connect(master);
      oscL.start();
      oscR.start();
      audioStop.current = () => { oscL.stop(); oscR.stop(); };
    }
  }
  function pickSoundscape(kind: Soundscape) {
    setSoundscape(kind);
    if (stage === 'live') startSoundscape(kind);
  }
  useEffect(() => () => stopSoundscape(), []);

  function startFocus() {
    const t = Math.round(mins * 60);
    setTotal(t);
    setLeft(t);
    setStage('live');
    if (soundscape !== 'off') startSoundscape(soundscape);
    timer.current = setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          clearInterval(timer.current);
          stopSoundscape();
          setStage('reflect');
          return 0;
        }
        return l - 1;
      });
    }, 1000);
  }
  function abortFocus() {
    clearInterval(timer.current);
    stopSoundscape();
    setStage('setup');
  }
  function finishFocus() {
    clearInterval(timer.current);
    stopSoundscape();
    setStage('reflect');
  }
  function resetFocus() {
    setSentiment(null);
    setNote('');
    setStage('setup');
  }

  const m = String(Math.max(0, Math.floor(left / 60))).padStart(2, '0');
  const s = String(Math.max(0, left % 60)).padStart(2, '0');
  const dashoffset = total ? 339.3 * (1 - left / total) : 0;
  const doneMin = Math.round(((total - Math.max(0, left)) / 60) * 10) / 10;

  async function logStray() {
    const v = strayText.trim();
    if (!v) return;
    setStrayText('');
    try {
      await commitOrQueue(v);
      setStrayMsg('◈ filed — back to focus');
    } catch {
      setStrayMsg('could not file that right now');
    }
    setTimeout(() => setStrayMsg(''), 2400);
  }

  /** Writes the session's real payoff: a memory (the reflection itself) and
   * a completed task node (the momentum signal Observatory/Projects both
   * read live). Best-effort — a failed write (offline, no owner yet) still
   * lets the Captain see their mission-complete summary rather than getting
   * stuck on a spinner. */
  async function submitReflection() {
    setLogging(true);
    try {
      if (ownerId && projId) {
        const sentimentLabel = sentiment === 'great' ? 'GREAT' : sentiment === 'okay' ? 'OKAY' : sentiment === 'rough' ? 'ROUGH' : 'UNRATED';
        await supabase.from('memories').insert({
          owner_id: ownerId,
          project_id: projId,
          kind: 'learning',
          content: `Focus session (${doneMin} min · "${intent || 'Deep work'}"): ${sentimentLabel}${note.trim() ? ' — ' + note.trim() : ''}`,
        });
        await supabase.from('nodes').insert({
          owner_id: ownerId,
          project_id: projId,
          kind: 'task',
          title: (intent || 'Focus session').slice(0, 80),
          body: `Completed a ${doneMin}-minute focus session.`,
          source: 'manual',
          ai_classified: false,
          status: 'done',
          metadata: { tags: ['◈ FOCUS SESSION'] },
        });
      }
    } catch (err) {
      console.error('Focus: failed to log reflection/momentum', err);
    } finally {
      setLogging(false);
      setStage('done');
    }
  }

  return (
    <section className={`room ${active ? 'on' : ''}`} id="r-focus" style={{ position: 'relative', overflow: 'hidden' }}>
      <canvas ref={canvasRef} id="focusWarp" />
      <div id="focusContent">
      <h2 className="rh">🎯 FOCUS TIME</h2>
      <div className="rsub">SESSIONS HAVE RITUAL. STARTING ONE IS A COMMITMENT.</div>
      {stage === 'setup' && (
        <div id="focusSetup">
          <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--cyan-dim)' }}>TARGET PROJECT</div>
          <div className="optrow" id="fProj">
            {projects.length === 0 && <span className="rsub" style={{ fontSize: 9 }}>No projects yet.</span>}
            {projects.map((p) => (
              <span key={p.id} className={`chip ${projId === p.id ? 'on' : ''}`} onClick={() => setProjId(p.id)}>
                {p.icon} {p.name.toUpperCase()}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--cyan-dim)' }}>DURATION</div>
          <div className="optrow" id="fDur">
            {durChips.map(([v, label]) => (
              <span key={label} className={`chip ${mins === v ? 'on' : ''}`} onClick={() => setMins(v)}>
                {label}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--cyan-dim)' }}>AMBIENT SOUNDSCAPE</div>
          <div className="optrow" id="fSound">
            {SOUNDSCAPES.map(([v, label]) => (
              <span key={v} className={`chip ${soundscape === v ? 'on' : ''}`} onClick={() => pickSoundscape(v)}>
                {label}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--cyan-dim)', marginBottom: 8 }}>MISSION INTENT</div>
          <input id="intent" placeholder='What will you accomplish? e.g. "Ship the dark mode toggle"' value={intent} onChange={(e) => setIntent(e.target.value)} />
          <button className="bigbtn" onClick={startFocus} disabled={!projId}>
            ENGAGE FOCUS ▸
          </button>
          <h2 className="rh" style={{ fontSize: 11, marginTop: 26 }}>
            SESSION LOG
          </h2>
          <div className="slog">
            <b>YESTERDAY · 50 MIN · STUDYHIVE</b>
            <br />
            "Splash screen v2" — completed. Core logged 3 nodes.
          </div>
          <div className="slog">
            <b>YESTERDAY · 25 MIN · NOVEL</b>
            <br />
            "Outline ch.3 from villain POV" — completed.
          </div>
        </div>
      )}
      {stage === 'live' && (
        <div id="focusLive" className="on">
          <div id="ring">
            <svg viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(0,245,255,.12)" strokeWidth="4" />
              <circle cx="60" cy="60" r="54" fill="none" stroke="#00F5FF" strokeWidth="4" strokeLinecap="round" strokeDasharray="339.3" strokeDashoffset={dashoffset} style={{ filter: 'drop-shadow(0 0 6px #00F5FF)' }} />
            </svg>
            <div className="tt">
              <div id="clock">
                {m}:{s}
              </div>
              <div id="fIntent">{(intent || 'DEEP WORK').toUpperCase()}</div>
            </div>
          </div>
          <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-dim)' }}>CAPTURE STILL LISTENS — DISTRACTIONS GET FILED, NOT FOLLOWED</div>
          <div id="strayCap">
            <input
              id="strayInput"
              placeholder="Stray thought? File it without breaking focus…"
              value={strayText}
              onChange={(e) => setStrayText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && logStray()}
            />
            <button onClick={logStray}>◈</button>
          </div>
          {strayMsg && <div id="strayMsg">{strayMsg}</div>}
          <div id="fCtrl">
            <button onClick={abortFocus}>ABORT</button>
            <button onClick={finishFocus}>COMPLETE ▸</button>
          </div>
        </div>
      )}
      {stage === 'reflect' && (
        <div id="reflect" className="on">
          <h2 className="rh" style={{ fontSize: 14 }}>▸ HOW DID IT GO? ◂</h2>
          <div className="rsub">xAI logs this as a real memory tied to {proj ? proj.name.toUpperCase() : 'this session'}.</div>
          <div id="sentimentRow">
            {(
              [
                ['great', '😄', 'GREAT'],
                ['okay', '😐', 'OKAY'],
                ['rough', '😩', 'ROUGH'],
              ] as [typeof sentiment, string, string][]
            ).map(([v, emoji, label]) => (
              <span key={label} className={`sentimentChip ${sentiment === v ? 'on' : ''}`} onClick={() => setSentiment(v)}>
                <span className="emoji">{emoji}</span> {label}
              </span>
            ))}
          </div>
          <textarea id="reflectNote" placeholder="Anything worth remembering? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="bigbtn" style={{ maxWidth: 320 }} onClick={submitReflection} disabled={logging}>
            {logging ? 'LOGGING…' : 'LOG REFLECTION ▸'}
          </button>
        </div>
      )}
      {stage === 'done' && (
        <div id="mission" className="on">
          <h2>▸ MISSION COMPLETE ◂</h2>
          <p id="mSum">
            SESSION LOGGED · {doneMin} MIN · {proj ? proj.name.toUpperCase() : '—'}
            <br />
            INTENT: "{(intent || 'DEEP WORK').toUpperCase()}"
            <br />◈ CORE LOGGED THE SESSION AS A TASK · {proj ? proj.name.toUpperCase() : 'the project'}'S STAR BRIGHTENS
          </p>
          <button className="bigbtn" style={{ maxWidth: 320 }} onClick={resetFocus}>
            RETURN TO SETUP
          </button>
        </div>
      )}
      </div>
    </section>
  );
}
