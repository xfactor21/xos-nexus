import { useState } from 'react';
import { useUiStore } from '../../stores/uiStore';

/** SETTINGS — ported 1:1 from xos-prototype.html: xAI autonomy, neon
 * intensity slider (wired to the same --glow var the core node glow uses),
 * shell target decision (Step 8, still undecided). */
export default function Settings({ active }: { active: boolean }) {
  const [autonomy, setAutonomy] = useState('SUGGEST');
  const [shell, setShell] = useState('UNDECIDED');
  const glow = useUiStore((s) => s.glow);
  const setGlow = useUiStore((s) => s.setGlow);

  return (
    <section className={`room ${active ? 'on' : ''}`} id="r-settings">
      <h2 className="rh">⚙ SETTINGS</h2>
      <div className="rsub">SHIP CONFIGURATION</div>
      <div className="gpanel setrow">
        <h3>◈ xAI AUTONOMY</h3>
        <div className="d">How much may xAI act without asking? All actions stay reversible.</div>
        <div className="optrow" style={{ margin: 0 }}>
          {['OBSERVE ONLY', 'SUGGEST', 'ROUTE AUTOMATICALLY', 'FULL COPILOT'].map((o) => (
            <span key={o} className={`chip ${autonomy === o ? 'on' : ''}`} onClick={() => setAutonomy(o)}>
              {o}
            </span>
          ))}
        </div>
      </div>
      <div className="gpanel setrow">
        <h3>NEON INTENSITY</h3>
        <div className="d">Glow strength across the interface.</div>
        <input type="range" min={0} max={2} step={0.1} value={glow} onChange={(e) => setGlow(parseFloat(e.target.value))} />
      </div>
      <div className="gpanel setrow">
        <h3>SHELL TARGET</h3>
        <div className="d">Sprint 002 decision pending.</div>
        <div className="optrow" style={{ margin: 0 }}>
          {['ELECTRON', 'TAURI', 'UNDECIDED'].map((o) => (
            <span key={o} className={`chip ${shell === o ? 'on' : ''}`} onClick={() => setShell(o)}>
              {o}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
