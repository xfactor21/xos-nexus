import { isTauri } from './localDb';

/**
 * "Open externally" — launches the OS's real default browser for a URL.
 * Desktop: `@tauri-apps/plugin-opener`'s `openUrl` (a genuine OS-level
 * open-with-default-handler call — NOT `window.open()`, which Tauri's
 * webview intercepts as an in-app navigation instead of handing off to the
 * system browser). Web build: a plain `window.open` new tab, the only thing
 * a browser page is allowed to do.
 *
 * Used by: the Browser room's "open externally" fallback for a page that
 * can't be embedded, and its bookmarks/history/quick-launch when the
 * Captain's "open externally" setting is on; and the Terminal room's "open
 * my dev server" affordance.
 */
export async function openExternally(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
