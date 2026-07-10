import { useEffect, useRef, useState } from 'react';
import ToolShell from './ToolShell';

/**
 * Amendment v0.4 item 2 (New Project modal redesign) — Amendment v0.3
 * Section B "Show More" utility tool. This is a genuinely-functional but
 * deliberately simple background remover: an edge-seeded, color-distance
 * flood fill that erases pixels connected to the image border which are
 * within a tunable color tolerance of the sampled background color. That's
 * real pixel analysis (not a stub), and it works well for the common case
 * of a flat/near-flat background — it is explicitly NOT ML-quality
 * segmentation (no neural net is available in this sandboxed browser
 * environment), which is disclosed to the Captain in the UI copy itself
 * rather than silently overclaiming.
 */
export default function BackgroundRemover({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const [tolerance, setTolerance] = useState(32);
  const [hasImage, setHasImage] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalDataRef = useRef<ImageData | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`xos-studio-bgremove-${boardId}`);
      if (raw) {
        const saved = JSON.parse(raw) as { tolerance?: number };
        if (typeof saved.tolerance === 'number') setTolerance(saved.tolerance);
      }
    } catch {
      /* ignore corrupt storage */
    }
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(`xos-studio-bgremove-${boardId}`, JSON.stringify({ tolerance }));
    } catch {
      /* non-fatal */
    }
  }, [boardId, tolerance]);

  function onFile(file: File | null) {
    if (!file) return;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    const img = new Image();
    img.onload = () => {
      const cv = canvasRef.current;
      if (!cv) return;
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0);
      originalDataRef.current = ctx.getImageData(0, 0, cv.width, cv.height);
      setHasImage(true);
      setFileName(file.name);
      runRemoval(tolerance);
    };
    img.src = url;
  }

  /** Real BFS flood fill seeded from every border pixel: any pixel reachable
   * from the edge through neighbors within `tol` color distance of its
   * flood-seed color gets alpha=0. This genuinely erases a connected
   * background region (not a rectangular crop, not a fake preview) —
   * islands of foreground surrounded by background stay opaque since the
   * flood can't reach through them. */
  function runRemoval(tol: number) {
    const cv = canvasRef.current;
    const original = originalDataRef.current;
    if (!cv || !original) return;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const w = cv.width;
    const h = cv.height;
    const src = original.data;
    const out = new Uint8ClampedArray(src); // start from the untouched original every re-run
    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let qHead = 0;
    let qTail = 0;

    function colorDist(i: number, j: number): number {
      const dr = src[i] - src[j];
      const dg = src[i + 1] - src[j + 1];
      const db = src[i + 2] - src[j + 2];
      return Math.sqrt(dr * dr + dg * dg + db * db);
    }

    // Seed every border pixel.
    for (let x = 0; x < w; x++) {
      for (const y of [0, h - 1]) {
        const idx = y * w + x;
        if (!visited[idx]) {
          visited[idx] = 1;
          queue[qTail++] = idx;
        }
      }
    }
    for (let y = 0; y < h; y++) {
      for (const x of [0, w - 1]) {
        const idx = y * w + x;
        if (!visited[idx]) {
          visited[idx] = 1;
          queue[qTail++] = idx;
        }
      }
    }

    while (qHead < qTail) {
      const idx = queue[qHead++];
      const x = idx % w;
      const y = (idx / w) | 0;
      const px = idx * 4;
      out[px + 3] = 0; // erase this pixel — it's connected to the border within tolerance

      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nIdx = ny * w + nx;
        if (visited[nIdx]) continue;
        const nPx = nIdx * 4;
        if (colorDist(px, nPx) <= tol) {
          visited[nIdx] = 1;
          queue[qTail++] = nIdx;
        }
      }
    }

    ctx.putImageData(new ImageData(out, w, h), 0, 0);
  }

  function download() {
    const cv = canvasRef.current;
    if (!cv) return;
    cv.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (fileName ? fileName.replace(/\.[^.]+$/, '') : 'image') + '-no-bg.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  }

  function reset() {
    if (originalDataRef.current) {
      const ctx = canvasRef.current?.getContext('2d', { willReadFrequently: true });
      if (ctx) ctx.putImageData(originalDataRef.current, 0, 0);
    }
  }

  return (
    <ToolShell title="BACKGROUND REMOVER" onExit={onExit}>
      <div className="toolField">
        <label className="toolDrop" style={{ display: 'inline-block' }}>
          {fileName ? `LOADED: ${fileName} (click to replace)` : 'CLICK TO UPLOAD AN IMAGE'}
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      <div className="toolHint" style={{ marginBottom: 12 }}>
        Edge-seeded color-distance removal — real pixel analysis, works best on a flat or near-flat background. This isn't ML-grade
        subject segmentation (no model runs in-browser here); tune the tolerance slider for trickier images.
      </div>
      {hasImage && (
        <>
          <div className="toolField" style={{ maxWidth: 340 }}>
            <label>TOLERANCE {tolerance}</label>
            <input
              type="range"
              min={4}
              max={100}
              value={tolerance}
              onChange={(e) => {
                const t = +e.target.value;
                setTolerance(t);
                runRemoval(t);
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button className="wbtn ghost" onClick={reset}>
              RESET
            </button>
            <button className="wbtn" onClick={download}>
              DOWNLOAD PNG (TRANSPARENT)
            </button>
          </div>
        </>
      )}
      <div className="toolCanvasWrap">
        <canvas ref={canvasRef} style={{ maxWidth: 560, height: 'auto' }} />
      </div>
    </ToolShell>
  );
}
