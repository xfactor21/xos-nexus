import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import Icon from '../../design-system/icons/Icon';

/**
 * PRESENTATION / SLIDE DECK — item #6 batch 2, tool 4 of 5. Multi-slide
 * editor with draggable/resizable text and image blocks (page-fraction
 * coordinates, same resolution-independent model PrintLayout.tsx uses),
 * per-slide background color, slide reorder/duplicate/delete, layout
 * templates that seed common block arrangements, a real fullscreen
 * Present mode (arrow-key/click navigation), and a real multi-page PDF
 * export via `pdf-lib` — genuine embedded images and real drawn text at
 * real point coordinates per slide, not a screenshot.
 *
 * Honest scope note: no speaker-notes pane, transitions, or animation
 * timing — this is static slide layout + real present/export, the same
 * kind of disclosed scope line drawn for every other tool in this batch.
 */

type BlockKind = 'text' | 'image';

interface SlideBlock {
  id: string;
  kind: BlockKind;
  x: number; // fraction 0..1
  y: number;
  w: number;
  h: number;
  text?: string;
  fontSize?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  src?: string;
}

interface Slide {
  id: string;
  bg: string;
  blocks: SlideBlock[];
}

const SLIDE_W = 960;
const SLIDE_H = 540; // 16:9

function storageKey(boardId: string) {
  return `xos-studio-presentation-${boardId}`;
}

let idCounter = 0;
const genId = (p: string) => `${p}-${++idCounter}-${Date.now().toString(36)}`;

function titleSlide(): Slide {
  return {
    id: genId('s'),
    bg: '#12121f',
    blocks: [
      { id: genId('b'), kind: 'text', x: 0.1, y: 0.38, w: 0.8, h: 0.16, text: 'Presentation Title', fontSize: 48, color: '#ffffff', align: 'center', bold: true },
      { id: genId('b'), kind: 'text', x: 0.1, y: 0.56, w: 0.8, h: 0.08, text: 'Subtitle or author', fontSize: 20, color: '#9a9ab0', align: 'center' },
    ],
  };
}

function titleBodySlide(): Slide {
  return {
    id: genId('s'),
    bg: '#12121f',
    blocks: [
      { id: genId('b'), kind: 'text', x: 0.08, y: 0.08, w: 0.84, h: 0.12, text: 'Slide Heading', fontSize: 32, color: '#ffffff', align: 'left', bold: true },
      { id: genId('b'), kind: 'text', x: 0.08, y: 0.26, w: 0.84, h: 0.6, text: 'Body text goes here.\nAdd points, one per line.', fontSize: 20, color: '#d0d0e0', align: 'left' },
    ],
  };
}

function twoColSlide(): Slide {
  return {
    id: genId('s'),
    bg: '#12121f',
    blocks: [
      { id: genId('b'), kind: 'text', x: 0.08, y: 0.08, w: 0.84, h: 0.12, text: 'Slide Heading', fontSize: 32, color: '#ffffff', align: 'left', bold: true },
      { id: genId('b'), kind: 'text', x: 0.08, y: 0.26, w: 0.4, h: 0.6, text: 'Left column', fontSize: 18, color: '#d0d0e0', align: 'left' },
      { id: genId('b'), kind: 'text', x: 0.52, y: 0.26, w: 0.4, h: 0.6, text: 'Right column', fontSize: 18, color: '#d0d0e0', align: 'left' },
    ],
  };
}

function imageCaptionSlide(): Slide {
  return {
    id: genId('s'),
    bg: '#12121f',
    blocks: [{ id: genId('b'), kind: 'text', x: 0.15, y: 0.85, w: 0.7, h: 0.1, text: 'Image caption', fontSize: 16, color: '#9a9ab0', align: 'center' }],
  };
}

function blankSlide(): Slide {
  return { id: genId('s'), bg: '#12121f', blocks: [] };
}

const TEMPLATES: { key: string; label: string; make: () => Slide }[] = [
  { key: 'title', label: 'Title', make: titleSlide },
  { key: 'titleBody', label: 'Title + Body', make: titleBodySlide },
  { key: 'twoCol', label: 'Two Column', make: twoColSlide },
  { key: 'imageCaption', label: 'Image + Caption', make: imageCaptionSlide },
  { key: 'blank', label: 'Blank', make: blankSlide },
];

function loadDeck(boardId: string): Slide[] {
  try {
    const raw = localStorage.getItem(storageKey(boardId));
    if (raw) return JSON.parse(raw) as Slide[];
  } catch {
    /* corrupt storage */
  }
  return [titleSlide()];
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export default function PresentationEditor({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const [slides, setSlides] = useState<Slide[]>(() => loadDeck(boardId));
  const [slideIdx, setSlideIdx] = useState(0);
  const [selId, setSelId] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initDone = useRef(false);
  const dragRef = useRef<{ id: string; offX: number; offY: number } | null>(null);
  const resizeRef = useRef<{ id: string } | null>(null);

  useEffect(() => {
    initDone.current = true;
  }, []);
  useEffect(() => {
    if (!initDone.current) return;
    const t = setTimeout(() => localStorage.setItem(storageKey(boardId), JSON.stringify(slides)), 300);
    return () => clearTimeout(t);
  }, [slides, boardId]);

  const slide = slides[slideIdx] ?? slides[0];

  function updateSlide(idx: number, patch: Partial<Slide>) {
    setSlides((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }
  function updateBlocks(fn: (blocks: SlideBlock[]) => SlideBlock[]) {
    setSlides((prev) => prev.map((s, i) => (i === slideIdx ? { ...s, blocks: fn(s.blocks) } : s)));
  }
  function updateSelected(patch: Partial<SlideBlock>) {
    if (!selId) return;
    updateBlocks((blocks) => blocks.map((b) => (b.id === selId ? { ...b, ...patch } : b)));
  }

  function addSlide(templateKey: string) {
    const tmpl = TEMPLATES.find((t) => t.key === templateKey) ?? TEMPLATES[TEMPLATES.length - 1];
    const s = tmpl.make();
    setSlides((prev) => {
      const next = [...prev];
      next.splice(slideIdx + 1, 0, s);
      return next;
    });
    setSlideIdx(slideIdx + 1);
  }
  function duplicateSlide() {
    const copy: Slide = { ...slide, id: genId('s'), blocks: slide.blocks.map((b) => ({ ...b, id: genId('b') })) };
    setSlides((prev) => {
      const next = [...prev];
      next.splice(slideIdx + 1, 0, copy);
      return next;
    });
    setSlideIdx(slideIdx + 1);
  }
  function deleteSlide(i: number) {
    if (slides.length <= 1) return;
    setSlides((prev) => prev.filter((_, idx) => idx !== i));
    setSlideIdx((cur) => Math.max(0, Math.min(cur, slides.length - 2)));
  }
  function moveSlide(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= slides.length) return;
    setSlides((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setSlideIdx(j);
  }

  function addTextBlock() {
    const id = genId('b');
    updateBlocks((blocks) => [...blocks, { id, kind: 'text', x: 0.15, y: 0.15, w: 0.7, h: 0.1, text: 'New text', fontSize: 22, color: '#ffffff', align: 'left' }]);
    setSelId(id);
  }
  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const id = genId('b');
      updateBlocks((blocks) => [...blocks, { id, kind: 'image', x: 0.25, y: 0.25, w: 0.5, h: 0.5, src }]);
      setSelId(id);
    };
    reader.readAsDataURL(file);
  }
  function removeSelected() {
    if (!selId) return;
    updateBlocks((blocks) => blocks.filter((b) => b.id !== selId));
    setSelId(null);
  }

  function onBlockPointerDown(e: RPointerEvent<HTMLDivElement>, b: SlideBlock) {
    e.stopPropagation();
    setSelId(b.id);
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    dragRef.current = { id: b.id, offX: px - b.x, offY: py - b.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function onResizePointerDown(e: RPointerEvent<HTMLDivElement>, b: SlideBlock) {
    e.stopPropagation();
    setSelId(b.id);
    resizeRef.current = { id: b.id };
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function onStagePointerMove(e: RPointerEvent<HTMLDivElement>) {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    if (dragRef.current) {
      const { id, offX, offY } = dragRef.current;
      updateBlocks((blocks) => blocks.map((b) => (b.id === id ? { ...b, x: Math.max(0, Math.min(1 - b.w, px - offX)), y: Math.max(0, Math.min(1 - b.h, py - offY)) } : b)));
    } else if (resizeRef.current) {
      const { id } = resizeRef.current;
      updateBlocks((blocks) => blocks.map((b) => (b.id === id ? { ...b, w: Math.max(0.05, px - b.x), h: Math.max(0.05, py - b.y) } : b)));
    }
  }
  function onStagePointerUp() {
    dragRef.current = null;
    resizeRef.current = null;
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (presenting) {
        if (e.key === 'ArrowRight' || e.key === ' ') setSlideIdx((i) => Math.min(slides.length - 1, i + 1));
        if (e.key === 'ArrowLeft') setSlideIdx((i) => Math.max(0, i - 1));
        if (e.key === 'Escape') setPresenting(false);
        return;
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && selId) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        removeSelected();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function exportPdf() {
    setExporting(true);
    try {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
      for (const s of slides) {
        const pdfPage = doc.addPage([SLIDE_W, SLIDE_H]);
        const [br, bg, bb] = hexToRgb(s.bg);
        pdfPage.drawRectangle({ x: 0, y: 0, width: SLIDE_W, height: SLIDE_H, color: rgb(br, bg, bb) });
        for (const b of s.blocks) {
          const x = b.x * SLIDE_W;
          const wPt = b.w * SLIDE_W;
          const hPt = b.h * SLIDE_H;
          const yTop = b.y * SLIDE_H;
          const yPdf = SLIDE_H - yTop - hPt;
          if (b.kind === 'image' && b.src) {
            const isPng = b.src.startsWith('data:image/png');
            const bytes = await fetch(b.src).then((r) => r.arrayBuffer());
            const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
            pdfPage.drawImage(img, { x, y: yPdf, width: wPt, height: hPt });
          } else if (b.kind === 'text' && b.text) {
            const fontSize = b.fontSize ?? 20;
            const [r, g, bl] = hexToRgb(b.color ?? '#ffffff');
            const useFont = b.bold ? boldFont : font;
            const lines = b.text.split('\n');
            lines.forEach((line, li) => {
              let lineX = x;
              if (b.align === 'center') {
                const lw = useFont.widthOfTextAtSize(line, fontSize);
                lineX = x + (wPt - lw) / 2;
              } else if (b.align === 'right') {
                const lw = useFont.widthOfTextAtSize(line, fontSize);
                lineX = x + wPt - lw;
              }
              pdfPage.drawText(line, { x: lineX, y: yPdf + hPt - fontSize - li * (fontSize * 1.3), size: fontSize, font: useFont, color: rgb(r, g, bl), maxWidth: wPt });
            });
          }
        }
      }
      const bytes = await doc.save();
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'presentation.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      console.error('Presentation export failed', err);
    } finally {
      setExporting(false);
    }
  }

  const selectedBlock = slide?.blocks.find((b) => b.id === selId) ?? null;

  if (presenting) {
    return (
      <div
        style={{ position: 'fixed', inset: 0, background: slide.bg, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={() => setSlideIdx((i) => Math.min(slides.length - 1, i + 1))}
      >
        <div style={{ position: 'relative', width: '90vw', maxWidth: SLIDE_W * 1.4, aspectRatio: `${SLIDE_W} / ${SLIDE_H}`, background: slide.bg }}>
          {slide.blocks.map((b) => (
            <div
              key={b.id}
              style={{
                position: 'absolute',
                left: `${b.x * 100}%`,
                top: `${b.y * 100}%`,
                width: `${b.w * 100}%`,
                height: `${b.h * 100}%`,
              }}
            >
              <PresentBlock b={b} />
            </div>
          ))}
        </div>
        <button
          className="toolBtn"
          onClick={(e) => {
            e.stopPropagation();
            setPresenting(false);
          }}
          style={{ position: 'absolute', top: 16, right: 16 }}
        >
          <Icon name="close" size={16} /> Exit
        </button>
        <div style={{ position: 'absolute', bottom: 16, color: '#888', fontSize: 12 }}>
          {slideIdx + 1} / {slides.length} — arrows or click to advance, Esc to exit
        </div>
      </div>
    );
  }

  return (
    <div className="toolShell">
      <div className="toolShellBar">
        <button className="toolBtn" onClick={onExit}>
          <Icon name="chevronLeft" size={16} /> Boards
        </button>
        <div className="toolRow" style={{ gap: 8 }}>
          <select onChange={(e) => e.target.value && addSlide(e.target.value)} value="">
            <option value="" disabled>
              + Add Slide
            </option>
            {TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <button className="toolBtn" onClick={duplicateSlide}>
            Duplicate
          </button>
          <button className="toolBtn" onClick={() => deleteSlide(slideIdx)} disabled={slides.length <= 1}>
            <Icon name="trash" size={16} /> Delete Slide
          </button>
        </div>
        <div className="toolRow" style={{ gap: 8, marginLeft: 'auto' }}>
          <button className="toolBtn" onClick={addTextBlock}>
            <Icon name="text" size={16} /> Add Text
          </button>
          <button className="toolBtn" onClick={() => fileInputRef.current?.click()}>
            <Icon name="image" size={16} /> Add Image
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onFilePicked} />
          <button className="toolBtn" onClick={() => setPresenting(true)}>
            Present
          </button>
          <button className="toolBtn" onClick={exportPdf} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export PDF'}
          </button>
        </div>
      </div>
      <div className="toolShellBody" style={{ display: 'flex', gap: 16 }}>
        <div className="toolCol" style={{ width: 160, gap: 8, overflowY: 'auto' }}>
          {slides.map((s, i) => (
            <div
              key={s.id}
              onClick={() => setSlideIdx(i)}
              style={{
                border: i === slideIdx ? '2px solid #00F5FF' : '1px solid rgba(255,255,255,0.15)',
                borderRadius: 6,
                background: s.bg,
                aspectRatio: `${SLIDE_W} / ${SLIDE_H}`,
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{ position: 'absolute', top: 2, left: 4, fontSize: 10, color: '#999' }}>{i + 1}</div>
              {s.blocks.map((b) => (
                <div
                  key={b.id}
                  style={{
                    position: 'absolute',
                    left: `${b.x * 100}%`,
                    top: `${b.y * 100}%`,
                    width: `${b.w * 100}%`,
                    height: `${b.h * 100}%`,
                    background: b.kind === 'image' ? '#555' : 'transparent',
                    fontSize: 4,
                    color: b.color,
                    overflow: 'hidden',
                  }}
                >
                  {b.kind === 'text' ? b.text : ''}
                </div>
              ))}
              <div className="toolRow" style={{ position: 'absolute', bottom: 2, right: 2, gap: 2 }} onClick={(e) => e.stopPropagation()}>
                <button onClick={() => moveSlide(i, -1)} style={{ fontSize: 9, padding: '1px 3px' }}>
                  ↑
                </button>
                <button onClick={() => moveSlide(i, 1)} style={{ fontSize: 9, padding: '1px 3px' }}>
                  ↓
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="toolCanvasWrap" style={{ display: 'inline-block' }}>
          <div
            ref={stageRef}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            onPointerDown={() => setSelId(null)}
            style={{ position: 'relative', width: SLIDE_W, height: SLIDE_H, background: slide.bg, overflow: 'hidden', borderRadius: 8, userSelect: 'none' }}
          >
            {slide.blocks.map((b) => (
              <div
                key={b.id}
                onPointerDown={(e) => onBlockPointerDown(e, b)}
                style={{
                  position: 'absolute',
                  left: `${b.x * 100}%`,
                  top: `${b.y * 100}%`,
                  width: `${b.w * 100}%`,
                  height: `${b.h * 100}%`,
                  outline: selId === b.id ? '2px solid #00F5FF' : 'none',
                  cursor: 'move',
                }}
              >
                <PresentBlock b={b} />
                {selId === b.id && (
                  <div
                    onPointerDown={(e) => onResizePointerDown(e, b)}
                    style={{ position: 'absolute', right: -6, bottom: -6, width: 14, height: 14, background: '#00F5FF', borderRadius: 3, cursor: 'nwse-resize' }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="toolCol" style={{ width: 200, gap: 8 }}>
          <div className="toolField">
            <label className="toolHint">Slide background</label>
            <input type="color" value={slide.bg} onChange={(e) => updateSlide(slideIdx, { bg: e.target.value })} />
          </div>
          {selectedBlock && selectedBlock.kind === 'text' && (
            <div className="toolField">
              <div className="toolHint">Text block</div>
              <textarea value={selectedBlock.text ?? ''} onChange={(e) => updateSelected({ text: e.target.value })} rows={4} style={{ width: '100%' }} />
              <div className="toolRow" style={{ gap: 6, marginTop: 6 }}>
                <label className="toolHint">
                  Size <input type="number" value={selectedBlock.fontSize ?? 20} onChange={(e) => updateSelected({ fontSize: Number(e.target.value) })} style={{ width: 50 }} />
                </label>
                <label className="toolHint">
                  Color <input type="color" value={selectedBlock.color ?? '#ffffff'} onChange={(e) => updateSelected({ color: e.target.value })} />
                </label>
              </div>
              <div className="toolRow" style={{ gap: 6, marginTop: 6 }}>
                {(['left', 'center', 'right'] as const).map((a) => (
                  <button key={a} className="toolBtn" onClick={() => updateSelected({ align: a })} style={{ opacity: selectedBlock.align === a ? 1 : 0.5 }}>
                    {a}
                  </button>
                ))}
                <button className="toolBtn" onClick={() => updateSelected({ bold: !selectedBlock.bold })} style={{ opacity: selectedBlock.bold ? 1 : 0.5 }}>
                  B
                </button>
              </div>
            </div>
          )}
          {selectedBlock && (
            <button className="toolBtn" onClick={removeSelected}>
              <Icon name="trash" size={16} /> Delete Block
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PresentBlock({ b }: { b: SlideBlock }) {
  if (b.kind === 'image' && b.src) {
    return <img src={b.src} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />;
  }
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        fontSize: b.fontSize ?? 20,
        color: b.color ?? '#ffffff',
        textAlign: b.align ?? 'left',
        fontWeight: b.bold ? 700 : 400,
        whiteSpace: 'pre-wrap',
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {b.text}
    </div>
  );
}
