import { useEffect, useRef, useState } from 'react';
import Icon from '../../design-system/icons/Icon';

/**
 * MOODBOARD / COLLAGE — item #6 batch 2, tool 3 of 5. A free-form board of
 * draggable/resizable/rotatable tiles (uploaded images, color swatches,
 * text notes) with real z-ordering, a real board background color, and a
 * real PNG export that rasterizes every tile — including rotation — onto
 * an offscreen canvas via context transforms (not a DOM screenshot hack).
 *
 * Honest scope note: this is a 2D freeform collage board (the Milanote-
 * caliber reference in the picker's blurb refers to the free-arrangement
 * interaction model), not a full research/linking/board-hierarchy product
 * — there's one board per Studio board, no nested boards or note-linking.
 */

type TileKind = 'image' | 'swatch' | 'note';

interface Tile {
  id: string;
  kind: TileKind;
  x: number; // center, board px
  y: number;
  w: number;
  h: number;
  rot: number; // degrees
  z: number;
  // image
  src?: string;
  // swatch
  color?: string;
  // note
  text?: string;
  fg?: string;
  bg?: string;
}

const BOARD_W = 1000;
const BOARD_H = 680;
const SWATCH_COLORS = ['#7A5CFF', '#00F5FF', '#FF5C8A', '#FFD166', '#3DDC97', '#F4F4F5', '#1A1A2E', '#FF8C42'];

function storageKey(boardId: string) {
  return `xos-studio-moodboard-${boardId}`;
}

let idCounter = 0;
const genId = () => `mt-${++idCounter}-${Date.now().toString(36)}`;

interface MoodDoc {
  tiles: Tile[];
  bg: string;
}

function loadDoc(boardId: string): MoodDoc {
  try {
    const raw = localStorage.getItem(storageKey(boardId));
    if (raw) return JSON.parse(raw) as MoodDoc;
  } catch {
    /* corrupt storage */
  }
  return { tiles: [], bg: '#0e0e1a' };
}

function nextZ(tiles: Tile[]): number {
  return tiles.reduce((m, t) => Math.max(m, t.z), 0) + 1;
}

export default function MoodboardEditor({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const [doc, setDoc] = useState<MoodDoc>(() => loadDoc(boardId));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initDone = useRef(false);
  const dragRef = useRef<{
    kind: 'move' | 'resize' | 'rotate';
    id: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
    origRot: number;
  } | null>(null);

  useEffect(() => {
    initDone.current = true;
  }, []);
  useEffect(() => {
    if (!initDone.current) return;
    const t = setTimeout(() => localStorage.setItem(storageKey(boardId), JSON.stringify(doc)), 300);
    return () => clearTimeout(t);
  }, [doc, boardId]);

  const tiles = doc.tiles;
  const selected = tiles.find((t) => t.id === selectedId) ?? null;

  function updateTile(id: string, patch: Partial<Tile>) {
    setDoc((d) => ({ ...d, tiles: d.tiles.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  }

  function addTile(t: Omit<Tile, 'id' | 'z'>) {
    const id = genId();
    setDoc((d) => ({ ...d, tiles: [...d.tiles, { ...t, id, z: nextZ(d.tiles) }] }));
    setSelectedId(id);
  }

  function addSwatch(color: string) {
    addTile({ kind: 'swatch', x: BOARD_W / 2, y: BOARD_H / 2, w: 140, h: 140, rot: 0, color });
  }

  function addNote() {
    addTile({ kind: 'note', x: BOARD_W / 2, y: BOARD_H / 2, w: 200, h: 140, rot: 0, text: 'New note', fg: '#0e0e1a', bg: '#FFD166' });
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const maxDim = 260;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        addTile({ kind: 'image', x: BOARD_W / 2, y: BOARD_H / 2, w: img.width * scale, h: img.height * scale, rot: 0, src });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  function bringToFront(id: string) {
    setDoc((d) => ({ ...d, tiles: d.tiles.map((t) => (t.id === id ? { ...t, z: nextZ(d.tiles) } : t)) }));
  }

  function deleteSelected() {
    if (!selectedId) return;
    setDoc((d) => ({ ...d, tiles: d.tiles.filter((t) => t.id !== selectedId) }));
    setSelectedId(null);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        deleteSelected();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function startDrag(kind: 'move' | 'resize' | 'rotate', tile: Tile, e: React.PointerEvent) {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setSelectedId(tile.id);
    bringToFront(tile.id);
    dragRef.current = {
      kind,
      id: tile.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: tile.x,
      origY: tile.y,
      origW: tile.w,
      origH: tile.h,
      origRot: tile.rot,
    };
  }

  function boardScale(): number {
    const el = boardRef.current;
    if (!el) return 1;
    return el.getBoundingClientRect().width / BOARD_W;
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const scale = boardScale();
    const dx = (e.clientX - drag.startClientX) / scale;
    const dy = (e.clientY - drag.startClientY) / scale;
    if (drag.kind === 'move') {
      updateTile(drag.id, { x: drag.origX + dx, y: drag.origY + dy });
    } else if (drag.kind === 'resize') {
      updateTile(drag.id, {
        w: Math.max(30, drag.origW + dx),
        h: Math.max(30, drag.origH + dy),
      });
    } else if (drag.kind === 'rotate') {
      const el = boardRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + (drag.origX / BOARD_W) * rect.width;
      const cy = rect.top + (drag.origY / BOARD_H) * rect.height;
      const angle = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
      updateTile(drag.id, { rot: Math.round(angle) });
    }
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  // Real PNG export: rasterizes every tile (image/swatch/note) onto an
  // offscreen canvas, honoring each tile's rotation via ctx transforms —
  // not a DOM-to-image screenshot shortcut.
  async function exportPng() {
    const canvas = document.createElement('canvas');
    canvas.width = BOARD_W;
    canvas.height = BOARD_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = doc.bg;
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);

    const sorted = [...doc.tiles].sort((a, b) => a.z - b.z);
    const imageCache = new Map<string, HTMLImageElement>();
    async function loadImg(src: string): Promise<HTMLImageElement> {
      if (imageCache.has(src)) return imageCache.get(src)!;
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = src;
      });
      imageCache.set(src, img);
      return img;
    }

    for (const t of sorted) {
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate((t.rot * Math.PI) / 180);
      if (t.kind === 'image' && t.src) {
        try {
          const img = await loadImg(t.src);
          ctx.drawImage(img, -t.w / 2, -t.h / 2, t.w, t.h);
        } catch {
          /* skip unloadable image */
        }
      } else if (t.kind === 'swatch') {
        ctx.fillStyle = t.color ?? '#7A5CFF';
        ctx.fillRect(-t.w / 2, -t.h / 2, t.w, t.h);
      } else if (t.kind === 'note') {
        ctx.fillStyle = t.bg ?? '#FFD166';
        ctx.fillRect(-t.w / 2, -t.h / 2, t.w, t.h);
        ctx.fillStyle = t.fg ?? '#0e0e1a';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        wrapText(ctx, t.text ?? '', 0, 0, t.w - 20, 20);
      }
      ctx.restore();
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'moodboard.png';
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  function wrapText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxWidth: number, lineHeight: number) {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    const startY = cy - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => ctx.fillText(line, cx, startY + i * lineHeight));
  }

  return (
    <div className="toolShell" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div className="toolShellBar">
        <button className="toolBtn" onClick={onExit}>
          <Icon name="chevronLeft" size={16} /> Boards
        </button>
        <div className="toolRow" style={{ gap: 8 }}>
          <button className="toolBtn" onClick={() => fileInputRef.current?.click()}>
            <Icon name="image" size={16} /> Add Image
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onFilePicked} />
          <button className="toolBtn" onClick={addNote}>
            <Icon name="text" size={16} /> Add Note
          </button>
          {selected && (
            <button className="toolBtn" onClick={deleteSelected}>
              <Icon name="trash" size={16} /> Delete
            </button>
          )}
        </div>
        <div className="toolRow" style={{ gap: 8, marginLeft: 'auto' }}>
          <label className="toolHint">
            Background{' '}
            <input type="color" value={doc.bg} onChange={(e) => setDoc((d) => ({ ...d, bg: e.target.value }))} />
          </label>
          <button className="toolBtn" onClick={exportPng}>
            Export PNG
          </button>
        </div>
      </div>
      <div className="toolShellBody" style={{ display: 'flex', gap: 16 }}>
        <div className="toolCol" style={{ width: 180, gap: 8 }}>
          <div className="toolHint">Swatches</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {SWATCH_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => addSwatch(c)}
                style={{ width: 32, height: 32, borderRadius: 6, background: c, border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer' }}
                title={c}
              />
            ))}
          </div>
          {selected && (
            <div className="toolField" style={{ marginTop: 12 }}>
              <div className="toolHint">Selected tile</div>
              {selected.kind === 'swatch' && (
                <input
                  type="color"
                  value={selected.color ?? '#7A5CFF'}
                  onChange={(e) => updateTile(selected.id, { color: e.target.value })}
                />
              )}
              {selected.kind === 'note' && (
                <>
                  <textarea
                    value={selected.text ?? ''}
                    onChange={(e) => updateTile(selected.id, { text: e.target.value })}
                    rows={3}
                    style={{ width: '100%' }}
                  />
                  <div className="toolRow" style={{ gap: 6, marginTop: 6 }}>
                    <label className="toolHint">
                      BG <input type="color" value={selected.bg ?? '#FFD166'} onChange={(e) => updateTile(selected.id, { bg: e.target.value })} />
                    </label>
                    <label className="toolHint">
                      Text <input type="color" value={selected.fg ?? '#0e0e1a'} onChange={(e) => updateTile(selected.id, { fg: e.target.value })} />
                    </label>
                  </div>
                </>
              )}
              <div className="toolHint" style={{ marginTop: 6 }}>
                Rotation: {selected.rot}°
              </div>
            </div>
          )}
        </div>
        <div className="toolCanvasWrap" style={{ display: 'inline-block' }}>
          <div
            ref={boardRef}
            style={{
              position: 'relative',
              width: BOARD_W,
              height: BOARD_H,
              background: doc.bg,
              overflow: 'hidden',
              borderRadius: 8,
              userSelect: 'none',
            }}
            onPointerDown={() => setSelectedId(null)}
          >
            {[...tiles]
              .sort((a, b) => a.z - b.z)
              .map((t) => {
                const isSel = t.id === selectedId;
                const leftPct = ((t.x - t.w / 2) / BOARD_W) * 100;
                const topPct = ((t.y - t.h / 2) / BOARD_H) * 100;
                const wPct = (t.w / BOARD_W) * 100;
                const hPct = (t.h / BOARD_H) * 100;
                return (
                  <div
                    key={t.id}
                    onPointerDown={(e) => startDrag('move', t, e)}
                    style={{
                      position: 'absolute',
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      width: `${wPct}%`,
                      height: `${hPct}%`,
                      transform: `rotate(${t.rot}deg)`,
                      outline: isSel ? '2px solid #00F5FF' : 'none',
                      cursor: 'move',
                      boxShadow: t.kind === 'image' ? '0 4px 14px rgba(0,0,0,0.35)' : 'none',
                    }}
                  >
                    {t.kind === 'image' && t.src && (
                      <img src={t.src} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4, pointerEvents: 'none' }} />
                    )}
                    {t.kind === 'swatch' && <div style={{ width: '100%', height: '100%', background: t.color, borderRadius: 4 }} />}
                    {t.kind === 'note' && (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          background: t.bg,
                          color: t.fg,
                          borderRadius: 4,
                          padding: 10,
                          fontSize: 13,
                          overflow: 'hidden',
                          whiteSpace: 'pre-wrap',
                          pointerEvents: 'none',
                        }}
                      >
                        {t.text}
                      </div>
                    )}
                    {isSel && (
                      <>
                        <div
                          onPointerDown={(e) => startDrag('resize', t, e)}
                          style={{ position: 'absolute', right: -6, bottom: -6, width: 14, height: 14, background: '#00F5FF', borderRadius: 3, cursor: 'nwse-resize' }}
                        />
                        <div
                          onPointerDown={(e) => startDrag('rotate', t, e)}
                          style={{ position: 'absolute', left: '50%', top: -26, width: 12, height: 12, marginLeft: -6, background: '#FF5C8A', borderRadius: '50%', cursor: 'grab' }}
                        />
                      </>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}
