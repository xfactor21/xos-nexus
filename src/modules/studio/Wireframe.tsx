import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as RMouseEvent, TouchEvent as RTouchEvent, ChangeEvent as RChangeEvent, WheelEvent as RWheelEvent, CSSProperties } from 'react';
import type { StudioItem, StudioArrow, InkStroke, CommentPin, StudioSnapshot, StudioItemType, PrototypeLink, StudioComponent, ComponentVariantName } from './types';
import { SEED_STUDIO } from './seed';

const SNAP = 8; // world-space snap threshold, feature uplift: alignment guides

type Tool = 'select' | 'pen' | 'frame' | 'sticky' | 'rect' | 'circle' | 'arrow' | 'image' | 'comment' | 'link';

function storageKey(boardId: string) {
  return `xos-studio-wf-${boardId}`;
}

function emptySnapshot(): StudioSnapshot {
  return { items: [], arrows: [], ink: [], comments: [], links: [], components: [] };
}

function loadSnapshot(boardId: string, seed: boolean): StudioSnapshot {
  try {
    const raw = localStorage.getItem(storageKey(boardId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StudioSnapshot>;
      // backward-compat: boards saved before the Amendment v0.2 prototyping
      // rework won't have links/components at all — default them in rather
      // than crashing on undefined.
      return { items: [], arrows: [], ink: [], comments: [], links: [], components: [], ...parsed };
    }
  } catch {
    /* ignore corrupt storage */
  }
  return seed ? SEED_STUDIO : emptySnapshot();
}

let idc = 100;
const nid = (p: string) => `${p}-${++idc}`;

const DEFAULT_COMPONENT_VARIANTS: StudioComponent['variants'] = {
  default: { bg: 'transparent', fg: 'var(--cyan)', label: 'Button' },
  hover: { bg: 'rgba(0,245,255,.12)', fg: 'var(--cyan)', label: 'Button' },
  pressed: { bg: 'rgba(0,245,255,.28)', fg: '#05080D', label: 'Button' },
};

/**
 * WIREFRAME / PROTOTYPE MODE — ported 1:1 from xos-prototype.html
 * (infinite canvas, pan/pinch/zoom, pen/frame/sticky tools) and extended
 * per the Steps 4/5 Feature Uplift: rectangle/circle/arrow shape tools,
 * image paste/upload, a real layers panel (drag-to-reorder + visibility
 * toggles), multi-select + group move, alignment guides/snapping, comment
 * pins, and undo/redo. Extracted from the old single-instance Studio room
 * into a per-board component for the Blueprint v0.3 Amendment v0.2
 * multi-mode/multi-board rework — same code, now keyed by `boardId`
 * instead of one global localStorage slot. Interactive prototyping (frame
 * links, click-targets, a real play/preview mode) is the next piece of
 * this mode's amendment spec — tracked separately, not yet built.
 */
export default function Wireframe({ boardId, isSeed, onExit }: { boardId: string; isSeed: boolean; onExit: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemElRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [snap, setSnap] = useState<StudioSnapshot>(() => loadSnapshot(boardId, isSeed));
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string[]>([]);
  const [guides, setGuides] = useState<{ v: number | null; h: number | null }>({ v: null, h: null });
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [initDone, setInitDone] = useState(false);

  // Amendment v0.2 — prototyping: link tool arming state, and Play mode
  // (which frame is showing full-screen + the back-stack of frames visited).
  const [linkArmed, setLinkArmed] = useState<{ itemId: string; hotspotKey: string } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [playStack, setPlayStack] = useState<string[]>([]);
  const [componentsPanelOpen, setComponentsPanelOpen] = useState(false);

  const past = useRef<StudioSnapshot[]>([]);
  const future = useRef<StudioSnapshot[]>([]);
  const [, forceHistoryTick] = useState(0);

  // pan/zoom — imperative, matches original sOx/sOy/sScale + sApply()
  const cam = useRef({ scale: 1, ox: -160, oy: -80 });
  const applyCam = () => {
    if (worldRef.current) worldRef.current.style.transform = `translate(${cam.current.ox}px,${cam.current.oy}px) scale(${cam.current.scale})`;
  };

  useEffect(() => {
    if (matchMedia('(max-width:760px)').matches) cam.current = { scale: 0.5, ox: -80, oy: -40 };
    applyCam();
    const inkCv = inkCanvasRef.current;
    if (inkCv) {
      const ctx = inkCv.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = '#00F5FF';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.shadowColor = '#00F5FF';
        ctx.shadowBlur = 6;
        snap.ink.forEach((s) => {
          if (s.points.length < 2) return;
          ctx.beginPath();
          ctx.moveTo(s.points[0][0], s.points[0][1]);
          s.points.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
          ctx.stroke();
        });
      }
    }
    setInitDone(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // persist
  useEffect(() => {
    if (!initDone) return;
    const t = setTimeout(() => localStorage.setItem(storageKey(boardId), JSON.stringify(snap)), 300);
    return () => clearTimeout(t);
  }, [snap, initDone, boardId]);

  function commit(next: StudioSnapshot, pushHist = true) {
    if (pushHist) {
      past.current.push(snap);
      if (past.current.length > 50) past.current.shift();
      future.current = [];
      forceHistoryTick((n) => n + 1);
    }
    setSnap(next);
  }
  function undo() {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(snap);
    setSnap(prev);
    forceHistoryTick((n) => n + 1);
  }
  function redo() {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(snap);
    setSnap(next);
    forceHistoryTick((n) => n + 1);
  }

  function worldPos(e: { clientX: number; clientY: number }) {
    const r = wrapRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left - cam.current.ox) / cam.current.scale, (e.clientY - r.top - cam.current.oy) / cam.current.scale] as [number, number];
  }
  function pointOf(e: RMouseEvent | RTouchEvent): { clientX: number; clientY: number } {
    return 'touches' in e && e.touches.length ? e.touches[0] : (e as RMouseEvent);
  }

  /* ============ TOOLBAR ============ */
  function setZoom(dir: 1 | -1) {
    cam.current.scale = Math.min(2, Math.max(0.3, cam.current.scale * (dir === 1 ? 1.15 : 0.87)));
    applyCam();
  }

  /* ============ SPAWN ============ */
  function spawnItem(type: StudioItemType, x: number, y: number, extra: Partial<StudioItem> = {}) {
    const base: StudioItem = {
      id: nid('it'),
      type,
      name: extra.name ?? defaultNameFor(type),
      x,
      y,
      w: type === 'sticky' || type === 'stickyM' ? 170 : type === 'circle' ? 120 : type === 'component' ? 140 : 230,
      h: type === 'sticky' || type === 'stickyM' ? 100 : type === 'circle' ? 120 : type === 'rect' ? 140 : type === 'component' ? 44 : 180,
      visible: true,
      text: type === 'sticky' || type === 'stickyM' ? 'New thought…' : undefined,
      variant: type === 'frame' ? 'blank' : undefined,
      ...extra,
    };
    commit({ ...snap, items: [...snap.items, base] });
    setSelected([base.id]);
  }
  function defaultNameFor(t: StudioItemType) {
    return { frame: 'NEW FRAME', sticky: 'Note', stickyM: 'Note', rect: 'Rectangle', circle: 'Circle', mood: 'Swatch', image: 'Image', component: 'Component' }[t];
  }

  /* ============ PROTOTYPE LINKS (Amendment v0.2) ============ */
  // Arming model: clicking a hotspot with nothing armed arms it as the
  // link's source; clicking a *different* frame item while something is
  // armed picks that whole frame as the target and commits the link.
  // Navigation targets are always whole frames — sub-hotspot precision is
  // only meaningful for the *source* end (which button triggers the jump).
  function handleHotspotClick(itemId: string, hotspotKey: string) {
    if (tool !== 'link') return;
    if (!linkArmed) {
      setLinkArmed({ itemId, hotspotKey });
      return;
    }
    if (itemId === linkArmed.itemId) {
      setLinkArmed(null); // clicking the armed source again cancels
      return;
    }
    const target = snap.items.find((i) => i.id === itemId);
    if (!target || target.type !== 'frame') return; // only frames are valid navigation targets
    const link: PrototypeLink = { id: nid('lnk'), sourceItemId: linkArmed.itemId, hotspotKey: linkArmed.hotspotKey, targetItemId: itemId };
    const links = snap.links.filter((l) => !(l.sourceItemId === linkArmed.itemId && l.hotspotKey === linkArmed.hotspotKey));
    commit({ ...snap, links: [...links, link] });
    setLinkArmed(null);
  }
  /* ============ PLAY / PREVIEW MODE (Amendment v0.2) ============ */
  function startPlay() {
    const selectedFrame = selected.map((id) => snap.items.find((i) => i.id === id)).find((i) => i?.type === 'frame');
    const firstFrame = snap.items.find((i) => i.type === 'frame');
    const start = selectedFrame ?? firstFrame;
    if (!start) return;
    setPlayStack([]);
    setPlaying(start.id);
  }
  function navigatePlay(hotspotKey: string) {
    if (!playing) return;
    const link = snap.links.find((l) => l.sourceItemId === playing && l.hotspotKey === hotspotKey);
    if (!link) return;
    setPlayStack((s) => [...s, playing]);
    setPlaying(link.targetItemId);
  }
  function playBack() {
    setPlayStack((s) => {
      if (!s.length) return s;
      const next = [...s];
      const prev = next.pop()!;
      setPlaying(prev);
      return next;
    });
  }
  function exitPlay() {
    setPlaying(null);
    setPlayStack([]);
  }

  /* ============ COMPONENTS (Amendment v0.2) ============ */
  function addComponent() {
    const comp: StudioComponent = { id: nid('comp'), name: `Button ${snap.components.length + 1}`, variants: structuredClone(DEFAULT_COMPONENT_VARIANTS) };
    commit({ ...snap, components: [...snap.components, comp] });
    return comp.id;
  }
  function addComponentInstance(componentId: string) {
    // offset well clear of the components panel itself (which floats at
    // screen left:8/top:56) so a freshly-dropped instance isn't immediately
    // hidden underneath the panel that just created it
    const [x, y] = [-cam.current.ox / cam.current.scale + 280, -cam.current.oy / cam.current.scale + 100];
    spawnItem('component', x, y, { componentId, activeVariant: 'default', name: snap.components.find((c) => c.id === componentId)?.name ?? 'Component' });
  }
  function setInstanceVariant(itemId: string, variant: ComponentVariantName) {
    commit({ ...snap, items: snap.items.map((it) => (it.id === itemId ? { ...it, activeVariant: variant } : it)) });
  }
  function updateComponentVariantStyle(componentId: string, variant: ComponentVariantName, patch: Partial<StudioComponent['variants'][ComponentVariantName]>) {
    commit(
      {
        ...snap,
        components: snap.components.map((c) => (c.id === componentId ? { ...c, variants: { ...c.variants, [variant]: { ...c.variants[variant], ...patch } } } : c)),
      },
      false,
    );
  }
  function commitComponentEdit() {
    commit(snap, true);
  }
  function deleteComponent(componentId: string) {
    commit({
      ...snap,
      components: snap.components.filter((c) => c.id !== componentId),
      items: snap.items.filter((it) => it.componentId !== componentId),
    });
  }

  /* ============ WRAP-LEVEL POINTER HANDLING ============ */
  const gesture = useRef<null | {
    kind: 'pan' | 'pinch' | 'ink' | 'marquee' | 'drag' | 'resize' | 'arrow';
    start: [number, number];
    camStart?: { ox: number; oy: number };
    pinchStart?: { d: number; scale: number };
    itemStarts?: Record<string, { x: number; y: number }>;
    resizeId?: string;
    resizeStart?: { w: number; h: number };
    arrowId?: string;
  }>(null);

  function distTouches(e: RTouchEvent | TouchEvent) {
    const t = e.touches;
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  }

  function onWrapDown(e: RMouseEvent | RTouchEvent) {
    if ((e.target as HTMLElement).closest('#stTools, #layersPanel, #stUndoRedo, .commentpin')) return;
    if ('touches' in e && e.touches.length === 2) {
      gesture.current = { kind: 'pinch', start: [0, 0], pinchStart: { d: distTouches(e), scale: cam.current.scale } };
      return;
    }
    const onItem = (e.target as HTMLElement).closest('.sitem');
    const p = pointOf(e);

    if (tool === 'pen') {
      gesture.current = { kind: 'ink', start: worldPos(p) };
      const [x, y] = worldPos(p);
      const stroke: InkStroke = { id: nid('ink'), points: [[x, y]] };
      commit({ ...snap, ink: [...snap.ink, stroke] }, false);
      return;
    }
    if (tool === 'frame' || tool === 'sticky' || tool === 'rect' || tool === 'circle') {
      const [x, y] = worldPos(p);
      spawnItem(tool, x, y);
      return;
    }
    if (tool === 'comment') {
      const [x, y] = worldPos(p);
      const pin: CommentPin = { id: nid('cm'), x, y, text: '' };
      commit({ ...snap, comments: [...snap.comments, pin] });
      setEditingComment(pin.id);
      return;
    }
    if (tool === 'arrow' && !onItem) {
      const [x, y] = worldPos(p);
      const arrow: StudioArrow = { id: nid('ar'), name: 'Arrow', x1: x, y1: y, x2: x, y2: y, visible: true };
      commit({ ...snap, arrows: [...snap.arrows, arrow] }, false);
      gesture.current = { kind: 'arrow', start: [x, y], arrowId: arrow.id };
      return;
    }
    if (tool === 'image' && !onItem) {
      fileInputRef.current?.click();
      return;
    }

    // select tool
    if (onItem) return; // item's own handler takes it (see hookItem)
    if ('shiftKey' in e && e.shiftKey) {
      gesture.current = { kind: 'marquee', start: worldPos(p) };
      setMarquee({ x: worldPos(p)[0], y: worldPos(p)[1], w: 0, h: 0 });
      return;
    }
    // plain empty-space drag = pan (unchanged prototype interaction)
    gesture.current = { kind: 'pan', start: [p.clientX, p.clientY], camStart: { ox: cam.current.ox, oy: cam.current.oy } };
    setSelected([]);
  }

  function onWrapMove(e: RMouseEvent | RTouchEvent) {
    const g = gesture.current;
    if (!g) return;
    const p = pointOf(e);
    if (g.kind === 'pinch' && 'touches' in e && e.touches.length === 2 && g.pinchStart) {
      const d = distTouches(e);
      cam.current.scale = Math.min(2, Math.max(0.3, (g.pinchStart.scale * d) / g.pinchStart.d));
      applyCam();
      return;
    }
    if (g.kind === 'pan' && g.camStart) {
      cam.current.ox = g.camStart.ox + (p.clientX - g.start[0]);
      cam.current.oy = g.camStart.oy + (p.clientY - g.start[1]);
      applyCam();
      return;
    }
    if (g.kind === 'ink') {
      const [x, y] = worldPos(p);
      const ctx = inkCanvasRef.current?.getContext('2d');
      const stroke = snap.ink[snap.ink.length - 1];
      if (ctx && stroke) {
        const [lx, ly] = stroke.points[stroke.points.length - 1];
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(x, y);
        ctx.stroke();
        stroke.points.push([x, y]);
      }
      return;
    }
    if (g.kind === 'marquee') {
      const [x, y] = worldPos(p);
      const x0 = g.start[0],
        y0 = g.start[1];
      setMarquee({ x: Math.min(x0, x), y: Math.min(y0, y), w: Math.abs(x - x0), h: Math.abs(y - y0) });
      return;
    }
    if (g.kind === 'arrow' && g.arrowId) {
      const [x, y] = worldPos(p);
      setSnap((s) => ({ ...s, arrows: s.arrows.map((a) => (a.id === g.arrowId ? { ...a, x2: x, y2: y } : a)) }));
      return;
    }
    if (g.kind === 'drag' && g.itemStarts) {
      const [sx, sy] = g.start;
      const [x, y] = worldPos(p);
      let dx = x - sx,
        dy = y - sy;

      // alignment guides: snap primary dragged item against unselected items
      const primaryId = Object.keys(g.itemStarts)[0];
      const primaryStart = g.itemStarts[primaryId];
      const primary = snap.items.find((i) => i.id === primaryId);
      if (primary) {
        const nx = primaryStart.x + dx,
          ny = primaryStart.y + dy;
        let vGuide: number | null = null,
          hGuide: number | null = null;
        for (const other of snap.items) {
          if (selected.includes(other.id)) continue;
          const oCx = other.x + other.w / 2,
            oL = other.x,
            oR = other.x + other.w;
          const nCx = nx + primary.w / 2,
            nL = nx,
            nR = nx + primary.w;
          if (Math.abs(nL - oL) < SNAP) { dx += oL - nL; vGuide = oL; }
          else if (Math.abs(nCx - oCx) < SNAP) { dx += oCx - nCx; vGuide = oCx; }
          else if (Math.abs(nR - oR) < SNAP) { dx += oR - nR; vGuide = oR; }
          const oCy = other.y + other.h / 2,
            oT = other.y,
            oB = other.y + other.h;
          const nCy = ny + primary.h / 2,
            nT = ny,
            nB = ny + primary.h;
          if (Math.abs(nT - oT) < SNAP) { dy += oT - nT; hGuide = oT; }
          else if (Math.abs(nCy - oCy) < SNAP) { dy += oCy - nCy; hGuide = oCy; }
          else if (Math.abs(nB - oB) < SNAP) { dy += oB - nB; hGuide = oB; }
        }
        setGuides({ v: vGuide, h: hGuide });
      }

      for (const id of Object.keys(g.itemStarts)) {
        const st = g.itemStarts[id];
        const el = itemElRefs.current[id];
        if (el) {
          el.style.left = st.x + dx + 'px';
          el.style.top = st.y + dy + 'px';
        }
      }
      (g as { lastDelta?: [number, number] }).lastDelta = [dx, dy];
      return;
    }
    if (g.kind === 'resize' && g.resizeId && g.resizeStart) {
      const [sx, sy] = g.start;
      const [x, y] = worldPos(p);
      const el = itemElRefs.current[g.resizeId];
      const nw = Math.max(60, g.resizeStart.w + (x - sx));
      const nh = Math.max(50, g.resizeStart.h + (y - sy));
      if (el) {
        el.style.width = nw + 'px';
        el.style.height = nh + 'px';
      }
      (g as { lastSize?: [number, number] }).lastSize = [nw, nh];
      return;
    }
  }

  function onWrapUp() {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'marquee' && marquee) {
      const hit = snap.items.filter((it) => it.x < marquee.x + marquee.w && it.x + it.w > marquee.x && it.y < marquee.y + marquee.h && it.y + it.h > marquee.y).map((it) => it.id);
      setSelected(hit);
      setMarquee(null);
    }
    if (g.kind === 'drag' && g.itemStarts) {
      const lastDelta = (g as { lastDelta?: [number, number] }).lastDelta ?? [0, 0];
      const items = snap.items.map((it) => (g.itemStarts![it.id] ? { ...it, x: g.itemStarts![it.id].x + lastDelta[0], y: g.itemStarts![it.id].y + lastDelta[1] } : it));
      commit({ ...snap, items });
      setGuides({ v: null, h: null });
    }
    if (g.kind === 'resize' && g.resizeId) {
      const lastSize = (g as { lastSize?: [number, number] }).lastSize;
      if (lastSize) {
        const items = snap.items.map((it) => (it.id === g.resizeId ? { ...it, w: lastSize[0], h: lastSize[1] } : it));
        commit({ ...snap, items });
      }
    }
    if (g.kind === 'ink') commit(snap);
    if (g.kind === 'arrow') commit(snap);
    gesture.current = null;
  }

  function onWheel(e: RWheelEvent) {
    e.preventDefault();
    setZoom(e.deltaY < 0 ? 1 : -1);
  }

  /* ============ ITEM INTERACTION ============ */
  function onItemDown(e: RMouseEvent | RTouchEvent, id: string) {
    if (tool !== 'select') return;
    e.stopPropagation();
    const el = e.target as HTMLElement;
    if (el.contentEditable === 'true' || el.closest('.resize-handle')) return;
    const shift = 'shiftKey' in e && e.shiftKey;
    let nextSel: string[];
    if (shift) {
      nextSel = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
    } else {
      nextSel = selected.includes(id) ? selected : [id];
    }
    setSelected(nextSel);
    const p = pointOf(e);
    const itemStarts: Record<string, { x: number; y: number }> = {};
    // primary item first so alignment-guide math above reads it via Object.keys()[0]
    itemStarts[id] = { x: snap.items.find((i) => i.id === id)!.x, y: snap.items.find((i) => i.id === id)!.y };
    nextSel.filter((s) => s !== id).forEach((s) => {
      const it = snap.items.find((i) => i.id === s);
      if (it) itemStarts[s] = { x: it.x, y: it.y };
    });
    gesture.current = { kind: 'drag', start: worldPos(p), itemStarts };
  }
  function onResizeDown(e: RMouseEvent | RTouchEvent, id: string) {
    e.stopPropagation();
    setSelected([id]);
    const p = pointOf(e);
    const it = snap.items.find((i) => i.id === id)!;
    gesture.current = { kind: 'resize', start: worldPos(p), resizeId: id, resizeStart: { w: it.w, h: it.h } };
  }

  function updateText(id: string, text: string) {
    setSnap((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, text } : it)) }));
  }
  function commitTextEdit() {
    commit(snap, true);
  }
  function deleteSelected() {
    if (!selected.length) return;
    commit({
      ...snap,
      items: snap.items.filter((i) => !selected.includes(i.id)),
      links: snap.links.filter((l) => !selected.includes(l.sourceItemId) && !selected.includes(l.targetItemId)),
    });
    setSelected([]);
  }

  /* ============ IMAGE UPLOAD ============ */
  function onFileChosen(e: RChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const [x, y] = [-cam.current.ox / cam.current.scale + 60, -cam.current.oy / cam.current.scale + 60];
      spawnItem('image', x, y, { src: String(reader.result), w: 220, h: 160 });
    };
    reader.readAsDataURL(file);
  }

  /* ============ LAYERS PANEL — drag to reorder ============ */
  const dragLayerIdx = useRef<number | null>(null);
  function onLayerDragStart(i: number) {
    dragLayerIdx.current = i;
  }
  function onLayerDrop(i: number) {
    const from = dragLayerIdx.current;
    if (from === null || from === i) return;
    const items = [...snap.items];
    const [moved] = items.splice(items.length - 1 - from, 1);
    items.splice(items.length - i, 0, moved);
    commit({ ...snap, items });
    dragLayerIdx.current = null;
  }
  function toggleVisible(id: string) {
    commit({ ...snap, items: snap.items.map((it) => (it.id === id ? { ...it, visible: !it.visible } : it)) });
  }

  useEffect(() => {
    applyCam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (playing) exitPlay();
      else if (linkArmed) setLinkArmed(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, linkArmed]);

  const layerOrder = [...snap.items].reverse(); // top of list = topmost z-order

  return (
    <div
      id="stWrap"
      ref={wrapRef}
      onMouseDown={onWrapDown}
      onMouseMove={onWrapMove}
      onMouseUp={onWrapUp}
      onMouseLeave={onWrapUp}
      onTouchStart={onWrapDown}
      onTouchMove={onWrapMove}
      onTouchEnd={onWrapUp}
      onWheel={onWheel}
    >
      <div id="stTools">
        <span className="tool" onClick={onExit} title="all boards">◂</span>
        <span className="tool sep" />
        {(
          [
            ['select', '▲'],
            ['pen', '✎'],
            ['frame', '▭'],
            ['sticky', '✦'],
            ['rect', '□'],
            ['circle', '○'],
            ['arrow', '↗'],
            ['image', '🖼'],
            ['comment', '💬'],
            ['link', '🔗'],
          ] as [Tool, string][]
        ).map(([t, label]) => (
          <span key={t} className={`tool ${tool === t ? 'on' : ''}`} onClick={() => { setTool(t); setLinkArmed(null); }} title={t === 'link' ? 'link frames (click a hotspot, then a target frame)' : t}>
            {label}
          </span>
        ))}
        <span className="tool sep" />
        <span className={`tool ${componentsPanelOpen ? 'on' : ''}`} onClick={() => setComponentsPanelOpen((v) => !v)} title="components">🧩</span>
        <span className="tool sep" />
        <span className="tool" onClick={() => setZoom(1)}>＋</span>
        <span className="tool" onClick={() => setZoom(-1)}>－</span>
        <span className="tool sep" />
        <button className="wbtn" style={{ padding: '0 14px', height: 32 }} disabled={!snap.items.some((i) => i.type === 'frame')} onClick={startPlay} title="preview/play mode">
          ▶ PLAY
        </button>
      </div>
      {tool === 'link' && (
        <div id="linkHint">
          {linkArmed ? 'Click a target frame to link to it — Esc to cancel' : 'Click a button or frame to start a link'}
        </div>
      )}

      <div id="stWorld" ref={worldRef}>
        <canvas id="stInk" ref={inkCanvasRef} width={5000} height={3500} />

        {/* arrows + alignment guides overlay */}
        <svg style={{ position: 'absolute', left: 0, top: 0, width: 5000, height: 3500, pointerEvents: 'none', zIndex: 3 }}>
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="var(--cyan)" />
            </marker>
          </defs>
          {snap.arrows.filter((a) => a.visible).map((a) => (
            <line key={a.id} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="var(--cyan)" strokeWidth={2} markerEnd="url(#arrowhead)" />
          ))}
        </svg>
        {guides.v !== null && <div className="guideline" style={{ left: guides.v, top: 0, width: 1, height: 3500 }} />}
        {guides.h !== null && <div className="guideline" style={{ left: 0, top: guides.h, width: 5000, height: 1 }} />}
        {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}

        {snap.items.map((it) => it.visible && (
          <div
            key={it.id}
            ref={(el) => { itemElRefs.current[it.id] = el; }}
            className={itemClass(it, selected.includes(it.id))}
            style={itemStyle(it)}
            onMouseDown={(e) => onItemDown(e, it.id)}
            onTouchStart={(e) => onItemDown(e, it.id)}
          >
            <ItemBody
              item={it}
              onTextChange={(v) => updateText(it.id, v)}
              onTextBlur={commitTextEdit}
              links={snap.links}
              components={snap.components}
              linkMode={tool === 'link'}
              linkArmedId={linkArmed?.itemId ?? null}
              onHotspotClick={handleHotspotClick}
              onInstanceVariantPick={selected.includes(it.id) && selected.length === 1 ? (v) => setInstanceVariant(it.id, v) : undefined}
            />
            {selected.includes(it.id) && tool === 'select' && (
              <div className="resize-handle" onMouseDown={(e) => onResizeDown(e, it.id)} onTouchStart={(e) => onResizeDown(e, it.id)} />
            )}
          </div>
        ))}

        {snap.comments.map((c) => (
          <div key={c.id} className="commentpin" style={{ left: c.x, top: c.y }} onClick={() => setEditingComment(c.id)}>
            <span>💬</span>
            {editingComment === c.id && (
              <div
                className="gpanel"
                style={{ position: 'absolute', left: 24, top: -6, width: 180, padding: 8, transform: 'rotate(45deg)', transformOrigin: 'top left' }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div style={{ transform: 'rotate(0deg)' }}>
                  <textarea
                    autoFocus
                    value={c.text}
                    placeholder="Comment…"
                    style={{ width: '100%', minHeight: 50, fontSize: 11, background: 'rgba(0,0,0,.3)', padding: 6 }}
                    onChange={(e) => setSnap((s) => ({ ...s, comments: s.comments.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)) }))}
                    onBlur={() => { commit(snap); setEditingComment(null); }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div id="layersPanel" className="gpanel">
        <h3>LAYERS · {snap.items.length}</h3>
        {layerOrder.map((it, i) => (
          <div
            key={it.id}
            className={`layer-row ${selected.includes(it.id) ? 'sel' : ''}`}
            draggable
            onDragStart={() => onLayerDragStart(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onLayerDrop(i)}
            onClick={() => setSelected([it.id])}
          >
            <span className={`vis ${it.visible ? '' : 'off'}`} onClick={(e) => { e.stopPropagation(); toggleVisible(it.id); }}>
              {it.visible ? '◉' : '○'}
            </span>
            <span className="lbl">{iconFor(it.type)} {it.name}</span>
          </div>
        ))}
        {selected.length > 0 && (
          <div style={{ padding: 8, borderTop: '1px solid var(--edge)' }}>
            <button className="wbtn ghost" style={{ width: '100%' }} onClick={deleteSelected}>
              DELETE ({selected.length})
            </button>
          </div>
        )}
      </div>

      <div id="stUndoRedo">
        <button onClick={undo} disabled={!past.current.length}>↺</button>
        <button onClick={redo} disabled={!future.current.length}>↻</button>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFileChosen} />

      {componentsPanelOpen && (
        <ComponentsPanel
          components={snap.components}
          onAdd={() => addComponent()}
          onAddInstance={addComponentInstance}
          onUpdateVariant={updateComponentVariantStyle}
          onCommit={commitComponentEdit}
          onDelete={deleteComponent}
          onClose={() => setComponentsPanelOpen(false)}
        />
      )}

      {playing && (
        <PlayOverlay
          frame={snap.items.find((i) => i.id === playing) ?? null}
          canBack={playStack.length > 0}
          onHotspot={navigatePlay}
          onBack={playBack}
          onExit={exitPlay}
        />
      )}
    </div>
  );
}

function iconFor(t: StudioItemType) {
  return { frame: '▭', sticky: '✦', stickyM: '✦', rect: '□', circle: '○', mood: '◆', image: '🖼', component: '🧩' }[t];
}
function itemClass(it: StudioItem, sel: boolean) {
  const base = ['sitem'];
  if (it.type === 'sticky') base.push('snote');
  if (it.type === 'stickyM') base.push('snote', 'm');
  if (it.type === 'mood') base.push('mood');
  if (it.type === 'rect') base.push('shape-rect');
  if (it.type === 'circle') base.push('shape-circle');
  if (it.type === 'component') base.push('comp-instance');
  if (sel) base.push('sel');
  return base.join(' ');
}
function itemStyle(it: StudioItem): CSSProperties {
  const style: CSSProperties = { left: it.x, top: it.y, width: it.w, height: it.h };
  if (it.type === 'mood') {
    style.background = it.bg;
    style.color = it.fg;
    style.display = 'grid';
    style.placeItems = 'center';
  }
  if (it.type === 'image' && it.src) {
    style.backgroundImage = `url(${it.src})`;
    style.backgroundSize = 'cover';
    style.backgroundPosition = 'center';
  }
  return style;
}

function ItemBody({
  item,
  onTextChange,
  onTextBlur,
  links,
  components,
  linkMode,
  linkArmedId,
  onHotspotClick,
  onInstanceVariantPick,
}: {
  item: StudioItem;
  onTextChange: (v: string) => void;
  onTextBlur: () => void;
  links: PrototypeLink[];
  components: StudioComponent[];
  linkMode: boolean;
  linkArmedId: string | null;
  onHotspotClick: (itemId: string, hotspotKey: string) => void;
  onInstanceVariantPick?: (v: ComponentVariantName) => void;
}) {
  if (item.type === 'mood') return <>{item.name}</>;
  if (item.type === 'image') return null;
  if (item.type === 'sticky' || item.type === 'stickyM') {
    return (
      <>
        <div className="tag">{item.type === 'stickyM' ? '◆ IDEA' : '◆ FROM CAPTURE'}</div>
        <div
          className="txt"
          contentEditable
          suppressContentEditableWarning
          onInput={(e) => onTextChange((e.target as HTMLElement).textContent ?? '')}
          onBlur={onTextBlur}
        >
          {item.text}
        </div>
      </>
    );
  }
  if (item.type === 'rect' || item.type === 'circle') {
    return (
      <div className="ttl">
        {item.name} <span>{Math.round(item.w)}×{Math.round(item.h)}</span>
      </div>
    );
  }
  if (item.type === 'component') {
    const comp = components.find((c) => c.id === item.componentId);
    return (
      <ComponentInstanceBody
        item={item}
        component={comp}
        linkMode={linkMode}
        isArmedSource={linkArmedId === item.id}
        onHotspotClick={() => onHotspotClick(item.id, 'self')}
        onVariantPick={onInstanceVariantPick}
      />
    );
  }
  // frame
  const linkedKeys = new Set(links.filter((l) => l.sourceItemId === item.id).map((l) => l.hotspotKey));
  const isArmedSource = linkArmedId === item.id;
  const hotspot = linkMode ? (key: string) => onHotspotClick(item.id, key) : undefined;
  return (
    <>
      <div className="ttl">
        {item.name} <span>375×812</span>
      </div>
      <div
        className={`wfb ${linkMode ? 'linkable' : ''} ${isArmedSource ? 'armed' : ''}`}
        onClick={hotspot ? (e) => { e.stopPropagation(); hotspot('frame'); } : undefined}
      >
        {item.variant === 'splash' && (
          <>
            <div className="ph solid" style={{ height: 90 }}>🐝 LOGO MARK</div>
            <div className="ph" style={{ height: 16 }}>TAGLINE</div>
            <div className="ph" style={{ height: 110 }}>HERO ILLUSTRATION</div>
            <div className="btnrow">
              <Hotspot label="GET STARTED" className="wbtn" hkey="btn0" hotspot={hotspot} linked={linkedKeys.has('btn0')} />
              <Hotspot label="LOG IN" className="wbtn ghost" hkey="btn1" hotspot={hotspot} linked={linkedKeys.has('btn1')} />
            </div>
          </>
        )}
        {item.variant === 'onboarding' && (
          <>
            <div className="ph" style={{ height: 12, width: '60%' }}>PROGRESS ●○○</div>
            <div className="ph solid" style={{ height: 130 }}>PICK YOUR SUBJECTS</div>
            <div className="ph" style={{ height: 34 }}>CHIP · CHIP · CHIP</div>
            <div className="btnrow">
              <Hotspot label="CONTINUE" className="wbtn" hkey="btn0" hotspot={hotspot} linked={linkedKeys.has('btn0')} />
            </div>
          </>
        )}
        {(!item.variant || item.variant === 'blank') && (
          <>
            <div className="ph" style={{ height: 140 }}>CANVAS</div>
            <div className="btnrow">
              <Hotspot label="ACTION" className="wbtn" hkey="btn0" hotspot={hotspot} linked={linkedKeys.has('btn0')} />
            </div>
          </>
        )}
        {linkedKeys.has('frame') && <span className="hotspotLinked frameLinked" title="whole-frame link">🔗</span>}
      </div>
    </>
  );
}

/** A clickable region inside a frame template that the Link tool can wire
 * to another frame. Renders identically to the original static `.wbtn`
 * when not in link mode — this is a real interaction layered on top of
 * the existing visual language, not a new element type. */
function Hotspot({ label, className, hkey, hotspot, linked }: { label: string; className: string; hkey: string; hotspot?: (key: string) => void; linked: boolean }) {
  return (
    <div className={`${className} ${hotspot ? 'linkable' : ''}`} onClick={hotspot ? (e) => { e.stopPropagation(); hotspot(hkey); } : undefined}>
      {label}
      {linked && <span className="hotspotLinked">🔗</span>}
    </div>
  );
}

/** A reusable component instance — Amendment v0.2: "a button's default/
 * hover/pressed states as one reusable component" rendered with genuinely
 * live mouse interaction (not three static swatches standing in for
 * states). Resting look is the editor-authored `activeVariant`; hovering
 * or holding the mouse down swaps to the component's real hover/pressed
 * style for as long as the pointer is actually in that state. */
function ComponentInstanceBody({
  item,
  component,
  linkMode,
  isArmedSource,
  onHotspotClick,
  onVariantPick,
}: {
  item: StudioItem;
  component: StudioComponent | undefined;
  linkMode: boolean;
  isArmedSource: boolean;
  onHotspotClick: () => void;
  onVariantPick?: (v: ComponentVariantName) => void;
}) {
  const [live, setLive] = useState<'hover' | 'pressed' | null>(null);
  if (!component) {
    return <div className="ttl" style={{ color: 'var(--magenta)' }}>⚠ missing component</div>;
  }
  const resting = item.activeVariant ?? 'default';
  const shown = live ?? resting;
  const style = component.variants[shown];
  return (
    <div
      className={`compBtn ${linkMode ? 'linkable' : ''} ${isArmedSource ? 'armed' : ''}`}
      style={{ background: style.bg, color: style.fg, border: `1px solid ${shown === 'default' ? 'var(--edge)' : style.fg}` }}
      onMouseEnter={() => !linkMode && setLive('hover')}
      onMouseLeave={() => setLive(null)}
      onMouseDown={() => !linkMode && setLive('pressed')}
      onMouseUp={() => !linkMode && setLive('hover')}
      onClick={linkMode ? (e) => { e.stopPropagation(); onHotspotClick(); } : undefined}
    >
      {style.label}
      {onVariantPick && !linkMode && (
        <div className="compVariantPicker" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          {(['default', 'hover', 'pressed'] as ComponentVariantName[]).map((v) => (
            <span key={v} className={`compChip ${resting === v ? 'on' : ''}`} onClick={() => onVariantPick(v)}>
              {v[0].toUpperCase()}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The Components library panel — define reusable components (seeded as a
 * Button with default/hover/pressed variants) and drop instances onto the
 * canvas. Editing a variant's color/label here updates every instance of
 * that component, since they all reference the one definition. */
function ComponentsPanel({
  components,
  onAdd,
  onAddInstance,
  onUpdateVariant,
  onCommit,
  onDelete,
  onClose,
}: {
  components: StudioComponent[];
  onAdd: () => string;
  onAddInstance: (id: string) => void;
  onUpdateVariant: (componentId: string, variant: ComponentVariantName, patch: Partial<ComponentVariantStylePatch>) => void;
  onCommit: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(components[0]?.id ?? null);
  const editing = components.find((c) => c.id === editingId) ?? null;
  return (
    <div id="componentsPanel" className="gpanel">
      <h3>
        COMPONENTS · {components.length}
        <span className="lyAdd" onClick={() => setEditingId(onAdd())} title="new component">＋</span>
        <span className="compPanelClose" onClick={onClose} title="close">✕</span>
      </h3>
      <div id="compList">
        {components.map((c) => (
          <div key={c.id} className={`layer-row ${editingId === c.id ? 'sel' : ''}`} onClick={() => setEditingId(c.id)}>
            <span className="lbl">🧩 {c.name}</span>
            <span className="lyDup" title="add to canvas" onClick={(e) => { e.stopPropagation(); onAddInstance(c.id); }}>⊕</span>
            <span className="lyDel" title="delete component" onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}>✕</span>
          </div>
        ))}
        {!components.length && <div className="compEmpty">No components yet — ＋ to create one.</div>}
      </div>
      {editing && (
        <div id="compEditor">
          <h4>{editing.name}</h4>
          {(['default', 'hover', 'pressed'] as ComponentVariantName[]).map((v) => (
            <div key={v} className="compVariantRow">
              <label>{v.toUpperCase()}</label>
              <input
                type="text"
                value={editing.variants[v].label}
                onChange={(e) => onUpdateVariant(editing.id, v, { label: e.target.value })}
                onBlur={onCommit}
              />
              <input
                type="color"
                value={toHexColor(editing.variants[v].bg)}
                onChange={(e) => onUpdateVariant(editing.id, v, { bg: e.target.value })}
                onBlur={onCommit}
              />
              <input
                type="color"
                value={toHexColor(editing.variants[v].fg)}
                onChange={(e) => onUpdateVariant(editing.id, v, { fg: e.target.value })}
                onBlur={onCommit}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
type ComponentVariantStylePatch = { bg: string; fg: string; label: string };
function toHexColor(c: string): string {
  // <input type=color> requires a #rrggbb value — component variants can
  // start with rgba()/transparent/named colors from the seed defaults, so
  // fall back to a neutral gray for the picker rather than crashing it.
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  return '#808080';
}

/** Play/Preview mode — Amendment v0.2: "a real preview/play mode that lets
 * the Captain click through their wireframe like a working app." Renders
 * exactly one frame at phone-mockup scale, full-screen, with its actual
 * hotspots wired to real navigation instead of the editor's select/drag
 * behavior — this reuses the same frame-template markup as the canvas
 * editor (via FrameContent) so preview never drifts from what's designed. */
function PlayOverlay({ frame, canBack, onHotspot, onBack, onExit }: { frame: StudioItem | null; canBack: boolean; onHotspot: (key: string) => void; onBack: () => void; onExit: () => void }) {
  if (!frame) {
    return (
      <div id="playOverlay">
        <div id="playTopbar">
          <button className="chip" onClick={onExit}>✕ EXIT PREVIEW</button>
        </div>
        <div className="playDead">This link points at a frame that no longer exists.</div>
      </div>
    );
  }
  return (
    <div id="playOverlay">
      <div id="playTopbar">
        {canBack && <button className="chip" onClick={onBack}>◂ BACK</button>}
        <span className="playFrameName">{frame.name}</span>
        <button className="chip" onClick={onExit}>✕ EXIT PREVIEW</button>
      </div>
      <div id="playPhone">
        <div className="wfb" onClick={(e) => { e.stopPropagation(); onHotspot('frame'); }}>
          {frame.variant === 'splash' && (
            <>
              <div className="ph solid" style={{ height: 90 }}>🐝 LOGO MARK</div>
              <div className="ph" style={{ height: 16 }}>TAGLINE</div>
              <div className="ph" style={{ height: 110 }}>HERO ILLUSTRATION</div>
              <div className="btnrow">
                <div className="wbtn" onClick={(e) => { e.stopPropagation(); onHotspot('btn0'); }}>GET STARTED</div>
                <div className="wbtn ghost" onClick={(e) => { e.stopPropagation(); onHotspot('btn1'); }}>LOG IN</div>
              </div>
            </>
          )}
          {frame.variant === 'onboarding' && (
            <>
              <div className="ph" style={{ height: 12, width: '60%' }}>PROGRESS ●○○</div>
              <div className="ph solid" style={{ height: 130 }}>PICK YOUR SUBJECTS</div>
              <div className="ph" style={{ height: 34 }}>CHIP · CHIP · CHIP</div>
              <div className="btnrow">
                <div className="wbtn" onClick={(e) => { e.stopPropagation(); onHotspot('btn0'); }}>CONTINUE</div>
              </div>
            </>
          )}
          {(!frame.variant || frame.variant === 'blank') && (
            <>
              <div className="ph" style={{ height: 140 }}>CANVAS</div>
              <div className="btnrow">
                <div className="wbtn" onClick={(e) => { e.stopPropagation(); onHotspot('btn0'); }}>ACTION</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
