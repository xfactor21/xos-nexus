import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { DrawEngine, hexToRgb, hsbToRgb, rgbToHex, rgbToHsb } from './DrawEngine';
import type { SymmetryMode } from './DrawEngine';
import type { BlendMode, BrushSettings, BrushType, DrawDocument } from '../types';
import Icon from '../../../design-system/icons/Icon';
import type { IconName } from '../../../design-system/icons/registry';

type Tool = 'brush' | 'eraser' | 'marquee' | 'lasso' | 'wand' | 'fill' | 'eyedropper' | 'gradient' | 'clone' | 'smudge' | 'heal' | 'text';

const BRUSH_TYPES: { key: BrushType; label: string; icon: IconName }[] = [
  { key: 'pencil', label: 'Pencil', icon: 'pencil' },
  { key: 'ink', label: 'Ink', icon: 'pen' },
  { key: 'airbrush', label: 'Airbrush', icon: 'wind' },
  { key: 'texture', label: 'Texture', icon: 'gridDense' },
];

const BLEND_MODES: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

const DEFAULT_W = 1400;
const DEFAULT_H = 950;

const PRESET_KEY = 'xos-studio-brush-presets-v1';
interface BrushPreset {
  id: string;
  name: string;
  settings: BrushSettings;
}
function loadPresets(): BrushPreset[] {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    return raw ? (JSON.parse(raw) as BrushPreset[]) : [];
  } catch {
    return [];
  }
}
function savePresets(list: BrushPreset[]) {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(list));
  } catch {
    /* best-effort */
  }
}

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
 * DRAW / PAINT MODE — Blueprint v0.3 Amendment v0.2/v0.4. Flagship
 * reference: Photoshop / Procreate. Full brush engine (pencil/ink/airbrush/
 * texture, size/opacity/hardness/flow, real pressure via Pointer Events),
 * layers with all 16 native blend modes + opacity, HSB color wheel +
 * swatches + eyedropper + gradient tool, marquee/lasso/magic-wand selection
 * + fill, retouch tools (clone stamp/smudge/spot-heal), a text tool, a full
 * Adjustments panel (brightness/contrast, hue/sat, levels, an interactive
 * curve, color balance, B&W), a separate Filters panel (blur, sharpen,
 * noise, pixelate), symmetry drawing guides, a reference-image overlay,
 * custom brush presets, a real history/snapshot panel (jump to any earlier
 * state, plus named bookmarks) on top of linear undo/redo, canvas
 * resize/crop, and PNG/JPEG export. See DrawEngine.ts for the actual
 * pixel-level implementation — this component is the UI wiring on top of
 * it.
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
  const [panel, setPanel] = useState<'none' | 'adjust' | 'filters' | 'resize' | 'export' | 'history'>('none');
  const [adjust, setAdjust] = useState({ brightness: 0, contrast: 0, hue: 0, sat: 1, light: 1 });
  const [levels, setLevels] = useState({ black: 0, white: 255, gamma: 1 });
  const [curvePoints, setCurvePoints] = useState([{ x: 0, y: 0 }, { x: 128, y: 128 }, { x: 255, y: 255 }]);
  const [colorBalance, setColorBalance] = useState({ shadows: [0, 0, 0] as [number, number, number], mids: [0, 0, 0] as [number, number, number], highlights: [0, 0, 0] as [number, number, number] });
  const [filters, setFilters] = useState({ blur: 3, noise: 24, pixelate: 10 });
  const [resizeDraft, setResizeDraft] = useState({ w: DEFAULT_W, h: DEFAULT_H, mode: 'scale' as 'scale' | 'crop' });
  const [symmetry, setSymmetryState] = useState<SymmetryMode>('none');
  const [reference, setReference] = useState<{ url: string; opacity: number; visible: boolean } | null>(null);
  const [presets, setPresets] = useState<BrushPreset[]>(() => loadPresets());
  const [presetNameDraft, setPresetNameDraft] = useState('');
  const [cloneArmed, setCloneArmed] = useState(false);
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; value: string } | null>(null);
  const [bookmarkNameDraft, setBookmarkNameDraft] = useState('');

  const strokeRef = useRef(false);
  const lassoPoints = useRef<[number, number][]>([]);
  const gradientDrag = useRef<{ x0: number; y0: number } | null>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);

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
      eng.onBookmarksChange = bump;
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
    const radius = Math.max(2, brush.size / 2);

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
    if (tool === 'clone') {
      if (e.altKey || !eng.hasCloneSource()) {
        eng.setCloneSource(x, y);
        setCloneArmed(true);
        return;
      }
      strokeRef.current = true;
      eng.beginClone(x, y, radius);
      return;
    }
    if (tool === 'smudge') {
      strokeRef.current = true;
      eng.beginSmudge(x, y);
      return;
    }
    if (tool === 'heal') {
      eng.healAt(x, y, radius);
      bump();
      return;
    }
    if (tool === 'text') {
      // Prevent the browser's default focus-follows-pointerdown behavior:
      // without this, the native mousedown that follows this pointerdown
      // re-focuses the canvas/body a tick after our autoFocus input mounts,
      // firing a blur on the just-created input and instantly committing
      // (and clearing) an empty text draft before the Captain can type.
      e.preventDefault();
      setTextDraft({ x, y, value: '' });
      return;
    }
  }

  function onPointerMove(e: RPointerEvent<HTMLCanvasElement>) {
    if (!strokeRef.current) return;
    const eng = engineRef.current;
    if (!eng) return;
    const [x, y] = worldPos(e);
    const pressure = e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 1;
    const radius = Math.max(2, brush.size / 2);

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
    if (tool === 'clone') {
      eng.continueClone(x, y, radius);
      bump();
      return;
    }
    if (tool === 'smudge') {
      eng.continueSmudge(x, y, radius, brush.flow);
      bump();
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
    if (tool === 'clone') {
      eng.endClone();
      bump();
    }
    if (tool === 'smudge') {
      eng.endSmudge();
      bump();
    }
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
  function applyLevels() {
    engineRef.current?.applyLevels(levels.black, levels.white, levels.gamma);
    bump();
  }
  function applyCurve() {
    engineRef.current?.applyCurve(curvePoints);
    bump();
  }
  function applyColorBalance() {
    engineRef.current?.applyColorBalance(colorBalance.shadows, colorBalance.mids, colorBalance.highlights);
    bump();
  }
  function applyBW() {
    engineRef.current?.applyBlackAndWhite();
    bump();
  }
  function applyBlur() {
    engineRef.current?.applyBlur(filters.blur);
    bump();
  }
  function applySharpen() {
    engineRef.current?.applySharpen();
    bump();
  }
  function applyNoise() {
    engineRef.current?.applyNoise(filters.noise);
    bump();
  }
  function applyPixelate() {
    engineRef.current?.applyPixelate(filters.pixelate);
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
  function commitText() {
    if (!textDraft) return;
    engineRef.current?.stampText(textDraft.x, textDraft.y, textDraft.value, { size: Math.max(10, brush.size * 1.4), color: brush.color });
    setTextDraft(null);
    bump();
  }
  function pickSymmetry(mode: SymmetryMode) {
    setSymmetryState(mode);
    engineRef.current?.setSymmetry(mode);
  }
  function savePreset() {
    const name = presetNameDraft.trim() || `Preset ${presets.length + 1}`;
    const next = [...presets, { id: `bp-${Date.now().toString(36)}`, name, settings: { ...brush } }];
    setPresets(next);
    savePresets(next);
    setPresetNameDraft('');
  }
  function deletePreset(id: string) {
    const next = presets.filter((p) => p.id !== id);
    setPresets(next);
    savePresets(next);
  }
  function onReferenceFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setReference({ url: String(reader.result), opacity: 0.4, visible: true });
    reader.readAsDataURL(file);
  }
  function bookmarkCurrent() {
    const label = bookmarkNameDraft.trim() || undefined;
    engineRef.current?.bookmarkCurrent(label ?? '');
    setBookmarkNameDraft('');
  }

  const eng = engineRef.current;
  const layerOrder = eng ? [...eng.layers].reverse() : [];
  const historyList = eng ? eng.historyList() : [];
  const bookmarkList = eng ? eng.listBookmarks() : [];

  return (
    <div id="dpRoot">
      <div id="dpTopbar">
        <button className="chip" onClick={onExit}><Icon name="chevronLeft" size={12} /> ALL BOARDS</button>
        <div id="dpToolgroup">
          {(
            [
              ['brush', 'brush'],
              ['eraser', 'eraser'],
              ['marquee', 'rect'],
              // no dedicated "lasso" glyph exists in the shared icon set —
              // `select` (a generic pointer/selection icon) is the closest
              // available stand-in for a free-form selection tool.
              ['lasso', 'select'],
              ['wand', 'wand'],
              ['fill', 'bucket'],
              ['eyedropper', 'droplet'],
              ['gradient', 'radial'],
              ['clone', 'stamp'],
              ['smudge', 'smudge'],
              ['heal', 'heal'],
              ['text', 'text'],
            ] as [Tool, IconName][]
          ).map(([t, icon]) => (
            <span key={t} className={`tool ${tool === t ? 'on' : ''}`} onClick={() => setTool(t)} title={t}>
              <Icon name={icon} size={14} />
            </span>
          ))}
        </div>
        <div id="dpTopActions">
          <button className="chip" disabled={!eng?.canUndo()} onClick={() => { engineRef.current?.undo(); bump(); }}><Icon name="undo" size={12} /> UNDO</button>
          <button className="chip" disabled={!eng?.canRedo()} onClick={() => { engineRef.current?.redo(); bump(); }}><Icon name="redo" size={12} /> REDO</button>
          <button className="chip" onClick={() => { engineRef.current?.clearSelection(); bump(); }}>DESELECT</button>
          <button className="chip" onClick={() => setPanel(panel === 'adjust' ? 'none' : 'adjust')}>ADJUST</button>
          <button className="chip" onClick={() => setPanel(panel === 'filters' ? 'none' : 'filters')}>FILTERS</button>
          <button className="chip" onClick={() => setPanel(panel === 'history' ? 'none' : 'history')}>HISTORY</button>
          <button className="chip" onClick={() => setPanel(panel === 'resize' ? 'none' : 'resize')}>RESIZE/CROP</button>
          <button className="chip" onClick={() => setPanel(panel === 'export' ? 'none' : 'export')}>EXPORT <Icon name="chevronDown" size={12} /></button>
        </div>
      </div>

      <div id="dpBody">
        {(tool === 'brush' || tool === 'eraser') && (
          <div id="dpBrushPanel" className="gpanel">
            <h3>BRUSH</h3>
            <div id="dpBrushTypes">
              {BRUSH_TYPES.map((b) => (
                <span key={b.key} className={`bt ${brush.type === b.key ? 'on' : ''}`} onClick={() => setBrush((s) => ({ ...s, type: b.key }))} title={b.label}>
                  <Icon name={b.icon} size={14} />
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

            <h3 style={{ marginTop: 14 }}>SYMMETRY</h3>
            <div id="dpSymmetryRow">
              {(
                [
                  ['none', null, 'OFF', 'No symmetry'],
                  ['vertical', 'arrowUpDown', undefined, 'Vertical symmetry'],
                  ['horizontal', 'swap', undefined, 'Horizontal symmetry'],
                  ['radial4', 'radial', undefined, '4-way radial symmetry'],
                ] as [SymmetryMode, IconName | null, string | undefined, string][]
              ).map(([m, icon, label, title]) => (
                <span key={m} className={`chip small ${symmetry === m ? 'on' : ''}`} onClick={() => pickSymmetry(m)} title={title}>
                  {icon ? <Icon name={icon} size={12} /> : label}
                </span>
              ))}
            </div>

            <h3 style={{ marginTop: 14 }}>
              BRUSH PRESETS
            </h3>
            <div id="dpPresetRow">
              {presets.map((p) => (
                <span key={p.id} className="presetChip" onClick={() => setBrush(p.settings)} title={p.name}>
                  {p.name}
                  <i className="presetDel" onClick={(e) => { e.stopPropagation(); deletePreset(p.id); }}><Icon name="trash" size={11} /></i>
                </span>
              ))}
              {!presets.length && <div className="rsub" style={{ fontSize: 8 }}>No saved presets yet.</div>}
            </div>
            <div id="dpPresetSave">
              <input id="presetNameInput" placeholder="Preset name…" value={presetNameDraft} onChange={(e) => setPresetNameDraft(e.target.value)} />
              <button className="wbtn" id="savePresetBtn" onClick={savePreset}>SAVE</button>
            </div>

            <h3 style={{ marginTop: 14 }}>REFERENCE IMAGE</h3>
            <input ref={referenceInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onReferenceFile(e.target.files?.[0] ?? null)} />
            <button className="wbtn" id="refUploadBtn" onClick={() => referenceInputRef.current?.click()}>UPLOAD</button>
            {reference && (
              <div id="dpRefControls">
                <label>OPACITY {Math.round(reference.opacity * 100)}%</label>
                <input type="range" min={5} max={90} value={Math.round(reference.opacity * 100)} onChange={(e) => setReference((r) => (r ? { ...r, opacity: +e.target.value / 100 } : r))} />
                <button className="chip small" onClick={() => setReference((r) => (r ? { ...r, visible: !r.visible } : r))}>
                  {reference.visible ? 'HIDE' : 'SHOW'}
                </button>
                <button className="chip small" onClick={() => setReference(null)}>REMOVE</button>
              </div>
            )}
          </div>
        )}
        {(tool === 'wand' || tool === 'fill') && (
          <div id="dpBrushPanel" className="gpanel">
            <h3>TOLERANCE</h3>
            <label>{tolerance}</label>
            <input type="range" min={1} max={120} value={tolerance} onChange={(e) => setTolerance(+e.target.value)} />
          </div>
        )}
        {tool === 'clone' && (
          <div id="dpBrushPanel" className="gpanel">
            <h3>CLONE STAMP</h3>
            <div className="rsub" style={{ fontSize: 9 }}>{(cloneArmed || eng?.hasCloneSource()) ? 'Source set — click/drag to paint from it.' : 'Alt-click (or just click) to set a clone source.'}</div>
            <label>SIZE {Math.round(brush.size)}px</label>
            <input type="range" min={4} max={200} value={brush.size} onChange={(e) => setBrush((s) => ({ ...s, size: +e.target.value }))} />
          </div>
        )}
        {tool === 'smudge' && (
          <div id="dpBrushPanel" className="gpanel">
            <h3>SMUDGE</h3>
            <label>SIZE {Math.round(brush.size)}px</label>
            <input type="range" min={4} max={200} value={brush.size} onChange={(e) => setBrush((s) => ({ ...s, size: +e.target.value }))} />
            <label>STRENGTH {Math.round(brush.flow * 100)}%</label>
            <input type="range" min={5} max={100} value={Math.round(brush.flow * 100)} onChange={(e) => setBrush((s) => ({ ...s, flow: +e.target.value / 100 }))} />
          </div>
        )}
        {tool === 'heal' && (
          <div id="dpBrushPanel" className="gpanel">
            <h3>SPOT HEAL</h3>
            <div className="rsub" style={{ fontSize: 9 }}>Click a blemish to blend it into its surroundings.</div>
            <label>SIZE {Math.round(brush.size)}px</label>
            <input type="range" min={6} max={140} value={brush.size} onChange={(e) => setBrush((s) => ({ ...s, size: +e.target.value }))} />
          </div>
        )}
        {tool === 'text' && (
          <div id="dpBrushPanel" className="gpanel">
            <h3>TEXT</h3>
            <div className="rsub" style={{ fontSize: 9 }}>Click the canvas to place a text box.</div>
            <label>SIZE {Math.round(brush.size)}</label>
            <input type="range" min={8} max={160} value={brush.size} onChange={(e) => setBrush((s) => ({ ...s, size: +e.target.value }))} />
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

              <div style={{ height: 10 }} />
              <h3>LEVELS</h3>
              <label>BLACK POINT {levels.black}</label>
              <input type="range" min={0} max={250} value={levels.black} onChange={(e) => setLevels((l) => ({ ...l, black: +e.target.value }))} />
              <label>WHITE POINT {levels.white}</label>
              <input type="range" min={5} max={255} value={levels.white} onChange={(e) => setLevels((l) => ({ ...l, white: +e.target.value }))} />
              <label>GAMMA ×{levels.gamma.toFixed(2)}</label>
              <input type="range" min={20} max={300} value={Math.round(levels.gamma * 100)} onChange={(e) => setLevels((l) => ({ ...l, gamma: +e.target.value / 100 }))} />
              <button className="wbtn" id="applyLevelsBtn" onClick={applyLevels}>APPLY LEVELS</button>

              <div style={{ height: 10 }} />
              <h3>CURVES</h3>
              <CurveEditor points={curvePoints} onChange={setCurvePoints} />
              <button className="wbtn" id="applyCurveBtn" onClick={applyCurve}>APPLY CURVE</button>

              <div style={{ height: 10 }} />
              <h3>COLOR BALANCE</h3>
              {(
                [
                  ['SHADOWS', 'shadows'],
                  ['MIDTONES', 'mids'],
                  ['HIGHLIGHTS', 'highlights'],
                ] as [string, 'shadows' | 'mids' | 'highlights'][]
              ).map(([label, key]) => (
                <div key={key} className="cbGroup">
                  <label>{label}</label>
                  {(['R', 'G', 'B'] as const).map((ch, i) => (
                    <input
                      key={ch}
                      type="range"
                      min={-100}
                      max={100}
                      value={colorBalance[key][i]}
                      title={ch}
                      onChange={(e) =>
                        setColorBalance((cb) => {
                          const arr = [...cb[key]] as [number, number, number];
                          arr[i] = +e.target.value;
                          return { ...cb, [key]: arr };
                        })
                      }
                    />
                  ))}
                </div>
              ))}
              <button className="wbtn" id="applyColorBalanceBtn" onClick={applyColorBalance}>APPLY COLOR BALANCE</button>
              <button className="wbtn ghost" id="applyBWBtn" onClick={applyBW}>CONVERT TO B&amp;W</button>
            </div>
          )}
          {panel === 'filters' && (
            <div id="dpAdjustPanel" className="gpanel">
              <h3>FILTERS</h3>
              <label>BLUR RADIUS {filters.blur}px</label>
              <input type="range" min={1} max={16} value={filters.blur} onChange={(e) => setFilters((f) => ({ ...f, blur: +e.target.value }))} />
              <button className="wbtn" onClick={applyBlur}>APPLY BLUR</button>
              <div style={{ height: 8 }} />
              <button className="wbtn ghost" onClick={applySharpen}>SHARPEN</button>
              <div style={{ height: 8 }} />
              <label>NOISE AMOUNT {filters.noise}</label>
              <input type="range" min={2} max={100} value={filters.noise} onChange={(e) => setFilters((f) => ({ ...f, noise: +e.target.value }))} />
              <button className="wbtn" id="applyNoiseBtn" onClick={applyNoise}>APPLY NOISE</button>
              <div style={{ height: 8 }} />
              <label>PIXELATE BLOCK {filters.pixelate}px</label>
              <input type="range" min={2} max={60} value={filters.pixelate} onChange={(e) => setFilters((f) => ({ ...f, pixelate: +e.target.value }))} />
              <button className="wbtn" id="applyPixelateBtn" onClick={applyPixelate}>APPLY PIXELATE</button>
            </div>
          )}
          {panel === 'history' && (
            <div id="dpAdjustPanel" className="gpanel">
              <h3>HISTORY</h3>
              <div id="dpHistoryList">
                {!historyList.length && <div className="rsub" style={{ fontSize: 9 }}>No steps yet — make an edit.</div>}
                {historyList.map((h) => (
                  <div key={h.index} className="historyRow" onClick={() => { engineRef.current?.jumpToHistoryIndex(h.index); bump(); }}>
                    {h.label}
                  </div>
                ))}
                <div className="historyRow current">Now</div>
              </div>
              <div style={{ height: 10 }} />
              <h3>BOOKMARKS</h3>
              <div id="dpBookmarkRow">
                <input placeholder="Bookmark name…" value={bookmarkNameDraft} onChange={(e) => setBookmarkNameDraft(e.target.value)} />
                <button className="wbtn" id="addBookmarkBtn" onClick={bookmarkCurrent}><Icon name="pin" size={12} /> SAVE</button>
              </div>
              {bookmarkList.map((b) => (
                <div key={b.id} className="historyRow bookmark">
                  <span onClick={() => { engineRef.current?.restoreBookmark(b.id); bump(); }}><Icon name="pin" size={11} /> {b.label}</span>
                  <i onClick={() => { engineRef.current?.deleteBookmark(b.id); bump(); }}><Icon name="trash" size={11} /></i>
                </div>
              ))}
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
            <div style={{ position: 'relative', width: (eng?.width ?? DEFAULT_W) * zoom, height: (eng?.height ?? DEFAULT_H) * zoom }}>
              {reference?.visible && (
                <img
                  id="dpReferenceOverlay"
                  src={reference.url}
                  style={{ opacity: reference.opacity, width: '100%', height: '100%', objectFit: 'contain', position: 'absolute', inset: 0, pointerEvents: 'none' }}
                />
              )}
              <canvas
                ref={canvasRef}
                style={{ width: (eng?.width ?? DEFAULT_W) * zoom, height: (eng?.height ?? DEFAULT_H) * zoom, touchAction: 'none', position: 'relative' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
              />
              {symmetry === 'vertical' || symmetry === 'radial4' ? <div className="dpSymGuide vert" /> : null}
              {symmetry === 'horizontal' || symmetry === 'radial4' ? <div className="dpSymGuide horiz" /> : null}
              {textDraft && (
                <div
                  id="dpTextOverlay"
                  style={{ left: textDraft.x * zoom, top: textDraft.y * zoom, fontSize: Math.max(10, brush.size * 1.4 * zoom), color: brush.color }}
                >
                  <input
                    id="dpTextInput"
                    autoFocus
                    value={textDraft.value}
                    style={{ fontSize: Math.max(10, brush.size * 1.4 * zoom), color: brush.color }}
                    onChange={(e) => setTextDraft((t) => (t ? { ...t, value: e.target.value } : t))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitText();
                      if (e.key === 'Escape') setTextDraft(null);
                    }}
                    onBlur={commitText}
                  />
                </div>
              )}
            </div>
          </div>
          <div id="dpZoom">
            <span className="tool" onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}><Icon name="minus" size={12} /></span>
            <span>{Math.round(zoom * 100)}%</span>
            <span className="tool" onClick={() => setZoom((z) => Math.min(4, z + 0.1))}><Icon name="plus" size={12} /></span>
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
              <span className="lyAdd" onClick={() => { engineRef.current?.addLayer(); bump(); }}><Icon name="plus" size={12} /></span>
            </h3>
            {layerOrder.map((l) => (
              <div key={l.meta.id} className={`layer-row ${eng?.activeLayerId === l.meta.id ? 'sel' : ''}`} onClick={() => { if (eng) { eng.activeLayerId = l.meta.id; bump(); } }}>
                <span className={`vis ${l.meta.visible ? '' : 'off'}`} onClick={(e) => { e.stopPropagation(); engineRef.current?.setLayerProp(l.meta.id, 'visible', !l.meta.visible); bump(); }}>
                  <Icon name={l.meta.visible ? 'eye' : 'eyeOff'} size={12} />
                </span>
                <span className="lbl">{l.meta.name}</span>
                <span className="lyDup" onClick={(e) => { e.stopPropagation(); engineRef.current?.duplicateLayer(l.meta.id); bump(); }} title="Duplicate"><Icon name="copy" size={12} /></span>
                <span className="lyDel" onClick={(e) => { e.stopPropagation(); engineRef.current?.deleteLayer(l.meta.id); bump(); }} title="Delete"><Icon name="trash" size={12} /></span>
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

/** A real, draggable piecewise-linear tone curve editor — points are actual
 * (input, output) pairs the Captain can drag; DrawEngine.applyCurve()
 * builds a 256-entry LUT from them. Click empty space to add a point,
 * drag an existing point to move it, double-click a point to remove it
 * (endpoints are protected so the curve always spans the full range). */
function CurveEditor({ points, onChange }: { points: { x: number; y: number }[]; onChange: (pts: { x: number; y: number }[]) => void }) {
  const size = 180;
  const svgRef = useRef<SVGSVGElement>(null);
  const dragIdx = useRef<number | null>(null);

  function toLocal(e: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(255, ((e.clientX - rect.left) / size) * 255));
    const y = Math.max(0, Math.min(255, 255 - ((e.clientY - rect.top) / size) * 255));
    return { x, y };
  }

  function onPointDown(i: number, e: React.PointerEvent<SVGCircleElement>) {
    e.stopPropagation();
    dragIdx.current = i;
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function onSvgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (dragIdx.current === null) return;
    const { x, y } = toLocal(e);
    const i = dragIdx.current;
    const next = points.map((p, idx) => (idx === i ? { x: i === 0 ? 0 : i === points.length - 1 ? 255 : x, y } : p));
    onChange(next);
  }
  function onSvgPointerUp() {
    dragIdx.current = null;
  }
  function onSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    if (dragIdx.current !== null) return;
    const { x, y } = toLocal(e);
    const next = [...points, { x, y }].sort((a, b) => a.x - b.x);
    onChange(next);
  }
  function removePoint(i: number) {
    if (i === 0 || i === points.length - 1 || points.length <= 2) return;
    onChange(points.filter((_, idx) => idx !== i));
  }

  const sorted = [...points].sort((a, b) => a.x - b.x);
  const path = sorted.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x / 255) * size} ${size - (p.y / 255) * size}`).join(' ');

  return (
    <svg
      id="dpCurveEditor"
      ref={svgRef}
      width={size}
      height={size}
      onPointerMove={onSvgPointerMove}
      onPointerUp={onSvgPointerUp}
      onClick={onSvgClick}
    >
      <rect x={0} y={0} width={size} height={size} fill="rgba(0,245,255,.04)" stroke="var(--edge)" />
      <line x1={0} y1={size} x2={size} y2={0} stroke="rgba(255,255,255,.12)" strokeDasharray="3,3" />
      <path d={path} fill="none" stroke="#00F5FF" strokeWidth={1.5} />
      {sorted.map((p, i) => (
        <circle
          key={i}
          className="curvePoint"
          cx={(p.x / 255) * size}
          cy={size - (p.y / 255) * size}
          r={4}
          onPointerDown={(e) => onPointDown(i, e)}
          onDoubleClick={() => removePoint(i)}
        />
      ))}
    </svg>
  );
}
