import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import ToolShell from './ToolShell';

/**
 * Amendment v0.4 item 2 (New Project modal redesign) — Amendment v0.3
 * Section B "Show More" utility tool. Real QR encoding via the `qrcode`
 * npm package (a genuine Reed-Solomon QR implementation, not a lookup
 * image or a fake grid) rendered straight to canvas, with real color and
 * error-correction controls and a real PNG export.
 */
type ErrorCorrection = 'L' | 'M' | 'Q' | 'H';

interface QrPrefs {
  text: string;
  fg: string;
  bg: string;
  ecc: ErrorCorrection;
  size: number;
}

const PREFS_KEY_PREFIX = 'xos-studio-qr-';

function loadPrefs(boardId: string): QrPrefs {
  const fallback: QrPrefs = { text: 'https://xos-nexus.surge.sh', fg: '#00F5FF', bg: '#05080D', ecc: 'M', size: 320 };
  try {
    const raw = localStorage.getItem(PREFS_KEY_PREFIX + boardId);
    if (raw) return { ...fallback, ...(JSON.parse(raw) as Partial<QrPrefs>) };
  } catch {
    /* corrupt storage — fall back to defaults */
  }
  return fallback;
}

export default function QrGenerator({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const [prefs, setPrefs] = useState<QrPrefs>(() => loadPrefs(boardId));
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Persist preferences (debounced-by-effect, not per-keystroke-blocking).
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY_PREFIX + boardId, JSON.stringify(prefs));
    } catch {
      /* quota or private-mode — non-fatal, just no persistence this session */
    }
  }, [boardId, prefs]);

  // Real QR render: re-encode from scratch whenever the text/colors/ECC/size change.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    if (!prefs.text.trim()) {
      const ctx = cv.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
      setError(null);
      return;
    }
    QRCode.toCanvas(
      cv,
      prefs.text,
      {
        width: prefs.size,
        margin: 2,
        errorCorrectionLevel: prefs.ecc,
        color: { dark: prefs.fg, light: prefs.bg },
      },
      (err: Error | null | undefined) => {
        setError(err ? err.message : null);
      }
    );
  }, [prefs.text, prefs.fg, prefs.bg, prefs.ecc, prefs.size]);

  function download() {
    const cv = canvasRef.current;
    if (!cv) return;
    cv.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qrcode.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  }

  return (
    <ToolShell title="QR CODE GENERATOR" onExit={onExit}>
      <div className="toolRow">
        <div className="toolCol">
          <div className="toolField">
            <label>TEXT / URL</label>
            <textarea
              rows={3}
              value={prefs.text}
              onChange={(e) => setPrefs((p) => ({ ...p, text: e.target.value }))}
              placeholder="Paste a URL or type any text to encode…"
            />
          </div>
          <div className="toolField">
            <label>FOREGROUND</label>
            <input type="color" value={prefs.fg} onChange={(e) => setPrefs((p) => ({ ...p, fg: e.target.value }))} />
          </div>
          <div className="toolField">
            <label>BACKGROUND</label>
            <input type="color" value={prefs.bg} onChange={(e) => setPrefs((p) => ({ ...p, bg: e.target.value }))} />
          </div>
          <div className="toolField">
            <label>ERROR CORRECTION</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['L', 'M', 'Q', 'H'] as ErrorCorrection[]).map((lvl) => (
                <span
                  key={lvl}
                  className={`chip small ${prefs.ecc === lvl ? 'on' : ''}`}
                  onClick={() => setPrefs((p) => ({ ...p, ecc: lvl }))}
                  title={lvl === 'L' ? '~7% recovery' : lvl === 'M' ? '~15% recovery' : lvl === 'Q' ? '~25% recovery' : '~30% recovery'}
                >
                  {lvl}
                </span>
              ))}
            </div>
            <div className="toolHint">Higher levels stay scannable even if part of the code is damaged or covered — at the cost of a denser pattern.</div>
          </div>
          <div className="toolField">
            <label>SIZE {prefs.size}px</label>
            <input type="range" min={120} max={640} step={20} value={prefs.size} onChange={(e) => setPrefs((p) => ({ ...p, size: +e.target.value }))} />
          </div>
          <button className="wbtn" onClick={download} disabled={!prefs.text.trim()}>
            DOWNLOAD PNG
          </button>
          {error && (
            <div className="toolHint" style={{ color: 'var(--magenta)', marginTop: 8 }}>
              Couldn't encode: {error}
            </div>
          )}
        </div>
        <div className="toolCol">
          <div className="toolCanvasWrap">
            <canvas ref={canvasRef} />
          </div>
          {!prefs.text.trim() && <div className="toolHint">Type something on the left to generate a real, scannable QR code.</div>}
        </div>
      </div>
    </ToolShell>
  );
}
