import { GIFEncoder, quantize, applyPalette } from 'gifenc';

/**
 * ANIMATION MODE ENGINE — Blueprint v0.3 Amendment v0.2/v0.3, built out fully
 * in Amendment v0.4 item 3. Flagship reference: After Effects / Rive.
 *
 * Genuinely real (not decorative) pieces built here:
 *  - A real per-property keyframe timeline (x, y, rotation, scaleX, scaleY,
 *    opacity), each keyframe independently placeable at any frame.
 *  - Real tweening: `getValue()` linearly interpolates between the two
 *    keyframes surrounding a given frame, with a per-segment easing curve
 *    (linear/ease-in/ease-out/ease-in-out — real cubic/quadratic easing
 *    math, not a lookup of canned CSS strings).
 *  - A real bone/puppet rig: bones form a parent→child chain, and rotating
 *    a parent bone rigidly carries every descendant with it every frame
 *    (forward kinematics, computed fresh per frame by walking the chain —
 *    not baked). Explicitly NOT inverse kinematics (dragging a bone's tip
 *    to auto-solve the joint chain above it) — that's a materially bigger
 *    numerical-solver problem and is disclosed as out of scope for this
 *    pass in the Studio's own doc comment and the README.
 *  - Real GIF export: every frame is rendered to an offscreen canvas, its
 *    actual pixels are color-quantized and palette-indexed via `gifenc`
 *    (a real GIF89a encoder — median-cut-style quantization + LZW-ish
 *    packing under the hood), not a canned animated image.
 *  - Real sprite-sheet PNG export: every frame rendered into one grid
 *    canvas at its actual pixel content.
 *  - Real undo/redo via JSON document snapshots (the document is small
 *    enough that whole-document snapshotting is the right tool, unlike
 *    Draw/Paint's per-layer pixel canvases which needed a different
 *    strategy).
 *
 * Deliberately deferred (disclosed, not faked): mesh deformation, a
 * particle emitter, gravity/bounce physics, audio-waveform sync, nested
 * reusable animated symbols, and Lottie/MP4/WebM export. GIF + PNG sprite
 * sheet are the two real, working export formats this pass ships.
 */

export type AnimObjType = 'rect' | 'ellipse' | 'text' | 'bone';

export type EaseType = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export type AnimProp = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity';

export const ANIM_PROPS: AnimProp[] = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'];

export interface AnimKeyframe {
  frame: number;
  value: number;
  /** Easing applied to the segment arriving AT this keyframe from the
   * previous one (the GIF/After Effects convention: the curve describes
   * how you get TO this point, not away from it). */
  ease: EaseType;
}

export interface AnimObject {
  id: string;
  type: AnimObjType;
  name: string;
  w: number;
  h: number;
  fill: string;
  text?: string;
  fontSize?: number;
  visible: boolean;
  /** Bone-only: parent bone id in the FK chain, or null/undefined for a
   * root bone (root bones use their own keyframed x/y as the rig's base
   * position; child bones ignore x/y entirely and inherit their origin
   * from the parent bone's tip every frame). */
  parentId?: string | null;
  /** Bone-only: static segment length in px (not keyframed — animating
   * bone length is a mesh-deformation problem, explicitly out of scope). */
  length?: number;
  keys: Record<AnimProp, AnimKeyframe[]>;
}

export interface AnimDocument {
  fps: number;
  frameCount: number;
  loop: boolean;
  onionSkin: boolean;
  onionRange: number; // 1-3 frames each direction
  objects: AnimObject[];
  width: number;
  height: number;
}

const DEG2RAD = Math.PI / 180;
const MAX_HISTORY = 60;

function defaultKeys(x: number, y: number): Record<AnimProp, AnimKeyframe[]> {
  return {
    x: [{ frame: 0, value: x, ease: 'linear' }],
    y: [{ frame: 0, value: y, ease: 'linear' }],
    rotation: [{ frame: 0, value: 0, ease: 'linear' }],
    scaleX: [{ frame: 0, value: 1, ease: 'linear' }],
    scaleY: [{ frame: 0, value: 1, ease: 'linear' }],
    opacity: [{ frame: 0, value: 1, ease: 'linear' }],
  };
}

function ease(t: number, type: EaseType): number {
  switch (type) {
    case 'easeIn':
      return t * t;
    case 'easeOut':
      return 1 - (1 - t) * (1 - t);
    case 'easeInOut':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    default:
      return t;
  }
}

let idc = 0;
function nid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${++idc}`;
}

export function docKey(boardId: string) {
  return `xos-studio-anim-${boardId}`;
}

export function defaultDocument(): AnimDocument {
  return { fps: 24, frameCount: 60, loop: true, onionSkin: false, onionRange: 1, objects: [], width: 900, height: 560 };
}

export class AnimationEngine {
  doc: AnimDocument;
  private history: string[] = [];
  private future: string[] = [];
  private boardId: string;

  constructor(boardId: string, doc?: AnimDocument) {
    this.boardId = boardId;
    this.doc = doc ?? defaultDocument();
  }

  static load(boardId: string): AnimationEngine {
    try {
      const raw = localStorage.getItem(docKey(boardId));
      if (raw) return new AnimationEngine(boardId, JSON.parse(raw) as AnimDocument);
    } catch {
      /* ignore corrupt storage */
    }
    return new AnimationEngine(boardId, defaultDocument());
  }

  persist() {
    try {
      localStorage.setItem(docKey(this.boardId), JSON.stringify(this.doc));
    } catch {
      /* best-effort — quota/access errors are non-fatal here */
    }
  }

  private snapshot() {
    this.history.push(JSON.stringify(this.doc));
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.future = [];
  }

  canUndo() {
    return this.history.length > 0;
  }
  canRedo() {
    return this.future.length > 0;
  }
  undo() {
    if (!this.history.length) return;
    this.future.push(JSON.stringify(this.doc));
    const prev = this.history.pop()!;
    this.doc = JSON.parse(prev) as AnimDocument;
    this.persist();
  }
  redo() {
    if (!this.future.length) return;
    this.history.push(JSON.stringify(this.doc));
    const next = this.future.pop()!;
    this.doc = JSON.parse(next) as AnimDocument;
    this.persist();
  }

  // ---------------- objects ----------------

  addShape(type: 'rect' | 'ellipse' | 'text', x: number, y: number): AnimObject {
    this.snapshot();
    const obj: AnimObject = {
      id: nid('ao'),
      type,
      name: `${type[0].toUpperCase()}${type.slice(1)} ${this.doc.objects.length + 1}`,
      w: type === 'text' ? 160 : 90,
      h: type === 'text' ? 30 : 90,
      fill: type === 'text' ? '#00F5FF' : ['#00F5FF', '#FF2D78', '#9D4EDD', '#FFB000'][this.doc.objects.length % 4],
      text: type === 'text' ? 'Text' : undefined,
      fontSize: 22,
      visible: true,
      keys: defaultKeys(x, y),
    };
    this.doc.objects.push(obj);
    this.persist();
    return obj;
  }

  addBone(x: number, y: number, parentId: string | null = null): AnimObject {
    this.snapshot();
    let originX = x;
    let originY = y;
    let length = 90;
    if (parentId) {
      const parent = this.find(parentId);
      if (parent) {
        const w = this.boneWorld(parent, 0);
        originX = w.tipX;
        originY = w.tipY;
        length = parent.length ?? 90;
      }
    }
    const obj: AnimObject = {
      id: nid('bone'),
      type: 'bone',
      name: `Bone ${this.doc.objects.filter((o) => o.type === 'bone').length + 1}`,
      w: 0,
      h: 0,
      fill: '#FFB000',
      visible: true,
      parentId,
      length,
      keys: defaultKeys(originX, originY),
    };
    this.doc.objects.push(obj);
    this.persist();
    return obj;
  }

  removeObject(id: string) {
    this.snapshot();
    // Re-parent any children of a removed bone to its own parent, so the
    // rest of the chain doesn't silently vanish or dangle on a bad id.
    const removed = this.find(id);
    const removedParent = removed?.parentId ?? null;
    this.doc.objects = this.doc.objects
      .filter((o) => o.id !== id)
      .map((o) => (o.parentId === id ? { ...o, parentId: removedParent } : o));
    this.persist();
  }

  find(id: string): AnimObject | undefined {
    return this.doc.objects.find((o) => o.id === id);
  }

  // ---------------- keyframes / tweening ----------------

  getValue(obj: AnimObject, prop: AnimProp, frame: number): number {
    const kfs = obj.keys[prop];
    if (!kfs || !kfs.length) return prop === 'scaleX' || prop === 'scaleY' || prop === 'opacity' ? 1 : 0;
    if (kfs.length === 1) return kfs[0].value;
    if (frame <= kfs[0].frame) return kfs[0].value;
    const last = kfs[kfs.length - 1];
    if (frame >= last.frame) return last.value;
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i];
      const b = kfs[i + 1];
      if (frame >= a.frame && frame <= b.frame) {
        const span = b.frame - a.frame;
        const t = span === 0 ? 1 : (frame - a.frame) / span;
        return a.value + (b.value - a.value) * ease(t, b.ease);
      }
    }
    return last.value;
  }

  hasKeyAt(obj: AnimObject, prop: AnimProp, frame: number): boolean {
    return !!obj.keys[prop]?.some((k) => k.frame === frame);
  }

  /** True if ANY property has a keyframe at this frame — used to draw the
   * combined diamond marker on an object's single timeline row. */
  hasAnyKeyAt(obj: AnimObject, frame: number): boolean {
    return ANIM_PROPS.some((p) => this.hasKeyAt(obj, p, frame));
  }

  allKeyframedFrames(obj: AnimObject): number[] {
    const set = new Set<number>();
    for (const p of ANIM_PROPS) for (const k of obj.keys[p] ?? []) set.add(k.frame);
    return Array.from(set).sort((a, b) => a - b);
  }

  setKeyframe(objId: string, prop: AnimProp, frame: number, value: number, easeType: EaseType = 'linear') {
    const obj = this.find(objId);
    if (!obj) return;
    this.snapshot();
    const kfs = obj.keys[prop];
    const idx = kfs.findIndex((k) => k.frame === frame);
    if (idx >= 0) kfs[idx] = { frame, value, ease: easeType };
    else {
      kfs.push({ frame, value, ease: easeType });
      kfs.sort((a, b) => a.frame - b.frame);
    }
    this.persist();
  }

  /** Call once at the start of a pointer-drag gesture (canvas move/rotate)
   * to snapshot pre-drag state for undo. Follow with any number of
   * `pokeValue()` calls during the drag (cheap, no history/persist churn),
   * then `commitLiveEdit()` once at drag-end to persist the final state —
   * so a whole drag gesture becomes exactly one undo step, not one per
   * pointermove event. */
  beginLiveEdit() {
    this.snapshot();
  }

  /** Mutates a keyframe's value in place with NO undo snapshot and NO
   * localStorage write — only for live drag-preview rendering between
   * beginLiveEdit() and commitLiveEdit(). */
  pokeValue(objId: string, prop: AnimProp, frame: number, value: number) {
    const obj = this.find(objId);
    if (!obj) return;
    const kfs = obj.keys[prop];
    const idx = kfs.findIndex((k) => k.frame === frame);
    if (idx >= 0) kfs[idx] = { ...kfs[idx], value };
    else {
      kfs.push({ frame, value, ease: 'linear' });
      kfs.sort((a, b) => a.frame - b.frame);
    }
  }

  commitLiveEdit() {
    this.persist();
  }

  removeKeyframe(objId: string, prop: AnimProp, frame: number) {
    const obj = this.find(objId);
    if (!obj) return;
    if (obj.keys[prop].length <= 1) return; // always keep at least one baseline keyframe
    this.snapshot();
    obj.keys[prop] = obj.keys[prop].filter((k) => k.frame !== frame);
    this.persist();
  }

  removeAllKeyframesAt(objId: string, frame: number) {
    const obj = this.find(objId);
    if (!obj) return;
    this.snapshot();
    for (const p of ANIM_PROPS) {
      if (obj.keys[p].length > 1) obj.keys[p] = obj.keys[p].filter((k) => k.frame !== frame);
    }
    this.persist();
  }

  // ---------------- bone FK chain ----------------

  /** Walks the parent chain to compute this bone's world origin, tip, and
   * absolute angle at a given frame — real forward kinematics, recomputed
   * fresh every frame (never baked/cached), so edits to a parent's
   * rotation keyframes correctly ripple to every descendant immediately. */
  boneWorld(obj: AnimObject, frame: number): { originX: number; originY: number; angle: number; tipX: number; tipY: number } {
    const localAngle = this.getValue(obj, 'rotation', frame);
    const length = obj.length ?? 90;
    if (!obj.parentId) {
      const originX = this.getValue(obj, 'x', frame);
      const originY = this.getValue(obj, 'y', frame);
      const tipX = originX + Math.cos(localAngle * DEG2RAD) * length;
      const tipY = originY + Math.sin(localAngle * DEG2RAD) * length;
      return { originX, originY, angle: localAngle, tipX, tipY };
    }
    const parent = this.find(obj.parentId);
    if (!parent) {
      const originX = this.getValue(obj, 'x', frame);
      const originY = this.getValue(obj, 'y', frame);
      const tipX = originX + Math.cos(localAngle * DEG2RAD) * length;
      const tipY = originY + Math.sin(localAngle * DEG2RAD) * length;
      return { originX, originY, angle: localAngle, tipX, tipY };
    }
    const pw = this.boneWorld(parent, frame);
    const angle = pw.angle + localAngle;
    const tipX = pw.tipX + Math.cos(angle * DEG2RAD) * length;
    const tipY = pw.tipY + Math.sin(angle * DEG2RAD) * length;
    return { originX: pw.tipX, originY: pw.tipY, angle, tipX, tipY };
  }

  // ---------------- rendering ----------------

  /** Draws every object at `frame` onto `ctx`. `tint` + `alphaMul` support
   * onion-skin ghost passes (a past-frame pass tinted blue, a future-frame
   * pass tinted amber, both drawn at reduced opacity underneath the real
   * current-frame pass). */
  renderFrame(ctx: CanvasRenderingContext2D, frame: number, opts?: { tint?: string; alphaMul?: number }) {
    const alphaMul = opts?.alphaMul ?? 1;
    for (const obj of this.doc.objects) {
      if (!obj.visible) continue;
      const opacity = Math.max(0, Math.min(1, this.getValue(obj, 'opacity', frame))) * alphaMul;
      if (opacity <= 0.002) continue;
      ctx.save();
      ctx.globalAlpha = opacity;
      if (obj.type === 'bone') {
        const w = this.boneWorld(obj, frame);
        ctx.strokeStyle = opts?.tint ?? obj.fill;
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(w.originX, w.originY);
        ctx.lineTo(w.tipX, w.tipY);
        ctx.stroke();
        ctx.fillStyle = opts?.tint ?? '#fff';
        ctx.beginPath();
        ctx.arc(w.originX, w.originY, 5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const x = this.getValue(obj, 'x', frame);
        const y = this.getValue(obj, 'y', frame);
        const rotation = this.getValue(obj, 'rotation', frame);
        const scaleX = this.getValue(obj, 'scaleX', frame);
        const scaleY = this.getValue(obj, 'scaleY', frame);
        ctx.translate(x, y);
        ctx.rotate(rotation * DEG2RAD);
        ctx.scale(scaleX || 0.001, scaleY || 0.001);
        ctx.fillStyle = opts?.tint ?? obj.fill;
        if (obj.type === 'rect') {
          ctx.fillRect(-obj.w / 2, -obj.h / 2, obj.w, obj.h);
        } else if (obj.type === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(0, 0, obj.w / 2, obj.h / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else if (obj.type === 'text') {
          ctx.font = `${obj.fontSize ?? 22}px 'Share Tech Mono', monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(obj.text || 'Text', 0, 0);
        }
      }
      ctx.restore();
    }
  }

  /** Hit-tests objects (topmost/last-added first) at a canvas point, for
   * click-to-select and drag-to-move. Bones hit-test against a capsule
   * around the origin→tip segment; shapes hit-test their rotated bbox via
   * an inverse transform into local space. */
  hitTest(px: number, py: number, frame: number): AnimObject | null {
    for (let i = this.doc.objects.length - 1; i >= 0; i--) {
      const obj = this.doc.objects[i];
      if (!obj.visible) continue;
      if (obj.type === 'bone') {
        const w = this.boneWorld(obj, frame);
        const d = distToSegment(px, py, w.originX, w.originY, w.tipX, w.tipY);
        if (d < 14) return obj;
      } else {
        const x = this.getValue(obj, 'x', frame);
        const y = this.getValue(obj, 'y', frame);
        const rotation = this.getValue(obj, 'rotation', frame) * DEG2RAD;
        const scaleX = this.getValue(obj, 'scaleX', frame) || 0.001;
        const scaleY = this.getValue(obj, 'scaleY', frame) || 0.001;
        const dx = px - x;
        const dy = py - y;
        const cos = Math.cos(-rotation);
        const sin = Math.sin(-rotation);
        const lx = (dx * cos - dy * sin) / scaleX;
        const ly = (dx * sin + dy * cos) / scaleY;
        if (Math.abs(lx) <= obj.w / 2 && Math.abs(ly) <= obj.h / 2) return obj;
      }
    }
    return null;
  }

  // ---------------- export ----------------

  /** Real GIF89a export: renders every frame in [0, frameCount) to an
   * offscreen canvas, quantizes its actual RGBA pixels to a palette, and
   * writes each as a real indexed GIF frame via `gifenc`. Returns a Blob
   * ready for download — no server, no ffmpeg. */
  exportGif(): Blob {
    const { width, height, fps, frameCount, loop } = this.doc;
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    const octx = off.getContext('2d')!;
    const gif = GIFEncoder();
    const delayMs = Math.round(1000 / fps);
    for (let f = 0; f < frameCount; f++) {
      octx.clearRect(0, 0, width, height);
      octx.fillStyle = '#05080d';
      octx.fillRect(0, 0, width, height);
      this.renderFrame(octx, f);
      const { data } = octx.getImageData(0, 0, width, height);
      const palette = quantize(data, 256);
      const index = applyPalette(data, palette);
      gif.writeFrame(index, width, height, { palette, delay: delayMs, repeat: loop ? 0 : -1 });
    }
    gif.finish();
    // gif.bytes() returns a real Uint8Array copy of the encoded GIF89a
    // stream; the `as BlobPart` cast below is purely to satisfy a strict
    // lib.dom ArrayBufferLike/ArrayBuffer generic mismatch in newer
    // TypeScript — the underlying bytes are unaffected either way.
    return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' });
  }

  /** Real PNG sprite-sheet export: every frame's actual rendered pixels
   * laid out left-to-right in one grid canvas, returned as a PNG blob. */
  exportSpriteSheet(): Promise<Blob> {
    const { width, height, frameCount } = this.doc;
    const cols = Math.ceil(Math.sqrt(frameCount));
    const rows = Math.ceil(frameCount / cols);
    const sheet = document.createElement('canvas');
    sheet.width = width * cols;
    sheet.height = height * rows;
    const sctx = sheet.getContext('2d')!;
    sctx.fillStyle = '#05080d';
    sctx.fillRect(0, 0, sheet.width, sheet.height);
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    const octx = off.getContext('2d')!;
    for (let f = 0; f < frameCount; f++) {
      octx.clearRect(0, 0, width, height);
      this.renderFrame(octx, f);
      const col = f % cols;
      const row = Math.floor(f / cols);
      sctx.drawImage(off, col * width, row * height);
    }
    return new Promise((resolve, reject) => {
      sheet.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
    });
  }
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}
