import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { commitOrQueue } from '../lib/offlineSync';
import { playSound } from '../lib/sound';
import Icon from '../design-system/icons/Icon';

/**
 * Poppable Quick Capture widget — the content of the standalone
 * `capture-widget` Tauri window (see src-tauri/src/lib.rs). Deliberately
 * NOT a shrunk-down copy of the full Capture room: this window exists so a
 * thought can be captured without switching away from whatever else is on
 * screen, so it's just a textarea and a commit button.
 *
 * Real data path, not a mock: this window shares the app's localStorage/
 * origin with the main window (same Tauri app, same webview data store),
 * so useAuthStore picks up the same signed-in session automatically, and
 * commitOrQueue writes to the same Supabase `nodes` table the main window
 * reads from — the main window's coreGraph Realtime subscription and toast
 * system pick the new node up on their own once it lands, no direct
 * window-to-window messaging needed.
 */
export default function CaptureWidget() {
  const init = useAuthStore((s) => s.init);
  const status = useAuthStore((s) => s.status);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'saved' | 'queued' | 'error'; text: string } | null>(null);

  useEffect(() => {
    init();
  }, [init]);

  async function submit() {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const { queued } = await commitOrQueue(v);
      setText('');
      playSound(queued ? 'notice' : 'capture');
      setResult({ kind: queued ? 'queued' : 'saved', text: queued ? 'Saved offline — will sync.' : 'Captured.' });
    } catch (err) {
      playSound('error');
      setResult({ kind: 'error', text: err instanceof Error ? err.message : 'Capture failed.' });
    } finally {
      setBusy(false);
      setTimeout(() => setResult(null), 2500);
    }
  }

  return (
    <div className="widgetRoot">
      <div className="widgetHeader">
        <Icon name="neuralCapture" size={13} glow="cyan" /> QUICK CAPTURE
      </div>
      {status === 'signed-out' && <div className="widgetSignedOut">Sign in from the main xOS window first.</div>}
      {status !== 'signed-out' && (
        <>
          <textarea
            className="widgetTextarea"
            autoFocus
            placeholder="What's on your mind, Captain?"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
          />
          <div className="widgetFooter">
            <span className="widgetHint">Cmd/Ctrl+Enter to commit</span>
            <button className="widgetSubmit" onClick={submit} disabled={busy || !text.trim()}>
              {busy ? 'SAVING…' : 'CAPTURE'}
            </button>
          </div>
          {result && <div className={`widgetResult widgetResult-${result.kind}`}>{result.text}</div>}
        </>
      )}
    </div>
  );
}
