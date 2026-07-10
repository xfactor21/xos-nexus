import { useCallback, useEffect, useRef, useState } from 'react';
import ToolShell from './ToolShell';

/**
 * MEME GENERATOR — a "New Project" utility tool for the Design Studio room.
 * Upload a background image (or pick a preset fill/gradient), add classic
 * bold/white/black-outline top & bottom captions, drag them into place on
 * the canvas, then export a PNG. The canvas is the single source of truth
 * and is fully redrawn on every relevant state change.
 */

type Pos = { x: number; y: number };

type Preset = {
  id: string;
  label: string;
  swatchStyle: React.CSSProperties;
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
};

const PRESETS: Preset[] = [
  {
    id: 'void',
    label: 'VOID',
    swatchStyle: { background: '#05050a' },
    paint: (ctx, w, h) => {
      ctx.fillStyle = '#05050a';
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'cyan',
    label: 'CYAN',
    swatchStyle: { background: 'var(--cyan)' },
    paint: (ctx, w, h) => {
      ctx.fillStyle = '#0af0ff';
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'magenta',
    label: 'MAGENTA',
    swatchStyle: { background: 'var(--magenta)' },
    paint: (ctx, w, h) => {
      ctx.fillStyle = '#ff2fd6';
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'nebula',
    label: 'NEBULA',
    swatchStyle: {
      background: 'linear-gradient(135deg, var(--purple), var(--magenta), var(--cyan))',
    },
    paint: (ctx, w, h) => {
      const gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, '#7b2ff7');
      gradient.addColorStop(0.5, '#ff2fd6');
      gradient.addColorStop(1, '#0af0ff');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    },
  },
];

const DEFAULT_W = 600;
const DEFAULT_H = 600;

type PersistedState = {
  topText: string;
  bottomText: string;
  fontSize: number;
  topPos: Pos;
  bottomPos: Pos;
  presetId: string;
};

function storageKey(boardId: string): string {
  return `xos-studio-meme-${boardId}`;
}

function loadPersisted(boardId: string): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(storageKey(boardId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Partial<PersistedState>;
    }
    return {};
  } catch {
    return {};
  }
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = words[i];
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  pos: Pos,
  fontSize: number,
  canvasWidth: number
): void {
  if (!text.trim()) return;
  const upper = text.toUpperCase();
  ctx.font = `bold ${fontSize}px Impact, 'Arial Black', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = fontSize / 12;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#fff';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const maxWidth = canvasWidth * 0.92;
  const lines = wrapLines(ctx, upper, maxWidth);
  const lineHeight = fontSize * 1.15;
  const totalHeight = lineHeight * lines.length;
  const startY = pos.y - totalHeight / 2 + lineHeight / 2;

  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    ctx.strokeText(line, pos.x, y);
    ctx.fillText(line, pos.x, y);
  });
}

export default function MemeGenerator({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const initialRef = useRef<Partial<PersistedState>>(loadPersisted(boardId));
  const initial = initialRef.current;

  const [topText, setTopText] = useState(initial.topText ?? 'TOP TEXT');
  const [bottomText, setBottomText] = useState(initial.bottomText ?? 'BOTTOM TEXT');
  const [fontSize, setFontSize] = useState(initial.fontSize ?? 40);
  const [presetId, setPresetId] = useState(initial.presetId ?? PRESETS[0].id);
  const [topPos, setTopPos] = useState<Pos>(initial.topPos ?? { x: DEFAULT_W / 2, y: 50 });
  const [bottomPos, setBottomPos] = useState<Pos>(
    initial.bottomPos ?? { x: DEFAULT_W / 2, y: DEFAULT_H - 50 }
  );
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({
    w: DEFAULT_W,
    h: DEFAULT_H,
  });
  const [bgImageEl, setBgImageEl] = useState<HTMLImageElement | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const draggingRef = useRef<'top' | 'bottom' | null>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvasSize.w;
    canvas.height = canvasSize.h;
    ctx.clearRect(0, 0, canvasSize.w, canvasSize.h);

    if (bgImageEl) {
      ctx.drawImage(bgImageEl, 0, 0, canvasSize.w, canvasSize.h);
    } else {
      const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
      preset.paint(ctx, canvasSize.w, canvasSize.h);
    }

    drawCaption(ctx, topText, topPos, fontSize, canvasSize.w);
    drawCaption(ctx, bottomText, bottomPos, fontSize, canvasSize.w);
  }, [bgImageEl, presetId, canvasSize, topText, bottomText, topPos, bottomPos, fontSize]);

  useEffect(() => {
    render();
  }, [render]);

  // Persist text/size/positions (not the uploaded image — too large for localStorage).
  useEffect(() => {
    try {
      const data: PersistedState = { topText, bottomText, fontSize, topPos, bottomPos, presetId };
      localStorage.setItem(storageKey(boardId), JSON.stringify(data));
    } catch {
      // ignore quota / access errors
    }
  }, [boardId, topText, bottomText, fontSize, topPos, bottomPos, presetId]);

  // Clean up any uploaded-image object URL on unmount.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    objectUrlRef.current = url;
    const img = new Image();
    img.onload = () => {
      setCanvasSize({ w: img.naturalWidth, h: img.naturalHeight });
      setBgImageEl(img);
    };
    img.src = url;
    e.target.value = '';
  };

  const handlePresetClick = (id: string) => {
    setPresetId(id);
    setBgImageEl(null);
    setCanvasSize({ w: DEFAULT_W, h: DEFAULT_H });
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>): Pos => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e);
    const distTop = Math.abs(point.y - topPos.y);
    const distBottom = Math.abs(point.y - bottomPos.y);
    const withinTop = distTop <= 40;
    const withinBottom = distBottom <= 40;

    let target: 'top' | 'bottom' | null = null;
    if (withinTop && withinBottom) {
      target = distTop <= distBottom ? 'top' : 'bottom';
    } else if (withinTop) {
      target = 'top';
    } else if (withinBottom) {
      target = 'bottom';
    }
    if (!target) return;

    draggingRef.current = target;
    const pos = target === 'top' ? topPos : bottomPos;
    dragOffsetRef.current = { dx: point.x - pos.x, dy: point.y - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const target = draggingRef.current;
    if (!target) return;
    const point = getCanvasPoint(e);
    const next: Pos = {
      x: point.x - dragOffsetRef.current.dx,
      y: point.y - dragOffsetRef.current.dy,
    };
    if (target === 'top') {
      setTopPos(next);
    } else {
      setBottomPos(next);
    }
  };

  const stopDragging = (e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleExport = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'meme.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  };

  return (
    <ToolShell title="MEME GENERATOR" onExit={onExit}>
      <div className="toolRow">
        <div className="toolCol">
          <label className="toolDrop">
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            DROP / SELECT IMAGE
          </label>

          <div className="toolSwatchGrid">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="toolSwatch"
                style={{
                  outline:
                    !bgImageEl && presetId === preset.id ? '2px solid var(--cyan)' : 'none',
                }}
                onClick={() => handlePresetClick(preset.id)}
              >
                <span className="sw" style={preset.swatchStyle} />
                {preset.label}
              </button>
            ))}
          </div>

          <label className="toolField">
            TOP TEXT
            <input type="text" value={topText} onChange={(e) => setTopText(e.target.value)} />
          </label>

          <label className="toolField">
            BOTTOM TEXT
            <input
              type="text"
              value={bottomText}
              onChange={(e) => setBottomText(e.target.value)}
            />
          </label>

          <label className="toolField">
            FONT SIZE: {fontSize}px
            <input
              type="range"
              min={18}
              max={72}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
            />
          </label>

          <button type="button" className="wbtn" onClick={handleExport}>
            EXPORT PNG
          </button>

          <div className="toolHint">Drag the captions on the canvas to reposition them.</div>
        </div>

        <div className="toolCol">
          <div className="toolCanvasWrap">
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={stopDragging}
              onPointerLeave={stopDragging}
              style={{ touchAction: 'none', maxWidth: '100%', cursor: 'grab' }}
            />
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
