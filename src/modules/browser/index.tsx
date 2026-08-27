import { useEffect, useRef, useState } from 'react';
import { isTauri } from '../../lib/localDb';
import { saveKnowledgeSnapshot } from '../../lib/copilotClient';
import { openTextFile, writeTextFileAt, saveTextFileAs, type OpenedFile } from '../../lib/fileIO';
import { openExternally } from '../../lib/opener';
import { pushToast } from '../../stores/toastStore';
import { playSound } from '../../lib/sound';
import { useCoreGraph } from '../../stores/coreGraph';
import { useAuthStore } from '../../stores/authStore';
import { useBrowserNavStore } from '../../stores/browserNavStore';
import Icon from '../../design-system/icons/Icon';
import AmbientField from '../../design-system/background/AmbientField';
import ShipAmbience from '../../design-system/background/ShipAmbience';
import CodeEditor from '../../design-system/CodeEditor';
import {
  type BookmarkEntry,
  type HistoryEntry,
  type BrowserSettings,
  loadBookmarks,
  loadHistory,
  loadSettings,
  saveSettings,
  addBookmark,
  removeBookmarkByUrl,
  clearBookmarks,
  renameBookmark,
  isBookmarked,
  addHistoryEntry,
  clearHistory,
  importBookmarks,
  parseBookmarksFile,
} from './storage';

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
  if (/^[\w-]+(\.[\w-]+)+([/:?#].*)?$/.test(trimmed)) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

type Panel = 'none' | 'bookmarks' | 'history' | 'settings';

export default function Browser({ active }: { active: boolean }) {
  const graphOwnerId = useCoreGraph((s) => s.ownerId);
  const authUserId = useAuthStore((s) => s.user?.id ?? null);
  const ownerId = graphOwnerId ?? authUserId ?? null;

  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [addressInput, setAddressInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const viewportRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<'browse' | 'edit'>('browse');
  const [openFile, setOpenFile] = useState<OpenedFile | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [previewDoc, setPreviewDoc] = useState('');
  const [fileDirty, setFileDirty] = useState(false);
  const [fileResetKey, setFileResetKey] = useState(0);
  const [fileBusy, setFileBusy] = useState<'idle' | 'saving'>('idle');

  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [historyLog, setHistoryLog] = useState<HistoryEntry[]>([]);
  const [settings, setSettings] = useState<BrowserSettings>({ homepage: '', openExternally: false });
  const [panel, setPanel] = useState<Panel>('none');
  const [historyFilter, setHistoryFilter] = useState('');
  const [homepageDraft, setHomepageDraft] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setBookmarks(loadBookmarks(ownerId));
    setHistoryLog(loadHistory(ownerId));
    const s = loadSettings(ownerId);
    setSettings(s);
    setHomepageDraft(s.homepage);
  }, [ownerId]);

  useEffect(() => {
    const t = setTimeout(() => setPreviewDoc(fileContent), 250);
    return () => clearTimeout(t);
  }, [fileContent]);

  const currentUrl = historyIndex >= 0 ? history[historyIndex] : null;
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  const currentUrlRef = useRef<string | null>(currentUrl);
  const historyIndexRef = useRef(historyIndex);
  useEffect(() => {
    currentUrlRef.current = currentUrl;
    historyIndexRef.current = historyIndex;
  }, [currentUrl, historyIndex]);

  function recordVisit(url: string) {
    setHistoryLog(addHistoryEntry(ownerId, url, url));
  }

  function go(rawUrl: string) {
    const url = normalizeUrl(rawUrl);
    if (!url) return;
    setAddressInput(url);
    setHistory((h) => [...h.slice(0, historyIndex + 1), url]);
    setHistoryIndex((i) => i + 1);
    setSaveState('idle');
    recordVisit(url);
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

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const un = await listen<string>('browser-nav', (event) => {
        const url = event.payload;
        if (!url || url === currentUrlRef.current) return;
        const idx = historyIndexRef.current;
        setHistory((h) => [...h.slice(0, idx + 1), url]);
        setHistoryIndex((i) => i + 1);
        setAddressInput(url);
        setSaveState('idle');
        recordVisit(url);
      });
      if (cancelled) un();
      else unlisten = un;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingNavUrl = useBrowserNavStore((s) => s.pendingUrl);
  const clearPendingNav = useBrowserNavStore((s) => s.clearPending);
  useEffect(() => {
    if (!active || !pendingNavUrl) return;
    go(pendingNavUrl);
    clearPendingNav();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pendingNavUrl]);

  useEffect(() => {
    if (!isTauri() || !active || mode !== 'browse' || !currentUrl) return;
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
  }, [currentUrl, active, mode]);

  useEffect(() => {
    if (!isTauri()) return;
    if (!active || mode !== 'browse') {
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
  }, [active, currentUrl, mode]);

  async function handleOpenHtmlFile() {
    try {
      const f = await openTextFile(['html', 'htm'], 'HTML');
      if (!f) return;
      setOpenFile(f);
      setFileContent(f.content);
      setPreviewDoc(f.content);
      setFileDirty(false);
      setFileResetKey((k) => k + 1);
      setMode('edit');
      pushToast(`Opened ${f.name}`, 'success');
    } catch (e) {
      console.error('Open .html file failed', e);
      pushToast(e instanceof Error ? e.message : 'Could not open that file', 'warn');
    }
  }

  async function handleSaveHtmlFile() {
    if (!openFile) return;
    setFileBusy('saving');
    try {
      await writeTextFileAt(openFile.path, fileContent);
      setFileDirty(false);
      pushToast(`Saved ${openFile.name}`, 'success');
    } catch (e) {
      console.error('Save .html file failed', e);
      pushToast(e instanceof Error ? e.message : 'Save failed', 'warn');
    } finally {
      setFileBusy('idle');
    }
  }

  async function handleSaveHtmlFileAs() {
    try {
      const path = await saveTextFileAs(fileContent, ['html', 'htm'], 'HTML', openFile?.name ?? 'index.html');
      if (!path) return;
      const name = path.split(/[/\\]/).pop() ?? path;
      setOpenFile({ path, name, content: fileContent });
      setFileDirty(false);
      pushToast(`Saved as ${name}`, 'success');
    } catch (e) {
      console.error('Save .html file as failed', e);
      pushToast(e instanceof Error ? e.message : 'Save failed', 'warn');
    }
  }

  function handleCloseHtmlFile() {
    setOpenFile(null);
    setFileContent('');
    setPreviewDoc('');
    setFileDirty(false);
    setMode('browse');
  }

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

  const currentIsBookmarked = currentUrl ? isBookmarked(bookmarks, currentUrl) : false;

  function toggleBookmark() {
    if (!currentUrl) return;
    if (currentIsBookmarked) {
      setBookmarks(removeBookmarkByUrl(ownerId, currentUrl));
      pushToast('Bookmark removed', 'info');
    } else {
      setBookmarks(addBookmark(ownerId, currentUrl, currentUrl));
      pushToast('Bookmarked', 'success');
      playSound('notice');
    }
  }

  function handleDeleteBookmark(id: string) {
    setBookmarks((prev) => {
      const target = prev.find((b) => b.id === id);
      const next = removeBookmarkByUrl(ownerId, target?.url ?? '');
      return next;
    });
  }

  function handleClearBookmarks() {
    if (!confirm('Delete every saved bookmark? This cannot be undone.')) return;
    setBookmarks(clearBookmarks(ownerId));
    pushToast('Bookmarks cleared', 'info');
  }

  function startRename(b: BookmarkEntry) {
    setRenamingId(b.id);
    setRenameDraft(b.title);
  }
  function commitRename(id: string) {
    setBookmarks(renameBookmark(ownerId, id, renameDraft.trim()));
    setRenamingId(null);
  }

  function openFromPanel(url: string) {
    if (settings.openExternally) {
      void openExternally(url);
    } else {
      go(url);
    }
    setPanel('none');
  }

  async function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const content = await file.text();
      const parsed = parseBookmarksFile(file.name, content);
      if (parsed.length === 0) {
        pushToast('No bookmarks found in that file', 'warn');
        return;
      }
      const { entries, added } = importBookmarks(ownerId, parsed);
      setBookmarks(entries);
      pushToast(`Imported ${added} bookmark${added === 1 ? '' : 's'}${parsed.length !== added ? ` (${parsed.length - added} already saved)` : ''}`, 'success');
      playSound('notice');
    } catch (err) {
      console.error('Bookmark import failed', err);
      pushToast('Could not read that file — expected a Chrome/Firefox bookmarks export (.html) or JSON', 'warn');
      playSound('error');
    }
  }

  const filteredHistory = historyFilter.trim()
    ? historyLog.filter((h) => h.url.toLowerCase().includes(historyFilter.toLowerCase()) || h.title.toLowerCase().includes(historyFilter.toLowerCase()))
    : historyLog;

  function handleClearHistory() {
    if (!confirm('Clear all browsing history? This cannot be undone.')) return;
    setHistoryLog(clearHistory(ownerId));
    pushToast('History cleared', 'info');
  }

  function commitHomepage() {
    const next = { ...settings, homepage: homepageDraft.trim() };
    setSettings(next);
    saveSettings(ownerId, next);
    pushToast('Homepage saved', 'success');
  }

  function toggleOpenExternally() {
    const next = { ...settings, openExternally: !settings.openExternally };
    setSettings(next);
    saveSettings(ownerId, next);
  }

  function goHome() {
    if (settings.homepage) go(settings.homepage);
  }

  return (
    <section className={`room ambient ${active ? 'on' : ''}`} id="r-browser">
      <AmbientField mood="cyan" density={16} active={active} parallax />
      <ShipAmbience kind="lights" corner="tl" active={active} />
      <div className="roomInner">
        <h2 className="rh">
          <Icon name="browser" size={16} glow="cyan" /> BROWSER
        </h2>
        <div className="rsub">{isTauri() ? 'EMBEDDED — NATIVE WEBVIEW' : 'WEB PREVIEW — LIMITED'}</div>

        {!isTauri() && mode === 'browse' && (
          <div className="browserBanner">
            <Icon name="warning" size={13} /> Full browsing requires the packaged desktop app. This web preview uses a
            plain iframe — most real sites block that outright (X-Frame-Options), so this is a demo surface only. Use
            "OPEN EXTERNALLY" below to actually visit a page.
          </div>
        )}

        {mode === 'browse' && (
          <div className="optrow" style={{ margin: '0 0 12px' }}>
            <span
              className={`chip ${!isTauri() ? 'disabled' : ''}`}
              onClick={handleOpenHtmlFile}
              title={isTauri() ? 'Open a local .html file to edit, with a live preview' : 'Desktop app only'}
            >
              <Icon name="folderOpen" size={12} /> OPEN .html FILE
            </span>
            <span className={`chip ${panel === 'bookmarks' ? 'on' : ''}`} onClick={() => setPanel(panel === 'bookmarks' ? 'none' : 'bookmarks')}>
              <Icon name="book" size={12} /> BOOKMARKS {bookmarks.length > 0 && `(${bookmarks.length})`}
            </span>
            <span className={`chip ${panel === 'history' ? 'on' : ''}`} onClick={() => setPanel(panel === 'history' ? 'none' : 'history')}>
              <Icon name="history" size={12} /> HISTORY
            </span>
            <span className={`chip ${panel === 'settings' ? 'on' : ''}`} onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}>
              <Icon name="settings" size={12} /> OPTIONS
            </span>
            {settings.homepage && (
              <span className="chip" onClick={goHome} title={settings.homepage}>
                <Icon name="globe" size={12} /> HOME
              </span>
            )}
          </div>
        )}

        {mode === 'browse' && (
          <>
            <div className="browserBar">
              <span className={`browserNavBtn ${canGoBack ? '' : 'disabled'}`} onClick={back} title="Back">
                <Icon name="chevronLeft" size={14} />
              </span>
              <span className={`browserNavBtn ${canGoForward ? '' : 'disabled'}`} onClick={forward} title="Forward">
                <Icon name="chevronRight" size={14} />
              </span>
              <span className={`browserNavBtn ${currentUrl ? '' : 'disabled'}`} onClick={reload} title="Reload">
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
                className={`browserNavBtn bookmarkStarBtn ${!currentUrl ? 'disabled' : ''} ${currentIsBookmarked ? 'on' : ''}`}
                onClick={toggleBookmark}
                title={currentIsBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
              >
                <Icon name="star" size={14} />
              </span>
              <span
                className={`browserNavBtn ${!currentUrl ? 'disabled' : ''}`}
                onClick={() => currentUrl && void openExternally(currentUrl)}
                title="Open in your system's default browser"
              >
                <Icon name="externalLink" size={14} />
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
                <>
                  <iframe key={currentUrl} src={currentUrl} className="browserIframe" title="xOS Browser" />
                  <div className="browserIframeFallback">
                    <Icon name="warning" size={12} /> Blocked or blank? Many sites refuse to be embedded.
                    <span className="browserFallbackLink" onClick={() => void openExternally(currentUrl)}>
                      Open externally <Icon name="externalLink" size={11} />
                    </span>
                  </div>
                </>
              )}
              {currentUrl && isTauri() && loading && (
                <div className="browserLoading">
                  <Icon name="spinner" size={20} className="spin" /> Loading…
                </div>
              )}
            </div>
          </>
        )}

        {mode === 'edit' && openFile && (
          <>
            <div className="fileEditorToolbar">
              <span className="fileEditorName">
                <Icon name="file" size={12} /> {openFile.name}
                {fileDirty && <span className="fileDirtyDot" title="Unsaved changes" />}
              </span>
              <span className={`fileEditorBtn ${fileBusy !== 'idle' ? 'disabled' : ''}`} onClick={handleSaveHtmlFile} title="Save">
                <Icon name="save" size={12} /> {fileBusy === 'saving' ? 'SAVING…' : 'SAVE'}
              </span>
              <span className="fileEditorBtn" onClick={handleSaveHtmlFileAs} title="Save as a new file">
                SAVE AS
              </span>
              <span className="fileEditorBtn" onClick={handleCloseHtmlFile} title="Back to browsing">
                <Icon name="close" size={12} /> CLOSE
              </span>
            </div>
            <div className="htmlEditorSplit">
              <CodeEditor
                className="codeEditorBox htmlEditorPane"
                value={fileContent}
                resetKey={fileResetKey}
                language="html"
                onChange={(v) => {
                  setFileContent(v);
                  setFileDirty(true);
                }}
              />
              <iframe className="htmlPreviewFrame" srcDoc={previewDoc} sandbox="allow-scripts" title="Live HTML preview" />
            </div>
          </>
        )}

        {panel === 'bookmarks' && (
          <div className="knowledgeOverlay" onClick={() => setPanel('none')}>
            <div className="knowledgePanel browserPanel" onClick={(e) => e.stopPropagation()}>
              <div className="knowledgePanelHeader">
                <div className="knowledgePanelTitle">
                  <Icon name="book" size={14} /> Bookmarks
                </div>
                <span className="fileEditorBtn" onClick={() => setPanel('none')}>
                  <Icon name="close" size={12} />
                </span>
              </div>
              <div className="optrow" style={{ margin: '0 0 12px' }}>
                <span className="chip" onClick={() => importInputRef.current?.click()}>
                  <Icon name="upload" size={12} /> IMPORT BOOKMARKS
                </span>
                <span className={`chip ${bookmarks.length === 0 ? 'disabled' : ''}`} onClick={handleClearBookmarks}>
                  <Icon name="trash" size={12} /> CLEAR ALL
                </span>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".html,.htm,.json,text/html,application/json"
                  style={{ display: 'none' }}
                  onChange={(e) => void handleImportFileChange(e)}
                />
              </div>
              <div className="browserPanelHint">
                Import accepts a Chrome/Firefox/Safari bookmarks export (Export bookmarks → .html) or a JSON file
                (Chrome's native export, or a plain <code>[&#123;"url","title"&#125;]</code> array).
              </div>
              {bookmarks.length === 0 ? (
                <div className="browserPanelEmpty">No bookmarks yet — star a page, or import some.</div>
              ) : (
                <div className="browserPanelList">
                  {bookmarks.map((b) => (
                    <div key={b.id} className="browserPanelItem">
                      <div className="browserPanelItemMain" onClick={() => openFromPanel(b.url)}>
                        {renamingId === b.id ? (
                          <input
                            className="browserRenameInput"
                            autoFocus
                            value={renameDraft}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename(b.id);
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            onBlur={() => commitRename(b.id)}
                          />
                        ) : (
                          <>
                            <div className="browserPanelItemTitle">{b.title}</div>
                            <div className="browserPanelItemUrl">{b.url}</div>
                          </>
                        )}
                      </div>
                      <div className="browserPanelItemActions">
                        <span
                          className="fileEditorBtn"
                          title="Rename"
                          onClick={(e) => {
                            e.stopPropagation();
                            startRename(b);
                          }}
                        >
                          <Icon name="pencil" size={11} />
                        </span>
                        <span
                          className="fileEditorBtn"
                          title="Remove bookmark"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteBookmark(b.id);
                          }}
                        >
                          <Icon name="trash" size={11} />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {panel === 'history' && (
          <div className="knowledgeOverlay" onClick={() => setPanel('none')}>
            <div className="knowledgePanel browserPanel" onClick={(e) => e.stopPropagation()}>
              <div className="knowledgePanelHeader">
                <div className="knowledgePanelTitle">
                  <Icon name="history" size={14} /> History
                </div>
                <span className="fileEditorBtn" onClick={() => setPanel('none')}>
                  <Icon name="close" size={12} />
                </span>
              </div>
              <div className="optrow" style={{ margin: '0 0 12px' }}>
                <input
                  className="browserAddress"
                  style={{ maxWidth: 320 }}
                  placeholder="Search history…"
                  value={historyFilter}
                  onChange={(e) => setHistoryFilter(e.target.value)}
                />
                <span className={`chip ${historyLog.length === 0 ? 'disabled' : ''}`} onClick={handleClearHistory}>
                  <Icon name="trash" size={12} /> CLEAR HISTORY
                </span>
              </div>
              {filteredHistory.length === 0 ? (
                <div className="browserPanelEmpty">{historyLog.length === 0 ? 'No browsing history yet.' : 'No matches.'}</div>
              ) : (
                <div className="browserPanelList">
                  {filteredHistory.slice(0, 200).map((h, i) => (
                    <div key={`${h.url}-${h.visitedAt}-${i}`} className="browserPanelItem">
                      <div className="browserPanelItemMain" onClick={() => openFromPanel(h.url)}>
                        <div className="browserPanelItemTitle">{h.title}</div>
                        <div className="browserPanelItemUrl">
                          {h.url} · {new Date(h.visitedAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {panel === 'settings' && (
          <div className="knowledgeOverlay" onClick={() => setPanel('none')}>
            <div className="knowledgePanel browserPanel" onClick={(e) => e.stopPropagation()}>
              <div className="knowledgePanelHeader">
                <div className="knowledgePanelTitle">
                  <Icon name="settings" size={14} /> Browser Options
                </div>
                <span className="fileEditorBtn" onClick={() => setPanel('none')}>
                  <Icon name="close" size={12} />
                </span>
              </div>

              <div className="browserSettingsRow">
                <div className="browserSettingsLabel">Homepage / HOME button target</div>
                <div className="optrow" style={{ margin: '6px 0 0' }}>
                  <input
                    className="browserAddress"
                    placeholder="https://…  (blank = no homepage)"
                    value={homepageDraft}
                    onChange={(e) => setHomepageDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && commitHomepage()}
                  />
                  <span className="browserNavBtn" onClick={commitHomepage}>
                    SAVE
                  </span>
                </div>
              </div>

              <div className="browserSettingsRow">
                <div className="browserSettingsLabel">Quick Launch / Bookmarks / History links open</div>
                <div className="optrow" style={{ margin: '6px 0 0' }}>
                  <span className={`chip ${!settings.openExternally ? 'on' : ''}`} onClick={() => settings.openExternally && toggleOpenExternally()}>
                    IN-APP VIEWER
                  </span>
                  <span className={`chip ${settings.openExternally ? 'on' : ''}`} onClick={() => !settings.openExternally && toggleOpenExternally()}>
                    SYSTEM BROWSER
                  </span>
                </div>
                <div className="browserPanelHint">
                  Doesn't affect links clicked <em>inside</em> an already-loaded page — those stay inside that page's
                  own webview, same as any browser.
                </div>
              </div>

              <div className="browserSettingsRow">
                <div className="browserSettingsLabel">Clear data</div>
                <div className="optrow" style={{ margin: '6px 0 0' }}>
                  <span className={`chip ${historyLog.length === 0 ? 'disabled' : ''}`} onClick={handleClearHistory}>
                    <Icon name="trash" size={12} /> CLEAR HISTORY
                  </span>
                  <span className={`chip ${bookmarks.length === 0 ? 'disabled' : ''}`} onClick={handleClearBookmarks}>
                    <Icon name="trash" size={12} /> CLEAR BOOKMARKS
                  </span>
                </div>
              </div>

              {!isTauri() && (
                <div className="browserBanner" style={{ marginTop: 4 }}>
                  <Icon name="warning" size={13} /> Web preview build: embedding is iframe-based and most sites block
                  it. "SYSTEM BROWSER" above is the reliable way to actually visit a page from here.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
