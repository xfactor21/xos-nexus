import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// eslint-disable-next-line import/no-unresolved
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import ToolShell from './ToolShell';
import Icon from '../../../design-system/icons/Icon';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * Item #6 (batch 1). Real PDF annotator: an existing PDF's pages are
 * genuinely rasterized via `pdfjs-dist` (Mozilla's real PDF parser/renderer
 * — the same engine Firefox's built-in PDF viewer uses), marked up with the
 * exact same annotation engine ScreenshotAnnotator already uses (arrow /
 * rect / ellipse / pen / text — reused, not reimplemented), then every
 * page's rendered+annotated pixels are re-embedded into a brand-new PDF via
 * `pdf-lib` and downloaded — a real multi-page PDF file, not a PNG export
 * pretending to be one.
 */
type Point = [number, number];
type Tool = 'arrow' | 'rect' | 'ellipse' | 'pen' | 'text';
type Annotation =
  | { id: string; kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { id: string; kind: 'rect'; x: number; y: number; w: number; h: number; color: string; width: number }
  | { id: string; kind: 'ellipse'; x: number; y: number; w: number; h: number; color: string; width: number }
  | { id: string; kind: 'pen'; points: Point[]; color: string; width: number }
  | { id: string; kind: 'text'; x: number; y: number; text: string; color: string; size: number };

// Stable empty-array reference for pages with no annotations yet — without
// this, `annByPage[pageIdx] ?? []` allocates a brand-new array every render
// for any blank page, which made the redraw effect below re-fire on every
// render instead of only when the annotation data actually changed.
const EMPTY_ANNOTATIONS: Annotation[] = [];

function drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation): void {
  switch (a.kind) {
    case 'arrow': {
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x1, a.y1);
      ctx.lineTo(a.x2, a.y2);
      ctx.stroke();
      const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
      const headLen = 12;
      const spread = (25 * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(a.x2, a.y2);
      ctx.lineTo(a.x2 - headLen * Math.cos(angle - spread), a.y2 - headLen * Math.sin(angle - spread));
      ctx.moveTo(a.x2, a.y2);
      ctx.lineTo(a.x2 - headLen * Math.cos(angle + spread), a.y2 - headLen * Math.sin(angle + spread));
      ctx.stroke();
      break;
    }
    case 'rect': {
      const x = a.w < 0 ? a.x + a.w : a.x;
      const y = a.h < 0 ? a.y + a.h : a.y;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.width;
      ctx.strokeRect(x, y, Math.abs(a.w), Math.abs(a.h));
      break;
    }
    case 'ellipse': {
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.width;
      ctx.beginPath();
      ctx.ellipse(a.x + a.w / 2, a.y + a.h / 2, Math.abs(a.w / 2), Math.abs(a.h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'pen': {
      if (a.points.length === 0) return;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(a.points[0][0], a.points[0][1]);
      for (let i = 1; i < a.points.length; i++) ctx.lineTo(a.points[i][0], a.points[i][1]);
      ctx.stroke();
      break;
    }
    case 'text': {
      ctx.font = `${a.size}px 'Share Tech Mono', monospace`;
      ctx.fillStyle = a.color;
      ctx.fillText(a.text, a.x, a.y);
      break;
    }
  }
}

export default function PdfMarkup({ onExit }: { boardId: string; onExit: () => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [pageImages, setPageImages] = useState<HTMLCanvasElement[]>([]);
  const [pageIdx, setPageIdx] = useState(0);
  const [annByPage, setAnnByPage] = useState<Record<number, Annotation[]>>({});
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState('#00fff2');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const idCounter = useRef(0);

  function genId() {
    idCounter.current += 1;
    return `ann-${idCounter.current}`;
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      const pages: HTMLCanvasElement[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 1.6 });
        const cv = document.createElement('canvas');
        cv.width = viewport.width;
        cv.height = viewport.height;
        const ctx = cv.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport, canvas: cv }).promise;
        pages.push(cv);
      }
      setPageImages(pages);
      setPageIdx(0);
      setAnnByPage({});
      setFileName(file.name);
    } catch (err) {
      console.error('PdfMarkup: failed to load PDF', err);
      setError("Couldn't read that file as a PDF — try a different file.");
    } finally {
      setLoading(false);
    }
  }

  const annotations = useMemo(() => annByPage[pageIdx] ?? EMPTY_ANNOTATIONS, [annByPage, pageIdx]);
  function setAnnotations(next: Annotation[] | ((prev: Annotation[]) => Annotation[])) {
    setAnnByPage((prev) => ({
      ...prev,
      [pageIdx]: typeof next === 'function' ? (next as (p: Annotation[]) => Annotation[])(prev[pageIdx] ?? []) : next,
    }));
  }

  // Redraw current page's base render + its annotations whenever any of them change.
  useEffect(() => {
    const canvas = canvasRef.current;
    const base = pageImages[pageIdx];
    if (!canvas || !base) return;
    canvas.width = base.width;
    canvas.height = base.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    const all = draft ? [...annotations, draft] : annotations;
    for (const a of all) drawAnnotation(ctx, a);
  }, [pageImages, pageIdx, annotations, draft]);

  function toCanvasCoords(e: RPointerEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / (rect.width || 1);
    const scaleY = canvas.height / (rect.height || 1);
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  }

  function handlePointerDown(e: RPointerEvent<HTMLCanvasElement>) {
    if (!pageImages[pageIdx]) return;
    const [x, y] = toCanvasCoords(e);
    if (tool === 'text') {
      const text = window.prompt('Annotation text:');
      if (text && text.trim()) setAnnotations((prev) => [...prev, { id: genId(), kind: 'text', x, y, text, color, size: 12 + strokeWidth * 2 }]);
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* unsupported — safe to ignore */
    }
    if (tool === 'arrow') setDraft({ id: genId(), kind: 'arrow', x1: x, y1: y, x2: x, y2: y, color, width: strokeWidth });
    else if (tool === 'rect') setDraft({ id: genId(), kind: 'rect', x, y, w: 0, h: 0, color, width: strokeWidth });
    else if (tool === 'ellipse') setDraft({ id: genId(), kind: 'ellipse', x, y, w: 0, h: 0, color, width: strokeWidth });
    else if (tool === 'pen') setDraft({ id: genId(), kind: 'pen', points: [[x, y]], color, width: strokeWidth });
  }
  function handlePointerMove(e: RPointerEvent<HTMLCanvasElement>) {
    if (!draft) return;
    const [x, y] = toCanvasCoords(e);
    setDraft((prev) => {
      if (!prev) return prev;
      if (prev.kind === 'arrow') return { ...prev, x2: x, y2: y };
      if (prev.kind === 'rect' || prev.kind === 'ellipse') return { ...prev, w: x - prev.x, h: y - prev.y };
      if (prev.kind === 'pen') return { ...prev, points: [...prev.points, [x, y] as Point] };
      return prev;
    });
  }
  function handlePointerUp(e: RPointerEvent<HTMLCanvasElement>) {
    if (draft) {
      setAnnotations((prev) => [...prev, draft]);
      setDraft(null);
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture never set — safe to ignore */
    }
  }

  async function exportPdf() {
    if (pageImages.length === 0) return;
    setExporting(true);
    try {
      const out = await PDFDocument.create();
      for (let i = 0; i < pageImages.length; i++) {
        const base = pageImages[i];
        const merged = document.createElement('canvas');
        merged.width = base.width;
        merged.height = base.height;
        const ctx = merged.getContext('2d')!;
        ctx.drawImage(base, 0, 0);
        for (const a of annByPage[i] ?? []) drawAnnotation(ctx, a);
        const png = merged.toDataURL('image/png');
        const bytes = await fetch(png).then((r) => r.arrayBuffer());
        const img = await out.embedPng(bytes);
        const page = out.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      const bytes = await out.save();
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (fileName ? fileName.replace(/\.pdf$/i, '') : 'annotated') + '-marked-up.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      console.error('PdfMarkup: export failed', err);
      setError("Couldn't export the annotated PDF.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <ToolShell
      title="PDF MARKUP / ANNOTATOR"
      onExit={onExit}
      actions={
        <button className="wbtn" onClick={exportPdf} disabled={exporting || pageImages.length === 0}>
          {exporting ? 'EXPORTING…' : 'EXPORT ANNOTATED PDF'}
        </button>
      }
    >
      <div className="toolCol">
        <div className="toolRow">
          <label className="toolDrop">
            <input type="file" accept="application/pdf" onChange={(e) => onFile(e.target.files?.[0] ?? null)} style={{ display: 'none' }} />
            {fileName ? `LOADED: ${fileName} (click to replace)` : 'UPLOAD A PDF'}
          </label>
          {loading && <span className="toolHint">Rendering pages…</span>}
        </div>
        {error && (
          <div className="toolHint" style={{ color: 'var(--magenta)' }}>
            {error}
          </div>
        )}
        {pageImages.length > 0 && (
          <>
            <div className="toolRow">
              {(['arrow', 'rect', 'ellipse', 'pen', 'text'] as Tool[]).map((t) => (
                <button key={t} className={tool === t ? 'chip on' : 'chip'} onClick={() => setTool(t)}>
                  {t.toUpperCase()}
                </button>
              ))}
              <label className="toolField">
                COLOR
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              </label>
              <label className="toolField">
                WIDTH: {strokeWidth}
                <input type="range" min={1} max={12} value={strokeWidth} onChange={(e) => setStrokeWidth(+e.target.value)} />
              </label>
            </div>
            <div className="toolRow" style={{ alignItems: 'center' }}>
              <span className="chip small" onClick={() => setPageIdx((i) => Math.max(0, i - 1))}>
                <Icon name="chevronLeft" size={11} />
              </span>
              <span style={{ fontSize: 11, opacity: 0.7 }}>
                PAGE {pageIdx + 1} / {pageImages.length}
              </span>
              <span className="chip small" onClick={() => setPageIdx((i) => Math.min(pageImages.length - 1, i + 1))}>
                <Icon name="chevronRight" size={11} />
              </span>
              <button className="wbtn ghost" onClick={() => setAnnotations((prev) => prev.slice(0, -1))} disabled={annotations.length === 0}>
                UNDO
              </button>
              <button className="wbtn ghost" onClick={() => setAnnotations([])} disabled={annotations.length === 0}>
                CLEAR PAGE
              </button>
            </div>
            <div className="toolCanvasWrap" style={{ maxWidth: 700 }}>
              <canvas
                ref={canvasRef}
                style={{ width: '100%', height: 'auto', touchAction: 'none', cursor: 'crosshair' }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              />
            </div>
          </>
        )}
      </div>
    </ToolShell>
  );
}
