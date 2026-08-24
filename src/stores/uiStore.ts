import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** System tray: the tooltip reflects real autonomy state instead of a
 * static label. Dynamically imported so the web/Netlify build (no Tauri
 * runtime) never loads @tauri-apps/api's core module for this — same
 * "isTauri() gate + dynamic import" pattern used for the capture widget
 * pop-out. Fire-and-forget: a tray tooltip failing to update is never
 * worth surfacing an error for. */
function syncTrayTooltip(autonomy: string) {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
  void import('@tauri-apps/api/core').then(({ invoke }) =>
    invoke('set_tray_tooltip', { text: `xOS: neXus — ${autonomy}` }).catch(() => {}),
  );
}

export type RoomId =
  | 'obs' | 'core' | 'capture' | 'projects' | 'focus' | 'studio'
  | 'roadmaps' | 'bugs' | 'releases' | 'vault' | 'comms' | 'settings'
  // Step 7 (added after the cockpit redesign landed) — three new rooms,
  // desktop-first, built with an eventual public/multi-user release in
  // mind rather than one Captain's machine.
  | 'browser' | 'knowledge' | 'terminal';

export type Autonomy = 'OBSERVE ONLY' | 'SUGGEST' | 'ROUTE AUTOMATICALLY' | 'FULL COPILOT';
export type ShellTarget = 'ELECTRON' | 'TAURI' | 'UNDECIDED';

interface UiState {
  room: RoomId;
  sidebarOpen: boolean;
  glow: number;
  autonomy: Autonomy;
  shellTarget: ShellTarget;
  reduceMotion: boolean;
  uiScale: number;
  shortcutsOpen: boolean;
  commandPaletteOpen: boolean;
  soundEnabled: boolean;
  soundVolume: number;
  /** Cockpit redesign, Captain's design pass: the hot-pink/violet gradient
   * "hairline + thread" accent (Design Studio pick, combo of variants 1+3 —
   * see legacy.css's GLOBAL ACCENT block) rolled out app-wide as a subtle
   * touch on top of the cyan-primary palette. Cyan stays primary regardless
   * of this setting — this only toggles the secondary gradient accent, per
   * "option to turn accents off in settings." Applied via a class on
   * <html> (see applyPinkAccents below) so plain CSS can gate on it. */
  pinkAccents: boolean;
  go: (r: RoomId) => void;
  toggleSidebar: () => void;
  closeSidebar: () => void;
  setGlow: (v: number) => void;
  setAutonomy: (a: Autonomy) => void;
  setShellTarget: (s: ShellTarget) => void;
  setReduceMotion: (v: boolean) => void;
  setUiScale: (v: number) => void;
  setShortcutsOpen: (v: boolean) => void;
  setCommandPaletteOpen: (v: boolean) => void;
  setSoundEnabled: (v: boolean) => void;
  setSoundVolume: (v: number) => void;
  setPinkAccents: (v: boolean) => void;
}

function applyReduceMotion(v: boolean) {
  document.documentElement.classList.toggle('force-reduce-motion', v);
}
function applyUiScale(v: number) {
  document.documentElement.style.setProperty('--ui-scale', String(v));
}
function applyPinkAccents(v: boolean) {
  document.documentElement.classList.toggle('no-pink-accents', !v);
}

/** Bug fix (flagged by the Captain): Settings' xAI Autonomy, Shell Target,
 * and Neon Intensity pickers never held across an app relaunch. They were
 * either plain component-local `useState` (autonomy/shell in
 * modules/settings/index.tsx) or, for glow, a store field with no backing
 * storage — so every value silently reset to its hardcoded default the
 * moment the Tauri window was closed and reopened, even though within a
 * single running session (rooms never unmount — see RoomOutlet) the picks
 * looked like they were sticking. Wrapping the whole store in zustand's
 * `persist` middleware, backed by localStorage (same precedent as
 * modules/projects/local.ts), actually saves these across relaunches.
 * `room`/`sidebarOpen` are deliberately left out of
 * `partialize` below — those are transient navigation state and should
 * reset to a clean boot state on a fresh launch, not "remember" whatever
 * room happened to be open when the app last closed. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      room: 'obs',
      sidebarOpen: false,
      glow: 1,
      autonomy: 'SUGGEST',
      // Sprint 002's shell decision was made and actually shipped back in
      // Step 8 (.github/workflows/tauri-build.yml + src-tauri/ — a Linux
      // .deb was built and smoke-tested) — this default now reflects that
      // real decision instead of the stale "UNDECIDED" the Settings picker
      // showed before this fix.
      shellTarget: 'TAURI',
      reduceMotion: false,
      uiScale: 1,
      shortcutsOpen: false,
      commandPaletteOpen: false,
      soundEnabled: true,
      soundVolume: 0.6,
      pinkAccents: true,
      // Amendment v0.6 step 2: the sidebar is now a persistent "neural spine"
      // (always at least visible as a collapsed dot-rail, never fully hidden —
      // see Shell.tsx), so selecting a room no longer force-collapses it the
      // way the old off-canvas mobile-drawer pattern did.
      go: (r) => set({ room: r }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      closeSidebar: () => set({ sidebarOpen: false }),
      setGlow: (v) => {
        document.documentElement.style.setProperty('--glow', String(v));
        set({ glow: v });
      },
      setAutonomy: (a) => {
        syncTrayTooltip(a);
        set({ autonomy: a });
      },
      setShellTarget: (s) => set({ shellTarget: s }),
      setReduceMotion: (v) => {
        applyReduceMotion(v);
        set({ reduceMotion: v });
      },
      setUiScale: (v) => {
        applyUiScale(v);
        set({ uiScale: v });
      },
      setShortcutsOpen: (v) => set({ shortcutsOpen: v }),
      setCommandPaletteOpen: (v) => set({ commandPaletteOpen: v }),
      setSoundEnabled: (v) => set({ soundEnabled: v }),
      setSoundVolume: (v) => set({ soundVolume: v }),
      setPinkAccents: (v) => {
        applyPinkAccents(v);
        set({ pinkAccents: v });
      },
    }),
    {
      name: 'xos-ui-settings',
      partialize: (s) => ({
        glow: s.glow,
        autonomy: s.autonomy,
        shellTarget: s.shellTarget,
        reduceMotion: s.reduceMotion,
        uiScale: s.uiScale,
        soundEnabled: s.soundEnabled,
        soundVolume: s.soundVolume,
        pinkAccents: s.pinkAccents,
      }),
      // The --glow/--accent/--ui-scale CSS custom properties and the
      // force-reduce-motion class all live outside React (read by canvas
      // effects or plain CSS), so on rehydration they need the same manual
      // sync each setter does on every change — otherwise a restored value
      // would be correct in the store but invisible in the rendered UI
      // until the control was touched again.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        document.documentElement.style.setProperty('--glow', String(state.glow));
        applyReduceMotion(state.reduceMotion);
        applyUiScale(state.uiScale);
        applyPinkAccents(state.pinkAccents);
        syncTrayTooltip(state.autonomy);
      },
    }
  )
);
