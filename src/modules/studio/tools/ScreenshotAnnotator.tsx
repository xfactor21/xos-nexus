import React, { useEffect, useRef, useState } from 'react';
import ToolShell from './ToolShell';

type Point = [number, number];

type Tool = 'arrow' | 'rect' | 'ellipse' | 'pen' | 'text';

type Annotation =
  | { id: string; kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { id: string; kind: 'rect'; x: number; y: number; w: number; h: number; color: string; width: number }
  | { id: string; kind: 'ellipse'; x: number; y: number; w: number; h: number; color: string; width: number }
  | { id: string; kind: 'pen'; points: Point[]; color: string; width: number }
  | { id: string; kind: 'text'; x: number; y: number; text: string; color: string; size: number };

type Prefs = { tool: Tool; color: string; width: number };

function toolLabel(t: Tool): string {
  switch (t) {
    case 'arrow':
      return 'ARROW';
    case 'rect':
      return 'RECTANGLE';
    case 'ellipse':
      return 'ELLIPSE';
    case 'pen':
      return 'PEN';
    case 'text':
      return 'TEXT';
  }
}

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
      for (let i = 1; i < a.points.length; i++) {
        ctx.lineTo(a.points[i][0], a.points[i][1]);
      }
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

export default function ScreenshotAnnotator({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const prevUrlRef = useRef<string | null>(null);
  const idCounterRef = useRef(0);

  const [imgDims, setImgDims] = useState<{ width: number; height: number } | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState('#00fff2');
  const [strokeWidth, setStrokeWidth] = useState(3);

  const prefsKey = `xos-studio-annotate-${boardId}`;

  // Load saved tool/color/width preferences only — the annotations array is
  // never persisted since it is meaningless without the (unpersisted) base
  // image, which is too large to stash in localStorage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(prefsKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Prefs>;
        if (parsed.tool) setTool(parsed.tool);
        if (parsed.color) setColor(parsed.color);
        if (typeof parsed.width === 'number') setStrokeWidth(parsed.width);
      }
    } catch {
      // corrupt or unavailable storage — ignore and use defaults
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const prefs: Prefs = { tool, color, width: strokeWidth };
      localStorage.setItem(prefsKey, JSON.stringify(prefs));
    } catch {
      // storage full/unavailable — ignore
    }
  }, [prefsKey, tool, color, strokeWidth]);

  useEffect(() => {
    return () => {
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !imgDims) return;
    canvas.width = imgDims.width;
    canvas.height = imgDims.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, imgDims.width, imgDims.height);
    const all = draft ? [...annotations, draft] : annotations;
    for (const ann of all) drawAnnotation(ctx, ann);
  }, [annotations, draft, imgDims]);

  function genId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    idCounterRef.current += 1;
    return `ann-${idCounterRef.current}`;
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setImgDims({ width: img.naturalWidth, height: img.naturalHeight });
      setAnnotations([]);
      setDraft(null);
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = url;
    };
    img.src = url;
    e.target.value = '';
  }

  function toImageCoords(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / (rect.width || 1);
    const scaleY = canvas.height / (rect.height || 1);
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (!imageRef.current) return;
    const [x, y] = toImageCoords(e);

    if (tool === 'text') {
      const text = window.prompt('Annotation text:');
      if (text && text.trim().length > 0) {
        const fontSize = 12 + strokeWidth * 2;
        setAnnotations((prev) => [...prev, { id: genId(), kind: 'text', x, y, text, color, size: fontSize }]);
      }
      return;
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointer capture not supported in this environment — safe to ignore
    }

    switch (tool) {
      case 'arrow':
        setDraft({ id: genId(), kind: 'arrow', x1: x, y1: y, x2: x, y2: y, color, width: strokeWidth });
        break;
      case 'rect':
        setDraft({ id: genId(), kind: 'rect', x, y, w: 0, h: 0, color, width: strokeWidth });
        break;
      case 'ellipse':
        setDraft({ id: genId(), kind: 'ellipse', x, y, w: 0, h: 0, color, width: strokeWidth });
        break;
      case 'pen':
        setDraft({ id: genId(), kind: 'pen', points: [[x, y]], color, width: strokeWidth });
        break;
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (!draft) return;
    const [x, y] = toImageCoords(e);
    setDraft((prev) => {
      if (!prev) return prev;
      switch (prev.kind) {
        case 'arrow':
          return { ...prev, x2: x, y2: y };
        case 'rect':
        case 'ellipse':
          return { ...prev, w: x - prev.x, h: y - prev.y };
        case 'pen':
          return { ...prev, points: [...prev.points, [x, y] as Point] };
        case 'text':
          return prev;
      }
    });
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (draft) {
      setAnnotations((prev) => [...prev, draft]);
      setDraft(null);
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture was never set — safe to ignore
    }
  }

  function handleUndo(): void {
    setAnnotations((prev) => prev.slice(0, -1));
  }

  function handleClearAll(): void {
    if (annotations.length === 0) return;
    if (window.confirm('Clear all annotations from this screenshot?')) {
      setAnnotations([]);
    }
  }

  function handleExport(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'annotated.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }

  return (
    <ToolShell title="SCREENSHOT ANNOTATOR" onExit={onExit}>
      <div className="toolCol">
        <div className="toolRow">
          <label className="toolDrop">
            <input type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
            UPLOAD SCREENSHOT
          </label>
          {!imgDims && <span className="toolHint">Upload an image to begin annotating.</span>}
        </div>

        <div className="toolRow">
          {(['arrow', 'rect', 'ellipse', 'pen', 'text'] as Tool[]).map((t) => (
            <button key={t} className={tool === t ? 'chip on' : 'chip'} onClick={() => setTool(t)}>
              {toolLabel(t)}
            </button>
          ))}
        </div>

        <div className="toolRow">
          <label className="toolField">
            COLOR
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <label className="toolField">
            WIDTH: {strokeWidth}
            <input
              type="range"
              min={1}
              max={12}
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="toolCanvasWrap" style={{ maxWidth: 700 }}>
          {imgDims ? (
            <canvas
              ref={canvasRef}
              style={{ width: '100%', height: 'auto', touchAction: 'none', cursor: 'crosshair' }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
          ) : (
            <span className="toolHint">No image loaded yet.</span>
          )}
        </div>

        <div className="toolRow">
          <button className="wbtn ghost" onClick={handleUndo} disabled={annotations.length === 0}>
            UNDO
          </button>
          <button className="wbtn ghost" onClick={handleClearAll} disabled={annotations.length === 0}>
            CLEAR ALL
          </button>
          <button className="wbtn" onClick={handleExport} disabled={!imgDims}>
            EXPORT PNG
          </button>
        </div>
      </div>
    </ToolShell>
  );
}
