import { create } from 'zustand';
import { playSound } from '../lib/sound';

export type ToastKind = 'info' | 'success' | 'warn';
export interface Toast {
  id: string;
  text: string;
  kind: ToastKind;
}

interface ToastState {
  toasts: Toast[];
  push: (text: string, kind?: ToastKind) => void;
  dismiss: (id: string) => void;
}

let seq = 0;

/** App-wide reusable toast system — every background event (a live capture
 * landing via Realtime, an autonomous xAI trigger, a cross-room drag-drop
 * action) surfaces here instead of each room inventing its own one-off
 * notification. Deliberately NOT persisted — toasts are ephemeral by
 * nature, unlike uiStore's settings. */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (text, kind = 'info') => {
    const id = `toast-${++seq}-${Date.now()}`;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    playSound(kind === 'warn' ? 'toast-warn' : 'toast');
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Non-hook accessor so plain (non-component) code — coreGraph's Realtime
 * handlers, copilotClient, etc — can push a toast without needing to be a
 * React component. */
export function pushToast(text: string, kind: ToastKind = 'info') {
  useToastStore.getState().push(text, kind);
}
