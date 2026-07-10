import { create } from 'zustand';

export type RoomId =
  | 'obs' | 'core' | 'capture' | 'projects' | 'focus' | 'studio'
  | 'roadmaps' | 'bugs' | 'releases' | 'vault' | 'comms' | 'settings';

interface UiState {
  room: RoomId;
  sidebarOpen: boolean;
  dockOpen: boolean;
  glow: number;
  go: (r: RoomId) => void;
  toggleSidebar: () => void;
  closeSidebar: () => void;
  toggleDock: () => void;
  setGlow: (v: number) => void;
}

export const useUiStore = create<UiState>((set) => ({
  room: 'obs',
  sidebarOpen: false,
  dockOpen: true,
  glow: 1,
  go: (r) => set({ room: r, sidebarOpen: false }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleDock: () => set((s) => ({ dockOpen: !s.dockOpen })),
  setGlow: (v) => {
    document.documentElement.style.setProperty('--glow', String(v));
    set({ glow: v });
  },
}));
