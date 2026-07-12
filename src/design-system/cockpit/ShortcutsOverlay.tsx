import { useEffect } from 'react';
import { useUiStore } from '../../stores/uiStore';

const SHORTCUTS: [string, string][] = [
  ['Cmd/Ctrl + K', 'Open command palette (navigate, capture, search)'],
  ['?', 'Toggle this shortcuts overlay'],
  ['Esc', 'Close any open overlay/panel'],
  ['Enter', 'Send message (Comms) · confirm top command palette result'],
  ['Click status dot', 'Cycle a bug/task/milestone status'],
  ['Click severity badge', 'Cycle a bug\'s severity'],
  ['Drag a bug row → Roadmaps', 'Promote it to a milestone'],
  ['Drag a capture node → Projects', 'Assign it to that project'],
  ['Menu icon (hud, top-left)', 'Toggle the sidebar between icon-only and labeled'],
  ['xAI dock header', 'Collapse/expand the xAI dock panel'],
  ['Range sliders', 'Drag or arrow-key to adjust (Neon Intensity, etc)'],
  ['Search inputs (Bugs/Vault)', 'Full-text filter as you type — no submit needed'],
];

/** Glassmorphism `?`-key shortcut overlay — global, works from any room. */
export default function ShortcutsOverlay() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '?') setOpen(!useUiStore.getState().shortcutsOpen);
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  if (!open) return null;
  return (
    <div className="shortcutsOverlay" onClick={() => setOpen(false)}>
      <div className="shortcutsPanel" onClick={(e) => e.stopPropagation()}>
        <h3>KEYBOARD SHORTCUTS</h3>
        <div className="shortcutsList">
          {SHORTCUTS.map(([key, desc]) => (
            <div className="shortcutsRow" key={key}>
              <span className="shortcutsKey">{key}</span>
              <span className="shortcutsDesc">{desc}</span>
            </div>
          ))}
        </div>
        <div className="shortcutsClose" onClick={() => setOpen(false)}>CLOSE (ESC)</div>
      </div>
    </div>
  );
}
