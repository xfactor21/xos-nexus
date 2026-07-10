import { useEffect, useMemo, useRef, useState } from 'react';
import ToolShell from './ToolShell';

type Mode = 'image' | 'color';
type Harmony = 'complementary' | 'analogous' | 'triadic' | 'monochrome';

const STORAGE_PREFIX = 'xos-studio-palette-';

// ---- color math helpers (kept local/self-contained on purpose) ----

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = parseInt(h, 16) || 0;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return [r, g, b];
}

function rgbToHsb(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return [h, s, v];
}

function hsbToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = ((h % 1) + 1) % 1;
  const i = Math.floor(hh * 6);
  const f = hh * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    default:
      r = v;
      g = p;
      b = q;
      break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  const toHex = (x: number) => clamp(x).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ---- palette generation ----

function generateHarmony(hex: string, harmony: Harmony): string[] {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, v] = rgbToHsb(r, g, b);

  const mk = (hueOffset: number, satMul: number, briMul: number) => {
    const hue = h + hueOffset;
    const sat = Math.max(0, Math.min(1, s * satMul));
    const bri = Math.max(0, Math.min(1, v * briMul));
    const [rr, gg, bb] = hsbToRgb(hue, sat, bri);
    return rgbToHex(rr, gg, bb);
  };

  switch (harmony) {
    case 'complementary':
      return [mk(0, 1, 1), mk(0, 1, 1.3), mk(0.5, 1, 1), mk(0.5, 1, 0.7), mk(0, 1, 0.5)];
    case 'analogous':
      return [mk(-0.166, 1, 1), mk(-0.083, 1, 1), mk(0, 1, 1), mk(0.083, 1, 1), mk(0.166, 1, 1)];
    case 'triadic':
      return [mk(0, 1, 1), mk(0.333, 1, 1), mk(0.667, 1, 1), mk(0, 1, 1.25), mk(0, 1, 0.6)];
    case 'monochrome':
      return [mk(0, 1, 0.3), mk(0, 1, 0.55), mk(0, 1, 0.8), mk(0, 1, 1), mk(0, 0.5, 1)];
    default:
      return [];
  }
}

function extractPalette(imageData: ImageData): string[] {
  const data = imageData.data;
  const buckets = new Map<string, { rSum: number; gSum: number; bSum: number; count: number }>();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 128) continue;

    const qr = Math.round(r / 32) * 32;
    const qg = Math.round(g / 32) * 32;
    const qb = Math.round(b / 32) * 32;
    const key = `${qr},${qg},${qb}`;

    const entry = buckets.get(key);
    if (entry) {
      entry.rSum += r;
      entry.gSum += g;
      entry.bSum += b;
      entry.count += 1;
    } else {
      buckets.set(key, { rSum: r, gSum: g, bSum: b, count: 1 });
    }
  }

  const top = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return top.map((e) => rgbToHex(e.rSum / e.count, e.gSum / e.count, e.bSum / e.count));
}

const HARMONIES: Harmony[] = ['complementary', 'analogous', 'triadic', 'monochrome'];

export default function PaletteGenerator({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const [mode, setMode] = useState<Mode>('image');
  const [baseColor, setBaseColor] = useState('#00e5ff');
  const [harmony, setHarmony] = useState<Harmony>('complementary');
  const [imageSwatches, setImageSwatches] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadedOnceRef = useRef(false);

  // load persisted state on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}${boardId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { mode?: Mode; baseColor?: string; harmony?: Harmony };
        if (parsed.mode === 'image' || parsed.mode === 'color') setMode(parsed.mode);
        if (typeof parsed.baseColor === 'string') setBaseColor(parsed.baseColor);
        if (parsed.harmony && HARMONIES.includes(parsed.harmony)) setHarmony(parsed.harmony);
      }
    } catch {
      // ignore corrupt/inaccessible storage
    }
    loadedOnceRef.current = true;
  }, [boardId]);

  // persist state on change
  useEffect(() => {
    if (!loadedOnceRef.current) return;
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${boardId}`, JSON.stringify({ mode, baseColor, harmony }));
    } catch {
      // ignore quota/access errors
    }
  }, [boardId, mode, baseColor, harmony]);

  const colorSwatches = useMemo(() => generateHarmony(baseColor, harmony), [baseColor, harmony]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxDim = 200;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        const scale = Math.min(maxDim / w, maxDim / h);
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
      }
      const canvas = canvasRef.current;
      if (!canvas) {
        URL.revokeObjectURL(url);
        return;
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      setImageSwatches(extractPalette(imageData));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const handleCopy = (hex: string, key: string) => {
    navigator.clipboard.writeText(hex).catch(() => {
      // clipboard may be unavailable; swatch still shows the hex text
    });
    setCopied(key);
    setTimeout(() => {
      setCopied((prev) => (prev === key ? null : prev));
    }, 1200);
  };

  const renderSwatch = (hex: string, key: string) => (
    <div key={key} className="toolSwatch" style={{ cursor: 'pointer' }} onClick={() => handleCopy(hex, key)}>
      <div className="sw" style={{ background: hex }} />
      <div className="hex">{copied === key ? 'Copied!' : hex}</div>
    </div>
  );

  return (
    <ToolShell title="PALETTE GENERATOR" onExit={onExit}>
      <div className="toolCol">
        <div className="toolRow">
          <button className={`chip ${mode === 'image' ? 'on' : ''}`} onClick={() => setMode('image')}>
            FROM IMAGE
          </button>
          <button className={`chip ${mode === 'color' ? 'on' : ''}`} onClick={() => setMode('color')}>
            FROM COLOR
          </button>
        </div>

        {mode === 'image' && (
          <div className="toolCol">
            <label className="toolDrop" style={{ cursor: 'pointer', display: 'block' }}>
              <input type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
              <span>{fileName ? fileName : 'Click to upload an image and extract its palette'}</span>
            </label>

            <div className="toolRow" style={{ alignItems: 'flex-start', gap: 16 }}>
              <div className="toolCanvasWrap">
                <canvas ref={canvasRef} style={{ maxWidth: 160, maxHeight: 160, display: 'block' }} />
              </div>
              <div className="toolSwatchGrid">
                {imageSwatches.length === 0 ? (
                  <div className="toolHint">Upload an image above — the 6 most common colors will appear here.</div>
                ) : (
                  imageSwatches.map((hex, i) => renderSwatch(hex, `img-${i}`))
                )}
              </div>
            </div>
          </div>
        )}

        {mode === 'color' && (
          <div className="toolCol">
            <div className="toolField">
              <div className="rsub">BASE COLOR</div>
              <div className="toolRow">
                <input type="color" value={baseColor} onChange={(e) => setBaseColor(e.target.value)} />
                <span style={{ color: 'var(--text-dim)' }}>{baseColor.toUpperCase()}</span>
              </div>
            </div>

            <div className="toolRow">
              {HARMONIES.map((h) => (
                <button key={h} className={`chip small ${harmony === h ? 'on' : ''}`} onClick={() => setHarmony(h)}>
                  {h.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="toolSwatchGrid">{colorSwatches.map((hex, i) => renderSwatch(hex, `col-${i}`))}</div>
          </div>
        )}
      </div>
    </ToolShell>
  );
}
