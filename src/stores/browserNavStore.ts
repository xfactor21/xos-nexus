import { create } from 'zustand';

/**
 * Terminal room's "Run Dev Server" (Part 2) hands a detected local dev
 * server URL to the Browser room (Part 1) through here rather than the two
 * modules importing each other directly — RoomOutlet mounts every room
 * simultaneously (see its own doc comment), so this is just a one-shot
 * mailbox: Terminal calls `requestNavigate(url)` then `useUiStore.getState().go('browser')`;
 * Browser's effect picks up `pendingUrl` once it becomes the active room and
 * clears it, so it's never replayed on a later visit.
 */
interface BrowserNavState {
  pendingUrl: string | null;
  requestNavigate: (url: string) => void;
  clearPending: () => void;
}

export const useBrowserNavStore = create<BrowserNavState>((set) => ({
  pendingUrl: null,
  requestNavigate: (url) => set({ pendingUrl: url }),
  clearPending: () => set({ pendingUrl: null }),
}));
