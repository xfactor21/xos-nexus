import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { DrawEngine, hexToRgb, hsbToRgb, rgbToHex, rgbToHsb } from './DrawEngine';
import type { BlendMode, BrushSettings, BrushType, DrawDocument } from '../types';

type Tool = 'brush' | 'eraser' | 'marquee' | 'lasso' | 'wand' | 'fill' | 'eyedropper' | 'gradient';

const BRUSH_TYPES: { key: BrushType; label: string; icon: string }[] = [
  { key: 'pencil', label: 'Pencil', icon: '✎' },
  { key: 'ink', label: 'Ink', icon: '🖊' },
  { key: 'airbrush', label: 'Airbrush', icon: '💨' },
  { key: 'texture', label: 'Texture', icon: '▦' },
];

const BLEND_MODES: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

const DEFAULT_W = 1400;
const DEFAULT_H = 950;

function docKey(boardId: string) {
  return `xos-studio-draw-${boardId}`;
}

function loadDoc(boardId: string): DrawDocument | null {
  try {
    const raw = localStorage.getItem(docKey(boardId));
    if (raw) return JSON.parse(raw) as DrawDocument;
  } catch {
    /* ignore corrupt storage */
  }
  return null;
}

/**
 * DRAW / PAINT MODE — Blueprint v0.3 Amendment v0.2. Flagship reference:
 * Photoshop / Procreate. Full brush engine (pencil/ink/airbrush/texture,
 * size/opacity/hardness/flow, real pressure via Pointer Events), layers
 * with native blend modes + opacity, HSB color wheel + swatches +
 * eyedropper + gradient tool, marquee/lasso/magic-wand selection + fill,
 * brightness/contrast + hue/saturation + blur/sharpen adjustments, real
 * multi-level undo, canvas resize/crop, PNG/JPEG export. See
 * DrawEngine.ts for the actual pixel-level implementation — this
 * component is the UI wiring on top of it.
 */
export default function DrawPaint({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<DrawEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [tick, forceTick] = useState(0);
  const bump = () => forceTick((n) => n + 1);

  const [tool, setTool] = useState<Tool>('brush');
  const [brush, setBrush] = useState<BrushSettings>({ type: 'pencil', size: 18, opacity: 1, hardness: 0.85, flow: 0.9, color: '#00F5FF' });
  const [swatches, setSwatches] = useState<string[]>(['#00F5FF', '#8B5CF6', '#FF2D78', '#FFB800', '#ffffff', '#05080D']);
  const [tolerance, setTolerance] = useState(28);
  const [zoom, setZoom] = useState(1);
  const [panel, setPanel] = useState<'none' | 'adjust' | 'resize' | 'export'>('none');
  const [adjust, setAdjust] = useState({ brightness: 0, contrast: 0, hue: 0, sat: 1, light: 1, blur: 3 });
  const [resizeDraft, setResizeDraft] = useState({ w: DEFAULT_W, h: DEFAULT_H, mode: 'scale' as 'scale' | 'crop' });

  const strokeRef = useRef(false);
  const lassoPoints = useRef<[number, number][]>([]);
  const gradientDrag = useRef<{ x0: number; y0: number } | null>(null);

  /* ============ init ============ */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cv = canvasRef.current!;
      const saved = loadDoc(boardId);
      const eng = saved ? await DrawEngine.fromDocument(cv, saved) : DrawEngine.blank(cv, DEFAULT_W, DEFAULT_H);
      if (cancelled) return;
      if (saved?.swatches?.length) setSwatches(saved.swatches);
      setResizeDraft({ w: eng.width, h: eng.height, mode: 'scale' });
      eng.onHistoryChange = bump;
      eng.onLayersChange = bump;
      engineRef.current = eng;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  /* ============ persistence (debounced) ============ */
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      const eng = engineRef.current;
      if (!eng) return;
      try {
        localStorage.setItem(docKey(boardId), JSON.stringify(eng.toDocument(swatches)));
      } catch {
        // localStorage quota exceeded on a large multi-layer painting —
        // non-fatal, the Captain just won't get autosave for this edit.
        console.warn('DrawPaint: autosave failed (likely localStorage quota)');
      }
    }, 500);
    return () => clearTimeout(t);
    // `tick` is bumped by the engine's onHistoryChange/onLayersChange
    // callbacks on every committed edit — that's what actually drives this
    // effect to re-fire and autosave, not just boardId/ready/swatches.
  }, [boardId, ready, swatches, tick]);

  function worldPos(e: RPointerEvent<HTMLCanvasElement>): [number, number] {
    const r = canvasRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom];
  }

  /* ============ pointer handling ============ */
  function onPointerDown(e: RPointerEvent<HTMLCanvasElement>) {
    const eng = engineRef.current;
    if (!eng) return;
    canvasRef.current!.setPointerCapture(e.pointerId);
    const [x, y] = worldPos(e);
    const pressure = e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 1;

    if (tool === 'brush' || tool === 'eraser') {
      strokeRef.current = true;
      eng.beginStroke(x, y, pressure, brush, tool === 'eraser');
      return;
    }
    if (tool === 'marquee') {
      strokeRef.current = true;
      gradientDrag.current = { x0: x, y0: y };
      return;
    }
    if (tool === 'lasso') {
      strokeRef.current = true;
      lassoPoints.current = [[x, y]];
      return;
    }
    if (tool === 'wand') {
      eng.magicWandSelect(x, y, tolerance);
      bump();
      return;
    }
    if (tool === 'fill') {
      eng.floodFillAt(x, y, brush.color, tolerance);
      bump();
      return;
    }
    if (tool === 'eyedropper') {
      const c = eng.sampleColorAt(x, y);
      setBrush((b) => ({ ...b, color: c }));
      return;
    }
    if (tool === 'gradient') {
      strokeRef.current = true;
      gradientDrag.current = { x0: x, y0: y };
      return;
    }
  }

  function onPointerMove(e: RPointerEvent<HTMLCanvasElement>) {
    if (!strokeRef.current) return;
    const eng = engineRef.current;
    if (!eng) return;
    const [x, y] = worldPos(e);
    const pressure = e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 1;

    if (tool === 'brush' || tool === 'eraser') {
      eng.continueStroke(x, y, pressure, brush, tool === 'eraser');
      return;
    }
    if (tool === 'marquee' && gradientDrag.current) {
      eng.setSelectionRect(gradientDrag.current.x0, gradientDrag.current.y0, x, y);
      return;
    }
    if (tool === 'lasso') {
      lassoPoints.current.push([x, y]);
      return;
    }
    if (tool === 'gradient' && gradientDrag.current) {
      // live preview: cheap redraw of a straight guide line
      eng.composite();
      const ctx = eng.displayCtx;
      ctx.save();
      ctx.strokeStyle = brush.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(gradientDrag.current.x0, gradientDrag.current.y0);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.restore();
      return;
    }
  }

  function onPointerUp(e: RPointerEvent<HTMLCanvasElement>) {
    const eng = engineRef.current;
    if (!eng) return;
    canvasRef.current?.releasePointerCapture(e.pointerId);
    if (!strokeRef.current) return;
    strokeRef.current = false;
    const [x, y] = worldPos(e);

    if (tool === 'brush' || tool === 'eraser') {
      eng.endStroke(brush, tool === 'eraser');
      return;
    }
    if (tool === 'lasso') {
      eng.setSelectionLasso(lassoPoints.current);
      lassoPoints.current = [];
      return;
    }
    if (tool === 'gradient' && gradientDrag.current) {
      const secondColor = swatches[1] ?? '#000000';
      eng.applyGradient(gradientDrag.current.x0, gradientDrag.current.y0, x, y, brush.color, secondColor);
      gradientDrag.current = null;
    }
    if (tool === 'marquee') gradientDrag.current = null;
  }

  /* ============ actions ============ */
  function addSwatch() {
    setSwatches((s) => (s.includes(brush.color) ? s : [brush.color, ...s].slice(0, 24)));
  }
  function applyBrightnessContrast() {
    engineRef.current?.applyBrightnessContrast(adjust.brightness, adjust.contrast);
    bump();
  }
  function applyHueSat() {
    engineRef.current?.applyHueSaturation(adjust.hue, adjust.sat, adjust.light);
    bump();
  }
  function applyBlur() {
    engineRef.current?.applyBlur(adjust.blur);
    bump();
  }
  function applySharpen() {
    engineRef.current?.applySharpen();
    bump();
  }
  function doResize() {
    engineRef.current?.resizeCanvas(resizeDraft.w, resizeDraft.h, resizeDraft.mode);
    setPanel('none');
    bump();
  }
  async function doExport(format: 'png' | 'jpeg') {
    const eng = engineRef.current;
    if (!eng) return;
    const blob = await eng.exportBlob(format, 0.92);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xos-studio-${boardId}.${format === 'png' ? 'png' : 'jpg'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setPanel('none');
  }

  const eng = engineRef.current;
  const layerOrder = eng ? [...eng.layers].reverse() : [];

  return (
    <div id="dpRoot">
      <div id="dpTopbar">
        <button className="chip" onClick={onExit}>◂ ALL BOARDS</button>
        <div id="dpToolgroup">
          {(
            [
              ['brush', '🖌'],
              ['eraser', '🧹'],
              ['marquee', '▭'],
              ['lasso', '⤾'],
              ['wand', '✨'],
              ['fill', '🪣'],
              ['eyedropper', '💧'],
              ['gradient', '◐'],
            ] as [Tool, string][]
          ).map(([t, icon]) => (
            <span key={t} className={`tool ${tool === t ? 'on' : ''}`} onClick={() => setTool(t)} title={t}>
              {icon}
            </span>
          ))}
        </div>
        <div id="dpTopActions">
          <button className="chip" disabled={!eng?.canUndo()} onClick={() => { engineRef.current?.undo(); bump(); }}>↺ UNDO</button>
          <button className="chip" disabled={!eng?.canRedo()} onClick={() => { engineRef.current?.redo(); bump(); }}>↻ REDO</button>
          <button className="chip" onClick={() => { engineRef.current?.clearSelection(); bump(); }}>DESELECT</button>
          <button className="chip" onClick={() => setPanel(panel === 'adjust' ? 'none' : 'adjust')}>ADJUST</button>
          <button className="chip" onClick={() => setPanel(panel === 'resize' ? 'none' : 'resize')}>RESIZE/CROP</button>
          <button className="chip" onClick={() => setPanel(panel === 'export' ? 'none' : 'export')}>EXPORT ▾</button>
        </div>
      </div>

      <div id="dpBody">
        {(tool === 'brush' || tool === 'eraser') && (
          <div id="dpBrushPanel" className="gpanel">
            <h3>BRUSH</h3>
            <div id="dpBrushTypes">
              {BRUSH_TYPES.map((b) => (
                <span key={b.key} className={`bt ${brush.type === b.key ? 'on' : ''}`} onClick={() => setBrush((s) => ({ ...s, type: b.key }))} title={b.label}>
                  {b.icon}
                </span>
              ))}
            </div>
            <label>SIZE {Math.round(brush.size)}px</label>
            <input type="range" min={1} max={200} value={brush.size} onChange={(e) => setBrush((s) => ({ ...s, size: +e.target.value }))} />
            <label>OPACITY {Math.round(brush.opacity * 100)}%</label>
            <input type="range" min={1} max={100} value={Math.round(brush.opacity * 100)} onChange={(e) => setBrush((s) => ({ ...s, opacity: +e.target.value / 100 }))} />
            <label>HARDNESS {Math.round(brush.hardness * 100)}%</label>
            <input type="range" min={0} max={100} value={Math.round(brush.hardness * 100)} onChange={(e) => setBrush((s) => ({ ...s, hardness: +e.target.value / 100 }))} />
            <label>FLOW {Math.round(brush.flow * 100)}%</label>
            <input type="range" min={1} max={100} value={Math.round(brush.flow * 100)} onChange={(e) => setBrush((s) => ({ ...s, flow: +e.target.value / 100 }))} />
          </div>
        )}
        {(tool === 'wand' || tool === 'fill') && (
          <div id="dpBrushPanel" className="gpanel">
            <h3>TOLERANCE</h3>
            <label>{tolerance}</label>
            <input type="range" min={1} max={120} value={tolerance} onChange={(e) => setTolerance(+e.target.value)} />
          </div>
        )}

        <div id="dpCanvasWrap" ref={wrapRef}>
          {panel === 'adjust' && (
            <div id="dpAdjustPanel" className="gpanel">
              <h3>ADJUSTMENTS</h3>
              <label>BRIGHTNESS {adjust.brightness}</label>
              <input type="range" min={-120} max={120} value={adjust.brightness} onChange={(e) => setAdjust((a) => ({ ...a, brightness: +e.target.value }))} />
              <label>CONTRAST {adjust.contrast}</label>
              <input type="range" min={-120} max={120} value={adjust.contrast} onChange={(e) => setAdjust((a) => ({ ...a, contrast: +e.target.value }))} />
              <button className="wbtn" onClick={applyBrightnessContrast}>APPLY B/C</button>
              <div style={{ height: 8 }} />
              <label>HUE {adjust.hue}°</label>
              <input type="range" min={-180} max={180} value={adjust.hue} onChange={(e) => setAdjust((a) => ({ ...a, hue: +e.target.value }))} />
              <label>SATURATION ×{adjust.sat.toFixed(2)}</label>
              <input type="range" min={0} max={200} value={Math.round(adjust.sat * 100)} onChange={(e) => setAdjust((a) => ({ ...a, sat: +e.target.value / 100 }))} />
              <label>LIGHTNESS ×{adjust.light.toFixed(2)}</label>
              <input type="range" min={0} max={200} value={Math.round(adjust.light * 100)} onChange={(e) => setAdjust((a) => ({ ...a, light: +e.target.value / 100 }))} />
              <button className="wbtn" onClick={applyHueSat}>APPLY H/S/L</button>
              <div style={{ height: 8 }} />
              <label>BLUR RADIUS {adjust.blur}px</label>
              <input type="range" min={1} max={16} value={adjust.blur} onChange={(e) => setAdjust((a) => ({ ...a, blur: +e.target.value }))} />
              <button className="wbtn" onClick={applyBlur}>APPLY BLUR</button>
              <button className="wbtn ghost" onClick={applySharpen}>SHARPEN</button>
            </div>
          )}
          {panel === 'resize' && (
            <div id="dpAdjustPanel" className="gpanel">
              <h3>RESIZE / CROP</h3>
              <label>WIDTH</label>
              <input type="number" value={resizeDraft.w} onChange={(e) => setResizeDraft((r) => ({ ...r, w: +e.target.value }))} />
              <label>HEIGHT</label>
              <input type="number" value={resizeDraft.h} onChange={(e) => setResizeDraft((r) => ({ ...r, h: +e.target.value }))} />
              <div className="optrow">
                <span className={`chip ${resizeDraft.mode === 'scale' ? 'on' : ''}`} onClick={() => setResizeDraft((r) => ({ ...r, mode: 'scale' }))}>SCALE</span>
                <span className={`chip ${resizeDraft.mode === 'crop' ? 'on' : ''}`} onClick={() => setResizeDraft((r) => ({ ...r, mode: 'crop' }))}>CROP (top-left anchor)</span>
              </div>
              <button className="wbtn" onClick={doResize}>APPLY</button>
            </div>
          )}
          {panel === 'export' && (
            <div id="dpAdjustPanel" className="gpanel">
              <h3>EXPORT</h3>
              <button className="wbtn" onClick={() => doExport('png')}>PNG (transparent)</button>
              <button className="wbtn ghost" onClick={() => doExport('jpeg')}>JPEG</button>
            </div>
          )}

          <div id="dpCanvasScroll">
            <canvas
              ref={canvasRef}
              style={{ width: (eng?.width ?? DEFAULT_W) * zoom, height: (eng?.height ?? DEFAULT_H) * zoom, touchAction: 'none' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            />
          </div>
          <div id="dpZoom">
            <span className="tool" onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}>－</span>
            <span>{Math.round(zoom * 100)}%</span>
            <span className="tool" onClick={() => setZoom((z) => Math.min(4, z + 0.1))}>＋</span>
          </div>
        </div>

        <div id="dpRightRail">
          <div id="dpColorPanel" className="gpanel">
            <h3>COLOR</h3>
            <ColorWheel color={brush.color} onChange={(c) => setBrush((s) => ({ ...s, color: c }))} />
            <div id="dpSwatchRow">
              <span className="swatch current" style={{ background: brush.color }} onClick={addSwatch} title="Save current color" />
              {swatches.map((s, i) => (
                <span key={i} className="swatch" style={{ background: s }} onClick={() => setBrush((b) => ({ ...b, color: s }))} />
              ))}
            </div>
          </div>

          <div id="layersPanel" className="gpanel">
            <h3>
              LAYERS · {eng?.layers.length ?? 0}
              <span className="lyAdd" onClick={() => { engineRef.current?.addLayer(); bump(); }}>＋</span>
            </h3>
            {layerOrder.map((l) => (
              <div key={l.meta.id} className={`layer-row ${eng?.activeLayerId === l.meta.id ? 'sel' : ''}`} onClick={() => { if (eng) { eng.activeLayerId = l.meta.id; bump(); } }}>
                <span className={`vis ${l.meta.visible ? '' : 'off'}`} onClick={(e) => { e.stopPropagation(); engineRef.current?.setLayerProp(l.meta.id, 'visible', !l.meta.visible); bump(); }}>
                  {l.meta.visible ? '◉' : '○'}
                </span>
                <span className="lbl">{l.meta.name}</span>
                <span className="lyDup" onClick={(e) => { e.stopPropagation(); engineRef.current?.duplicateLayer(l.meta.id); bump(); }} title="Duplicate">⧉</span>
                <span className="lyDel" onClick={(e) => { e.stopPropagation(); engineRef.current?.deleteLayer(l.meta.id); bump(); }} title="Delete">✕</span>
              </div>
            ))}
            {eng?.activeLayerId && (
              <div id="dpLayerProps">
                <label>OPACITY</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round((eng.activeLayer()?.meta.opacity ?? 1) * 100)}
                  onChange={(e) => { engineRef.current?.setLayerProp(eng.activeLayerId, 'opacity', +e.target.value / 100, false); bump(); }}
                  onMouseUp={() => { engineRef.current?.setLayerProp(eng.activeLayerId, 'opacity', eng.activeLayer()?.meta.opacity ?? 1, true); }}
                />
                <label>BLEND MODE</label>
                <select value={eng.activeLayer()?.meta.blendMode ?? 'normal'} onChange={(e) => { engineRef.current?.setLayerProp(eng.activeLayerId, 'blendMode', e.target.value as BlendMode); bump(); }}>
                  {BLEND_MODES.map((m) => (
                    <option key={m} value={m}>{m.toUpperCase()}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Real HSB color wheel — a hue ring rendered with actual HSB→RGB math per
 * pixel (via conic gradient approximation using canvas arcs) plus a
 * saturation/brightness square for the selected hue, not a fake color
 * swatch grid standing in for one. */
function ColorWheel({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  const ringRef = useRef<HTMLCanvasElement>(null);
  const svRef = useRef<HTMLCanvasElement>(null);
  const [r, g, b] = hexToRgb(color);
  const [hue, sat, bri] = rgbToHsb(r, g, b);
  const dragging = useRef<'ring' | 'sv' | null>(null);

  useEffect(() => {
    const cv = ringRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const size = cv.width;
    const cx = size / 2,
      cy = size / 2,
      outerR = size / 2 - 2,
      innerR = outerR - 14;
    ctx.clearRect(0, 0, size, size);
    for (let a = 0; a < 360; a++) {
      const rad0 = ((a - 0.6) * Math.PI) / 180;
      const rad1 = ((a + 0.6) * Math.PI) / 180;
      const [rr, gg, bb] = hsbToRgb(a / 360, 1, 1);
      ctx.strokeStyle = `rgb(${rr},${gg},${bb})`;
      ctx.lineWidth = outerR - innerR;
      ctx.beginPath();
      ctx.arc(cx, cy, (outerR + innerR) / 2, rad0, rad1);
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    const cv = svRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const size = cv.width;
    const [hr, hg, hb] = hsbToRgb(hue, 1, 1);
    ctx.fillStyle = `rgb(${hr},${hg},${hb})`;
    ctx.fillRect(0, 0, size, size);
    const whiteGrad = ctx.createLinearGradient(0, 0, size, 0);
    whiteGrad.addColorStop(0, 'rgba(255,255,255,1)');
    whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = whiteGrad;
    ctx.fillRect(0, 0, size, size);
    const blackGrad = ctx.createLinearGradient(0, 0, 0, size);
    blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
    blackGrad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = blackGrad;
    ctx.fillRect(0, 0, size, size);
  }, [hue]);

  function ringToHue(cv: HTMLCanvasElement, clientX: number, clientY: number): number | null {
    const rect = cv.getBoundingClientRect();
    const x = clientX - rect.left - cv.width / 2;
    const y = clientY - rect.top - cv.height / 2;
    const dist = Math.hypot(x, y);
    const outerR = cv.width / 2 - 2,
      innerR = outerR - 14;
    if (dist < innerR - 6 || dist > outerR + 6) return null;
    let ang = (Math.atan2(y, x) * 180) / Math.PI;
    if (ang < 0) ang += 360;
    return ang / 360;
  }
  function svToSatBri(cv: HTMLCanvasElement, clientX: number, clientY: number): [number, number] {
    const rect = cv.getBoundingClientRect();
    const x = Math.max(0, Math.min(cv.width, clientX - rect.left));
    const y = Math.max(0, Math.min(cv.height, clientY - rect.top));
    return [x / cv.width, 1 - y / cv.height];
  }

  function handleDown(kind: 'ring' | 'sv', e: React.PointerEvent<HTMLCanvasElement>) {
    dragging.current = kind;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    handleMove(e);
  }
  function handleMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragging.current) return;
    if (dragging.current === 'ring' && ringRef.current) {
      const h = ringToHue(ringRef.current, e.clientX, e.clientY);
      if (h !== null) {
        const [rr, gg, bb] = hsbToRgb(h, sat, bri);
        onChange(rgbToHex(rr, gg, bb));
      }
    } else if (dragging.current === 'sv' && svRef.current) {
      const [s, v] = svToSatBri(svRef.current, e.clientX, e.clientY);
      const [rr, gg, bb] = hsbToRgb(hue, s, v);
      onChange(rgbToHex(rr, gg, bb));
    }
  }
  function handleUp() {
    dragging.current = null;
  }

  return (
    <div id="dpColorWheel">
      <canvas ref={ringRef} width={116} height={116} onPointerDown={(e) => handleDown('ring', e)} onPointerMove={handleMove} onPointerUp={handleUp} onPointerLeave={handleUp} />
      <canvas
        ref={svRef}
        width={64}
        height={64}
        style={{ position: 'absolute', left: 26, top: 26 }}
        onPointerDown={(e) => handleDown('sv', e)}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerLeave={handleUp}
      />
    </div>
  );
}
