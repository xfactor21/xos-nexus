import { useState } from 'react';
import { useUiStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useCoreGraph } from '../../stores/coreGraph';
import { pushToast } from '../../stores/toastStore';
import { supabase } from '../../lib/supabase';
import { playSound } from '../../lib/sound';
import Icon from '../../design-system/icons/Icon';
import AmbientField from '../../design-system/background/AmbientField';
import { resetCoreLayout } from '../copilot/NeuralCore';

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
 * All three now live in uiStore, persisted to localStorage.
 *
 * Cleanup pass (Captain's audit — "get rid of settings that don't work"):
 * THEME ACCENT was removed entirely. It set `--accent` on <html>, but a
 * grep across every stylesheet in the app turned up zero uses of
 * `var(--accent)` — the redesign's actual accent system (pinkAccents below)
 * replaced it and nothing was ever wired back to this variable, so the
 * picker changed literally nothing on screen. SHELL TARGET is downgraded
 * from a 3-way picker to a plain status line for the same reason: nothing
 * in the codebase reads `shellTarget` except this file, and the decision
 * it "picks" was already made and shipped (Step 8) — showing three
 * clickable chips implied you could switch back to Electron/Undecided and
 * have that matter, which isn't true. xAI AUTONOMY was kept: it's the one
 * picker here with a real (if modest) effect — it updates the desktop
 * tray tooltip live (see syncTrayTooltip in uiStore.ts) — so its copy below
 * was tightened to describe what it actually does today instead of
 * implying it gates xAI's write behavior (that's hard-coded to always
 * confirm before filing — see XaiChatWindow.tsx). */
export default function Settings({ active }: { active: boolean }) {
  const autonomy = useUiStore((s) => s.autonomy);
  const setAutonomy = useUiStore((s) => s.setAutonomy);
  const shell = useUiStore((s) => s.shellTarget);
  const glow = useUiStore((s) => s.glow);
  const setGlow = useUiStore((s) => s.setGlow);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const reduceMotion = useUiStore((s) => s.reduceMotion);
  const setReduceMotion = useUiStore((s) => s.setReduceMotion);
  const uiScale = useUiStore((s) => s.uiScale);
  const setUiScale = useUiStore((s) => s.setUiScale);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const soundEnabled = useUiStore((s) => s.soundEnabled);
  const setSoundEnabled = useUiStore((s) => s.setSoundEnabled);
  const soundVolume = useUiStore((s) => s.soundVolume);
  const setSoundVolume = useUiStore((s) => s.setSoundVolume);
  const pinkAccents = useUiStore((s) => s.pinkAccents);
  const setPinkAccents = useUiStore((s) => s.setPinkAccents);
  const shipAmbience = useUiStore((s) => s.shipAmbience);
  const setShipAmbience = useUiStore((s) => s.setShipAmbience);
  const go = useUiStore((s) => s.go);
  const nodes = useCoreGraph((s) => s.nodes);
  const edges = useCoreGraph((s) => s.edges);
  const memories = useCoreGraph((s) => s.memories);
  const [newPassword, setNewPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [tourBusy, setTourBusy] = useState(false);

  /** Reverses `markFeatureTourComplete` without touching the cinematic
   * onboarding flag or any real data — a Captain who wants to see the new
   * FeatureTour again shouldn't have to wipe their whole account to do it.
   * `App.tsx` re-checks `has_seen_feature_tour` on every mount, so the tour
   * genuinely replays on next load rather than just flipping a value nothing
   * reads. */
  async function replayFeatureTour() {
    setTourBusy(true);
    const { error } = await supabase.auth.updateUser({ data: { has_seen_feature_tour: false } });
    setTourBusy(false);
    if (error) {
      pushToast(`Couldn't reset the tour: ${error.message}`, 'warn');
      return;
    }
    pushToast('Feature tour will replay next time you load xOS.', 'success');
  }

  /** Un-persists Neural Core's dragged positions/groups back to the default
   * radial layout (real nodes/edges/tags are untouched — this only clears
   * `xos-corepos-${ownerId}`). Reloads so the room actually re-lays-out;
   * rooms never unmount within a session (see RoomOutlet), so without a
   * reload the already-mounted ring wouldn't reflect the cleared state. */
  function resetLayout() {
    resetCoreLayout(user?.id ?? null);
    pushToast('Neural Core layout reset — reloading…', 'success');
    setTimeout(() => window.location.reload(), 600);
  }

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
        <div className="d">
          Updates your desktop tray tooltip live. Filing still always asks first in chat, regardless of this
          setting — see the Yes/No prompt after anything xAI proposes logging.
        </div>
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
        <div className="d">Decided and shipped in Step 8 — <strong>{shell}</strong> (see .github/workflows/tauri-build.yml). Not a live toggle — the build target is fixed at compile time.</div>
      </div>
      <div className="gpanel setrow">
        <h3>PINK/VIOLET ACCENTS</h3>
        <div className="d">
          A subtle hot-pink/violet gradient thread — the header hairline, Design Studio's freshest-board
          ring and New Board tile — layered on top of the cyan-primary cockpit. Cyan stays primary either way;
          this only turns the secondary accent on or off app-wide.
        </div>
        <div className="optrow" style={{ margin: 0 }}>
          <span className={`chip ${pinkAccents ? 'on' : ''}`} onClick={() => setPinkAccents(!pinkAccents)}>
            <Icon name={pinkAccents ? 'checkCircle' : 'circle'} size={12} /> {pinkAccents ? 'ACCENTS ON' : 'ACCENTS OFF'}
          </span>
        </div>
      </div>
      <div className="gpanel setrow">
        <h3>SHIP AMBIENCE</h3>
        <div className="d">
          Subtle per-room decoration — a comet occasionally crossing the screen, blinking console lights,
          a small decorative "still running" terminal readout, different per room. Purely cosmetic, never
          blocks or sits on top of real content. Turn it off here any time it's not landing for you.
        </div>
        <div className="optrow" style={{ margin: 0 }}>
          <span className={`chip ${shipAmbience ? 'on' : ''}`} onClick={() => setShipAmbience(!shipAmbience)}>
            <Icon name={shipAmbience ? 'checkCircle' : 'circle'} size={12} /> {shipAmbience ? 'AMBIENCE ON' : 'AMBIENCE OFF'}
          </span>
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
        <h3>
          <Icon name="refresh" size={14} /> NEURAL CORE LAYOUT
        </h3>
        <div className="d">Dragged nodes and groups getting unreadable? Reset back to the default radial layout — your actual nodes, tags, and associations are untouched.</div>
        <div className="optrow" style={{ margin: 0 }}>
          <span className="chip" onClick={resetLayout}>
            RESET LAYOUT
          </span>
        </div>
      </div>
      <div className="gpanel setrow">
        <h3>
          <Icon name="browser" size={14} /> BROWSER
        </h3>
        <div className="d">Homepage, external-link behavior, and clear-data controls live inside the Browser room itself.</div>
        <div className="optrow" style={{ margin: 0 }}>
          <span className="chip" onClick={() => go('browser')}>
            OPEN BROWSER SETTINGS
          </span>
        </div>
      </div>
      <div className="gpanel setrow">
        <h3>
          <Icon name="tag" size={14} /> REVIEW xAI'S TAGS &amp; ASSOCIATIONS
        </h3>
        <div className="d">Accept, correct, or reject what xAI has tagged and linked on its own — corrections genuinely feed back into future classification, not just cosmetic cleanup.</div>
        <div className="optrow" style={{ margin: 0 }}>
          <span className="chip" onClick={() => go('core')}>
            OPEN NEURAL CORE
          </span>
        </div>
      </div>
      <div className="gpanel setrow">
        <h3>
          <Icon name="history" size={14} /> FEATURE TOUR
        </h3>
        <div className="d">Replay the guided tour of xOS's core features (Neural Core, xAI chat, Capture, and the rest).</div>
        <div className="optrow" style={{ margin: 0 }}>
          <span className="chip" onClick={replayFeatureTour} style={{ opacity: tourBusy ? 0.5 : 1, pointerEvents: tourBusy ? 'none' : 'auto' }}>
            {tourBusy ? 'RESETTING…' : 'REPLAY TOUR'}
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
        <h3>SOUND</h3>
        <div className="d">Synthesized UI tones — capture confirms, toasts, xAI's autonomous chime, room-nav ticks. No audio files, just oscillators.</div>
        <div className="optrow" style={{ margin: 0 }}>
          <span
            className={`chip ${soundEnabled ? 'on' : ''}`}
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              if (next) playSound('nav');
            }}
          >
            <Icon name={soundEnabled ? 'checkCircle' : 'circle'} size={12} /> SOUND ENABLED
          </span>
        </div>
        <div className="d" style={{ marginTop: 10 }}>VOLUME — {Math.round(soundVolume * 100)}%</div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={soundVolume}
          onChange={(e) => setSoundVolume(parseFloat(e.target.value))}
          onMouseUp={() => playSound('nav')}
        />
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
