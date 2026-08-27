/**
 * Browser room — bookmarks / history / settings persistence, plus bookmark
 * import parsing (Netscape Bookmark File Format .html + Chrome/Firefox JSON
 * export). localStorage, scoped per ownerId — same precedent as Neural
 * Core's `xos-corepos-${ownerId}` layout store (NeuralCore.tsx) and
 * Projects' `xos-project-classes-v1` (modules/projects/local.ts). No
 * sensible existing Supabase table for any of this (bookmarks/history/tab
 * chrome settings aren't part of the deployed schema, and inventing one
 * wasn't authorized by this pass — same no-unauthorized-migration stance
 * used elsewhere in this codebase), so localStorage is the right call here,
 * not a shortcut.
 */

export interface BookmarkEntry {
  id: string;
  url: string;
  title: string;
  addedAt: string;
}

export interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: string;
}

export interface BrowserSettings {
  /** What the empty "Where to, Captain?" start screen and a brand-new tab
   * navigate to when the Captain clicks "HOME" — separate from the
   * QUICK_LAUNCH chips, which stay fixed. Empty string = no homepage set,
   * start screen stays as-is. */
  homepage: string;
  /** When true, Quick Launch / Bookmarks / History entries open in the
   * OS's real default browser (via the opener plugin on desktop, a new tab
   * on web) instead of loading into the in-app viewer. Does not affect the
   * embedded page's OWN internal link clicks — those are outside this
   * room's control (see the module doc comment in index.tsx). */
  openExternally: boolean;
}

const DEFAULT_SETTINGS: BrowserSettings = {
  homepage: '',
  openExternally: false,
};

const HISTORY_LIMIT = 500;

function scopeKey(kind: 'bookmarks' | 'history' | 'settings', ownerId: string | null): string {
  return `xos-browser-${kind}-${ownerId ?? 'anon'}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* best-effort — a full/blocked localStorage shouldn't crash the room */
  }
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

export function loadBookmarks(ownerId: string | null): BookmarkEntry[] {
  return readJson<BookmarkEntry[]>(scopeKey('bookmarks', ownerId), []);
}
function saveBookmarks(ownerId: string | null, entries: BookmarkEntry[]) {
  writeJson(scopeKey('bookmarks', ownerId), entries);
}

export function isBookmarked(entries: BookmarkEntry[], url: string): boolean {
  return entries.some((b) => b.url === url);
}

export function addBookmark(ownerId: string | null, url: string, title: string): BookmarkEntry[] {
  const current = loadBookmarks(ownerId);
  if (isBookmarked(current, url)) return current;
  const next = [{ id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, url, title: title || url, addedAt: new Date().toISOString() }, ...current];
  saveBookmarks(ownerId, next);
  return next;
}

export function removeBookmark(ownerId: string | null, id: string): BookmarkEntry[] {
  const next = loadBookmarks(ownerId).filter((b) => b.id !== id);
  saveBookmarks(ownerId, next);
  return next;
}

export function removeBookmarkByUrl(ownerId: string | null, url: string): BookmarkEntry[] {
  const next = loadBookmarks(ownerId).filter((b) => b.url !== url);
  saveBookmarks(ownerId, next);
  return next;
}

export function clearBookmarks(ownerId: string | null): BookmarkEntry[] {
  saveBookmarks(ownerId, []);
  return [];
}

export function renameBookmark(ownerId: string | null, id: string, title: string): BookmarkEntry[] {
  const next = loadBookmarks(ownerId).map((b) => (b.id === id ? { ...b, title: title || b.url } : b));
  saveBookmarks(ownerId, next);
  return next;
}

/** Merge-imports a batch of parsed bookmarks, de-duping by URL against what's
 * already saved (an import run twice, or one that overlaps existing
 * bookmarks, shouldn't create duplicates). Returns { entries, added }. */
export function importBookmarks(ownerId: string | null, parsed: Array<{ url: string; title: string }>): { entries: BookmarkEntry[]; added: number } {
  const current = loadBookmarks(ownerId);
  const existingUrls = new Set(current.map((b) => b.url));
  const now = new Date().toISOString();
  const fresh: BookmarkEntry[] = [];
  for (const p of parsed) {
    if (!p.url || existingUrls.has(p.url)) continue;
    existingUrls.add(p.url);
    fresh.push({ id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${fresh.length}`, url: p.url, title: p.title || p.url, addedAt: now });
  }
  const entries = [...fresh, ...current];
  saveBookmarks(ownerId, entries);
  return { entries, added: fresh.length };
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export function loadHistory(ownerId: string | null): HistoryEntry[] {
  return readJson<HistoryEntry[]>(scopeKey('history', ownerId), []);
}
function saveHistory(ownerId: string | null, entries: HistoryEntry[]) {
  writeJson(scopeKey('history', ownerId), entries);
}

/** Appends a visit. Newest first, capped at HISTORY_LIMIT so this can't grow
 * localStorage without bound over months of real use. */
export function addHistoryEntry(ownerId: string | null, url: string, title: string): HistoryEntry[] {
  const current = loadHistory(ownerId);
  const next = [{ url, title: title || url, visitedAt: new Date().toISOString() }, ...current].slice(0, HISTORY_LIMIT);
  saveHistory(ownerId, next);
  return next;
}

export function clearHistory(ownerId: string | null): HistoryEntry[] {
  saveHistory(ownerId, []);
  return [];
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function loadSettings(ownerId: string | null): BrowserSettings {
  return { ...DEFAULT_SETTINGS, ...readJson<Partial<BrowserSettings>>(scopeKey('settings', ownerId), {}) };
}
export function saveSettings(ownerId: string | null, settings: BrowserSettings): void {
  writeJson(scopeKey('settings', ownerId), settings);
}

// ---------------------------------------------------------------------------
// Bookmark import parsing
// ---------------------------------------------------------------------------

interface ParsedBookmark {
  url: string;
  title: string;
}

/** Netscape Bookmark File Format — the standard `<!DOCTYPE NETSCAPE-Bookmark-
 * file-1>` HTML export every real browser (Chrome, Firefox, Safari, Edge)
 * produces from "Export bookmarks". Every bookmark is an `<A HREF="...">`
 * anchor (folders are `<H3>`, ignored here — flattened import, not
 * folder-preserving, which is enough for "get my bookmarks in"). DOMParser
 * tolerates this format's deliberately-unclosed `<DT>`/`<p>` tags fine, same
 * as a real browser does when it reads its own export back in. */
function parseNetscapeBookmarks(html: string): ParsedBookmark[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const anchors = Array.from(doc.querySelectorAll('a[href]'));
  return anchors
    .map((a) => ({ url: a.getAttribute('href') ?? '', title: (a.textContent ?? '').trim() }))
    .filter((b) => /^https?:\/\//i.test(b.url));
}

/** Chrome/Edge's native "Bookmarks" JSON export format: a `roots` object
 * (bookmark_bar / other / synced), each a folder node with `children`; a
 * bookmark node has `type: "url"`, `name`, `url`. Recurses through nested
 * folders. */
interface ChromeBookmarkNode {
  type?: string;
  name?: string;
  url?: string;
  children?: ChromeBookmarkNode[];
}
function walkChromeNodes(node: ChromeBookmarkNode, out: ParsedBookmark[]) {
  if (node.type === 'url' && node.url) {
    out.push({ url: node.url, title: node.name ?? node.url });
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) walkChromeNodes(child, out);
  }
}

/** Accepts three shapes: (1) a plain array of {url, title|name}, the
 * simplest possible "just my links" JSON; (2) Chrome's native export
 * ({checksum, version, roots: {...}}); (3) a bare folder node
 * ({children: [...]}). Throws on anything else so the caller can surface a
 * clear "couldn't read that file" error instead of silently importing 0. */
function parseJsonBookmarks(raw: string): ParsedBookmark[] {
  const data = JSON.parse(raw) as unknown;
  const out: ParsedBookmark[] = [];
  if (Array.isArray(data)) {
    for (const entry of data as Array<Record<string, unknown>>) {
      const url = typeof entry.url === 'string' ? entry.url : '';
      const title = typeof entry.title === 'string' ? entry.title : typeof entry.name === 'string' ? entry.name : '';
      if (/^https?:\/\//i.test(url)) out.push({ url, title });
    }
    return out;
  }
  if (data && typeof data === 'object') {
    const obj = data as { roots?: Record<string, ChromeBookmarkNode>; children?: ChromeBookmarkNode[] };
    if (obj.roots && typeof obj.roots === 'object') {
      for (const root of Object.values(obj.roots)) walkChromeNodes(root, out);
      return out;
    }
    if (Array.isArray(obj.children)) {
      walkChromeNodes(obj as ChromeBookmarkNode, out);
      return out;
    }
  }
  throw new Error('Unrecognized bookmarks JSON shape.');
}

/** Entry point for the IMPORT BOOKMARKS file input — sniffs format by
 * content rather than trusting the file extension (a browser export
 * sometimes lands as .htm, sometimes .html; a JSON export is occasionally
 * saved with no extension at all). */
export function parseBookmarksFile(filename: string, content: string): ParsedBookmark[] {
  const trimmed = content.trimStart();
  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (looksJson || /\.json$/i.test(filename)) {
    return parseJsonBookmarks(content);
  }
  return parseNetscapeBookmarks(content);
}
