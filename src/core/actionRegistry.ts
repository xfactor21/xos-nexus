import { useMemo } from 'react';
import { useUiStore } from '../stores/uiStore';
import { ROOMS } from './rooms';
import { exportGraphData } from '../lib/exportData';

/**
 * The internal "plugin surface" for action-type Custom Commands (Settings >
 * CUSTOM COMMANDS) — every entry here is one existing xOS capability made
 * bindable to a custom palette command. Adding a new capability to the
 * registry (one array entry) makes it pickable in Settings and runnable
 * from the command palette with zero other changes — this is what keeps
 * the command palette from being a fixed, hardcoded list forever.
 */
export interface RegisteredAction {
  id: string;
  label: string;
  category: string;
  run: () => void;
}

/** Built fresh off the live store each render (not a static array) so a
 * bound custom command always acts on current state — e.g. "Toggle Ship
 * Ambience" reads whichever way it's currently set, never a stale value
 * captured once at registration time. */
export function useActionRegistry(): RegisteredAction[] {
  const go = useUiStore((s) => s.go);
  const shipAmbience = useUiStore((s) => s.shipAmbience);
  const setShipAmbience = useUiStore((s) => s.setShipAmbience);
  const reduceMotion = useUiStore((s) => s.reduceMotion);
  const setReduceMotion = useUiStore((s) => s.setReduceMotion);
  const soundEnabled = useUiStore((s) => s.soundEnabled);
  const setSoundEnabled = useUiStore((s) => s.setSoundEnabled);
  const pinkAccents = useUiStore((s) => s.pinkAccents);
  const setPinkAccents = useUiStore((s) => s.setPinkAccents);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);

  return useMemo<RegisteredAction[]>(
    () => [
      ...ROOMS.map((r) => ({
        id: `nav:${r.id}`,
        label: `Go to ${r.name}`,
        category: 'NAVIGATE',
        run: () => go(r.id),
      })),
      {
        id: 'ambience:toggle',
        label: shipAmbience ? 'Turn Ship Ambience off' : 'Turn Ship Ambience on',
        category: 'TOGGLE',
        run: () => setShipAmbience(!shipAmbience),
      },
      {
        id: 'motion:toggle',
        label: reduceMotion ? 'Turn Reduce Motion off' : 'Turn Reduce Motion on',
        category: 'TOGGLE',
        run: () => setReduceMotion(!reduceMotion),
      },
      {
        id: 'sound:toggle',
        label: soundEnabled ? 'Mute sound' : 'Unmute sound',
        category: 'TOGGLE',
        run: () => setSoundEnabled(!soundEnabled),
      },
      {
        id: 'accents:toggle',
        label: pinkAccents ? 'Turn accent color off' : 'Turn accent color on',
        category: 'TOGGLE',
        run: () => setPinkAccents(!pinkAccents),
      },
      {
        id: 'data:export',
        label: 'Export data as JSON',
        category: 'DATA',
        run: () => exportGraphData(),
      },
      {
        id: 'shortcuts:open',
        label: 'Show keyboard shortcuts',
        category: 'HELP',
        run: () => setShortcutsOpen(true),
      },
    ],
    [
      go,
      shipAmbience,
      setShipAmbience,
      reduceMotion,
      setReduceMotion,
      soundEnabled,
      setSoundEnabled,
      pinkAccents,
      setPinkAccents,
      setShortcutsOpen,
    ],
  );
}
