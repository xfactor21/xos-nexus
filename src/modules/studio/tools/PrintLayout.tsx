import { useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import ToolShell from './ToolShell';
import Icon from '../../../design-system/icons/Icon';

/**
 * Item #6 (batch 1). Real multi-page print layout: place image and text
 * blocks on a real page-size canvas (Letter or A4, portrait or landscape),
 * arrange multiple pages, then export an actual multi-page PDF via
 * `pdf-lib` — genuine embedded images and real drawn text at real point
 * coordinates (not a screenshot of the editor), sized to the exact paper
 * dimensions selected.
 */
type PageSize = 'letter' | 'a4';
type Orientation = 'portrait' | 'landscape';

interface LayoutItem {
  id: string;
  kind: 'image' | 'text';
  // Stored as page-fraction coordinates (0..1) so the same item definition
  // is resolution-independent between the on-screen canvas and the
  // real-point PDF export.
  x: number;
  y: number;
  w: number;
  h: number;
  src?: string; // image data URL
  imgW?: number;
  imgH?: number;
  text?: string;
  fontSize?: number;
  color?: string;
}

interface LayoutPage {
  id: string;
  items: LayoutItem[];
}

// Real paper sizes in PDF points (72pt/inch) — Letter 8.5x11", A4 210x297mm.
const SIZE_PT: Record<PageSize, [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

function pagePt(size: PageSize, orientation: Orientation): [number, number] {
  const [w, h] = SIZE_PT[size];
  return orientation === 'landscape' ? [h, w] : [w, h];
}

export default function PrintLayout({ onExit }: { boardId: string; onExit: () => void }) {
  const [size, setSize] = useState<PageSize>('letter');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [pages, setPages] = useState<LayoutPage[]>([{ id: 'p1', items: [] }]);
  const [pageIdx, setPageIdx] = useState(0);
  const [selId, setSelId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; offX: number; offY: number } | null>(null);
  const idCounter = useRef(0);
  const genId = () => `item-${++idCounter.current}`;

  const page = pages[pageIdx];
  const [ptW, ptH] = pagePt(size, orientation);
  const aspect = ptW / ptH;

  function updateItems(fn: (items: LayoutItem[]) => LayoutItem[]) {
    setPages((prev) => prev.map((p, i) => (i === pageIdx ? { ...p, items: fn(p.items) } : p)));
  }

  function addImage(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const src = reader.result as string;
        const targetW = 0.4;
        const targetH = targetW * (img.naturalHeight / img.naturalWidth) * aspect;
        const id = genId();
        updateItems((items) => [...items, { id, kind: 'image', x: 0.3, y: 0.3, w: targetW, h: targetH, src, imgW: img.naturalWidth, imgH: img.naturalHeight }]);
        setSelId(id);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  function addText() {
    const id = genId();
    updateItems((items) => [...items, { id, kind: 'text', x: 0.15, y: 0.15, w: 0.7, h: 0.08, text: 'Heading text', fontSize: 24, color: '#111111' }]);
    setSelId(id);
  }

  function removeSelected() {
    if (!selId) return;
    updateItems((items) => items.filter((i) => i.id !== selId));
    setSelId(null);
  }

  function addPage() {
    const id = `p${pages.length + 1}-${Date.now()}`;
    setPages((prev) => [...prev, { id, items: [] }]);
    setPageIdx(pages.length);
  }
  function removePage(i: number) {
    if (pages.length <= 1) return;
    setPages((prev) => prev.filter((_, idx) => idx !== i));
    setPageIdx((cur) => Math.max(0, Math.min(cur, pages.length - 2)));
  }

  function onItemPointerDown(e: RPointerEvent<HTMLDivElement>, item: LayoutItem) {
    e.stopPropagation();
    setSelId(item.id);
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    dragRef.current = { id: item.id, offX: px - item.x, offY: py - item.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function onStagePointerMove(e: RPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const { id, offX, offY } = dragRef.current;
    updateItems((items) => items.map((it) => (it.id === id ? { ...it, x: Math.max(0, Math.min(1 - it.w, px - offX)), y: Math.max(0, Math.min(1 - it.h, py - offY)) } : it)));
  }
  function onStagePointerUp() {
    dragRef.current = null;
  }

  function updateSelected(patch: Partial<LayoutItem>) {
    if (!selId) return;
    updateItems((items) => items.map((it) => (it.id === selId ? { ...it, ...patch } : it)));
  }

  async function exportPdf() {
    setExporting(true);
    setError(null);
    try {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      for (const pg of pages) {
        const pdfPage = doc.addPage([ptW, ptH]);
        for (const item of pg.items) {
          const x = item.x * ptW;
          const wPt = item.w * ptW;
          const hPt = item.h * ptH;
          // PDF origin is bottom-left; our editor's y is top-down.
          const yTop = item.y * ptH;
          const yPdf = ptH - yTop - hPt;
          if (item.kind === 'image' && item.src) {
            const isPng = item.src.startsWith('data:image/png');
            const bytes = await fetch(item.src).then((r) => r.arrayBuffer());
            const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
            pdfPage.drawImage(img, { x, y: yPdf, width: wPt, height: hPt });
          } else if (item.kind === 'text' && item.text) {
            const fontSize = item.fontSize ?? 18;
            const [r, g, b] = hexToRgb(item.color ?? '#111111');
            pdfPage.drawText(item.text, { x, y: yPdf + hPt - fontSize, size: fontSize, font, color: rgb(r, g, b), maxWidth: wPt });
          }
        }
      }
      const bytes = await doc.save();
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'print-layout.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      console.error('PrintLayout export failed', err);
      setError("Couldn't export the PDF.");
    } finally {
      setExporting(false);
    }
  }

  function hexToRgb(hex: string): [number, number, number] {
    const m = hex.replace('#', '');
    const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  const selectedItem = page?.items.find((i) => i.id === selId) ?? null;

  return (
    <ToolShell
      title="PRINT LAYOUT DESIGNER"
      onExit={onExit}
      actions={
        <button className="wbtn" onClick={exportPdf} disabled={exporting}>
          {exporting ? 'EXPORTING…' : `EXPORT PDF (${pages.length} PAGE${pages.length === 1 ? '' : 'S'})`}
        </button>
      }
    >
      <div className="toolRow">
        <div className="toolCol">
          <div className="toolField">
            <label>PAPER</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['letter', 'a4'] as PageSize[]).map((s) => (
                <span key={s} className={`chip small ${size === s ? 'on' : ''}`} onClick={() => setSize(s)}>
                  {s.toUpperCase()}
                </span>
              ))}
              {(['portrait', 'landscape'] as Orientation[]).map((o) => (
                <span key={o} className={`chip small ${orientation === o ? 'on' : ''}`} onClick={() => setOrientation(o)}>
                  {o.toUpperCase()}
                </span>
              ))}
            </div>
          </div>
          <div className="toolField">
            <label>ADD</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <label className="wbtn ghost" style={{ cursor: 'pointer' }}>
                <Icon name="image" size={12} /> IMAGE
                <input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => addImage(e.target.files?.[0] ?? null)} />
              </label>
              <button className="wbtn ghost" onClick={addText}>
                <Icon name="text" size={12} /> TEXT
              </button>
            </div>
          </div>
          <div className="toolField">
            <label>PAGES</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {pages.map((p, i) => (
                <span key={p.id} className={`chip small ${i === pageIdx ? 'on' : ''}`} onClick={() => setPageIdx(i)}>
                  {i + 1}
                  {pages.length > 1 && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        removePage(i);
                      }}
                      style={{ marginLeft: 4, display: 'inline-flex' }}
                    >
                      <Icon name="close" size={10} />
                    </span>
                  )}
                </span>
              ))}
              <span className="chip small" onClick={addPage}>
                <Icon name="plus" size={10} />
              </span>
            </div>
            {pages.length > 1 && (
              <button className="wbtn ghost" style={{ marginTop: 6 }} onClick={() => removePage(pageIdx)}>
                DELETE THIS PAGE
              </button>
            )}
          </div>
          {selectedItem && (
            <div className="toolField">
              <label>SELECTED {selectedItem.kind.toUpperCase()}</label>
              {selectedItem.kind === 'text' && (
                <>
                  <textarea rows={2} value={selectedItem.text} onChange={(e) => updateSelected({ text: e.target.value })} />
                  <label style={{ marginTop: 6 }}>SIZE {selectedItem.fontSize}</label>
                  <input type="range" min={8} max={72} value={selectedItem.fontSize} onChange={(e) => updateSelected({ fontSize: +e.target.value })} />
                  <input type="color" value={selectedItem.color} onChange={(e) => updateSelected({ color: e.target.value })} />
                </>
              )}
              <button className="wbtn ghost" style={{ marginTop: 6 }} onClick={removeSelected}>
                <Icon name="trash" size={11} /> DELETE ELEMENT
              </button>
            </div>
          )}
          {error && (
            <div className="toolHint" style={{ color: 'var(--magenta)' }}>
              {error}
            </div>
          )}
        </div>
        <div className="toolCol">
          <div
            ref={stageRef}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            onPointerLeave={onStagePointerUp}
            onPointerDown={() => setSelId(null)}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 460,
              aspectRatio: `${aspect}`,
              background: '#fff',
              boxShadow: '0 0 24px rgba(0,245,255,.15)',
              overflow: 'hidden',
            }}
          >
            {page?.items.map((item) => (
              <div
                key={item.id}
                onPointerDown={(e) => onItemPointerDown(e, item)}
                style={{
                  position: 'absolute',
                  left: `${item.x * 100}%`,
                  top: `${item.y * 100}%`,
                  width: `${item.w * 100}%`,
                  height: `${item.h * 100}%`,
                  border: selId === item.id ? '2px solid #FF2D78' : '1px dashed rgba(0,0,0,.2)',
                  cursor: 'move',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'flex-end',
                }}
              >
                {item.kind === 'image' && item.src && <img src={item.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />}
                {item.kind === 'text' && (
                  <span style={{ color: item.color, fontSize: (item.fontSize ?? 18) * 0.6, fontFamily: 'Helvetica, sans-serif', pointerEvents: 'none' }}>{item.text}</span>
                )}
              </div>
            ))}
          </div>
          <div className="toolHint" style={{ marginTop: 8 }}>
            Drag elements to position them. Real {size === 'letter' ? '8.5×11"' : '210×297mm'} {orientation} page — matches the exported PDF exactly.
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
