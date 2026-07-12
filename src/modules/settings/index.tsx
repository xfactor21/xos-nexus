import { useState } from 'react';
import { useUiStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useCoreGraph } from '../../stores/coreGraph';
import { pushToast } from '../../stores/toastStore';
import { supabase } from '../../lib/supabase';
import Icon from '../../design-system/icons/Icon';
import AmbientField from '../../design-system/background/AmbientField';

const ACCENTS: { id: 'mg' | 'pu' | 'cy'; label: string; swatch: string }[] = [
  { id: 'mg', label: 'MAGENTA', swatch: 'var(--mg)' },
  { id: 'pu', label: 'PURPLE', swatch: 'var(--pu)' },
  { id: 'cy', label: 'CYAN', swatch: 'var(--cy)' },
];

/** SETTINGS — ported 1:1 from xos-prototype.html: xAI autonomy, neon
 * intensity slider (wired to the same --glow var the core node glow uses),
 * shell target (Step 8 decision — actually shipped, see
 * .github/workflows/tauri-build.yml). Account panel added for Step 1
 * (Auth) — no prototype equivalent, since the prototype never had a real
 * session to sign out of.
 *
 * Bug fix: autonomy/shell were plain component-local useState (and glow
 * had no backing storage at all), so every pick silently reset to its
 * hardcoded default on the next app relaunch — it only *looked* like it
 * held because RoomOutlet never unmounts rooms within a running session.
 * All three now live in uiStore, persisted to localStorage. */
export default function Settings({ active }: { active: boolean }) {
  const autonomy = useUiStore((s) => s.autonomy);
  const setAutonomy = useUiStore((s) => s.setAutonomy);
  const shell = useUiStore((s) => s.shellTarget);
  const setShell = useUiStore((s) => s.setShellTarget);
  const glow = useUiStore((s) => s.glow);
  const setGlow = useUiStore((s) => s.setGlow);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const accent = useUiStore((s) => s.accent);
  const setAccent = useUiStore((s) => s.setAccent);
  const reduceMotion = useUiStore((s) => s.reduceMotion);
  const setReduceMotion = useUiStore((s) => s.setReduceMotion);
  const uiScale = useUiStore((s) => s.uiScale);
  const setUiScale = useUiStore((s) => s.setUiScale);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const nodes = useCoreGraph((s) => s.nodes);
  const edges = useCoreGraph((s) => s.edges);
  const memories = useCoreGraph((s) => s.memories);
  const [newPassword, setNewPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  function exportData() {
    // Real export of whatever's actually in the store — no placeholder file.
    const payload = { exportedAt: new Date().toISOString(), nodes, edges, memories };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xos-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast('Export downloaded.', 'success');
  }

  async function changePassword() {
    if (newPassword.length < 8) {
      pushToast('Password must be at least 8 characters.', 'warn');
      return;
    }
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwBusy(false);
    if (error) {
      pushToast(`Password change failed: ${error.message}`, 'warn');
      return;
    }
    setNewPassword('');
    pushToast('Password updated.', 'success');
  }

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
          {(['OBSERVE ONLY', 'SUGGEST', 'ROUTE AUTOMATICALLY', 'FULL COPILOT'] as const).map((o) => (
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
        <div className="d">Decided and shipped in Step 8 — Tauri (see .github/workflows/tauri-build.yml).</div>
        <div className="optrow" style={{ margin: 0 }}>
          {(['ELECTRON', 'TAURI', 'UNDECIDED'] as const).map((o) => (
            <span key={o} className={`chip ${shell === o ? 'on' : ''}`} onClick={() => setShell(o)}>
              {o}
            </span>
          ))}
        </div>
      </div>
      <div className="gpanel setrow">
        <h3>THEME ACCENT</h3>
        <div className="d">Which brand hue drives active-state emphasis chrome (active room, active thread). The core cockpit palette stays fixed.</div>
        <div className="optrow" style={{ margin: 0 }}>
          {ACCENTS.map((a) => (
            <span key={a.id} className={`chip ${accent === a.id ? 'on' : ''}`} onClick={() => setAccent(a.id)}>
              <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: a.swatch, marginRight: 6 }} />
              {a.label}
            </span>
          ))}
        </div>
      </div>
      <div className="gpanel setrow">
        <h3>
          <Icon name="command" size={14} /> KEYBOARD SHORTCUTS
        </h3>
        <div className="d">Cmd/Ctrl+K opens the command palette anywhere. Press ? to see everything else.</div>
        <div className="optrow" style={{ margin: 0 }}>
          <span className="chip" onClick={() => setShortcutsOpen(true)}>
            VIEW SHORTCUTS
          </span>
        </div>
      </div>
      <div className="gpanel setrow">
        <h3>ACCESSIBILITY</h3>
        <div className="d">Reduce Motion overrides the app's animation even if your OS doesn't request it. UI Scale resizes text app-wide.</div>
        <div className="optrow" style={{ margin: 0 }}>
          <span className={`chip ${reduceMotion ? 'on' : ''}`} onClick={() => setReduceMotion(!reduceMotion)}>
            <Icon name={reduceMotion ? 'checkCircle' : 'circle'} size={12} /> REDUCE MOTION
          </span>
        </div>
        <div className="d" style={{ marginTop: 10 }}>UI SCALE — {Math.round(uiScale * 100)}%</div>
        <input type="range" min={0.85} max={1.25} step={0.05} value={uiScale} onChange={(e) => setUiScale(parseFloat(e.target.value))} />
      </div>
      <div className="gpanel setrow">
        <h3>
          <Icon name="download" size={14} /> DATA EXPORT
        </h3>
        <div className="d">Download every node, edge, and memory currently loaded, as JSON.</div>
        <div className="optrow" style={{ margin: 0 }}>
          <span className="chip" onClick={exportData}>
            EXPORT JSON
          </span>
        </div>
      </div>
      <div className="gpanel setrow">
        <h3>
          <Icon name="lock" size={14} /> PASSWORD
        </h3>
        <div className="d">Change your Supabase Auth password.</div>
        <div className="optrow" style={{ margin: 0, gap: 8 }}>
          <input
            type="password"
            placeholder="New password (min 8 chars)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={{ flex: 1, background: 'var(--glass)', border: '1px solid var(--edge)', padding: '8px 10px', fontSize: 12, color: 'var(--text)' }}
          />
          <span className="chip" onClick={changePassword} style={{ opacity: pwBusy ? 0.5 : 1, pointerEvents: pwBusy ? 'none' : 'auto' }}>
            {pwBusy ? 'UPDATING…' : 'CHANGE'}
          </span>
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
