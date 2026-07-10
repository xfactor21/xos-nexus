import { useEffect, useRef, useState } from 'react';
import ToolShell from './ToolShell';

interface Selection {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface PersistedSettings {
  brightness: number;
  contrast: number;
}

function loadSettings(boardId: string): PersistedSettings {
  try {
    const raw = localStorage.getItem(`xos-studio-photoedit-${boardId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      return {
        brightness: typeof parsed.brightness === 'number' ? parsed.brightness : 0,
        contrast: typeof parsed.contrast === 'number' ? parsed.contrast : 0,
      };
    }
  } catch {
    // ignore corrupt storage
  }
  return { brightness: 0, contrast: 0 };
}

export default function QuickPhotoEditor({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const originalImageRef = useRef<HTMLImageElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const exportUrlRef = useRef<string | null>(null);
  const draggingRef = useRef(false);

  const initial = loadSettings(boardId);
  const [brightness, setBrightness] = useState(initial.brightness);
  const [contrast, setContrast] = useState(initial.contrast);
  const [hasImage, setHasImage] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [status, setStatus] = useState<string>('AWAITING IMAGE UPLOAD');

  useEffect(() => {
    try {
      localStorage.setItem(
        `xos-studio-photoedit-${boardId}`,
        JSON.stringify({ brightness, contrast })
      );
    } catch {
      // ignore quota / privacy errors
    }
  }, [boardId, brightness, contrast]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);
    };
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;

    const img = new Image();
    img.onload = () => {
      originalImageRef.current = img;
      drawImageToWorkingCanvas(img);
      setSelection(null);
      setHasImage(true);
      setStatus('IMAGE LOADED');
    };
    img.src = url;
  }

  function drawImageToWorkingCanvas(img: HTMLImageElement) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  }

  function handleReset() {
    const img = originalImageRef.current;
    if (!img) return;
    drawImageToWorkingCanvas(img);
    setSelection(null);
    setStatus('RESET TO ORIGINAL');
  }

  function handleRotate() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    const rotated = document.createElement('canvas');
    rotated.width = h;
    rotated.height = w;
    const rctx = rotated.getContext('2d');
    if (!rctx) return;

    rctx.translate(h, 0);
    rctx.rotate(Math.PI / 2);
    rctx.drawImage(canvas, 0, 0);

    canvas.width = rotated.width;
    canvas.height = rotated.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(rotated, 0, 0);
    setSelection(null);
    setStatus('ROTATED 90°');
  }

  function handleFlipHorizontal() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scratch = document.createElement('canvas');
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    const sctx = scratch.getContext('2d');
    if (!sctx) return;

    sctx.save();
    sctx.scale(-1, 1);
    sctx.drawImage(canvas, -scratch.width, 0);
    sctx.restore();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(scratch, 0, 0);
    setStatus('FLIPPED HORIZONTAL');
  }

  function handleFlipVertical() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scratch = document.createElement('canvas');
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    const sctx = scratch.getContext('2d');
    if (!sctx) return;

    sctx.save();
    sctx.scale(1, -1);
    sctx.drawImage(canvas, 0, -scratch.height);
    sctx.restore();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(scratch, 0, 0);
    setStatus('FLIPPED VERTICAL');
  }

  function canvasPointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    return {
      x: Math.max(0, Math.min(canvas.width, x)),
      y: Math.max(0, Math.min(canvas.height, y)),
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!hasImage) return;
    const { x, y } = canvasPointFromEvent(e);
    draggingRef.current = true;
    setSelection({ x0: x, y0: y, x1: x, y1: y });
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!draggingRef.current) return;
    const { x, y } = canvasPointFromEvent(e);
    setSelection((prev) => (prev ? { ...prev, x1: x, y1: y } : prev));
  }

  function handlePointerUp() {
    draggingRef.current = false;
  }

  function handleApplyCrop() {
    if (!selection) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sx = Math.round(Math.min(selection.x0, selection.x1));
    const sy = Math.round(Math.min(selection.y0, selection.y1));
    const sw = Math.round(Math.abs(selection.x1 - selection.x0));
    const sh = Math.round(Math.abs(selection.y1 - selection.y0));

    if (sw < 1 || sh < 1) {
      setStatus('SELECTION TOO SMALL');
      return;
    }

    const cropped = document.createElement('canvas');
    cropped.width = sw;
    cropped.height = sh;
    const cctx = cropped.getContext('2d');
    if (!cctx) return;
    cctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    canvas.width = sw;
    canvas.height = sh;
    ctx.clearRect(0, 0, sw, sh);
    ctx.drawImage(cropped, 0, 0);

    setSelection(null);
    setStatus('CROP APPLIED');
  }

  function handleClearSelection() {
    setSelection(null);
  }

  function handleApplyAdjustments() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let v = data[i + c];
        v = v + brightness;
        v = factor * (v - 128) + 128;
        data[i + c] = Math.max(0, Math.min(255, v));
      }
    }

    ctx.putImageData(imageData, 0, 0);
    setStatus('BRIGHTNESS/CONTRAST APPLIED');
  }

  function handleExport() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      if (exportUrlRef.current) {
        URL.revokeObjectURL(exportUrlRef.current);
        exportUrlRef.current = null;
      }
      const url = URL.createObjectURL(blob);
      exportUrlRef.current = url;
      const a = document.createElement('a');
      a.href = url;
      a.download = 'edited.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => {
        if (exportUrlRef.current === url) {
          URL.revokeObjectURL(url);
          exportUrlRef.current = null;
        }
      }, 5000);
      setStatus('EXPORTED PNG');
    }, 'image/png');
  }

  const canvas = canvasRef.current;
  let overlayStyle: React.CSSProperties | null = null;
  if (selection && canvas && canvas.width > 0 && canvas.height > 0) {
    const rect = canvas.getBoundingClientRect();
    const displayScaleX = rect.width > 0 ? rect.width / canvas.width : 1;
    const displayScaleY = rect.height > 0 ? rect.height / canvas.height : 1;
    const left = Math.min(selection.x0, selection.x1) * displayScaleX;
    const top = Math.min(selection.y0, selection.y1) * displayScaleY;
    const width = Math.abs(selection.x1 - selection.x0) * displayScaleX;
    const height = Math.abs(selection.y1 - selection.y0) * displayScaleY;
    overlayStyle = {
      position: 'absolute',
      left,
      top,
      width,
      height,
      background: 'rgba(0, 255, 255, 0.2)',
      border: '1px dashed var(--cyan)',
      pointerEvents: 'none',
    };
  }

  return (
    <ToolShell title="QUICK PHOTO EDITOR" onExit={onExit}>
      <div className="toolCol">
        <div className="toolRow">
          <label className="toolDrop">
            <input type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
            UPLOAD PHOTO
          </label>
        </div>

        <div className="toolCanvasWrap" style={{ position: 'relative' }}>
          <canvas
            ref={canvasRef}
            style={{ maxWidth: 520, width: '100%', height: 'auto', touchAction: 'none' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
          {overlayStyle && <div style={overlayStyle} />}
        </div>

        <div className="toolHint">{status}</div>

        <div className="toolRow">
          <button className="wbtn" disabled={!hasImage} onClick={handleRotate}>
            ROTATE 90°
          </button>
          <button className="wbtn" disabled={!hasImage} onClick={handleFlipHorizontal}>
            FLIP HORIZONTAL
          </button>
          <button className="wbtn" disabled={!hasImage} onClick={handleFlipVertical}>
            FLIP VERTICAL
          </button>
          <button className="wbtn ghost" disabled={!hasImage} onClick={handleReset}>
            RESET
          </button>
        </div>

        <div className="rsub">CROP</div>
        <div className="toolRow">
          <button className="wbtn" disabled={!selection} onClick={handleApplyCrop}>
            APPLY CROP
          </button>
          <button className="wbtn ghost" disabled={!selection} onClick={handleClearSelection}>
            CLEAR SELECTION
          </button>
        </div>
        <div className="toolHint">DRAG DIRECTLY ON THE IMAGE TO SELECT A CROP REGION</div>

        <div className="rsub">BRIGHTNESS / CONTRAST</div>
        <div className="toolField">
          <label>BRIGHTNESS ({brightness})</label>
          <input
            type="range"
            min={-100}
            max={100}
            value={brightness}
            onChange={(e) => setBrightness(Number(e.target.value))}
          />
        </div>
        <div className="toolField">
          <label>CONTRAST ({contrast})</label>
          <input
            type="range"
            min={-100}
            max={100}
            value={contrast}
            onChange={(e) => setContrast(Number(e.target.value))}
          />
        </div>
        <div className="toolRow">
          <button className="wbtn" disabled={!hasImage} onClick={handleApplyAdjustments}>
            APPLY
          </button>
        </div>

        <div className="rsub">EXPORT</div>
        <div className="toolRow">
          <button className="wbtn" disabled={!hasImage} onClick={handleExport}>
            EXPORT PNG
          </button>
        </div>
      </div>
    </ToolShell>
  );
}
