import { useEffect, useRef, useState } from 'react';
import { isTauri } from '../../lib/localDb';
import { saveKnowledgeSnapshot } from '../../lib/copilotClient';
import { pushToast } from '../../stores/toastStore';
import { playSound } from '../../lib/sound';
import Icon from '../../design-system/icons/Icon';
import AmbientField from '../../design-system/background/AmbientField';

/** Small dynamic-import wrapper — same "isTauri() gate + dynamic import"
 * pattern used everywhere else in xOS (uiStore's tray sync, the Capture
 * room's POP OUT button) so the web/Netlify bundle never eagerly loads
 * @tauri-apps/api for a command that only exists on desktop. */
async function invokeTauri<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

interface RustPageSnapshot {
  url: string;
  title: string;
  description: string;
  text_content: string;
}

const QUICK_LAUNCH = [
  { label: 'Anthropic Docs', url: 'https://docs.anthropic.com' },
  { label: 'GitHub', url: 'https://github.com' },
  { label: 'MDN', url: 'https://developer.mozilla.org' },
  { label: 'Hacker News', url: 'https://news.ycombinator.com' },
];

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // A bare domain-looking string ("github.com", "docs.rs/tokio") gets a
  // scheme; anything else is treated as a search query, mirroring how every
  // real address bar behaves.
  if (/^[\w-]+(\.[\w-]+)+([/:?#].*)?$/.test(trimmed)) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

/** ROOM A — WEB BROWSER (Step 7). Tauri build: the viewport is a genuine
 * native child webview (Window::add_child, src-tauri/src/lib.rs) positioned
 * exactly over this room's content area — not an <iframe>. Most real sites
 * send X-Frame-Options/CSP frame-ancestors headers that block same-page
 * iframe embedding outright (banks, social media, most news); a real
 * embedded webview navigating directly to the URL is a top-level load from
 * that site's own perspective, so it never hits that wall. Web-preview
 * build (xos-nexus.surge.sh): falls back to a plain <iframe>, clearly
 * labeled — most real sites WILL fail to load there, and that's expected,
 * not a bug to chase. */
export default function Browser({ active }: { active: boolean }) {
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [addressInput, setAddressInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const viewportRef = useRef<HTMLDivElement>(null);

  const currentUrl = historyIndex >= 0 ? history[historyIndex] : null;
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  function go(rawUrl: string) {
    const url = normalizeUrl(rawUrl);
    if (!url) return;
    setAddressInput(url);
    setHistory((h) => [...h.slice(0, historyIndex + 1), url]);
    setHistoryIndex((i) => i + 1);
    setSaveState('idle');
    playSound('nav');
  }

  function back() {
    if (!canGoBack) return;
    setHistoryIndex((i) => i - 1);
    setAddressInput(history[historyIndex - 1]);
    playSound('nav');
  }
  function forward() {
    if (!canGoForward) return;
    setHistoryIndex((i) => i + 1);
    setAddressInput(history[historyIndex + 1]);
    playSound('nav');
  }
  function reload() {
    if (!currentUrl) return;
    if (isTauri()) void invokeTauri('navigate_browser_view', { url: currentUrl }).catch(() => {});
    playSound('nav');
  }

  // Tauri: create/navigate the native child webview whenever the target URL
  // changes (or the room becomes active again with one already loaded).
  useEffect(() => {
    if (!isTauri() || !active || !currentUrl) return;
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setLoading(true);
    invokeTauri('open_browser_view', { url: currentUrl, x: rect.left, y: rect.top, width: rect.width, height: rect.height })
      .catch((e) => {
        console.error('open_browser_view failed', e);
        pushToast('Could not load that page', 'warn');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUrl, active]);

  // Keep the native webview's bounds glued to the viewport div (window
  // resize, sidebar collapse, etc.), and shrink it to nothing while the
  // Browser room isn't the active one — RoomOutlet keeps every room
  // mounted, so without this the embedded webview would float on top of
  // whichever room the Captain navigates to next.
  useEffect(() => {
    if (!isTauri()) return;
    if (!active) {
      void invokeTauri('hide_browser_view').catch(() => {});
      return;
    }
    const el = viewportRef.current;
    if (!el || !currentUrl) return;
    const sync = () => {
      const rect = el.getBoundingClientRect();
      void invokeTauri('set_browser_view_bounds', { x: rect.left, y: rect.top, width: rect.width, height: rect.height }).catch(() => {});
    };
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener('resize', sync);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [active, currentUrl]);

  async function handleAddToMatrix() {
    if (!currentUrl || !isTauri()) return;
    setSaveState('saving');
    try {
      const snap = await invokeTauri<RustPageSnapshot>('fetch_page_snapshot', { url: currentUrl });
      const result = await saveKnowledgeSnapshot({
        url: snap.url,
        title: snap.title,
        description: snap.description,
        textContent: snap.text_content,
      });
      setSaveState('saved');
      playSound('capture');
      pushToast(`Saved to Knowledge Matrix: ${result.node?.title ?? snap.title}`, 'success');
    } catch (e) {
      console.error('ADD TO MATRIX failed', e);
      setSaveState('error');
      playSound('error');
      pushToast('Could not save this page — try again', 'warn');
    } finally {
      setTimeout(() => setSaveState('idle'), 3000);
    }
  }

  return (
    <section className={`room ambient ${active ? 'on' : ''}`} id="r-browser">
      <AmbientField mood="cyan" density={16} active={active} parallax />
      <div className="roomInner">
        <h2 className="rh">
          <Icon name="browser" size={16} glow="cyan" /> BROWSER
        </h2>
        <div className="rsub">{isTauri() ? 'EMBEDDED — NATIVE WEBVIEW' : 'WEB PREVIEW — LIMITED'}</div>

        {!isTauri() && (
          <div className="browserBanner">
            <Icon name="warning" size={13} /> Full browsing requires the packaged desktop app. This web preview uses a
            plain iframe — most real sites block that outright (X-Frame-Options), so this is a demo surface only.
          </div>
        )}

        <div className="browserBar">
          <span className={`browserNavBtn ${canGoBack ? '' : 'disabled'}`} onClick={back}>
            <Icon name="chevronLeft" size={14} />
          </span>
          <span className={`browserNavBtn ${canGoForward ? '' : 'disabled'}`} onClick={forward}>
            <Icon name="chevronRight" size={14} />
          </span>
          <span className={`browserNavBtn ${currentUrl ? '' : 'disabled'}`} onClick={reload}>
            <Icon name="refresh" size={14} />
          </span>
          <input
            className="browserAddress"
            value={addressInput}
            placeholder="Search or enter an address…"
            onChange={(e) => setAddressInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go(addressInput);
            }}
          />
          <span className="browserNavBtn" onClick={() => go(addressInput)}>
            GO
          </span>
          <span
            className={`browserNavBtn addToMatrixBtn ${!currentUrl || !isTauri() ? 'disabled' : ''} ${saveState}`}
            onClick={handleAddToMatrix}
            title={isTauri() ? 'Save this page to the Knowledge Matrix' : 'Desktop app only'}
          >
            <Icon name="addToMatrix" size={14} />
            {saveState === 'saving' ? 'SAVING…' : saveState === 'saved' ? 'SAVED' : saveState === 'error' ? 'FAILED' : 'ADD TO MATRIX'}
          </span>
        </div>

        <div className="browserViewport" ref={viewportRef}>
          {!currentUrl && (
            <div className="browserStart">
              <div className="browserStartTitle">Where to, Captain?</div>
              <div className="browserQuickLaunch">
                {QUICK_LAUNCH.map((q) => (
                  <span key={q.url} className="chip" onClick={() => go(q.url)}>
                    {q.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {currentUrl && !isTauri() && (
            <iframe key={currentUrl} src={currentUrl} className="browserIframe" title="xOS Browser" />
          )}
          {currentUrl && isTauri() && loading && (
            <div className="browserLoading">
              <Icon name="spinner" size={20} className="spin" /> Loading…
            </div>
          )}
          {/* Tauri: the actual page renders in the native child webview
              positioned over this element by the effects above — nothing
              to render here in that case, this div is purely a bounds
              reference. */}
        </div>
      </div>
    </section>
  );
}
