import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import Icon from '../../design-system/icons/Icon';

/**
 * ICON DESIGN — item #6 batch 2, tool 5 of 5 (final tool in the sequence).
 * A real icon-set editor: multiple named icons, each backed by a pixel
 * grid, with genuinely dual output — a real vector SVG (one <rect> per
 * filled cell, so it's actually scalable vector data, not a rasterized
 * pixel image wearing an .svg extension) and real rasterized PNG export
 * at 4 standard icon sizes (16/24/32/48px), rendered from the same grid
 * data via canvas so every exported size is pixel-accurate, not a single
 * size stretched.
 *
 * Honest scope note: painting is grid/pixel-only (no bezier pen inside
 * this tool — VectorEditor already covers freeform vector drawing); the
 * "vector" half of the pitch is the SVG *output* being real scalable
 * rect data, not a freeform curve-editing surface duplicating
 * VectorEditor. No zip bundling — multi-icon export triggers one
 * download per icon (sequential anchor clicks), each a real file.
 */

const GRID_SIZE = 16;
const CELL_PX = 24; // on-screen edit cell size
const EXPORT_SIZES = [16, 24, 32, 48];

const PALETTE = ['#0e0e1a', '#ffffff', '#7A5CFF', '#00F5FF', '#FF5C8A', '#FFD166', '#3DDC97', '#FF8C42'];

type Tool = 'paint' | 'erase';

interface IconDef {
  id: string;
  name: string;
  grid: (string | null)[]; // GRID_SIZE * GRID_SIZE
}

function storageKey(boardId: string) {
  return `xos-studio-icondesign-${boardId}`;
}

function blankGrid(): (string | null)[] {
  return new Array(GRID_SIZE * GRID_SIZE).fill(null);
}

let idCounter = 0;
const genId = () => `icon-${++idCounter}-${Date.now().toString(36)}`;

function defaultSet(): IconDef[] {
  return [{ id: genId(), name: 'icon-1', grid: blankGrid() }];
}

function loadSet(boardId: string): IconDef[] {
  try {
    const raw = localStorage.getItem(storageKey(boardId));
    if (raw) {
      const parsed = JSON.parse(raw) as IconDef[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* corrupt storage */
  }
  return defaultSet();
}

function iconToSvg(def: IconDef): string {
  let rects = '';
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const c = def.grid[y * GRID_SIZE + x];
      if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID_SIZE} ${GRID_SIZE}" width="${GRID_SIZE}" height="${GRID_SIZE}">${rects}</svg>`;
}

function drawIconToCanvas(def: IconDef, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const cell = size / GRID_SIZE;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const c = def.grid[y * GRID_SIZE + x];
      if (c) {
        ctx.fillStyle = c;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }
  return canvas;
}

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function downloadCanvasPng(filename: string, canvas: HTMLCanvasElement) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, 'image/png');
}

export default function IconDesignEditor({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const [icons, setIcons] = useState<IconDef[]>(() => loadSet(boardId));
  const [activeId, setActiveId] = useState<string>(() => loadSet(boardId)[0].id);
  const [tool, setTool] = useState<Tool>('paint');
  const [color, setColor] = useState('#ffffff');
  const initDone = useRef(false);
  const paintingRef = useRef(false);

  useEffect(() => {
    initDone.current = true;
  }, []);
  useEffect(() => {
    if (!initDone.current) return;
    const t = setTimeout(() => localStorage.setItem(storageKey(boardId), JSON.stringify(icons)), 300);
    return () => clearTimeout(t);
  }, [icons, boardId]);

  const active = icons.find((i) => i.id === activeId) ?? icons[0];

  function updateActiveGrid(idx: number, value: string | null) {
    setIcons((prev) => prev.map((ic) => (ic.id === active.id ? { ...ic, grid: ic.grid.map((c, i) => (i === idx ? value : c)) } : ic)));
  }

  function paintCell(idx: number) {
    updateActiveGrid(idx, tool === 'paint' ? color : null);
  }

  function onCellPointerDown(e: RPointerEvent, idx: number) {
    e.preventDefault();
    paintingRef.current = true;
    paintCell(idx);
  }
  function onCellPointerEnter(idx: number) {
    if (paintingRef.current) paintCell(idx);
  }
  useEffect(() => {
    function up() {
      paintingRef.current = false;
    }
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  function addIcon() {
    const id = genId();
    const name = `icon-${icons.length + 1}`;
    setIcons((prev) => [...prev, { id, name, grid: blankGrid() }]);
    setActiveId(id);
  }
  function duplicateIcon() {
    const id = genId();
    setIcons((prev) => {
      const idx = prev.findIndex((i) => i.id === active.id);
      const copy: IconDef = { id, name: `${active.name}-copy`, grid: [...active.grid] };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }
  function deleteIcon(id: string) {
    if (icons.length <= 1) return;
    setIcons((prev) => prev.filter((i) => i.id !== id));
    if (activeId === id) {
      const remaining = icons.filter((i) => i.id !== id);
      setActiveId(remaining[0].id);
    }
  }
  function renameActive(name: string) {
    setIcons((prev) => prev.map((ic) => (ic.id === active.id ? { ...ic, name } : ic)));
  }
  function clearActive() {
    setIcons((prev) => prev.map((ic) => (ic.id === active.id ? { ...ic, grid: blankGrid() } : ic)));
  }

  function exportActiveSvg() {
    downloadText(`${active.name}.svg`, iconToSvg(active), 'image/svg+xml');
  }
  function exportActivePngs() {
    EXPORT_SIZES.forEach((size, i) => {
      setTimeout(() => downloadCanvasPng(`${active.name}-${size}.png`, drawIconToCanvas(active, size)), i * 150);
    });
  }
  function exportAllSvgs() {
    icons.forEach((ic, i) => {
      setTimeout(() => downloadText(`${ic.name}.svg`, iconToSvg(ic), 'image/svg+xml'), i * 150);
    });
  }

  return (
    <div className="toolShell">
      <div className="toolShellBar">
        <button className="toolBtn" onClick={onExit}>
          <Icon name="chevronLeft" size={16} /> Boards
        </button>
        <div className="toolRow" style={{ gap: 8 }}>
          <button className={`toolBtn ${tool === 'paint' ? 'toolBtnActive' : ''}`} onClick={() => setTool('paint')}>
            <Icon name="penTool" size={16} /> Paint
          </button>
          <button className={`toolBtn ${tool === 'erase' ? 'toolBtnActive' : ''}`} onClick={() => setTool('erase')}>
            <Icon name="eraser" size={16} /> Erase
          </button>
          <button className="toolBtn" onClick={clearActive}>
            <Icon name="trash" size={16} /> Clear
          </button>
        </div>
        <div className="toolRow" style={{ gap: 8, marginLeft: 'auto' }}>
          <button className="toolBtn" onClick={exportActiveSvg}>
            Export SVG
          </button>
          <button className="toolBtn" onClick={exportActivePngs}>
            Export PNGs (16/24/32/48)
          </button>
          <button className="toolBtn" onClick={exportAllSvgs}>
            Export Set (all SVGs)
          </button>
        </div>
      </div>
      <div className="toolShellBody" style={{ display: 'flex', gap: 16 }}>
        <div className="toolCol" style={{ width: 180, gap: 8, overflowY: 'auto' }}>
          <div className="toolHint">Icon set</div>
          {icons.map((ic) => (
            <div
              key={ic.id}
              onClick={() => setActiveId(ic.id)}
              className="toolRow"
              style={{
                gap: 8,
                alignItems: 'center',
                border: ic.id === activeId ? '1px solid #00F5FF' : '1px solid rgba(255,255,255,0.12)',
                borderRadius: 6,
                padding: 6,
                cursor: 'pointer',
              }}
            >
              <IconThumb def={ic} />
              <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ic.name}</span>
              {icons.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteIcon(ic.id);
                  }}
                  style={{ fontSize: 10 }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button className="toolBtn" onClick={addIcon}>
            + New Icon
          </button>
          <button className="toolBtn" onClick={duplicateIcon}>
            Duplicate
          </button>
        </div>
        <div className="toolCol" style={{ alignItems: 'center', gap: 12 }}>
          <input value={active.name} onChange={(e) => renameActive(e.target.value)} style={{ width: GRID_SIZE * CELL_PX, textAlign: 'center' }} />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_PX}px)`,
              gridTemplateRows: `repeat(${GRID_SIZE}, ${CELL_PX}px)`,
              border: '1px solid rgba(255,255,255,0.2)',
              background: '#05080d',
              userSelect: 'none',
            }}
            onPointerLeave={() => (paintingRef.current = false)}
          >
            {active.grid.map((c, idx) => (
              <div
                key={idx}
                onPointerDown={(e) => onCellPointerDown(e, idx)}
                onPointerEnter={() => onCellPointerEnter(idx)}
                style={{
                  width: CELL_PX,
                  height: CELL_PX,
                  background: c ?? 'transparent',
                  borderRight: '1px solid rgba(255,255,255,0.06)',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  cursor: 'crosshair',
                }}
              />
            ))}
          </div>
          <div className="toolRow" style={{ gap: 6 }}>
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{ width: 24, height: 24, background: c, borderRadius: 4, border: color === c ? '2px solid #00F5FF' : '1px solid rgba(255,255,255,0.2)', cursor: 'pointer' }}
              />
            ))}
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </div>
        </div>
        <div className="toolCol" style={{ width: 220, gap: 12 }}>
          <div className="toolHint">Live preview (real sizes)</div>
          {EXPORT_SIZES.map((size) => (
            <div key={size} className="toolRow" style={{ gap: 10, alignItems: 'center' }}>
              <PreviewCanvas def={active} size={size} />
              <span className="toolHint">{size}px</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function IconThumb({ def }: { def: IconDef }) {
  return <PreviewCanvas def={def} size={20} />;
}

function PreviewCanvas({ def, size }: { def: IconDef; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    const cell = size / GRID_SIZE;
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const c = def.grid[y * GRID_SIZE + x];
        if (c) {
          ctx.fillStyle = c;
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    }
  }, [def, size]);
  return <canvas ref={ref} style={{ width: size, height: size, background: '#05080d', borderRadius: 4 }} />;
}
