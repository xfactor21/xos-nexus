import { useState } from 'react';
import { useUiStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import Icon from '../../design-system/icons/Icon';
import AmbientField from '../../design-system/background/AmbientField';

/** SETTINGS — ported 1:1 from xos-prototype.html: xAI autonomy, neon
 * intensity slider (wired to the same --glow var the core node glow uses),
 * shell target decision (Step 8, still undecided). Account panel added for
 * Step 1 (Auth) — no prototype equivalent, since the prototype never had a
 * real session to sign out of. */
export default function Settings({ active }: { active: boolean }) {
  const [autonomy, setAutonomy] = useState('SUGGEST');
  const [shell, setShell] = useState('UNDECIDED');
  const glow = useUiStore((s) => s.glow);
  const setGlow = useUiStore((s) => s.setGlow);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  return (
    <section className={`room ambient ${active ? 'on' : ''}`} id="r-settings">
      <AmbientField mood="cyan" density={18} active={active} parallax />
      <div className="roomInner">
      <h2 className="rh">
        <Icon name="settings" size={16} glow="cyan" /> SETTINGS
      </h2>
      <div className="rsub">SHIP CONFIGURATION</div>
      <div className="gpanel setrow">
        <h3>
          <Icon name="xai" size={14} glow="cyan" /> xAI AUTONOMY
        </h3>
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
      <div className="gpanel setrow">
        <h3>
          <Icon name="user" size={14} /> ACCOUNT
        </h3>
        <div className="d">{user?.email ?? 'Not signed in'}</div>
        <div className="optrow" style={{ margin: 0 }}>
          <span className="chip" onClick={() => signOut()}>
            SIGN OUT
          </span>
        </div>
      </div>
      </div>
    </section>
  );
}
