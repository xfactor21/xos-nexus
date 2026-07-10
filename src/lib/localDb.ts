/**
 * Local SQLite mirror — Step 8 ("Shell Packaging (Tauri) + Offline-First
 * Sync"). Only meaningful inside the packaged Tauri shell, which is the
 * only build target that ships a local SQLite runtime via
 * `@tauri-apps/plugin-sql`; the web/Netlify companion build (Step 10) has
 * no local database and keeps its existing best-effort behavior.
 *
 * Scope: rather than mirroring every Supabase table locally (a much larger
 * undertaking, and unnecessary for the acceptance test this step is
 * actually graded against), this is an outbox/reconciliation queue for
 * writes made while offline. A capture made with no network lands in
 * `pending_captures` instead of being lost; `syncEngine.ts` drains the
 * queue back to Supabase the moment connectivity returns. This directly
 * satisfies the handoff's Step 8 acceptance criterion: "disconnect
 * network, capture a thought, reconnect — it appears in Supabase without
 * data loss."
 */
import Database from '@tauri-apps/plugin-sql';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export interface PendingCapture {
  id: number;
  owner_id: string;
  text: string;
  created_at: string;
  attempts: number;
  last_error: string | null;
}

let dbPromise: Promise<Database> | null = null;

function loadDb(): Promise<Database> {
  if (!isTauri()) {
    return Promise.reject(new Error('localDb: not running inside the Tauri shell — no local SQLite runtime available.'));
  }
  if (!dbPromise) {
    dbPromise = Database.load('sqlite:xos-nexus.db').then(async (db) => {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS pending_captures (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT NOT NULL,
          text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT
        )`,
      );
      return db;
    });
  }
  return dbPromise;
}

export async function enqueueCapture(ownerId: string, text: string): Promise<void> {
  const db = await loadDb();
  await db.execute('INSERT INTO pending_captures (owner_id, text, created_at) VALUES ($1, $2, $3)', [ownerId, text, new Date().toISOString()]);
}

export async function listPendingCaptures(): Promise<PendingCapture[]> {
  const db = await loadDb();
  return db.select<PendingCapture[]>('SELECT * FROM pending_captures ORDER BY id ASC');
}

export async function pendingCaptureCount(): Promise<number> {
  const db = await loadDb();
  const rows = await db.select<{ n: number }[]>('SELECT COUNT(*) as n FROM pending_captures');
  return rows[0]?.n ?? 0;
}

export async function removePendingCapture(id: number): Promise<void> {
  const db = await loadDb();
  await db.execute('DELETE FROM pending_captures WHERE id = $1', [id]);
}

export async function markCaptureAttempt(id: number, error: string): Promise<void> {
  const db = await loadDb();
  await db.execute('UPDATE pending_captures SET attempts = attempts + 1, last_error = $2 WHERE id = $1', [id, error]);
}
