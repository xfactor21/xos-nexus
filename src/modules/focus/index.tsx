import { useRef, useState } from 'react';

const projectChips = ['🐝 STUDYHIVE', '🎵 MUSIC', '🌐 WEBSITE', '📖 NOVEL'];
const durChips: [number, string][] = [
  [15, '15 MIN'],
  [25, '25 MIN'],
  [50, '50 MIN'],
  [0.1, 'DEMO 6s'],
];

/** FOCUS TIME — ported 1:1 from xos-prototype.html: setup → live ring timer
 * → mission-complete summary. */
export default function Focus({ active }: { active: boolean }) {
  const [stage, setStage] = useState<'setup' | 'live' | 'done'>('setup');
  const [proj, setProj] = useState(projectChips[0]);
  const [mins, setMins] = useState(25);
  const [intent, setIntent] = useState('');
  const [left, setLeft] = useState(0);
  const [total, setTotal] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  function startFocus() {
    const t = Math.round(mins * 60);
    setTotal(t);
    setLeft(t);
    setStage('live');
    timer.current = setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          clearInterval(timer.current);
          setStage('done');
          return 0;
        }
        return l - 1;
      });
    }, 1000);
  }
  function abortFocus() {
    clearInterval(timer.current);
    setStage('setup');
  }
  function finishFocus() {
    clearInterval(timer.current);
    setStage('done');
  }
  function resetFocus() {
    setStage('setup');
  }

  const m = String(Math.max(0, Math.floor(left / 60))).padStart(2, '0');
  const s = String(Math.max(0, left % 60)).padStart(2, '0');
  const dashoffset = total ? 339.3 * (1 - left / total) : 0;
  const doneMin = Math.round(((total - Math.max(0, left)) / 60) * 10) / 10;

  return (
    <section className={`room ${active ? 'on' : ''}`} id="r-focus">
      <h2 className="rh">🎯 FOCUS TIME</h2>
      <div className="rsub">SESSIONS HAVE RITUAL. STARTING ONE IS A COMMITMENT.</div>
      {stage === 'setup' && (
        <div id="focusSetup">
          <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--cyan-dim)' }}>TARGET PROJECT</div>
          <div className="optrow" id="fProj">
            {projectChips.map((c) => (
              <span key={c} className={`chip ${proj === c ? 'on' : ''}`} onClick={() => setProj(c)}>
                {c}
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
          <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--cyan-dim)', marginBottom: 8 }}>MISSION INTENT</div>
          <input id="intent" placeholder='What will you accomplish? e.g. "Ship the dark mode toggle"' value={intent} onChange={(e) => setIntent(e.target.value)} />
          <button className="bigbtn" onClick={startFocus}>
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
          <div id="fCtrl">
            <button onClick={abortFocus}>ABORT</button>
            <button onClick={finishFocus}>COMPLETE ▸</button>
          </div>
        </div>
      )}
      {stage === 'done' && (
        <div id="mission" className="on">
          <h2>▸ MISSION COMPLETE ◂</h2>
          <p id="mSum">
            SESSION LOGGED · {doneMin} MIN · {proj}
            <br />
            INTENT: "{(intent || 'DEEP WORK').toUpperCase()}"
            <br />◈ CORE LOGGED THE SESSION AS A NODE · A STAR BRIGHTENS
          </p>
          <button className="bigbtn" style={{ maxWidth: 320 }} onClick={resetFocus}>
            RETURN TO SETUP
          </button>
        </div>
      )}
    </section>
  );
}
