import { useEffect, useState } from 'react';
import type { MouseEvent as RMouseEvent } from 'react';
import type { StudioBoard, StudioMode } from './types';
import { IMPLEMENTED_MODES } from './types';
import { loadBoards, createBoard, touchBoard, renameBoard, deleteBoard } from './boards';
import DrawPaint from './draw/DrawPaint';
import Wireframe from './Wireframe';

const MODE_META: Record<StudioMode, { label: string; icon: string; blurb: string; ref: string }> = {
  draw: { label: 'Draw / Paint', icon: '🖌', blurb: 'Layers, real brushes, blend modes, filters', ref: 'Photoshop-caliber' },
  wireframe: { label: 'Wireframe / Prototype', icon: '▭', blurb: 'Infinite canvas, frames, sticky notes, flows', ref: 'Figma-caliber' },
  animation: { label: 'Animation', icon: '🎬', blurb: 'Timeline, keyframes, tweening', ref: 'After Effects-caliber' },
  vector: { label: 'Vector', icon: '✒', blurb: 'Bezier pen, paths, boolean ops', ref: 'Illustrator-caliber' },
  diagram: { label: 'Diagram', icon: '🔗', blurb: 'Flowcharts, connectors, swimlanes', ref: 'Whimsical-caliber' },
  moodboard: { label: 'Moodboard', icon: '◆', blurb: 'Swatches, references, style tiles', ref: 'Milanote-caliber' },
};

const MODE_ORDER: StudioMode[] = ['draw', 'wireframe', 'animation', 'vector', 'diagram', 'moodboard'];

/** Legacy single-canvas snapshot key from before the multi-board rework —
 * if present and no boards exist yet, we surface it as the seeded first
 * wireframe board rather than silently discarding a user's prior work. */
const LEGACY_KEY = 'xos-studio-v1';

/** Id of the auto-created default board, when this session had to create
 * one — tracked explicitly rather than inferred from array position, so
 * "should Wireframe fall back to SEED_STUDIO content" stays correct
 * regardless of board list order/deletion. */
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

/**
 * DESIGN STUDIO — Blueprint v0.3 Amendment v0.2: Design Studio becomes a
 * multi-mode creative suite, picking a mode per-board the way Figma picks
 * a file type. This component is the picker/router shell; each mode's
 * actual tool lives in its own component (DrawPaint, Wireframe, …) and
 * owns the full viewport below this room's header. Only 'draw' and
 * 'wireframe' are implemented per the amendment's own updated execution
 * order — the rest are shown as honest "coming soon" cards, not stubs.
 */
export default function Studio({ active }: { active: boolean }) {
  const [boards, setBoards] = useState<StudioBoard[]>(seedFromLegacyIfNeeded);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMode, setNewMode] = useState<StudioMode>('draw');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');

  const openBoard = boards.find((b) => b.id === openId) || null;

  function refresh() {
    setBoards(loadBoards());
  }

  function openBoardById(id: string) {
    touchBoard(id);
    setOpenId(id);
    refresh();
  }

  function handleCreate() {
    const board = createBoard(newName || `Untitled ${MODE_META[newMode].label}`, newMode);
    refresh();
    setCreating(false);
    setNewName('');
    openBoardById(board.id);
  }

  function handleDelete(id: string, e: RMouseEvent) {
    e.stopPropagation();
    if (!confirm('Delete this board? This cannot be undone.')) return;
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
      <section className={`room ${active ? 'on' : ''}`} id="r-studio" style={{ maxWidth: 'none', padding: '56px 8px 90px' }}>
        <h2 className="rh" style={{ paddingLeft: 4 }}>
          🎨 DESIGN STUDIO <span style={{ opacity: 0.5, fontWeight: 400 }}>/ {openBoard.name}</span>
        </h2>
        {openBoard.mode === 'draw' && <DrawPaint boardId={openBoard.id} onExit={() => { setOpenId(null); refresh(); }} />}
        {openBoard.mode === 'wireframe' && (
          <Wireframe boardId={openBoard.id} isSeed={openBoard.id === seedBoardId} onExit={() => { setOpenId(null); refresh(); }} />
        )}
      </section>
    );
  }

  return (
    <section className={`room ${active ? 'on' : ''}`} id="r-studio" style={{ maxWidth: 'none', padding: '56px 8px 90px' }}>
      <h2 className="rh" style={{ paddingLeft: 4 }}>
        🎨 DESIGN STUDIO
      </h2>
      <div className="rsub" style={{ paddingLeft: 4 }}>
        A BOARD PER PROJECT · PICK A MODE LIKE PICKING A FILE TYPE · EVERYTHING FEEDS THE CORE
      </div>

      <div id="dpBoardGrid">
        <div className="dpBoardCard dpNew" onClick={() => setCreating(true)}>
          <div className="dpNewPlus">＋</div>
          <div>NEW BOARD</div>
        </div>
        {boards.map((b) => (
          <div key={b.id} className="dpBoardCard" onClick={() => openBoardById(b.id)}>
            <button className="dpBoardDel" onClick={(e) => handleDelete(b.id, e)} title="delete board">✕</button>
            <div className="dpBoardIcon">{MODE_META[b.mode].icon}</div>
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
          <div className="gpanel dpModalBody" onClick={(e) => e.stopPropagation()}>
            <h3>NEW BOARD</h3>
            <input
              autoFocus
              placeholder="Board name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && newMode && handleCreate()}
              style={{ width: '100%', marginBottom: 14 }}
            />
            <div id="dpModeGrid">
              {MODE_ORDER.map((m) => {
                const implemented = IMPLEMENTED_MODES.includes(m);
                const meta = MODE_META[m];
                return (
                  <div
                    key={m}
                    className={`dpModeCard ${newMode === m ? 'sel' : ''} ${implemented ? '' : 'disabled'}`}
                    onClick={() => implemented && setNewMode(m)}
                  >
                    <div className="dpModeIcon">{meta.icon}</div>
                    <div className="dpModeLabel">{meta.label}</div>
                    <div className="dpModeBlurb">{implemented ? meta.blurb : 'Coming soon'}</div>
                    {!implemented && <div className="dpModeSoon">{meta.ref}</div>}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="wbtn ghost" onClick={() => setCreating(false)}>CANCEL</button>
              <button className="wbtn" onClick={handleCreate}>CREATE</button>
            </div>
          </div>
        </div>
      )}
    </section>
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
