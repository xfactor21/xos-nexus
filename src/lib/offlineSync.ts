/**
 * Step 8 offline-first sync engine. Pairs with `localDb.ts`'s outbox table:
 * this module is what actually drains it back to Supabase once the shell
 * is back online, plus the `commitOrQueue` wrapper every capture surface
 * calls instead of `offlineCommit` directly so a failed write becomes a
 * queued one (inside Tauri) instead of a lost one.
 */
import { supabase } from './supabase';
import { offlineCommit } from './copilotClient';
import { enqueueCapture, isTauri, listPendingCaptures, markCaptureAttempt, pendingCaptureCount, removePendingCapture } from './localDb';

async function currentOwnerId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/**
 * Same contract as `offlineCommit`, plus: if the write fails (offline, DNS
 * down, Supabase unreachable — anything) AND we're running inside the
 * Tauri shell, the capture is queued to local SQLite instead of the error
 * propagating, and the return value reports `queued: true` so the UI can
 * show "saved — will sync" instead of "not saved." Outside Tauri (the web
 * build), failures still propagate exactly as before — there's no local
 * database to queue into there.
 */
export async function commitOrQueue(text: string, ownerIdOverride: string | null = null): Promise<{ nodeId: string | null; queued: boolean }> {
  try {
    const { nodeId } = await offlineCommit(text, ownerIdOverride);
    return { nodeId, queued: false };
  } catch (err) {
    if (!isTauri()) throw err;
    const ownerId = ownerIdOverride ?? (await currentOwnerId());
    if (!ownerId) throw err;
    await enqueueCapture(ownerId, text);
    return { nodeId: null, queued: true };
  }
}

let started = false;
let draining = false;

/** Idempotent — safe to call from multiple mount points. No-ops outside
 * the Tauri shell. */
export function startSyncEngine() {
  if (started || !isTauri()) return;
  started = true;
  void drainQueue();
  window.addEventListener('online', () => void drainQueue());
  // Belt-and-suspenders poll — `online`/`offline` events aren't always
  // reliable for detecting "the network came back" on every platform.
  window.setInterval(() => void drainQueue(), 20000);
}

/** Attempts to flush every queued capture back to Supabase, oldest first.
 * Stops at the first failure (almost certainly "still offline") rather
 * than burning through retries for every queued row — the next `online`
 * event or poll tick will pick up where this left off. */
export async function drainQueue(): Promise<void> {
  if (draining || !isTauri()) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  draining = true;
  try {
    const pending = await listPendingCaptures();
    for (const row of pending) {
      try {
        await offlineCommit(row.text, row.owner_id);
        await removePendingCapture(row.id);
      } catch (err) {
        await markCaptureAttempt(row.id, err instanceof Error ? err.message : String(err));
        break;
      }
    }
  } finally {
    draining = false;
  }
}

export { pendingCaptureCount, isTauri };
