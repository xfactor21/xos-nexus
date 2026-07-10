export type StudioItemType = 'frame' | 'sticky' | 'stickyM' | 'rect' | 'circle' | 'mood' | 'image';

export interface StudioItem {
  id: string;
  type: StudioItemType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  src?: string;
  visible: boolean;
  variant?: 'splash' | 'onboarding' | 'blank';
  bg?: string;
  fg?: string;
}

export interface StudioArrow {
  id: string;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  visible: boolean;
}

export interface InkStroke {
  id: string;
  points: [number, number][];
}

export interface CommentPin {
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface StudioSnapshot {
  items: StudioItem[];
  arrows: StudioArrow[];
  ink: InkStroke[];
  comments: CommentPin[];
}

/**
 * Blueprint v0.3 Amendment v0.2 — Design Studio → Multi-Mode Creative
 * Suite. A board picks a mode at creation, like choosing a file type in
 * Figma. Only 'draw' and 'wireframe' are actually implemented — the
 * amendment's own updated execution order says Draw/Paint first, then
 * Wireframe/Prototype interactivity, "then the remaining modes can follow
 * after the rest of the room overhaul progresses." The rest are modeled
 * here (so the picker UI and data shape are future-proof) but surfaced as
 * "coming soon" rather than faked with a shallow stub.
 */
export type StudioMode = 'draw' | 'wireframe' | 'animation' | 'vector' | 'diagram' | 'moodboard';

export const IMPLEMENTED_MODES: StudioMode[] = ['draw', 'wireframe'];

export interface StudioBoard {
  id: string;
  name: string;
  mode: StudioMode;
  createdAt: string;
  updatedAt: string;
}

/* ============ Draw / Paint mode ============ */

export type BrushType = 'pencil' | 'ink' | 'airbrush' | 'texture';

/** Maps directly onto CanvasRenderingContext2D.globalCompositeOperation —
 * the browser's native compositor already implements real Porter-Duff +
 * separable blend-mode math, so this isn't a re-implementation, just a
 * typed subset of what canvas already supports natively. */
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

export interface BrushSettings {
  type: BrushType;
  size: number; // px, radius at pressure=1
  opacity: number; // 0-1, caps the whole stroke regardless of overlap
  hardness: number; // 0-1, edge softness of the brush tip
  flow: number; // 0-1, per-dab build-up rate within a stroke
  color: string; // '#rrggbb'
}

export interface DrawLayerMeta {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0-1
  blendMode: BlendMode;
  locked: boolean;
}

/** Persisted board document — layer pixel data serializes as PNG data
 * URLs (canvas.toDataURL), which is the only realistic way to survive a
 * page reload without a real backing store; see the Design Studio README
 * deviation note for why this still isn't wired to Supabase. */
export interface DrawDocument {
  width: number;
  height: number;
  layers: DrawLayerMeta[];
  layerData: Record<string, string>; // layer id -> PNG data URL
  activeLayerId: string;
  swatches: string[];
}
