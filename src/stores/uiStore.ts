import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type RoomId =
  | 'obs' | 'core' | 'capture' | 'projects' | 'focus' | 'studio'
  | 'roadmaps' | 'bugs' | 'releases' | 'vault' | 'comms' | 'settings';

export type Autonomy = 'OBSERVE ONLY' | 'SUGGEST' | 'ROUTE AUTOMATICALLY' | 'FULL COPILOT';
export type ShellTarget = 'ELECTRON' | 'TAURI' | 'UNDECIDED';
/** Cockpit redesign — accent controls which of the three brand hues drives
 * single-color emphasis chrome (active nav border, active thread accent,
 * etc). The base mg/pu/cy/pk palette itself stays fixed everywhere else per
 * the brief's "non-negotiable" color system — this only reassigns which one
 * is *dominant*, it doesn't introduce new colors. */
export type Accent = 'mg' | 'pu' | 'cy';

interface UiState {
  room: RoomId;
  sidebarOpen: boolean;
  dockOpen: boolean;
  glow: number;
  autonomy: Autonomy;
  shellTarget: ShellTarget;
  accent: Accent;
  reduceMotion: boolean;
  uiScale: number;
  shortcutsOpen: boolean;
  commandPaletteOpen: boolean;
  go: (r: RoomId) => void;
  toggleSidebar: () => void;
  closeSidebar: () => void;
  toggleDock: () => void;
  setGlow: (v: number) => void;
  setAutonomy: (a: Autonomy) => void;
  setShellTarget: (s: ShellTarget) => void;
  setAccent: (a: Accent) => void;
  setReduceMotion: (v: boolean) => void;
  setUiScale: (v: number) => void;
  setShortcutsOpen: (v: boolean) => void;
  setCommandPaletteOpen: (v: boolean) => void;
}

function applyAccent(a: Accent) {
  const map: Record<Accent, string> = { mg: 'var(--mg)', pu: 'var(--pu)', cy: 'var(--cy)' };
  document.documentElement.style.setProperty('--accent', map[a]);
}
function applyReduceMotion(v: boolean) {
  document.documentElement.classList.toggle('force-reduce-motion', v);
}
function applyUiScale(v: number) {
  document.documentElement.style.setProperty('--ui-scale', String(v));
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
 * `room`/`sidebarOpen`/`dockOpen` are deliberately left out of
 * `partialize` below — those are transient navigation state and should
 * reset to a clean boot state on a fresh launch, not "remember" whatever
 * room happened to be open when the app last closed. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      room: 'obs',
      sidebarOpen: false,
      dockOpen: true,
      glow: 1,
      autonomy: 'SUGGEST',
      // Sprint 002's shell decision was made and actually shipped back in
      // Step 8 (.github/workflows/tauri-build.yml + src-tauri/ — a Linux
      // .deb was built and smoke-tested) — this default now reflects that
      // real decision instead of the stale "UNDECIDED" the Settings picker
      // showed before this fix.
      shellTarget: 'TAURI',
      accent: 'mg',
      reduceMotion: false,
      uiScale: 1,
      shortcutsOpen: false,
      commandPaletteOpen: false,
      // Amendment v0.6 step 2: the sidebar is now a persistent "neural spine"
      // (always at least visible as a collapsed dot-rail, never fully hidden —
      // see Shell.tsx), so selecting a room no longer force-collapses it the
      // way the old off-canvas mobile-drawer pattern did.
      go: (r) => set({ room: r }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      closeSidebar: () => set({ sidebarOpen: false }),
      toggleDock: () => set((s) => ({ dockOpen: !s.dockOpen })),
      setGlow: (v) => {
        document.documentElement.style.setProperty('--glow', String(v));
        set({ glow: v });
      },
      setAutonomy: (a) => set({ autonomy: a }),
      setShellTarget: (s) => set({ shellTarget: s }),
      setAccent: (a) => {
        applyAccent(a);
        set({ accent: a });
      },
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
    }),
    {
      name: 'xos-ui-settings',
      partialize: (s) => ({ glow: s.glow, autonomy: s.autonomy, shellTarget: s.shellTarget, accent: s.accent, reduceMotion: s.reduceMotion, uiScale: s.uiScale }),
      // The --glow/--accent/--ui-scale CSS custom properties and the
      // force-reduce-motion class all live outside React (read by canvas
      // effects or plain CSS), so on rehydration they need the same manual
      // sync each setter does on every change — otherwise a restored value
      // would be correct in the store but invisible in the rendered UI
      // until the control was touched again.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        document.documentElement.style.setProperty('--glow', String(state.glow));
        applyAccent(state.accent);
        applyReduceMotion(state.reduceMotion);
        applyUiScale(state.uiScale);
      },
    }
  )
);
