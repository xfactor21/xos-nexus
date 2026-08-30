import { useEffect, useRef } from 'react';
import { useConfirmStore } from '../../stores/confirmStore';
import { playSound } from '../../lib/sound';
import Icon from '../icons/Icon';

/** Themed replacement for the browser's native `window.confirm()` — every
 * destructive/consequential action in the app (delete bug, clear history,
 * run an xAI-suggested shell command, delete a custom command, etc) now
 * routes through `askConfirm()` (stores/confirmStore.ts) instead of the flat
 * OS dialog, which broke the cockpit illusion every time it popped. Mounted
 * once in Shell.tsx alongside ToastHost/CommandPalette/ShortcutsOverlay —
 * same "one global overlay, works from every room" pattern. */
export default function ConfirmDialog() {
  const pending = useConfirmStore((s) => s.pending);
  const resolveWith = useConfirmStore((s) => s._resolveWith);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pending) return;
    playSound('toast-warn');
    // Focus the confirm button on open so Enter immediately actions it —
    // matches the native dialog's keyboard behavior Captains are used to.
    confirmBtnRef.current?.focus();
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        resolveWith(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        resolveWith(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, resolveWith]);

  if (!pending) return null;

  return (
    <div className="confirmOverlay" onClick={() => resolveWith(false)}>
      <div className={`confirmPanel ${pending.tone === 'danger' ? 'danger' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="confirmHead">
          <Icon name="warning" size={16} glow={pending.tone === 'danger' ? 'magenta' : 'cyan'} />
          <span>{pending.title ?? (pending.tone === 'danger' ? 'CONFIRM — CANNOT BE UNDONE' : 'CONFIRM ACTION')}</span>
        </div>
        <div className="confirmMsg">{pending.message}</div>
        <div className="confirmBtns">
          <button className="confirmBtn cancel" onClick={() => resolveWith(false)}>
            {pending.cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            className={`confirmBtn accept ${pending.tone === 'danger' ? 'danger' : ''}`}
            onClick={() => resolveWith(true)}
          >
            {pending.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
