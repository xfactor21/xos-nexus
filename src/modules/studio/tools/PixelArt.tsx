import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import ToolShell from './ToolShell';
import { askConfirm } from '../../../stores/confirmStore';

type Tool = 'paint' | 'eraser';

interface PixelState {
  gridSize: number;
  grid: (string | null)[];
}

const DEFAULT_SIZE = 24;
const DEFAULT_CELL_PX = 16;
const EXPORT_SCALE = 16;
const GRID_SIZE_OPTIONS = [16, 24, 32];

// A small retro/console-inspired palette.
const PALETTE: string[] = [
  '#000000',
  '#1d2b53',
  '#7e2553',
  '#008751',
  '#ab5236',
  '#5f574f',
  '#c2c3c7',
  '#fff1e8',
  '#ff004d',
  '#29adff',
];

function storageKey(boardId: string): string {
  return `xos-studio-pixelart-${boardId}`;
}

function blankGrid(size: number): (string | null)[] {
  return new Array(size * size).fill(null);
}

function loadInitial(boardId: string): PixelState {
  try {
    const raw = localStorage.getItem(storageKey(boardId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PixelState>;
      const size = parsed.gridSize;
      const g = parsed.grid;
      if (
        typeof size === 'number' &&
        Array.isArray(g) &&
        g.length === size * size &&
        g.every((c) => c === null || typeof c === 'string')
      ) {
        return { gridSize: size, grid: g as (string | null)[] };
      }
    }
  } catch {
    // fall through to blank grid
  }
  return { gridSize: DEFAULT_SIZE, grid: blankGrid(DEFAULT_SIZE) };
}

export default function PixelArt({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const [state, setState] = useState<PixelState>(() => loadInitial(boardId));
  const [cellPx, setCellPx] = useState<number>(DEFAULT_CELL_PX);
  const [tool, setTool] = useState<Tool>('paint');
  const [currentColor, setCurrentColor] = useState<string>(PALETTE[0]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  const { gridSize, grid } = state;

  // Redraw the editing canvas whenever the grid, size, or zoom changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = gridSize * cellPx;
    canvas.height = gridSize * cellPx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const color = grid[y * gridSize + x];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
        }
      }
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridSize; i++) {
      const p = i * cellPx + 0.5;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, gridSize * cellPx);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(gridSize * cellPx, p);
      ctx.stroke();
    }
  }, [grid, gridSize, cellPx]);

  // Debounced persistence so a paint drag doesn't spam localStorage writes.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(storageKey(boardId), JSON.stringify(state));
      } catch {
        // ignore storage failures (quota, privacy mode, etc.)
      }
    }, 400);
    return () => clearTimeout(t);
  }, [state, boardId]);

  const paintAt = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.floor(((clientX - rect.left) * scaleX) / cellPx);
      const y = Math.floor(((clientY - rect.top) * scaleY) / cellPx);
      if (x < 0 || y < 0 || x >= gridSize || y >= gridSize) return;
      const idx = y * gridSize + x;
      const value = tool === 'eraser' ? null : currentColor;
      setState((s) => {
        if (s.grid[idx] === value) return s;
        const next = s.grid.slice();
        next[idx] = value;
        return { ...s, grid: next };
      });
    },
    [cellPx, gridSize, tool, currentColor]
  );

  const handlePointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    isDrawing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    paintAt(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    paintAt(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    isDrawing.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleGridSizeChange = async (size: number) => {
    if (size === gridSize) return;
    const hasContent = grid.some((c) => c !== null);
    if (hasContent && !(await askConfirm('Changing grid size will clear the current canvas. Continue?', { tone: 'danger', confirmLabel: 'CONTINUE' }))) {
      return;
    }
    // A resize can't cleanly preserve pixel positions across different grid
    // dimensions, so this tool intentionally resets to a blank grid.
    setState({ gridSize: size, grid: blankGrid(size) });
  };

  const handleClear = async () => {
    if (!grid.some((c) => c !== null)) return;
    if (!(await askConfirm('Clear the entire canvas?', { tone: 'danger', confirmLabel: 'CLEAR' }))) return;
    setState((s) => ({ ...s, grid: blankGrid(s.gridSize) }));
  };

  const handleExport = () => {
    const size = gridSize * EXPORT_SCALE;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = size;
    exportCanvas.height = size;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const color = grid[y * gridSize + x];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(x * EXPORT_SCALE, y * EXPORT_SCALE, EXPORT_SCALE, EXPORT_SCALE);
        }
      }
    }

    exportCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pixelart.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  };

  return (
    <ToolShell
      title="PIXEL ART"
      onExit={onExit}
      actions={
        <>
          <button className="wbtn ghost" onClick={handleClear}>
            CLEAR
          </button>
          <button className="wbtn" onClick={handleExport}>
            EXPORT PNG
          </button>
        </>
      }
    >
      <div className="toolCol">
        <div className="toolRow">
          <div className="toolField">
            <label className="rsub">TOOL</label>
            <div className="toolRow">
              <button className={`chip ${tool === 'paint' ? 'on' : ''}`} onClick={() => setTool('paint')}>
                PAINT
              </button>
              <button className={`chip ${tool === 'eraser' ? 'on' : ''}`} onClick={() => setTool('eraser')}>
                ERASER
              </button>
            </div>
          </div>

          <div className="toolField">
            <label className="rsub">GRID SIZE</label>
            <div className="toolRow">
              {GRID_SIZE_OPTIONS.map((size) => (
                <button
                  key={size}
                  className={`chip ${gridSize === size ? 'on' : ''}`}
                  onClick={() => handleGridSizeChange(size)}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          <div className="toolField">
            <label className="rsub">ZOOM ({cellPx}px)</label>
            <input
              type="range"
              min={4}
              max={32}
              value={cellPx}
              onChange={(e) => setCellPx(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="toolField">
          <label className="rsub">PALETTE</label>
          <div className="toolSwatchGrid">
            {PALETTE.map((hex) => (
              <div
                key={hex}
                className={`toolSwatch ${currentColor === hex && tool === 'paint' ? 'on' : ''}`}
                onClick={() => {
                  setCurrentColor(hex);
                  setTool('paint');
                }}
                title={hex}
              >
                <div className="sw" style={{ background: hex }} />
              </div>
            ))}
            <div className="toolSwatch" title="Custom color">
              <input
                type="color"
                value={currentColor}
                onChange={(e) => {
                  setCurrentColor(e.target.value);
                  setTool('paint');
                }}
                style={{ width: '100%', height: '100%', border: 'none', padding: 0, background: 'none' }}
              />
            </div>
          </div>
        </div>

        <div className="toolCanvasWrap">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              cursor: tool === 'eraser' ? 'cell' : 'crosshair',
              touchAction: 'none',
              imageRendering: 'pixelated',
            }}
          />
        </div>

        <div className="toolHint">
          Click or drag to paint. {gridSize}×{gridSize} grid, saved automatically for this board.
        </div>
      </div>
    </ToolShell>
  );
}
