import { useEffect, useMemo, useRef, useState } from 'react';
import ToolShell from './ToolShell';
import { ICONS } from '../../../design-system/icons/registry';
import type { IconName } from '../../../design-system/icons/registry';

/**
 * Item #6 (batch 1 of 2 — the 6 smaller utility tools). Real icon + wordmark
 * combiner: pick a real Lucide glyph (same registry every other room draws
 * from — no bespoke logo-only icon set), a wordmark, layout, colors and
 * shape, and export a real transparent PNG rendered on an actual canvas
 * (icon path drawn via a throwaway SVG->Image round-trip, not a fake
 * preview that doesn't match what downloads).
 */
type Layout = 'iconLeft' | 'iconTop' | 'iconOnly' | 'wordOnly';
type Shape = 'none' | 'circle' | 'roundedSquare' | 'square';

interface LogoPrefs {
  icon: IconName;
  word: string;
  sub: string;
  layout: Layout;
  shape: Shape;
  fg: string;
  bg: string;
  accent: string;
  size: number;
}

const ICON_CHOICE_NAMES: string[] = [
  'hexagon', 'bolt', 'sparkles', 'star', 'diamond', 'penTool', 'brush', 'wand', 'stamp',
  'telescope', 'sprout', 'globe', 'music', 'camera', 'idea', 'branch', 'grid', 'layers', 'checkCircle',
];
const ICON_CHOICES: IconName[] = ICON_CHOICE_NAMES.filter((n) => n in ICONS) as IconName[];

const PREFS_KEY_PREFIX = 'xos-studio-logo-';

function loadPrefs(boardId: string): LogoPrefs {
  const fallback: LogoPrefs = {
    icon: 'hexagon', word: 'BRAND', sub: '', layout: 'iconLeft', shape: 'roundedSquare',
    fg: '#E6F4FF', bg: '#05080D', accent: '#00F5FF', size: 480,
  };
  try {
    const raw = localStorage.getItem(PREFS_KEY_PREFIX + boardId);
    if (raw) return { ...fallback, ...(JSON.parse(raw) as Partial<LogoPrefs>) };
  } catch {
    /* corrupt storage */
  }
  return fallback;
}

/** Renders a Lucide icon component to an SVG string and back to a drawable
 * <canvas> image (Lucide ships as React components, not canvas-drawable
 * paths, so a real SVG->Image round-trip is the honest way to get real
 * pixels — no faked/simplified glyph). Uses `renderToStaticMarkup` (a pure,
 * synchronous string render with no commit/root lifecycle) rather than
 * mounting a real React root off-tree — an earlier version did that and it
 * raced with the parent tree's own concurrent rendering ("Attempted to
 * synchronously unmount a root while React was already rendering"),
 * corrupting paint elsewhere on the page. This has no such lifecycle to
 * race. */
function iconToDataUrl(name: IconName, color: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    import('react-dom/server').then(({ renderToStaticMarkup }) => {
      const IconComp = ICONS[name];
      let xml = renderToStaticMarkup(<IconComp size={256} strokeWidth={1.6} color={color} />);
      if (!xml.includes('xmlns=')) {
        xml = xml.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('icon image decode failed'));
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
    });
  });
}

export default function LogoMaker({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const [prefs, setPrefs] = useState<LogoPrefs>(() => loadPrefs(boardId));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY_PREFIX + boardId, JSON.stringify(prefs));
    } catch {
      /* non-fatal */
    }
  }, [boardId, prefs]);

  const iconChoices = useMemo(() => ICON_CHOICES, []);

  useEffect(() => {
    let cancelled = false;
    const cv = canvasRef.current;
    if (!cv) return;
    setBusy(true);
    const W = prefs.size,
      H = Math.round(prefs.size * 0.62);
    cv.width = W;
    cv.height = H;
    const ctx2d = cv.getContext('2d');
    if (!ctx2d) return;
    const ctx: CanvasRenderingContext2D = ctx2d;

    async function render() {
      ctx.clearRect(0, 0, W, H);
      if (prefs.bg !== 'transparent') {
        ctx.fillStyle = prefs.bg;
        ctx.fillRect(0, 0, W, H);
      }

      const showIcon = prefs.layout !== 'wordOnly';
      const showWord = prefs.layout !== 'iconOnly';
      const iconSize = Math.min(H * 0.68, W * 0.3);

      let iconImg: HTMLImageElement | null = null;
      if (showIcon) {
        try {
          iconImg = await iconToDataUrl(prefs.icon, prefs.bg === prefs.accent ? prefs.fg : '#05080D');
        } catch {
          iconImg = null;
        }
      }
      if (cancelled) return;

      const drawBadge = (cx: number, cy: number, r: number) => {
        if (prefs.shape === 'none') return;
        ctx.fillStyle = prefs.accent;
        ctx.beginPath();
        if (prefs.shape === 'circle') {
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
        } else {
          const s = r * 1.9;
          const rr = prefs.shape === 'roundedSquare' ? s * 0.22 : 0;
          const x0 = cx - s / 2,
            y0 = cy - s / 2;
          ctx.moveTo(x0 + rr, y0);
          ctx.arcTo(x0 + s, y0, x0 + s, y0 + s, rr);
          ctx.arcTo(x0 + s, y0 + s, x0, y0 + s, rr);
          ctx.arcTo(x0, y0 + s, x0, y0, rr);
          ctx.arcTo(x0, y0, x0 + s, y0, rr);
        }
        ctx.closePath();
        ctx.fill();
      };

      if (prefs.layout === 'iconLeft') {
        const badgeR = iconSize * 0.62;
        const badgeCx = W * 0.18,
          badgeCy = H / 2;
        drawBadge(badgeCx, badgeCy, badgeR);
        if (iconImg) ctx.drawImage(iconImg, badgeCx - iconSize / 2.6, badgeCy - iconSize / 2.6, iconSize * 0.77, iconSize * 0.77);
        if (showWord) {
          ctx.fillStyle = prefs.fg;
          ctx.textBaseline = 'middle';
          ctx.font = `600 ${Math.round(H * 0.26)}px 'Orbitron', sans-serif`;
          ctx.fillText(prefs.word.toUpperCase(), W * 0.32, prefs.sub ? H * 0.42 : H / 2);
          if (prefs.sub) {
            ctx.fillStyle = prefs.accent;
            ctx.font = `400 ${Math.round(H * 0.12)}px 'Share Tech Mono', monospace`;
            ctx.fillText(prefs.sub.toUpperCase(), W * 0.32, H * 0.68);
          }
        }
      } else if (prefs.layout === 'iconTop') {
        const badgeR = iconSize * 0.55;
        const badgeCx = W / 2,
          badgeCy = H * 0.34;
        drawBadge(badgeCx, badgeCy, badgeR);
        if (iconImg) ctx.drawImage(iconImg, badgeCx - iconSize / 2.7, badgeCy - iconSize / 2.7, iconSize * 0.74, iconSize * 0.74);
        if (showWord) {
          ctx.fillStyle = prefs.fg;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `600 ${Math.round(H * 0.2)}px 'Orbitron', sans-serif`;
          ctx.fillText(prefs.word.toUpperCase(), W / 2, H * 0.78);
          ctx.textAlign = 'left';
        }
      } else if (prefs.layout === 'iconOnly') {
        const badgeR = Math.min(W, H) * 0.4;
        drawBadge(W / 2, H / 2, badgeR);
        if (iconImg) ctx.drawImage(iconImg, W / 2 - badgeR * 0.72, H / 2 - badgeR * 0.72, badgeR * 1.44, badgeR * 1.44);
      } else {
        ctx.fillStyle = prefs.fg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `600 ${Math.round(H * 0.28)}px 'Orbitron', sans-serif`;
        ctx.fillText(prefs.word.toUpperCase(), W / 2, H / 2);
        ctx.textAlign = 'left';
      }
      setBusy(false);
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [prefs]);

  function download() {
    const cv = canvasRef.current;
    if (!cv) return;
    cv.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(prefs.word || 'logo').toLowerCase().replace(/\s+/g, '-')}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  }

  return (
    <ToolShell title="LOGO MAKER" onExit={onExit} actions={<button className="wbtn" onClick={download}>DOWNLOAD PNG</button>}>
      <div className="toolRow">
        <div className="toolCol">
          <div className="toolField">
            <label>WORDMARK</label>
            <input value={prefs.word} onChange={(e) => setPrefs((p) => ({ ...p, word: e.target.value }))} placeholder="BRAND" />
          </div>
          <div className="toolField">
            <label>TAGLINE (OPTIONAL)</label>
            <input value={prefs.sub} onChange={(e) => setPrefs((p) => ({ ...p, sub: e.target.value }))} placeholder="est. 2026" />
          </div>
          <div className="toolField">
            <label>ICON</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
              {iconChoices.map((name) => {
                const IconComp = ICONS[name];
                return (
                  <span
                    key={name}
                    className={`chip small ${prefs.icon === name ? 'on' : ''}`}
                    style={{ display: 'grid', placeItems: 'center', padding: '8px 0' }}
                    onClick={() => setPrefs((p) => ({ ...p, icon: name }))}
                  >
                    <IconComp size={16} />
                  </span>
                );
              })}
            </div>
          </div>
          <div className="toolField">
            <label>LAYOUT</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {([
                ['iconLeft', 'ICON + WORD'],
                ['iconTop', 'STACKED'],
                ['iconOnly', 'ICON ONLY'],
                ['wordOnly', 'WORDMARK ONLY'],
              ] as [Layout, string][]).map(([l, label]) => (
                <span key={l} className={`chip small ${prefs.layout === l ? 'on' : ''}`} onClick={() => setPrefs((p) => ({ ...p, layout: l }))}>
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div className="toolField">
            <label>BADGE SHAPE</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {([
                ['none', 'NONE'],
                ['circle', 'CIRCLE'],
                ['roundedSquare', 'ROUNDED'],
                ['square', 'SQUARE'],
              ] as [Shape, string][]).map(([s, label]) => (
                <span key={s} className={`chip small ${prefs.shape === s ? 'on' : ''}`} onClick={() => setPrefs((p) => ({ ...p, shape: s }))}>
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div className="toolField">
            <label>TEXT / ICON</label>
            <input type="color" value={prefs.fg} onChange={(e) => setPrefs((p) => ({ ...p, fg: e.target.value }))} />
          </div>
          <div className="toolField">
            <label>ACCENT / BADGE</label>
            <input type="color" value={prefs.accent} onChange={(e) => setPrefs((p) => ({ ...p, accent: e.target.value }))} />
          </div>
          <div className="toolField">
            <label>BACKGROUND</label>
            <input type="color" value={prefs.bg} onChange={(e) => setPrefs((p) => ({ ...p, bg: e.target.value }))} />
          </div>
        </div>
        <div className="toolCol">
          <div className="toolCanvasWrap">
            <canvas ref={canvasRef} style={{ maxWidth: '100%', height: 'auto' }} />
          </div>
          {busy && <div className="toolHint">Rendering…</div>}
        </div>
      </div>
    </ToolShell>
  );
}
