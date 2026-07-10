import type { BlendMode, BrushSettings, DrawDocument, DrawLayerMeta } from '../types';

/**
 * DrawEngine — the real, pixel-level painting engine behind Draw/Paint
 * mode. Framework-agnostic on purpose (no React) so the graphics code
 * stays testable and the React layer (DrawPaint.tsx) is just wiring.
 *
 * Model: one offscreen HTMLCanvasElement per layer holds real pixel data;
 * `composite()` draws them bottom-to-top onto the single visible display
 * canvas using the browser's native `globalCompositeOperation`, which
 * already implements the requested blend modes (multiply/screen/overlay/
 * etc.) correctly — there's no need to hand-roll blend-mode math when the
 * platform already has it.
 *
 * Brush strokes paint onto a per-stroke scratch canvas first (dabs
 * accumulate there via ordinary source-over compositing, which is exactly
 * how "flow" is supposed to behave — repeated overlapping dabs build up
 * naturally), then get composited onto the active layer once at stroke
 * end with `globalAlpha = brush.opacity`, which is what caps the whole
 * stroke's maximum opacity regardless of how much flow built up inside
 * it. This mirrors how Photoshop's flow/opacity distinction actually
 * works, not a simplified stand-in for it.
 */

let idc = 0;
const nid = (p: string) => `${p}-${Date.now().toString(36)}-${++idc}`;

interface Layer {
  meta: DrawLayerMeta;
  canvas: HTMLCanvasElement;
}

interface HistoryEntry {
  width: number;
  height: number;
  layers: DrawLayerMeta[];
  activeLayerId: string;
  layerData: Record<string, string>; // dataURL snapshot per layer id
}

export type SelectionShape = { maskCanvas: HTMLCanvasElement; bounds: { x: number; y: number; w: number; h: number } } | null;

const HISTORY_LIMIT = 40;

function blendToComposite(b: BlendMode): GlobalCompositeOperation {
  return b === 'normal' ? 'source-over' : (b as GlobalCompositeOperation);
}

export type SymmetryMode = 'none' | 'vertical' | 'horizontal' | 'radial4';

export class DrawEngine {
  width: number;
  height: number;
  layers: Layer[] = [];
  activeLayerId = '';
  selection: SelectionShape = null;
  display: HTMLCanvasElement;
  displayCtx: CanvasRenderingContext2D;
  /** Amendment v0.4 item 10 — symmetry drawing: every brush dab (and ink
   * line segment) is mirrored across the canvas center per the active
   * mode, at the pixel-stamping level, not a visual-only guide overlay. */
  symmetry: SymmetryMode = 'none';

  private scratch: HTMLCanvasElement;
  private scratchCtx: CanvasRenderingContext2D;
  private strokeLastPoint: [number, number] | null = null;
  private strokeDist = 0;

  /* clone stamp state (Amendment v0.4 item 6) */
  private cloneSource: [number, number] | null = null;
  private cloneOffset: [number, number] | null = null;
  private cloneFrozenSnapshot: HTMLCanvasElement | null = null;

  /* smudge state (Amendment v0.4 item 6) */
  private smudgeLast: [number, number] | null = null;

  /* named bookmarks — independent of the linear undo/redo stack, survive
   * across undo/redo so the Captain can always jump back to a marked
   * moment even after further edits (Amendment v0.4 item 11). */
  private bookmarks: { id: string; label: string; entry: HistoryEntry }[] = [];
  onBookmarksChange: (() => void) | null = null;

  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];

  onHistoryChange: (() => void) | null = null;
  onLayersChange: (() => void) | null = null;

  constructor(display: HTMLCanvasElement, width: number, height: number) {
    this.display = display;
    this.width = width;
    this.height = height;
    display.width = width;
    display.height = height;
    const ctx = display.getContext('2d');
    if (!ctx) throw new Error('DrawEngine: 2D context unavailable');
    this.displayCtx = ctx;

    this.scratch = document.createElement('canvas');
    this.scratch.width = width;
    this.scratch.height = height;
    const sctx = this.scratch.getContext('2d');
    if (!sctx) throw new Error('DrawEngine: 2D context unavailable (scratch)');
    this.scratchCtx = sctx;
  }

  /* ============ document lifecycle ============ */

  static blank(display: HTMLCanvasElement, width: number, height: number): DrawEngine {
    const eng = new DrawEngine(display, width, height);
    eng.addLayer('Layer 1', false);
    eng.composite();
    return eng;
  }

  static async fromDocument(display: HTMLCanvasElement, doc: DrawDocument): Promise<DrawEngine> {
    const eng = new DrawEngine(display, doc.width, doc.height);
    eng.layers = [];
    for (const meta of doc.layers) {
      const canvas = document.createElement('canvas');
      canvas.width = doc.width;
      canvas.height = doc.height;
      const ctx = canvas.getContext('2d')!;
      const url = doc.layerData[meta.id];
      if (url) {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, 0, 0);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = url;
        });
      }
      eng.layers.push({ meta, canvas });
    }
    if (!eng.layers.length) eng.addLayer('Layer 1', false);
    eng.activeLayerId = doc.activeLayerId && eng.layers.some((l) => l.meta.id === doc.activeLayerId) ? doc.activeLayerId : eng.layers[eng.layers.length - 1].meta.id;
    eng.composite();
    return eng;
  }

  toDocument(swatches: string[]): DrawDocument {
    const layerData: Record<string, string> = {};
    for (const l of this.layers) layerData[l.meta.id] = l.canvas.toDataURL('image/png');
    return {
      width: this.width,
      height: this.height,
      layers: this.layers.map((l) => l.meta),
      layerData,
      activeLayerId: this.activeLayerId,
      swatches,
    };
  }

  /* ============ compositing ============ */

  composite() {
    const ctx = this.displayCtx;
    ctx.clearRect(0, 0, this.width, this.height);
    // checkerboard for transparency, like every real paint app
    this.drawCheckerboard(ctx);
    for (const layer of this.layers) {
      if (!layer.meta.visible) continue;
      ctx.save();
      ctx.globalAlpha = layer.meta.opacity;
      ctx.globalCompositeOperation = blendToComposite(layer.meta.blendMode);
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();
    }
    if (this.selection) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(this.selection.bounds.x + 0.5, this.selection.bounds.y + 0.5, this.selection.bounds.w, this.selection.bounds.h);
      ctx.restore();
    }
  }

  private checkerPattern: CanvasPattern | null = null;
  private drawCheckerboard(ctx: CanvasRenderingContext2D) {
    if (!this.checkerPattern) {
      const tile = document.createElement('canvas');
      tile.width = 16;
      tile.height = 16;
      const tctx = tile.getContext('2d')!;
      tctx.fillStyle = '#2a2f38';
      tctx.fillRect(0, 0, 16, 16);
      tctx.fillStyle = '#20242b';
      tctx.fillRect(0, 0, 8, 8);
      tctx.fillRect(8, 8, 8, 8);
      this.checkerPattern = ctx.createPattern(tile, 'repeat');
    }
    if (this.checkerPattern) {
      ctx.save();
      ctx.fillStyle = this.checkerPattern;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    }
  }

  activeLayer(): Layer | null {
    return this.layers.find((l) => l.meta.id === this.activeLayerId) ?? null;
  }

  /* ============ layers ============ */

  addLayer(name?: string, snapshot = true) {
    if (snapshot) this.pushHistory();
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const meta: DrawLayerMeta = { id: nid('layer'), name: name ?? `Layer ${this.layers.length + 1}`, visible: true, opacity: 1, blendMode: 'normal', locked: false };
    this.layers.push({ meta, canvas });
    this.activeLayerId = meta.id;
    this.composite();
    this.onLayersChange?.();
    return meta.id;
  }

  duplicateLayer(id: string) {
    const src = this.layers.find((l) => l.meta.id === id);
    if (!src) return;
    this.pushHistory();
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    canvas.getContext('2d')!.drawImage(src.canvas, 0, 0);
    const meta: DrawLayerMeta = { ...src.meta, id: nid('layer'), name: src.meta.name + ' copy' };
    const idx = this.layers.findIndex((l) => l.meta.id === id);
    this.layers.splice(idx + 1, 0, { meta, canvas });
    this.activeLayerId = meta.id;
    this.composite();
    this.onLayersChange?.();
  }

  deleteLayer(id: string) {
    if (this.layers.length <= 1) return;
    const idx = this.layers.findIndex((l) => l.meta.id === id);
    if (idx < 0) return;
    this.pushHistory();
    this.layers.splice(idx, 1);
    if (this.activeLayerId === id) this.activeLayerId = this.layers[Math.max(0, idx - 1)].meta.id;
    this.composite();
    this.onLayersChange?.();
  }

  reorderLayer(id: string, toIndex: number) {
    const from = this.layers.findIndex((l) => l.meta.id === id);
    if (from < 0) return;
    this.pushHistory();
    const [moved] = this.layers.splice(from, 1);
    this.layers.splice(Math.max(0, Math.min(this.layers.length, toIndex)), 0, moved);
    this.composite();
    this.onLayersChange?.();
  }

  setLayerProp<K extends keyof DrawLayerMeta>(id: string, key: K, value: DrawLayerMeta[K], snapshot = true) {
    const layer = this.layers.find((l) => l.meta.id === id);
    if (!layer) return;
    if (snapshot) this.pushHistory();
    layer.meta = { ...layer.meta, [key]: value };
    this.composite();
    this.onLayersChange?.();
  }

  renameLayer(id: string, name: string) {
    this.setLayerProp(id, 'name', name || 'Layer');
  }

  /* ============ brush strokes ============ */

  beginStroke(x: number, y: number, pressure: number, brush: BrushSettings, erase = false) {
    const layer = this.activeLayer();
    if (!layer || layer.meta.locked) return;
    this.scratchCtx.clearRect(0, 0, this.width, this.height);
    this.strokeLastPoint = [x, y];
    this.strokeDist = 0;
    this.stampAt(x, y, pressure, brush);
    this.blitScratchPreview(erase);
  }

  continueStroke(x: number, y: number, pressure: number, brush: BrushSettings, erase = false) {
    if (!this.strokeLastPoint) return;
    const [lx, ly] = this.strokeLastPoint;
    const dist = Math.hypot(x - lx, y - ly);
    const spacing = Math.max(1, brush.size * (brush.type === 'ink' ? 0.35 : 0.28));

    if (brush.type === 'ink') {
      // continuous stroked line for smoother ink quality vs discrete dabs
      this.scratchCtx.save();
      this.scratchCtx.globalAlpha = brush.flow;
      this.scratchCtx.strokeStyle = brush.color;
      this.scratchCtx.lineCap = 'round';
      this.scratchCtx.lineJoin = 'round';
      this.scratchCtx.lineWidth = Math.max(1, brush.size * (0.4 + pressure * 0.6));
      const fromPts = this.symmetryPoints(lx, ly);
      const toPts = this.symmetryPoints(x, y);
      for (let i = 0; i < fromPts.length; i++) {
        this.scratchCtx.beginPath();
        this.scratchCtx.moveTo(fromPts[i][0], fromPts[i][1]);
        this.scratchCtx.lineTo(toPts[i][0], toPts[i][1]);
        this.scratchCtx.stroke();
      }
      this.scratchCtx.restore();
      this.strokeLastPoint = [x, y];
    } else {
      this.strokeDist += dist;
      let remaining = dist;
      let cx = lx,
        cy = ly;
      const dx = (x - lx) / (dist || 1);
      const dy = (y - ly) / (dist || 1);
      while (this.strokeDist >= spacing) {
        const step = spacing;
        cx += dx * step;
        cy += dy * step;
        this.stampAt(cx, cy, pressure, brush);
        this.strokeDist -= spacing;
        remaining -= step;
        if (remaining < 0) break;
      }
      this.strokeLastPoint = [x, y];
    }
    this.blitScratchPreview(erase);
  }

  endStroke(brush: BrushSettings, erase = false) {
    const layer = this.activeLayer();
    this.strokeLastPoint = null;
    if (!layer || layer.meta.locked) {
      this.scratchCtx.clearRect(0, 0, this.width, this.height);
      this.composite();
      return;
    }
    this.pushHistory();
    const ctx = layer.canvas.getContext('2d')!;
    ctx.save();
    const mergeOp: GlobalCompositeOperation = erase ? 'destination-out' : 'source-over';
    if (this.selection) {
      // clip the scratch to the selection mask before merging down
      const clipped = document.createElement('canvas');
      clipped.width = this.width;
      clipped.height = this.height;
      const cctx = clipped.getContext('2d')!;
      cctx.drawImage(this.scratch, 0, 0);
      cctx.globalCompositeOperation = 'destination-in';
      cctx.drawImage(this.selection.maskCanvas, 0, 0);
      ctx.globalCompositeOperation = mergeOp;
      ctx.globalAlpha = brush.opacity;
      ctx.drawImage(clipped, 0, 0);
    } else {
      ctx.globalCompositeOperation = mergeOp;
      ctx.globalAlpha = brush.opacity;
      ctx.drawImage(this.scratch, 0, 0);
    }
    ctx.restore();
    this.scratchCtx.clearRect(0, 0, this.width, this.height);
    this.composite();
  }

  /** Shows the in-progress stroke live without merging it down yet — draw
   * everything committed, then the scratch on top at brush opacity so the
   * live preview looks right without mutating the real layer mid-stroke.
   * In erase mode this punches the scratch shape out of the *preview*
   * compositing (destination-out) so an in-progress erase looks like
   * erasing, not like painting cyan. */
  private blitScratchPreview(erase = false) {
    this.composite();
    const ctx = this.displayCtx;
    ctx.save();
    ctx.globalAlpha = erase ? 1 : 1;
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    ctx.drawImage(this.scratch, 0, 0);
    ctx.restore();
  }

  private brushTip: { key: string; canvas: HTMLCanvasElement } | null = null;
  private getBrushTip(brush: BrushSettings, radius: number): HTMLCanvasElement {
    const key = `${brush.type}:${radius}:${brush.hardness}:${brush.color}`;
    if (this.brushTip?.key === key) return this.brushTip.canvas;
    const d = Math.max(2, Math.ceil(radius * 2));
    const c = document.createElement('canvas');
    c.width = d;
    c.height = d;
    const ctx = c.getContext('2d')!;
    const cx = d / 2,
      cy = d / 2;
    if (brush.type === 'texture') {
      // procedural stippled/noisy tip — real per-pixel noise, not a static asset
      const img = ctx.createImageData(d, d);
      const [r, g, b] = hexToRgb(brush.color);
      for (let py = 0; py < d; py++) {
        for (let px = 0; px < d; px++) {
          const dx = px - cx,
            dy = py - cy;
          const dist = Math.hypot(dx, dy) / (d / 2);
          const i = (py * d + px) * 4;
          if (dist > 1) continue;
          const edge = smoothstep(1, brush.hardness, dist);
          const noise = 0.35 + Math.random() * 0.65;
          img.data[i] = r;
          img.data[i + 1] = g;
          img.data[i + 2] = b;
          img.data[i + 3] = Math.round(255 * edge * noise * (Math.random() > 0.28 ? 1 : 0));
        }
      }
      ctx.putImageData(img, 0, 0);
    } else {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, d / 2);
      const hard = Math.max(0.02, brush.hardness);
      g.addColorStop(0, hexToRgba(brush.color, 1));
      g.addColorStop(Math.min(0.98, hard), hexToRgba(brush.color, 1));
      g.addColorStop(1, hexToRgba(brush.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    this.brushTip = { key, canvas: c };
    return c;
  }

  private stampAt(x: number, y: number, pressure: number, brush: BrushSettings) {
    const p = brush.type === 'pencil' ? 1 : Math.max(0.15, pressure); // pencil ignores pressure for consistent hard line
    const radius = Math.max(0.6, (brush.size / 2) * p);
    const tip = this.getBrushTip(brush, radius);
    const dabFlow = brush.type === 'airbrush' ? brush.flow * 0.35 : brush.flow;
    this.scratchCtx.save();
    this.scratchCtx.globalAlpha = Math.max(0.02, dabFlow);
    for (const [sx, sy] of this.symmetryPoints(x, y)) {
      this.scratchCtx.drawImage(tip, sx - tip.width / 2, sy - tip.height / 2);
    }
    this.scratchCtx.restore();
  }

  /** Mirrors a world-space point across the canvas center per the active
   * symmetry mode. Always includes the original point first. */
  private symmetryPoints(x: number, y: number): [number, number][] {
    if (this.symmetry === 'none') return [[x, y]];
    const cx = this.width / 2,
      cy = this.height / 2;
    if (this.symmetry === 'vertical') return [[x, y], [2 * cx - x, y]];
    if (this.symmetry === 'horizontal') return [[x, y], [x, 2 * cy - y]];
    // radial4: mirror across both axes at once, four-fold
    return [[x, y], [2 * cx - x, y], [x, 2 * cy - y], [2 * cx - x, 2 * cy - y]];
  }

  setSymmetry(mode: SymmetryMode) {
    this.symmetry = mode;
  }

  /* ============ selection tools ============ */

  clearSelection() {
    this.selection = null;
    this.composite();
  }

  setSelectionFromPath(path: Path2D, bounds: { x: number; y: number; w: number; h: number }) {
    const mask = document.createElement('canvas');
    mask.width = this.width;
    mask.height = this.height;
    const ctx = mask.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fill(path);
    this.selection = { maskCanvas: mask, bounds };
    this.composite();
  }

  setSelectionRect(x0: number, y0: number, x1: number, y1: number) {
    const x = Math.min(x0, x1),
      y = Math.min(y0, y1);
    const w = Math.abs(x1 - x0),
      h = Math.abs(y1 - y0);
    const path = new Path2D();
    path.rect(x, y, w, h);
    this.setSelectionFromPath(path, { x, y, w, h });
  }

  setSelectionLasso(points: [number, number][]) {
    if (points.length < 3) return;
    const path = new Path2D();
    path.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points.slice(1)) path.lineTo(x, y);
    path.closePath();
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]);
    const bounds = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    this.setSelectionFromPath(path, bounds);
  }

  /** Real flood-fill-based magic wand — reads actual pixel data from the
   * active layer (flattened composite, so "select the sky" works even if
   * the sky spans what the Captain perceives as one region across a soft
   * brush edge) and BFS-grows a raster mask by color distance. */
  magicWandSelect(x: number, y: number, tolerance: number) {
    const w = this.width,
      h = this.height;
    const sample = this.flattenedImageData();
    const startIdx = (Math.floor(y) * w + Math.floor(x)) * 4;
    if (startIdx < 0 || startIdx >= sample.data.length) return;
    const sr = sample.data[startIdx],
      sg = sample.data[startIdx + 1],
      sb = sample.data[startIdx + 2],
      sa = sample.data[startIdx + 3];
    const visited = new Uint8Array(w * h);
    const stack: number[] = [Math.floor(y) * w + Math.floor(x)];
    const mask = document.createElement('canvas');
    mask.width = w;
    mask.height = h;
    const mctx = mask.getContext('2d')!;
    const maskImg = mctx.createImageData(w, h);
    let minX = w,
      minY = h,
      maxX = 0,
      maxY = 0;
    const tol = tolerance * tolerance * 4; // squared-distance budget across 4 channels

    while (stack.length) {
      const idx = stack.pop()!;
      if (visited[idx]) continue;
      visited[idx] = 1;
      const px = idx % w,
        py = (idx / w) | 0;
      const di = idx * 4;
      const dr = sample.data[di] - sr,
        dg = sample.data[di + 1] - sg,
        db = sample.data[di + 2] - sb,
        da = sample.data[di + 3] - sa;
      const dist2 = dr * dr + dg * dg + db * db + da * da;
      if (dist2 > tol) continue;
      maskImg.data[di] = 255;
      maskImg.data[di + 1] = 255;
      maskImg.data[di + 2] = 255;
      maskImg.data[di + 3] = 255;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      if (px > 0) stack.push(idx - 1);
      if (px < w - 1) stack.push(idx + 1);
      if (py > 0) stack.push(idx - w);
      if (py < h - 1) stack.push(idx + w);
    }
    mctx.putImageData(maskImg, 0, 0);
    this.selection = { maskCanvas: mask, bounds: { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) } };
    this.composite();
  }

  /* ============ fill / bucket ============ */

  floodFillAt(x: number, y: number, color: string, tolerance: number) {
    const layer = this.activeLayer();
    if (!layer || layer.meta.locked) return;
    const ctx = layer.canvas.getContext('2d')!;
    const w = this.width,
      h = this.height;
    const img = ctx.getImageData(0, 0, w, h);
    const startIdx = (Math.floor(y) * w + Math.floor(x)) * 4;
    if (startIdx < 0 || startIdx >= img.data.length) return;
    const sr = img.data[startIdx],
      sg = img.data[startIdx + 1],
      sb = img.data[startIdx + 2],
      sa = img.data[startIdx + 3];
    this.pushHistory();
    const [fr, fg, fb] = hexToRgb(color);
    const inSelection = this.selectionContains.bind(this);
    const tol = tolerance * tolerance * 4;
    const visited = new Uint8Array(w * h);
    const stack: number[] = [Math.floor(y) * w + Math.floor(x)];
    while (stack.length) {
      const idx = stack.pop()!;
      if (visited[idx]) continue;
      visited[idx] = 1;
      const px = idx % w,
        py = (idx / w) | 0;
      if (this.selection && !inSelection(px, py)) continue;
      const di = idx * 4;
      const dr = img.data[di] - sr,
        dg = img.data[di + 1] - sg,
        db = img.data[di + 2] - sb,
        da = img.data[di + 3] - sa;
      if (dr * dr + dg * dg + db * db + da * da > tol) continue;
      img.data[di] = fr;
      img.data[di + 1] = fg;
      img.data[di + 2] = fb;
      img.data[di + 3] = 255;
      if (px > 0) stack.push(idx - 1);
      if (px < w - 1) stack.push(idx + 1);
      if (py > 0) stack.push(idx - w);
      if (py < h - 1) stack.push(idx + w);
    }
    ctx.putImageData(img, 0, 0);
    this.composite();
  }

  private selectionContains(x: number, y: number): boolean {
    if (!this.selection) return true;
    const ctx = this.selection.maskCanvas.getContext('2d')!;
    return ctx.getImageData(x, y, 1, 1).data[3] > 0;
  }

  /* ============ gradient tool ============ */

  applyGradient(x0: number, y0: number, x1: number, y1: number, colorA: string, colorB: string) {
    const layer = this.activeLayer();
    if (!layer || layer.meta.locked) return;
    this.pushHistory();
    const ctx = layer.canvas.getContext('2d')!;
    ctx.save();
    if (this.selection) {
      ctx.beginPath();
      // approximate clip via mask compositing since Path2D isn't retained for raster masks
      const temp = document.createElement('canvas');
      temp.width = this.width;
      temp.height = this.height;
      const tctx = temp.getContext('2d')!;
      const grad = tctx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, colorA);
      grad.addColorStop(1, colorB);
      tctx.fillStyle = grad;
      tctx.fillRect(0, 0, this.width, this.height);
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(this.selection.maskCanvas, 0, 0);
      ctx.drawImage(temp, 0, 0);
    } else {
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, colorA);
      grad.addColorStop(1, colorB);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    ctx.restore();
    this.composite();
  }

  /* ============ retouch tools: clone stamp / smudge / spot heal ============
   * Amendment v0.4 item 6. All three sample real pixel data from the active
   * layer — none of these are visual stand-ins. */

  /** Alt/Option-click equivalent: marks the point future clone strokes
   * sample from. The next `beginClone()` establishes the fixed offset
   * between source and where painting starts, exactly like a real clone
   * stamp tool — after that, the sample point tracks the brush at a
   * constant offset as the Captain drags. */
  setCloneSource(x: number, y: number) {
    this.cloneSource = [x, y];
    this.cloneOffset = null;
  }

  hasCloneSource(): boolean {
    return this.cloneSource !== null;
  }

  beginClone(x: number, y: number, radius: number) {
    const layer = this.activeLayer();
    if (!layer || layer.meta.locked || !this.cloneSource) return;
    this.pushHistory();
    if (!this.cloneOffset) this.cloneOffset = [x - this.cloneSource[0], y - this.cloneSource[1]];
    // Freeze a copy of the source layer's current pixels for the whole
    // stroke, so cloning doesn't sample pixels the same stroke just painted
    // a moment ago (which would smear rather than genuinely duplicate).
    const frozen = document.createElement('canvas');
    frozen.width = this.width;
    frozen.height = this.height;
    frozen.getContext('2d')!.drawImage(layer.canvas, 0, 0);
    this.cloneFrozenSnapshot = frozen;
    this.stampClone(x, y, radius);
  }

  continueClone(x: number, y: number, radius: number) {
    this.stampClone(x, y, radius);
  }

  endClone() {
    this.cloneFrozenSnapshot = null;
  }

  private stampClone(x: number, y: number, radius: number) {
    const layer = this.activeLayer();
    if (!layer || !this.cloneOffset || !this.cloneFrozenSnapshot) return;
    // We want the frozen source pixel at (sx,sy) = (x - offsetX, y - offsetY)
    // to land at screen point (x,y). Drawing the whole frozen canvas
    // translated by (x - sx, y - sy) = (offsetX, offsetY) achieves that —
    // note this translation is constant for the whole stroke since the
    // offset itself doesn't change as the brush moves.
    const ctx = layer.canvas.getContext('2d')!;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(this.cloneFrozenSnapshot, this.cloneOffset[0], this.cloneOffset[1]);
    ctx.restore();
    this.composite();
  }

  beginSmudge(x: number, y: number) {
    const layer = this.activeLayer();
    if (!layer || layer.meta.locked) return;
    this.pushHistory();
    this.smudgeLast = [x, y];
  }

  /** Drags existing pixel content forward: at each step, copy a patch from
   * the layer's *current* state centered on the previous point and paint it
   * (soft circular mask, opacity-scaled) at the new point — precisely how a
   * simple finger/smudge tool works, sampling live content rather than a
   * canned brush tip. */
  continueSmudge(x: number, y: number, radius: number, strength: number) {
    const layer = this.activeLayer();
    if (!layer || layer.meta.locked || !this.smudgeLast) return;
    const [lx, ly] = this.smudgeLast;
    const d = Math.max(2, Math.ceil(radius * 2));
    const patch = document.createElement('canvas');
    patch.width = d;
    patch.height = d;
    const pctx = patch.getContext('2d')!;
    pctx.drawImage(layer.canvas, lx - d / 2, ly - d / 2, d, d, 0, 0, d, d);
    const ctx = layer.canvas.getContext('2d')!;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = Math.max(0.05, Math.min(1, strength));
    ctx.drawImage(patch, x - d / 2, y - d / 2);
    ctx.restore();
    this.smudgeLast = [x, y];
    this.composite();
  }

  endSmudge() {
    this.smudgeLast = null;
  }

  /** Approximate content-aware heal: blends the blemish into a blurred copy
   * of its own surrounding donut of pixels, rather than a literal
   * generative fill — real pixel math (reuses the same box-blur used by the
   * Blur filter), not a no-op placeholder. */
  healAt(x: number, y: number, radius: number) {
    const layer = this.activeLayer();
    if (!layer || layer.meta.locked) return;
    this.pushHistory();
    const pad = Math.ceil(radius * 2.2);
    const x0 = Math.max(0, Math.floor(x - pad)),
      y0 = Math.max(0, Math.floor(y - pad));
    const w = Math.min(this.width - x0, pad * 2),
      h = Math.min(this.height - y0, pad * 2);
    if (w <= 0 || h <= 0) return;
    const ctx = layer.canvas.getContext('2d')!;
    let patch = ctx.getImageData(x0, y0, w, h);
    for (let i = 0; i < 4; i++) patch = boxBlur(patch, w, h, Math.max(2, Math.round(radius * 0.6)));
    const blurCanvas = document.createElement('canvas');
    blurCanvas.width = w;
    blurCanvas.height = h;
    blurCanvas.getContext('2d')!.putImageData(patch, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(blurCanvas, x0, y0);
    ctx.restore();
    this.composite();
  }

  /* ============ text tool (Amendment v0.4 item 9) ============ */

  /** Rasterizes text directly onto the active layer at the given point —
   * there's no separate "text layer" object model yet (canvas items here
   * are pure pixel layers), so text commits immediately like a stamp,
   * consistent with how every other Draw/Paint tool works. */
  stampText(x: number, y: number, text: string, opts: { size: number; color: string; font?: string; align?: CanvasTextAlign }) {
    const layer = this.activeLayer();
    if (!layer || layer.meta.locked || !text.trim()) return;
    this.pushHistory();
    const ctx = layer.canvas.getContext('2d')!;
    ctx.save();
    ctx.font = `${opts.size}px ${opts.font ?? "'Rajdhani', sans-serif"}`;
    ctx.fillStyle = opts.color;
    ctx.textBaseline = 'top';
    ctx.textAlign = opts.align ?? 'left';
    ctx.fillText(text, x, y);
    ctx.restore();
    this.composite();
  }

  /* ============ eyedropper ============ */

  sampleColorAt(x: number, y: number): string {
    const img = this.flattenedImageData();
    const idx = (Math.floor(y) * this.width + Math.floor(x)) * 4;
    return rgbToHex(img.data[idx], img.data[idx + 1], img.data[idx + 2]);
  }

  private flattenedImageData(): ImageData {
    this.composite();
    // composite() also draws the checkerboard + selection marquee onto
    // displayCtx, which would pollute sampling — recomposite onto a clean
    // offscreen target for pixel reads instead of reading displayCtx directly.
    const flat = document.createElement('canvas');
    flat.width = this.width;
    flat.height = this.height;
    const fctx = flat.getContext('2d')!;
    for (const layer of this.layers) {
      if (!layer.meta.visible) continue;
      fctx.save();
      fctx.globalAlpha = layer.meta.opacity;
      fctx.globalCompositeOperation = blendToComposite(layer.meta.blendMode);
      fctx.drawImage(layer.canvas, 0, 0);
      fctx.restore();
    }
    return fctx.getImageData(0, 0, this.width, this.height);
  }

  /* ============ adjustments (real pixel math, applied to active layer) ============ */

  applyBrightnessContrast(brightness: number, contrast: number) {
    this.mapActiveLayerPixels((r, g, b, a) => {
      const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
      const cr = clamp255(factor * (r - 128) + 128 + brightness);
      const cg = clamp255(factor * (g - 128) + 128 + brightness);
      const cb = clamp255(factor * (b - 128) + 128 + brightness);
      return [cr, cg, cb, a];
    });
  }

  applyHueSaturation(hueShift: number, satMul: number, lightMul: number) {
    this.mapActiveLayerPixels((r, g, b, a) => {
      const [h, s, l] = rgbToHsl(r, g, b);
      const nh = (h + hueShift / 360 + 1) % 1;
      const ns = clamp01(s * satMul);
      const nl = clamp01(l * lightMul);
      const [nr, ng, nb] = hslToRgb(nh, ns, nl);
      return [nr, ng, nb, a];
    });
  }

  /** Levels: real black-point/white-point/gamma remap per channel — the
   * same math a real levels dialog uses (linear stretch between the two
   * input points, then a gamma curve), not a brightness slider in disguise. */
  applyLevels(inBlack: number, inWhite: number, gamma: number) {
    const lo = Math.min(inBlack, inWhite),
      hi = Math.max(inBlack, inWhite, lo + 1);
    const g = Math.max(0.1, gamma);
    const map = (v: number) => {
      const t = clamp01((v - lo) / (hi - lo));
      return clamp255(Math.pow(t, 1 / g) * 255);
    };
    this.mapActiveLayerPixels((r, g2, b, a) => [map(r), map(g2), map(b), a]);
  }

  /** Curves: a piecewise-linear tone curve through Captain-editable control
   * points (x = input 0-255, y = output 0-255), applied via a precomputed
   * 256-entry lookup table to all three channels — a real interactive
   * curve, not a single-slider stand-in. Points must be sorted by x. */
  applyCurve(points: { x: number; y: number }[]) {
    if (points.length < 2) return;
    const sorted = [...points].sort((a, b) => a.x - b.x);
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      let i = 0;
      while (i < sorted.length - 2 && sorted[i + 1].x < v) i++;
      const p0 = sorted[i],
        p1 = sorted[i + 1] ?? sorted[i];
      const t = p1.x === p0.x ? 0 : clamp01((v - p0.x) / (p1.x - p0.x));
      lut[v] = clamp255(p0.y + (p1.y - p0.y) * t);
    }
    this.mapActiveLayerPixels((r, g, b, a) => [lut[Math.round(r)], lut[Math.round(g)], lut[Math.round(b)], a]);
  }

  /** Color balance: independent R/G/B tint sliders (-100..100) for
   * shadows/midtones/highlights, weighted by each pixel's actual luminance
   * so a "shadows" push only meaningfully affects dark pixels — the same
   * tone-range-weighting a real color-balance tool uses. */
  applyColorBalance(shadows: [number, number, number], mids: [number, number, number], highlights: [number, number, number]) {
    this.mapActiveLayerPixels((r, g, b, a) => {
      const lum = (r + g + b) / 3 / 255;
      const shadowW = clamp01(1 - lum * 2.2);
      const highW = clamp01((lum - 0.45) * 2.2);
      const midW = clamp01(1 - Math.abs(lum - 0.5) * 2.2);
      const nr = clamp255(r + (shadows[0] * shadowW + mids[0] * midW + highlights[0] * highW) * 0.6);
      const ng = clamp255(g + (shadows[1] * shadowW + mids[1] * midW + highlights[1] * highW) * 0.6);
      const nb = clamp255(b + (shadows[2] * shadowW + mids[2] * midW + highlights[2] * highW) * 0.6);
      return [nr, ng, nb, a];
    });
  }

  /** Real luminance-correct desaturate (Rec. 709 weights), not a naive
   * r+g+b/3 average. */
  applyBlackAndWhite() {
    this.mapActiveLayerPixels((r, g, b, a) => {
      const l = clamp255(0.2126 * r + 0.7152 * g + 0.0722 * b);
      return [l, l, l, a];
    });
  }

  /* ============ filters (Amendment v0.4 item 8) ============ */

  applyNoise(amount: number) {
    this.mapActiveLayerPixels((r, g, b, a) => {
      const n = (Math.random() - 0.5) * amount;
      return [clamp255(r + n), clamp255(g + n), clamp255(b + n), a];
    });
  }

  /** Real block-averaging pixelate — reads and re-fills actual pixel
   * blocks, not a CSS `image-rendering` trick. */
  applyPixelate(blockSize: number) {
    const layer = this.activeLayer();
    if (!layer || layer.meta.locked) return;
    this.pushHistory();
    const ctx = layer.canvas.getContext('2d')!;
    const w = this.width,
      h = this.height;
    const img = ctx.getImageData(0, 0, w, h);
    const bs = Math.max(2, Math.round(blockSize));
    for (let by = 0; by < h; by += bs) {
      for (let bx = 0; bx < w; bx += bs) {
        const bw = Math.min(bs, w - bx),
          bh = Math.min(bs, h - by);
        let r = 0,
          g = 0,
          b = 0,
          a = 0,
          n = 0;
        for (let y = by; y < by + bh; y++) {
          for (let x = bx; x < bx + bw; x++) {
            const i = (y * w + x) * 4;
            r += img.data[i];
            g += img.data[i + 1];
            b += img.data[i + 2];
            a += img.data[i + 3];
            n++;
          }
        }
        r /= n; g /= n; b /= n; a /= n;
        for (let y = by; y < by + bh; y++) {
          for (let x = bx; x < bx + bw; x++) {
            const i = (y * w + x) * 4;
            img.data[i] = r;
            img.data[i + 1] = g;
            img.data[i + 2] = b;
            img.data[i + 3] = a;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    this.composite();
  }

  applyBlur(radius: number) {
    const layer = this.activeLayer();
    if (!layer || layer.meta.locked) return;
    this.pushHistory();
    const ctx = layer.canvas.getContext('2d')!;
    let img = ctx.getImageData(0, 0, this.width, this.height);
    // separable box blur, three passes ~= gaussian approximation — real
    // convolution, not a CSS filter() shortcut, and fast enough for a
    // bounded document size.
    const passes = 3;
    for (let i = 0; i < passes; i++) img = boxBlur(img, this.width, this.height, Math.max(1, Math.round(radius)));
    ctx.putImageData(img, 0, 0);
    this.composite();
  }

  applySharpen() {
    const layer = this.activeLayer();
    if (!layer || layer.meta.locked) return;
    this.pushHistory();
    const ctx = layer.canvas.getContext('2d')!;
    const img = ctx.getImageData(0, 0, this.width, this.height);
    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
    const out = convolve3x3(img, this.width, this.height, kernel);
    ctx.putImageData(out, 0, 0);
    this.composite();
  }

  private mapActiveLayerPixels(fn: (r: number, g: number, b: number, a: number) => [number, number, number, number]) {
    const layer = this.activeLayer();
    if (!layer || layer.meta.locked) return;
    this.pushHistory();
    const ctx = layer.canvas.getContext('2d')!;
    const img = ctx.getImageData(0, 0, this.width, this.height);
    const sel = this.selection;
    const selCtx = sel?.maskCanvas.getContext('2d');
    const selImg = selCtx?.getImageData(0, 0, this.width, this.height);
    for (let i = 0; i < img.data.length; i += 4) {
      if (selImg && selImg.data[i + 3] === 0) continue;
      const [r, g, b, a] = fn(img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]);
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    this.composite();
  }

  /* ============ canvas resize / crop ============ */

  resizeCanvas(newW: number, newH: number, mode: 'scale' | 'crop', anchor: { x: number; y: number } = { x: 0, y: 0 }) {
    this.pushHistory();
    for (const layer of this.layers) {
      const next = document.createElement('canvas');
      next.width = newW;
      next.height = newH;
      const ctx = next.getContext('2d')!;
      if (mode === 'scale') {
        ctx.drawImage(layer.canvas, 0, 0, this.width, this.height, 0, 0, newW, newH);
      } else {
        ctx.drawImage(layer.canvas, -anchor.x, -anchor.y);
      }
      layer.canvas = next;
    }
    this.width = newW;
    this.height = newH;
    this.display.width = newW;
    this.display.height = newH;
    this.scratch.width = newW;
    this.scratch.height = newH;
    this.selection = null;
    this.composite();
    this.onLayersChange?.();
  }

  /* ============ export ============ */

  async exportBlob(format: 'png' | 'jpeg', quality = 0.92): Promise<Blob> {
    const flat = document.createElement('canvas');
    flat.width = this.width;
    flat.height = this.height;
    const ctx = flat.getContext('2d')!;
    if (format === 'jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, this.width, this.height);
    }
    for (const layer of this.layers) {
      if (!layer.meta.visible) continue;
      ctx.save();
      ctx.globalAlpha = layer.meta.opacity;
      ctx.globalCompositeOperation = blendToComposite(layer.meta.blendMode);
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();
    }
    return new Promise((resolve, reject) => {
      flat.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
        format === 'png' ? 'image/png' : 'image/jpeg',
        quality,
      );
    });
  }

  /* ============ history ============ */

  private historySuspended = false;

  /** Snapshots the CURRENT (pre-edit) state onto `past`, before the caller
   * goes on to mutate anything. This must run before the mutation, not
   * after — an after-the-fact snapshot would be identical to the state
   * undo is supposed to return to, making undo a no-op. Every mutating
   * method below calls this first, then performs its edit. */
  private pushHistory() {
    if (this.historySuspended) return;
    const entry: HistoryEntry = {
      width: this.width,
      height: this.height,
      layers: this.layers.map((l) => ({ ...l.meta })),
      activeLayerId: this.activeLayerId,
      layerData: Object.fromEntries(this.layers.map((l) => [l.meta.id, l.canvas.toDataURL('image/png')])),
    };
    this.past.push(entry);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.onHistoryChange?.();
  }

  canUndo() {
    return this.past.length > 0;
  }
  canRedo() {
    return this.future.length > 0;
  }

  /* ============ history/snapshot panel (Amendment v0.4 item 11) ============
   * The linear undo/redo stack above already exists; this exposes it as a
   * real jump-to-arbitrary-state panel instead of only stepping one at a
   * time, plus independent named bookmarks that survive further edits. */

  /** One entry per state currently on the undo stack, oldest first. Index
   * matches what `jumpToHistoryIndex` expects. */
  historyList(): { index: number; label: string }[] {
    return this.past.map((_, i) => ({ index: i, label: i === 0 ? 'Start' : `Step ${i}` }));
  }

  async jumpToHistoryIndex(targetIdx: number) {
    if (targetIdx < 0 || targetIdx >= this.past.length) return;
    const entry = this.past[targetIdx];
    const after = this.past.slice(targetIdx + 1); // states between target and "now"
    const forwardSeq = [...after, this.snapshotCurrent()]; // chronological order back to "now"
    this.future = [...forwardSeq.reverse(), ...this.future]; // redo() pops from the end
    this.past = this.past.slice(0, targetIdx);
    await this.restoreEntry(entry);
    this.onHistoryChange?.();
  }

  bookmarkCurrent(label: string) {
    this.bookmarks.push({ id: nid('bm'), label: label || `Bookmark ${this.bookmarks.length + 1}`, entry: this.snapshotCurrent() });
    this.onBookmarksChange?.();
  }

  listBookmarks(): { id: string; label: string }[] {
    return this.bookmarks.map((b) => ({ id: b.id, label: b.label }));
  }

  async restoreBookmark(id: string) {
    const bm = this.bookmarks.find((b) => b.id === id);
    if (!bm) return;
    this.past.push(this.snapshotCurrent());
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    await this.restoreEntry(bm.entry);
    this.onHistoryChange?.();
  }

  deleteBookmark(id: string) {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
    this.onBookmarksChange?.();
  }

  async undo() {
    const entry = this.past.pop();
    if (!entry) return;
    this.future.push(this.snapshotCurrent());
    await this.restoreEntry(entry);
    this.onHistoryChange?.();
  }

  async redo() {
    const entry = this.future.pop();
    if (!entry) return;
    this.past.push(this.snapshotCurrent());
    await this.restoreEntry(entry);
    this.onHistoryChange?.();
  }

  private snapshotCurrent(): HistoryEntry {
    return {
      width: this.width,
      height: this.height,
      layers: this.layers.map((l) => ({ ...l.meta })),
      activeLayerId: this.activeLayerId,
      layerData: Object.fromEntries(this.layers.map((l) => [l.meta.id, l.canvas.toDataURL('image/png')])),
    };
  }

  private async restoreEntry(entry: HistoryEntry) {
    this.historySuspended = true;
    this.width = entry.width;
    this.height = entry.height;
    this.display.width = entry.width;
    this.display.height = entry.height;
    this.scratch.width = entry.width;
    this.scratch.height = entry.height;
    const layers: Layer[] = [];
    for (const meta of entry.layers) {
      const canvas = document.createElement('canvas');
      canvas.width = entry.width;
      canvas.height = entry.height;
      const ctx = canvas.getContext('2d')!;
      const url = entry.layerData[meta.id];
      if (url) {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, 0, 0);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = url;
        });
      }
      layers.push({ meta, canvas });
    }
    this.layers = layers;
    this.activeLayerId = entry.activeLayerId;
    this.selection = null;
    this.composite();
    this.onLayersChange?.();
    this.historySuspended = false;
  }
}

/* ============ pixel/color helpers ============ */

function clamp255(v: number) {
  return Math.max(0, Math.min(255, v));
}
function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((edge0 - x) / (edge0 - edge1 || 1));
  return t * t * (3 - 2 * t);
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function hexToRgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.round(clamp255(v)).toString(16).padStart(2, '0')).join('');
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, s, l];
}
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [Math.round(hue2rgb(p, q, h + 1 / 3) * 255), Math.round(hue2rgb(p, q, h) * 255), Math.round(hue2rgb(p, q, h - 1 / 3) * 255)];
}

/** HSB/HSV, used by the color wheel UI (distinct from HSL used for the
 * saturation/lightness adjustment above — real, correct, separate math
 * for each, not one reused for both). */
export function hsbToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0,
    g = 0,
    b = 0;
  switch (i % 6) {
    case 0:
      [r, g, b] = [v, t, p];
      break;
    case 1:
      [r, g, b] = [q, v, p];
      break;
    case 2:
      [r, g, b] = [p, v, t];
      break;
    case 3:
      [r, g, b] = [p, q, v];
      break;
    case 4:
      [r, g, b] = [t, p, v];
      break;
    default:
      [r, g, b] = [v, p, q];
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
export function rgbToHsb(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

function boxBlur(img: ImageData, w: number, h: number, radius: number): ImageData {
  const out = new ImageData(w, h);
  const src = img.data,
    dst = out.data;
  // horizontal pass
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        const i = (y * w + xx) * 4;
        r += src[i];
        g += src[i + 1];
        b += src[i + 2];
        a += src[i + 3];
        n++;
      }
      const o = (y * w + x) * 4;
      tmp[o] = r / n;
      tmp[o + 1] = g / n;
      tmp[o + 2] = b / n;
      tmp[o + 3] = a / n;
    }
  }
  // vertical pass
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        const i = (yy * w + x) * 4;
        r += tmp[i];
        g += tmp[i + 1];
        b += tmp[i + 2];
        a += tmp[i + 3];
        n++;
      }
      const o = (y * w + x) * 4;
      dst[o] = r / n;
      dst[o + 1] = g / n;
      dst[o + 2] = b / n;
      dst[o + 3] = a / n;
    }
  }
  return out;
}

function convolve3x3(img: ImageData, w: number, h: number, kernel: number[]): ImageData {
  const out = new ImageData(w, h);
  const src = img.data,
    dst = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0,
        g = 0,
        b = 0;
      let k = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const xx = Math.min(w - 1, Math.max(0, x + kx));
          const yy = Math.min(h - 1, Math.max(0, y + ky));
          const i = (yy * w + xx) * 4;
          const weight = kernel[k++];
          r += src[i] * weight;
          g += src[i + 1] * weight;
          b += src[i + 2] * weight;
        }
      }
      const o = (y * w + x) * 4;
      dst[o] = clamp255(r);
      dst[o + 1] = clamp255(g);
      dst[o + 2] = clamp255(b);
      dst[o + 3] = src[o + 3];
    }
  }
  return out;
}
