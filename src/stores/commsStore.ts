import { create } from 'zustand';

/** Tiny shared store so parts of the app outside the Comms room (Ship
 * Ambience's reactive alert condition) can read a real "how many threads
 * are unread" number without importing the whole Comms room or its thread
 * content. modules/comms/index.tsx is the sole writer — this store only
 * ever holds the count. */
interface CommsState {
  unreadCount: number;
  setUnreadCount: (n: number) => void;
}

export const useCommsStore = create<CommsState>((set) => ({
  unreadCount: 0,
  setUnreadCount: (n) => set((s) => (s.unreadCount === n ? s : { unreadCount: n })),
}));
