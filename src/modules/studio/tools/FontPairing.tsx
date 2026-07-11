import { useEffect, useMemo, useState } from 'react';
import ToolShell from './ToolShell';
import Icon from '../../../design-system/icons/Icon';

// Module-level ref count + element handle backing the shared Google Fonts
// <link> — see the effect below for why this needs to be ref-counted
// rather than a plain create/remove pair.
let fontLinkRefCount = 0;
let fontLinkEl: HTMLLinkElement | null = null;

type GenericFamily = 'serif' | 'sans-serif' | 'display';

type FontPair = {
  heading: string;
  body: string;
  weight?: string;
};

const FONT_PAIRS: FontPair[] = [
  { heading: 'Playfair Display', body: 'Source Sans Pro' },
  { heading: 'Montserrat', body: 'Merriweather' },
  { heading: 'Poppins', body: 'Roboto' },
  { heading: 'Oswald', body: 'Lato' },
  { heading: 'Space Grotesk', body: 'Inter' },
  { heading: 'Bebas Neue', body: 'Nunito Sans' },
  { heading: 'Cormorant Garamond', body: 'Work Sans' },
  { heading: 'Archivo Black', body: 'Karla' },
  { heading: 'DM Serif Display', body: 'DM Sans' },
  { heading: 'Fraunces', body: 'Manrope' },
  { heading: 'Abril Fatface', body: 'Rubik' },
  { heading: 'Josefin Sans', body: 'Nunito' },
];

const GENERIC_FAMILY: Record<string, GenericFamily> = {
  'Playfair Display': 'serif',
  'Source Sans Pro': 'sans-serif',
  Montserrat: 'sans-serif',
  Merriweather: 'serif',
  Poppins: 'sans-serif',
  Roboto: 'sans-serif',
  Oswald: 'sans-serif',
  Lato: 'sans-serif',
  'Space Grotesk': 'sans-serif',
  Inter: 'sans-serif',
  'Bebas Neue': 'display',
  'Nunito Sans': 'sans-serif',
  'Cormorant Garamond': 'serif',
  'Work Sans': 'sans-serif',
  'Archivo Black': 'sans-serif',
  Karla: 'sans-serif',
  'DM Serif Display': 'serif',
  'DM Sans': 'sans-serif',
  Fraunces: 'serif',
  Manrope: 'sans-serif',
  'Abril Fatface': 'serif',
  Rubik: 'sans-serif',
  'Josefin Sans': 'sans-serif',
  Nunito: 'sans-serif',
};

const DEFAULT_HEADING = 'The quick brown fox';
const DEFAULT_BODY =
  'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs — a pangram used to preview every letterform a typeface has to offer, in context, at reading size.';

const MAX_SHUFFLE_RETRIES = 12;

function genericFor(fontName: string): GenericFamily {
  return GENERIC_FAMILY[fontName] ?? 'sans-serif';
}

function cssSnippet(pair: FontPair): string {
  const headingGeneric = genericFor(pair.heading);
  const bodyGeneric = genericFor(pair.body);
  return `/* Heading */\nfont-family: '${pair.heading}', ${headingGeneric};\n\n/* Body */\nfont-family: '${pair.body}', ${bodyGeneric};`;
}

function buildGoogleFontsHref(pairs: FontPair[]): string {
  const families = new Set<string>();
  for (const pair of pairs) {
    families.add(pair.heading);
    families.add(pair.body);
  }
  const params = Array.from(families).map((name) => {
    const encoded = name.split(' ').join('+');
    return `family=${encoded}:wght@400;700`;
  });
  return `https://fonts.googleapis.com/css2?${params.join('&')}&display=swap`;
}

type PersistedState = {
  selectedIndex?: number;
  headingText?: string;
  bodyText?: string;
};

export default function FontPairing({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const storageKey = `xos-studio-fontpair-${boardId}`;

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [headingText, setHeadingText] = useState(DEFAULT_HEADING);
  const [bodyText, setBodyText] = useState(DEFAULT_BODY);
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load persisted state on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedState;
        if (
          typeof parsed.selectedIndex === 'number' &&
          parsed.selectedIndex >= 0 &&
          parsed.selectedIndex < FONT_PAIRS.length
        ) {
          setSelectedIndex(parsed.selectedIndex);
        }
        if (typeof parsed.headingText === 'string') setHeadingText(parsed.headingText);
        if (typeof parsed.bodyText === 'string') setBodyText(parsed.bodyText);
      }
    } catch {
      // ignore malformed/inaccessible storage
    } finally {
      setLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Persist state on change (skip until initial load completes to avoid clobbering).
  useEffect(() => {
    if (!loaded) return;
    try {
      const payload: PersistedState = { selectedIndex, headingText, bodyText };
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // ignore quota/access errors
    }
  }, [loaded, storageKey, selectedIndex, headingText, bodyText]);

  // Inject the single Google Fonts stylesheet link for all curated pairs,
  // cleaned up on unmount via a module-level reference count rather than a
  // plain create/remove pair. A plain pair breaks under React 18
  // StrictMode's dev-only mount→cleanup→remount double-invoke (and under
  // Fast Refresh): a bare "does a matching <link> already exist" check
  // means whichever mount happens to run second sees the first mount's
  // link, skips creating its own, and therefore never registers a cleanup
  // for it — so when the *second* instance later unmounts for real, no one
  // owns the link anymore and it leaks forever. Ref-counting sidesteps that
  // ownership question entirely: the Nth mount only creates the link if the
  // count was zero, and the link is only removed once the count drops back
  // to zero, regardless of how many times or in what order this component
  // mounts and unmounts.
  useEffect(() => {
    fontLinkRefCount += 1;
    if (fontLinkRefCount === 1) {
      const href = buildGoogleFontsHref(FONT_PAIRS);
      fontLinkEl = document.createElement('link');
      fontLinkEl.rel = 'stylesheet';
      fontLinkEl.href = href;
      document.head.appendChild(fontLinkEl);
    }
    return () => {
      fontLinkRefCount -= 1;
      if (fontLinkRefCount <= 0) {
        fontLinkEl?.remove();
        fontLinkEl = null;
        fontLinkRefCount = 0;
      }
    };
  }, []);

  const selectedPair = FONT_PAIRS[selectedIndex];

  const snippet = useMemo(() => cssSnippet(selectedPair), [selectedPair]);

  function selectIndex(i: number) {
    setSelectedIndex(((i % FONT_PAIRS.length) + FONT_PAIRS.length) % FONT_PAIRS.length);
  }

  function handlePrev() {
    selectIndex(selectedIndex - 1);
  }

  function handleNext() {
    selectIndex(selectedIndex + 1);
  }

  function handleShuffle() {
    if (FONT_PAIRS.length <= 1) return;
    let next = selectedIndex;
    let tries = 0;
    while (next === selectedIndex && tries < MAX_SHUFFLE_RETRIES) {
      next = Math.floor(Math.random() * FONT_PAIRS.length);
      tries += 1;
    }
    setSelectedIndex(next);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — silently ignore
    }
  }

  return (
    <ToolShell title="FONT PAIRING EXPLORER" onExit={onExit}>
      <div className="toolCol">
        <div className="toolRow">
          <button className="chip" onClick={handlePrev}>
            <Icon name="chevronLeft" size={12} /> PREV
          </button>
          <button className="chip" onClick={handleNext}>
            NEXT <Icon name="chevronRight" size={12} />
          </button>
          <button className="chip" onClick={handleShuffle}>
            <Icon name="shuffle" size={12} /> SHUFFLE
          </button>
          <button className="wbtn" onClick={handleCopy}>
            {copied ? 'COPIED!' : 'COPY CSS'}
          </button>
        </div>

        <div className="toolRow" style={{ alignItems: 'stretch', gap: 16 }}>
          <div className="gpanel" style={{ padding: 16, flex: 2, minWidth: 320 }}>
            <div className="rsub">LIVE PREVIEW</div>
            <div
              style={{
                fontFamily: selectedPair.heading,
                fontWeight: 700,
                fontSize: 40,
                lineHeight: 1.15,
                color: 'var(--text)',
                marginTop: 8,
                marginBottom: 12,
                wordBreak: 'break-word',
              }}
            >
              {headingText || DEFAULT_HEADING}
            </div>
            <p
              style={{
                fontFamily: selectedPair.body,
                fontWeight: 400,
                fontSize: 14,
                lineHeight: 1.6,
                color: 'var(--text-dim)',
                marginTop: 0,
              }}
            >
              {bodyText || DEFAULT_BODY}
            </p>

            <div className="toolField" style={{ marginTop: 12 }}>
              <label className="toolHint">Heading sample</label>
              <input
                type="text"
                value={headingText}
                onChange={(e) => setHeadingText(e.target.value)}
                placeholder={DEFAULT_HEADING}
              />
            </div>
            <div className="toolField" style={{ marginTop: 8 }}>
              <label className="toolHint">Body sample</label>
              <textarea
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                placeholder={DEFAULT_BODY}
                rows={4}
              />
            </div>

            <div className="toolField" style={{ marginTop: 12 }}>
              <label className="toolHint">CSS</label>
              <pre
                style={{
                  background: 'var(--void)',
                  border: '1px solid var(--edge)',
                  borderRadius: 6,
                  padding: 10,
                  fontSize: 12,
                  color: 'var(--cyan)',
                  whiteSpace: 'pre-wrap',
                  margin: 0,
                }}
              >
                {snippet}
              </pre>
            </div>
          </div>

          <div className="gpanel" style={{ padding: 12, flex: 1, minWidth: 220, maxHeight: 480, overflowY: 'auto' }}>
            <div className="rsub">CURATED PAIRS</div>
            <div className="toolCol" style={{ marginTop: 8, gap: 6 }}>
              {FONT_PAIRS.map((pair, i) => {
                const isSelected = i === selectedIndex;
                return (
                  <div
                    key={`${pair.heading}-${pair.body}`}
                    className="gpanel"
                    onClick={() => selectIndex(i)}
                    style={{
                      padding: '8px 10px',
                      cursor: 'pointer',
                      border: isSelected ? '1px solid var(--cyan)' : '1px solid var(--edge)',
                      color: isSelected ? 'var(--cyan)' : 'var(--text)',
                    }}
                  >
                    <div style={{ fontFamily: pair.heading, fontSize: 15, fontWeight: 700 }}>{pair.heading}</div>
                    <div className="toolHint" style={{ marginTop: 2 }}>
                      {pair.heading} / {pair.body}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="toolHint">
          Fonts load live from Google Fonts. Click any pair to preview it, or use SHUFFLE / PREV / NEXT to browse.
        </div>
      </div>
    </ToolShell>
  );
}
