import { create } from 'zustand';

export type ConfirmTone = 'default' | 'danger';

export interface ConfirmRequest {
  id: string;
  message: string;
  title?: string;
  tone: ConfirmTone;
  confirmLabel: string;
  cancelLabel: string;
}

interface ConfirmState {
  pending: ConfirmRequest | null;
  /** Internal — set by askConfirm, read by ConfirmDialog to resolve the caller's promise. */
  _resolve: ((v: boolean) => void) | null;
  _resolveWith: (v: boolean) => void;
  _open: (req: ConfirmRequest, resolve: (v: boolean) => void) => void;
}

let seq = 0;

/** App-wide themed confirm — replaces the browser's native `window.confirm()`,
 * which renders as a plain OS dialog that breaks the cockpit's whole visual
 * language (and, on some platforms, blocks the render thread outright).
 * `ConfirmDialog.tsx` (mounted once in Shell) is the actual glass/glow panel;
 * this store just queues one pending request at a time and holds the promise
 * resolver so callers can `await` it exactly like the native API — every
 * existing `if (!confirm(...)) return;` call site becomes
 * `if (!(await askConfirm(...))) return;` with no other logic changes. */
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,
  _resolve: null,
  _resolveWith: (v) => {
    const resolve = get()._resolve;
    set({ pending: null, _resolve: null });
    resolve?.(v);
  },
  _open: (req, resolve) => set({ pending: req, _resolve: resolve }),
}));

export interface AskConfirmOptions {
  title?: string;
  tone?: ConfirmTone;
  confirmLabel?: string;
  cancelLabel?: string;
}

/** Non-hook accessor — plain functions and event handlers call this directly,
 * same shape as the native `confirm()` they're replacing. Resolves `true` on
 * confirm, `false` on cancel/Escape/backdrop click. Requests queue implicitly
 * (each call waits for `_resolve` to be free is NOT enforced — a second call
 * while one is pending will replace it, which matches this app's usage
 * pattern of one confirm gating one user action at a time; nothing here
 * fires two confirms concurrently). */
export function askConfirm(message: string, opts: AskConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState()._open(
      {
        id: `confirm-${++seq}-${Date.now()}`,
        message,
        title: opts.title,
        tone: opts.tone ?? 'default',
        confirmLabel: opts.confirmLabel ?? 'CONFIRM',
        cancelLabel: opts.cancelLabel ?? 'CANCEL',
      },
      resolve
    );
  });
}
