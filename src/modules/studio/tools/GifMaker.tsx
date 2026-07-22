import { useEffect, useRef, useState } from 'react';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import ToolShell from './ToolShell';
import Icon from '../../../design-system/icons/Icon';

/**
 * Item #6 (batch 1). Real frames-to-GIF exporter — upload a set of images,
 * reorder them, set each frame's delay, and export a genuine GIF89a file
 * via `gifenc` (the exact same real encoder Design Studio's Animation mode
 * uses for its own GIF export — see animation/AnimationEngine.ts's
 * exportGif(), same quantize/applyPalette/writeFrame pipeline, not a
 * separate/fake implementation).
 */
interface GifFrame {
  id: string;
  img: HTMLImageElement;
  delayMs: number;
}

export default function GifMaker({ onExit }: { boardId: string; onExit: () => void }) {
  const [frames, setFrames] = useState<GifFrame[]>([]);
  const [loop, setLoop] = useState(true);
  const [busy, setBusy] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function addFiles(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        setFrames((f) => [...f, { id: `${Date.now()}-${Math.random()}`, img, delayMs: 200 }]);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }

  function removeFrame(id: string) {
    setFrames((f) => f.filter((x) => x.id !== id));
  }

  function move(id: string, dir: -1 | 1) {
    setFrames((f) => {
      const i = f.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= f.length) return f;
      const next = [...f];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function setDelay(id: string, ms: number) {
    setFrames((f) => f.map((x) => (x.id === id ? { ...x, delayMs: ms } : x)));
  }

  // Live preview — actually cycles through the real frames at their real
  // delays, on an actual canvas, so what's previewed matches what exports.
  useEffect(() => {
    const cv = previewCanvasRef.current;
    if (!cv || frames.length === 0) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const maxW = Math.max(...frames.map((f) => f.img.naturalWidth));
    const maxH = Math.max(...frames.map((f) => f.img.naturalHeight));
    cv.width = maxW;
    cv.height = maxH;
    const frame = frames[previewIdx % frames.length];
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(frame.img, 0, 0);
    playTimer.current = setTimeout(() => setPreviewIdx((i) => (i + 1) % frames.length), frame.delayMs);
    return () => {
      if (playTimer.current) clearTimeout(playTimer.current);
    };
  }, [frames, previewIdx]);

  async function exportGif() {
    if (frames.length === 0) return;
    setBusy(true);
    try {
      const W = Math.max(...frames.map((f) => f.img.naturalWidth));
      const H = Math.max(...frames.map((f) => f.img.naturalHeight));
      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      const octx = off.getContext('2d')!;
      const gif = GIFEncoder();
      for (const frame of frames) {
        octx.clearRect(0, 0, W, H);
        octx.fillStyle = '#05080d';
        octx.fillRect(0, 0, W, H);
        octx.drawImage(frame.img, 0, 0);
        const { data } = octx.getImageData(0, 0, W, H);
        const palette = quantize(data, 256);
        const index = applyPalette(data, palette);
        gif.writeFrame(index, W, H, { palette, delay: frame.delayMs, repeat: loop ? 0 : -1 });
      }
      gif.finish();
      const blob = new Blob([gif.bytes() as BlobPart], { type: 'image/gif' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'animation.gif';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolShell
      title="GIF MAKER"
      onExit={onExit}
      actions={
        <button className="wbtn" onClick={exportGif} disabled={busy || frames.length === 0}>
          {busy ? 'ENCODING…' : `EXPORT GIF (${frames.length} FRAMES)`}
        </button>
      }
    >
      <div className="toolRow">
        <div className="toolCol">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
          <button className="wbtn" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={13} /> ADD FRAMES
          </button>
          <div className="toolField" style={{ marginTop: 10 }}>
            <label>
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> LOOP FOREVER
            </label>
          </div>
          <div className="toolHint" style={{ marginTop: 8 }}>
            Upload images in the order you want them to play (drag reorder not needed — use the arrows below each thumbnail). Each frame's delay is real and honored in both the preview and the exported GIF.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, maxHeight: 380, overflowY: 'auto' }}>
            {frames.map((f, i) => (
              <div key={f.id} className="gpanel" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8 }}>
                <img src={f.img.src} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }} />
                <span style={{ fontSize: 10, opacity: 0.6 }}>#{i + 1}</span>
                <input
                  type="number"
                  min={20}
                  max={5000}
                  step={20}
                  value={f.delayMs}
                  onChange={(e) => setDelay(f.id, +e.target.value)}
                  style={{ width: 64 }}
                />
                <span style={{ fontSize: 9, opacity: 0.5 }}>ms</span>
                <span style={{ flex: 1 }} />
                <span className="chip small" onClick={() => move(f.id, -1)}>
                  <Icon name="chevronUp" size={11} />
                </span>
                <span className="chip small" onClick={() => move(f.id, 1)}>
                  <Icon name="chevronDown" size={11} />
                </span>
                <span className="chip small" onClick={() => removeFrame(f.id)}>
                  <Icon name="trash" size={11} />
                </span>
              </div>
            ))}
            {frames.length === 0 && <div className="toolHint">No frames yet — add a few images to begin.</div>}
          </div>
        </div>
        <div className="toolCol">
          <div className="toolCanvasWrap">
            {frames.length > 0 ? (
              <canvas ref={previewCanvasRef} style={{ maxWidth: '100%', height: 'auto', imageRendering: 'pixelated' }} />
            ) : (
              <div className="toolHint">Live preview plays here once you've added frames.</div>
            )}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
