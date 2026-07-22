export type StudioItemType = 'frame' | 'sticky' | 'stickyM' | 'rect' | 'circle' | 'mood' | 'image' | 'component';

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
  /** Wireframe/Prototype mode, Amendment v0.2: which reusable StudioComponent
   * this canvas item is an instance of, and which of its named variants is
   * the "resting" look shown in the editor — real hover/pressed previewing
   * on top of this happens live via mouse events, not stored state. */
  componentId?: string;
  activeVariant?: ComponentVariantName;
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
  /** Amendment v0.2 — Wireframe/Prototype interactivity: frame links let
   * the Captain wire a click target (a specific button inside a frame, or
   * the whole frame as a fallback) to another frame, then click through the
   * whole flow in Play mode like a working app. */
  links: PrototypeLink[];
  /** Amendment v0.2 — reusable components with named variants (a button's
   * default/hover/pressed states as one definition, not three copies). */
  components: StudioComponent[];
}

/**
 * Wireframe/Prototype mode, Amendment v0.2. A link's `hotspotKey` names
 * which clickable region of the source item it's wired from: `'frame'`
 * means "anywhere on the frame body that isn't a more specific hotspot",
 * `'btn0'`/`'btn1'`/… address a specific button rendered inside a frame
 * template (see ItemBody in Wireframe.tsx), and `'self'` addresses a
 * whole component instance. One link per (sourceItemId, hotspotKey) pair —
 * wiring a new target to an existing hotspot replaces the old link.
 */
export interface PrototypeLink {
  id: string;
  sourceItemId: string;
  hotspotKey: string;
  targetItemId: string;
}

/** Amendment v0.2 — Wireframe/Prototype mode component library: "a button's
 * default/hover/pressed states as one reusable component" rather than three
 * separate static shapes. `bg`/`fg` are real applied styles (not swatches
 * standing in for them), and `label` is the text rendered in that variant —
 * real per-state content, since a pressed state often reads differently
 * ("Sending…" vs "Send") not just a different color. */
export type ComponentVariantName = 'default' | 'hover' | 'pressed';

export interface ComponentVariantStyle {
  bg: string;
  fg: string;
  label: string;
}

export interface StudioComponent {
  id: string;
  name: string;
  variants: Record<ComponentVariantName, ComponentVariantStyle>;
}

/**
 * Blueprint v0.3 Amendment v0.2/v0.3 Section B — Design Studio → Multi-Mode
 * Creative Suite. A board picks a mode at creation, like choosing a file
 * type in Figma. `draw` and `wireframe` were implemented first per the
 * amendment's own execution order; Amendment v0.4 item 2 (New Project
 * modal redesign) adds the full 8-primary + Show-More utility-tool roster
 * from Section B to the *picker*, and brings real, working — if
 * appropriately small — implementations for the utility tools alongside
 * it, rather than the old flat 6-tile grid with literal "Coming soon"
 * placeholders. The five heavier primary creative modes this pass doesn't
 * build full flagship depth for (vector/diagram/moodboard/presentation/
 * iconDesign) get their own dedicated future passes the same way Animation
 * (built out fully in Amendment v0.4 item 3) did — see the Studio picker's
 * own comment for exactly which modes are genuinely implemented right now.
 */
export type StudioMode =
  | 'draw'
  | 'wireframe'
  | 'animation'
  | 'vector'
  | 'diagram'
  | 'moodboard'
  | 'presentation'
  | 'iconDesign'
  // ---- utility tools (Amendment v0.3 Section B "Show More" roster) ----
  | 'imageConverter'
  | 'backgroundRemover'
  | 'paletteGenerator'
  | 'quickPhotoEditor'
  | 'logoMaker'
  | 'pixelArt'
  | 'videoTrimmer'
  | 'audioTrimmer'
  | 'pdfMarkup'
  | 'qrGenerator'
  | 'memeGenerator'
  | 'fontPairing'
  | 'screenshotAnnotator'
  | 'gifMaker'
  | 'chartBuilder'
  | 'printLayout'
  | 'modelViewer';

/** Which modes have a genuine, working implementation behind them right
 * now — kept as an explicit allowlist (not "everything not on a deny
 * list") so a newly-added `StudioMode` is honestly unavailable in the
 * picker until it's actually built, never silently clickable into a
 * blank room. */
export const IMPLEMENTED_MODES: StudioMode[] = [
  'draw',
  'wireframe',
  // Amendment v0.4 item 3: Animation mode built out fully — real per-
  // property keyframe timeline + tweening, onion-skinning, a bone/puppet
  // FK rig, and real GIF + PNG sprite-sheet export. See Animation.tsx and
  // animation/AnimationEngine.ts for exactly what's real vs. deliberately
  // deferred (inverse kinematics, mesh deform, particles/physics,
  // audio-sync, nested symbols, Lottie/video export).
  'animation',
  'imageConverter',
  'paletteGenerator',
  'quickPhotoEditor',
  'pixelArt',
  'qrGenerator',
  'memeGenerator',
  'fontPairing',
  'screenshotAnnotator',
  'chartBuilder',
  'audioTrimmer',
  'backgroundRemover',
  // Punch-list item #6, batch 1 — the 6 smaller utility tools (the 5
  // remaining primary creative modes — Vector, Diagram, Moodboard,
  // Presentation, Icon Design — are each their own larger dedicated pass,
  // done one at a time with sign-off, not bundled in here).
  'logoMaker',
  'gifMaker',
  'videoTrimmer',
  'pdfMarkup',
  'printLayout',
  'modelViewer',
  // Item #6 batch 2, tool 1 of 5 (done one at a time, in order, per the
  // Captain's direction) — real bezier pen + boolean ops. See
  // VectorEditor.tsx for exactly what's real vs. the one disclosed
  // simplification (booleans flatten curves to straight-edge polygons,
  // same as every real boolean-ops implementation's polygon-clip core).
  'vector',
];

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
