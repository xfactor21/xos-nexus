import { isTauri } from './localDb';

/** Local-file open/edit/save for the Terminal (.py) and Browser (.html)
 * rooms. Desktop-only — every function here throws if called from the web
 * preview build, same "isTauri() gate" pattern used everywhere else (Browser
 * room's native webview, offlineSync's SQLite mirror).
 *
 * Security note: `capabilities/default.json` grants `fs:allow-read-text-file`
 * / `fs:allow-write-text-file` with NO static path scope. That's
 * deliberate, not an oversight — `@tauri-apps/plugin-dialog`'s open/save
 * commands dynamically extend the fs plugin's scope to exactly the file the
 * user picked in the native OS dialog (confirmed in tauri-plugin-dialog's
 * own source: every pick calls `window.try_fs_scope().allow_file(path)`).
 * So this module can only ever touch a file the Captain explicitly chose
 * through a real OS dialog — never an arbitrary path handed in from JS.
 */

export interface OpenedFile {
  path: string;
  name: string;
  content: string;
}

async function requireTauri() {
  if (!isTauri()) throw new Error('File editing requires the desktop app.');
}

/** Opens the native "pick a file" dialog filtered to the given extension,
 * reads it, and returns its path/name/content. Returns null if the
 * Captain cancels the dialog. */
export async function openTextFile(extensions: string[], label: string): Promise<OpenedFile | null> {
  await requireTauri();
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  const path = await open({ multiple: false, directory: false, filters: [{ name: label, extensions }] });
  if (!path || typeof path !== 'string') return null;
  const content = await readTextFile(path);
  const name = path.split(/[/\\]/).pop() ?? path;
  return { path, name, content };
}

/** Writes content back to an already-known path (from a prior openTextFile
 * call) — no dialog needed since the fs scope already covers that path
 * from when it was picked. */
export async function writeTextFileAt(path: string, content: string): Promise<void> {
  await requireTauri();
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  await writeTextFile(path, content);
}

/** "Save As" — opens the native save dialog, then writes there. Returns
 * the chosen path (for the caller to remember as the new "current file"),
 * or null if the Captain cancels. */
export async function saveTextFileAs(
  content: string,
  extensions: string[],
  label: string,
  defaultName?: string,
): Promise<string | null> {
  await requireTauri();
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  const path = await save({ defaultPath: defaultName, filters: [{ name: label, extensions }] });
  if (!path) return null;
  await writeTextFile(path, content);
  return path;
}

/** Native "pick a folder" dialog — used by the Terminal room's SHELL
 * runtime / RUN DEV SERVER (real OS command execution needs a real working
 * directory, e.g. the Captain's actual project folder, not a hardcoded
 * guess). Returns null if the Captain cancels. */
export async function pickDirectory(): Promise<string | null> {
  await requireTauri();
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ multiple: false, directory: true });
  if (!path || typeof path !== 'string') return null;
  return path;
}
