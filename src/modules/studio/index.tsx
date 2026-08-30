import { useEffect, useState } from 'react';
import type { MouseEvent as RMouseEvent } from 'react';
import type { StudioBoard, StudioMode } from './types';
import { IMPLEMENTED_MODES } from './types';
import Icon from '../../design-system/icons/Icon';
import type { IconName } from '../../design-system/icons/registry';
import AmbientField from '../../design-system/background/AmbientField';
import ShipAmbience from '../../design-system/background/ShipAmbience';
import { useUiStore } from '../../stores/uiStore';
import { loadBoards, createBoard, touchBoard, renameBoard, deleteBoard } from './boards';
import { askConfirm } from '../../stores/confirmStore';
import DrawPaint from './draw/DrawPaint';
import Wireframe from './Wireframe';
import Animation from './Animation';
import VectorEditor from './VectorEditor';
import DiagramEditor from './DiagramEditor';
import MoodboardEditor from './MoodboardEditor';
import PresentationEditor from './PresentationEditor';
import IconDesignEditor from './IconDesignEditor';
import ImageConverter from './tools/ImageConverter';
import PaletteGenerator from './tools/PaletteGenerator';
import QuickPhotoEditor from './tools/QuickPhotoEditor';
import PixelArt from './tools/PixelArt';
import QrGenerator from './tools/QrGenerator';
import MemeGenerator from './tools/MemeGenerator';
import FontPairing from './tools/FontPairing';
import ScreenshotAnnotator from './tools/ScreenshotAnnotator';
import ChartBuilder from './tools/ChartBuilder';
import AudioTrimmer from './tools/AudioTrimmer';
import BackgroundRemover from './tools/BackgroundRemover';
import LogoMaker from './tools/LogoMaker';
import GifMaker from './tools/GifMaker';
import VideoTrimmer from './tools/VideoTrimmer';
import PdfMarkup from './tools/PdfMarkup';
import PrintLayout from './tools/PrintLayout';
import ModelViewer from './tools/ModelViewer';

interface ModeMeta {
  label: string;
  icon: IconName;
  blurb: string;
  ref: string;
  category: 'primary' | 'utility';
}

const MODE_META: Record<StudioMode, ModeMeta> = {
  draw: { label: 'Draw / Paint', icon: 'brush', blurb: 'Layers, real brushes, blend modes, filters', ref: 'Photoshop-caliber', category: 'primary' },
  wireframe: { label: 'Wireframe / Prototype', icon: 'rect', blurb: 'Infinite canvas, frames, sticky notes, flows', ref: 'Figma-caliber', category: 'primary' },
  animation: { label: 'Animation', icon: 'clapper', blurb: 'Timeline, keyframes, tweening', ref: 'After Effects-caliber', category: 'primary' },
  vector: { label: 'Vector / Illustration', icon: 'penTool', blurb: 'Bezier pen, paths, boolean ops', ref: 'Illustrator-caliber', category: 'primary' },
  diagram: { label: 'Diagram / Flowchart', icon: 'diagram', blurb: 'Flowcharts, connectors, swimlanes', ref: 'Whimsical-caliber', category: 'primary' },
  moodboard: { label: 'Moodboard / Collage', icon: 'image', blurb: 'Swatches, references, style tiles', ref: 'Milanote-caliber', category: 'primary' },
  presentation: { label: 'Presentation / Slide Deck', icon: 'slidedeck', blurb: 'Slides, layouts, speaker notes', ref: 'Keynote-caliber', category: 'primary' },
  iconDesign: { label: 'Icon Design', icon: 'hexagon', blurb: 'Pixel-grid + vector icon sets', ref: 'Icon-kit-caliber', category: 'primary' },
  imageConverter: { label: 'Image Converter', icon: 'swap', blurb: 'Real PNG/JPEG/WebP conversion', ref: 'utility', category: 'utility' },
  backgroundRemover: { label: 'Background Remover', icon: 'scissors', blurb: 'Edge-seeded color-distance cutout', ref: 'utility', category: 'utility' },
  paletteGenerator: { label: 'Color Palette Generator', icon: 'droplet', blurb: 'From an image or a base color', ref: 'utility', category: 'utility' },
  quickPhotoEditor: { label: 'Quick Photo Editor', icon: 'image', blurb: 'Crop, rotate, flip, brightness/contrast', ref: 'utility', category: 'utility' },
  logoMaker: { label: 'Logo Maker', icon: 'stamp', blurb: 'Icon + wordmark combiner', ref: 'utility', category: 'utility' },
  pixelArt: { label: 'Pixel Art Editor', icon: 'gridDense', blurb: 'Grid painter, crisp nearest-neighbor export', ref: 'utility', category: 'utility' },
  videoTrimmer: { label: 'Video Trimmer', icon: 'play', blurb: 'Trim a clip to a real exported cut', ref: 'utility', category: 'utility' },
  audioTrimmer: { label: 'Audio Waveform Trimmer', icon: 'music', blurb: 'Real waveform, trim, export WAV', ref: 'utility', category: 'utility' },
  pdfMarkup: { label: 'PDF Markup / Annotator', icon: 'file', blurb: 'Mark up an existing PDF', ref: 'utility', category: 'utility' },
  qrGenerator: { label: 'QR / Barcode Generator', icon: 'grid', blurb: 'Real scannable QR encoding', ref: 'utility', category: 'utility' },
  memeGenerator: { label: 'Meme Generator', icon: 'message', blurb: 'Classic caption-and-image tool', ref: 'utility', category: 'utility' },
  fontPairing: { label: 'Font Pairing Explorer', icon: 'text', blurb: 'Real Google Fonts, live preview', ref: 'utility', category: 'utility' },
  screenshotAnnotator: { label: 'Screenshot Annotator', icon: 'arrowUpRight', blurb: 'Arrows, shapes, callouts on an image', ref: 'utility', category: 'utility' },
  gifMaker: { label: 'GIF Maker', icon: 'clapper', blurb: 'Frames-to-GIF exporter', ref: 'utility', category: 'utility' },
  chartBuilder: { label: 'Chart / Graph Builder', icon: 'chart', blurb: 'Real bar/line/pie from your data', ref: 'utility', category: 'utility' },
  printLayout: { label: 'Print Layout Designer', icon: 'rows', blurb: 'Multi-page print layout', ref: 'utility', category: 'utility' },
  modelViewer: { label: '3D Model Viewer', icon: 'hexagon', blurb: 'Preview a 3D model file', ref: 'stretch', category: 'utility' },
};

function freshnessOf(updatedAt: string): number {
  const days = Math.max(0, (Date.now() - new Date(updatedAt).getTime()) / 86_400_000);
  const halfLife = 5;
  return Math.pow(0.5, days / halfLife) * 100;
}
function BoardRing({ pct, color }: { pct: number; color: string }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" className="boardRing" aria-hidden="true">
      <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="3" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
        transform="rotate(-90 18 18)"
        style={{ transition: 'stroke-dasharray .4s ease' }}
      />
    </svg>
  );
}

const PRIMARY_ORDER: StudioMode[] = ['draw', 'wireframe', 'animation', 'vector', 'diagram', 'moodboard', 'presentation', 'iconDesign'];
const UTILITY_ORDER: StudioMode[] = [
  'imageConverter',
  'backgroundRemover',
  'paletteGenerator',
  'quickPhotoEditor',
  'logoMaker',
  'pixelArt',
  'videoTrimmer',
  'audioTrimmer',
  'pdfMarkup',
  'qrGenerator',
  'memeGenerator',
  'fontPairing',
  'screenshotAnnotator',
  'gifMaker',
  'chartBuilder',
  'printLayout',
  'modelViewer',
];

const LEGACY_KEY = 'xos-studio-v1';

let seedBoardId: string | null = null;

function seedFromLegacyIfNeeded(): StudioBoard[] {
  const existing = loadBoards();
  if (existing.length > 0) return existing;
  const hasLegacy = !!localStorage.getItem(LEGACY_KEY);
  const board = createBoard('Original Board', 'wireframe');
  seedBoardId = board.id;
  if (hasLegacy) {
    try {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) localStorage.setItem(`xos-studio-wf-${board.id}`, legacy);
    } catch {
      /* ignore */
    }
  }
  return loadBoards();
}

export default function Studio({ active }: { active: boolean }) {
  const [boards, setBoards] = useState<StudioBoard[]>(seedFromLegacyIfNeeded);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMode, setNewMode] = useState<StudioMode>('draw');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const pinkAccents = useUiStore((s) => s.pinkAccents);

  const openBoard = boards.find((b) => b.id === openId) || null;

  function refresh() {
    setBoards(loadBoards());
  }

  function openBoardById(id: string) {
    touchBoard(id);
    setOpenId(id);
    refresh();
  }

  function exitToBoards() {
    setOpenId(null);
    refresh();
  }

  function handleCreate() {
    const board = createBoard(newName || `Untitled ${MODE_META[newMode].label}`, newMode);
    refresh();
    setCreating(false);
    setNewName('');
    setShowMore(false);
    openBoardById(board.id);
  }

  async function handleDelete(id: string, e: RMouseEvent) {
    e.stopPropagation();
    if (!(await askConfirm('Delete this board?', { tone: 'danger', confirmLabel: 'DELETE' }))) return;
    deleteBoard(id);
    refresh();
  }

  function commitRename(id: string) {
    if (renameVal.trim()) renameBoard(id, renameVal.trim());
    setRenamingId(null);
    refresh();
  }

  useEffect(() => {
    if (!active) return;
    refresh();
  }, [active]);

  if (openBoard) {
    return (
      <section className={`room ${active ? 'on' : ''}`} id="r-studio" style={{ maxWidth: 'none', padding: '56px 8px 90px 76px' }}>
        <h2 className="rh" style={{ paddingLeft: 4 }}>
          <Icon name="designStudio" size={18} /> DESIGN STUDIO <span style={{ opacity: 0.5, fontWeight: 400 }}>/ {openBoard.name}</span>
        </h2>
        {openBoard.mode === 'draw' && <DrawPaint boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'wireframe' && <Wireframe boardId={openBoard.id} isSeed={openBoard.id === seedBoardId} onExit={exitToBoards} />}
        {openBoard.mode === 'animation' && <Animation boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'vector' && <VectorEditor boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'diagram' && <DiagramEditor boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'moodboard' && <MoodboardEditor boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'presentation' && <PresentationEditor boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'iconDesign' && <IconDesignEditor boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'imageConverter' && <ImageConverter boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'paletteGenerator' && <PaletteGenerator boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'quickPhotoEditor' && <QuickPhotoEditor boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'pixelArt' && <PixelArt boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'qrGenerator' && <QrGenerator boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'memeGenerator' && <MemeGenerator boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'fontPairing' && <FontPairing boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'screenshotAnnotator' && <ScreenshotAnnotator boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'chartBuilder' && <ChartBuilder boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'audioTrimmer' && <AudioTrimmer boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'backgroundRemover' && <BackgroundRemover boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'logoMaker' && <LogoMaker boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'gifMaker' && <GifMaker boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'videoTrimmer' && <VideoTrimmer boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'pdfMarkup' && <PdfMarkup boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'printLayout' && <PrintLayout boardId={openBoard.id} onExit={exitToBoards} />}
        {openBoard.mode === 'modelViewer' && <ModelViewer boardId={openBoard.id} onExit={exitToBoards} />}
      </section>
    );
  }

  return (
    <section className={`room ambient ${active ? 'on' : ''}`} id="r-studio" style={{ maxWidth: 'none', padding: '56px 8px 90px 76px' }}>
      <AmbientField mood="chromatic" density={30} active={active} parallax />
      <ShipAmbience kind="comet" active={active} />
      <div className="roomInner">
      <h2 className="rh" style={{ paddingLeft: 4 }}>
        <Icon name="designStudio" size={18} /> DESIGN STUDIO
      </h2>
      <div className="rsub" style={{ paddingLeft: 4 }}>
        A BOARD PER PROJECT · PICK A MODE LIKE PICKING A FILE TYPE · EVERYTHING FEEDS THE CORE
      </div>
      <div id="dpBoardGrid">
        <div className="dpBoardCard dpNew" onClick={() => setCreating(true)}>
          <div className="dpNewPlus">
            <Icon name="plus" size={22} />
          </div>
          <div>NEW BOARD</div>
        </div>
        {boards.map((b) => (
          <div key={b.id} className="dpBoardCard" onClick={() => openBoardById(b.id)}>
            <button className="dpBoardDel" onClick={(e) => handleDelete(b.id, e)} title="delete board">
              <Icon name="trash" size={12} />
            </button>
            <div className="dpBoardTop">
              <div className="dpBoardIcon">
                <Icon name={MODE_META[b.mode].icon} size={20} />
              </div>
              <BoardRing
                pct={freshnessOf(b.updatedAt)}
                color={
                  freshnessOf(b.updatedAt) >= 50
                    ? pinkAccents
                      ? 'var(--purple)'
                      : 'var(--cyan)'
                    : freshnessOf(b.updatedAt) >= 15
                      ? 'var(--amber)'
                      : 'var(--text-dim)'
                }
              />
            </div>
            {renamingId === b.id ? (
              <input
                autoFocus
                className="dpBoardRename"
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => commitRename(b.id)}
                onKeyDown={(e) => e.key === 'Enter' && commitRename(b.id)}
              />
            ) : (
              <div
                className="dpBoardName"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setRenamingId(b.id);
                  setRenameVal(b.name);
                }}
              >
                {b.name}
              </div>
            )}
            <div className="dpBoardMode">{MODE_META[b.mode].label}</div>
            <div className="dpBoardUpdated">{timeAgo(b.updatedAt)}</div>
          </div>
        ))}
      </div>

      {creating && (
        <div className="dpModal" onClick={() => setCreating(false)}>
          <div className="gpanel dpModalBody" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '86vh' }}>
            <h3>NEW BOARD</h3>
            <input
              autoFocus
              placeholder="Board name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && newMode && IMPLEMENTED_MODES.includes(newMode) && handleCreate()}
              style={{ width: '100%', marginBottom: 14 }}
            />
            <div id="dpModeGrid" className="primary">
              {PRIMARY_ORDER.map((m) => (
                <ModeCard key={m} mode={m} meta={MODE_META[m]} selected={newMode === m} onSelect={() => setNewMode(m)} />
              ))}
            </div>

            {!showMore && (
              <button id="dpShowMoreBtn" onClick={() => setShowMore(true)}>
                SHOW MORE — {UTILITY_ORDER.length} MORE PROJECT TYPES <Icon name="chevronDown" size={12} />
              </button>
            )}

            {showMore && (
              <div className="dpModeSection">
                <div className="dpModeSectionLabel">UTILITY TOOLS</div>
                <div id="dpModeGrid" className="primary">
                  {UTILITY_ORDER.map((m) => (
                    <ModeCard key={m} mode={m} meta={MODE_META[m]} selected={newMode === m} onSelect={() => setNewMode(m)} utility />
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="wbtn ghost" onClick={() => setCreating(false)}>CANCEL</button>
              <button className="wbtn" disabled={!IMPLEMENTED_MODES.includes(newMode)} onClick={handleCreate}>
                CREATE
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </section>
  );
}

function ModeCard({
  mode,
  meta,
  selected,
  onSelect,
  utility,
}: {
  mode: StudioMode;
  meta: ModeMeta;
  selected: boolean;
  onSelect: () => void;
  utility?: boolean;
}) {
  const implemented = IMPLEMENTED_MODES.includes(mode);
  return (
    <div
      className={`dpModeCard ${utility ? 'utility' : ''} ${selected ? 'sel' : ''} ${implemented ? '' : 'disabled'}`}
      onClick={() => implemented && onSelect()}
      title={implemented ? meta.blurb : `${meta.blurb} — not yet available`}
    >
      <div className="dpModeIcon">
        <Icon name={meta.icon} size={22} />
      </div>
      <div className="dpModeLabel">{meta.label}</div>
      <div className="dpModeBlurb">{meta.blurb}</div>
      {!implemented && <div className="dpModeNotYet">{meta.ref === 'stretch' ? 'Stretch goal' : 'Not yet available'}</div>}
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
