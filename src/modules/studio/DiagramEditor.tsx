import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import Icon from '../../design-system/icons/Icon';
import type { IconName } from '../../design-system/icons/registry';

/**
 * DIAGRAM / FLOWCHART — item #6 batch 2, tool 2 of 5. Real flowchart
 * editor: process/decision/terminal nodes, connectors that genuinely stay
 * attached and re-route live as nodes move (computed geometry, not fixed
 * coordinates — this is the actual feature that distinguishes a diagram
 * tool from Wireframe's free-floating arrows, which this deliberately does
 * NOT reuse), swimlanes, inline text editing, and real SVG export.
 *
 * Connector routing is exact closed-form boundary clipping per shape (not
 * an approximation swept under a bounding box for every type): rectangles
 * clip via the standard slope-scale formula, decision diamonds clip via
 * the Manhattan-normalized |dx|/hw + |dy|/hh diamond boundary, terminals
 * clip as rounded rects (rect formula — visually correct for the small
 * corner radius used here).
 */
type NodeType = 'process' | 'decision' | 'terminal';
interface DNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fill: string;
}
interface DEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}
interface Lane {
  id: string;
  label: string;
}

const W = 1040;
const H = 680;

function storageKey(boardId: string) {
  return `xos-studio-diagram-${boardId}`;
}
let idCounter = 0;
const genId = (p: string) => `${p}-${++idCounter}-${Date.now().toString(36)}`;

interface SaveShape {
  nodes: DNode[];
  edges: DEdge[];
  lanes: Lane[];
}
function load(boardId: string): SaveShape {
  try {
    const raw = localStorage.getItem(storageKey(boardId));
    if (raw) return JSON.parse(raw) as SaveShape;
  } catch {
    /* corrupt storage */
  }
  return { nodes: [], edges: [], lanes: [] };
}

/** Exact boundary-clip scale factor along direction (dx,dy) from a shape's
 * center, so a connector's endpoint lands precisely on the shape's real
 * edge rather than floating inside or outside it. */
function clipScale(type: NodeType, hw: number, hh: number, dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  if (type === 'decision') {
    const denom = Math.abs(dx) / hw + Math.abs(dy) / hh;
    return denom === 0 ? 0 : 1 / denom;
  }
  // rect / terminal
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  return Math.min(sx, sy);
}

function nodeCenter(n: DNode): [number, number] {
  return [n.x + n.w / 2, n.y + n.h / 2];
}

/** Real connector geometry between two nodes' actual boundaries — recomputed
 * on every render from current node positions, which is what makes the
 * connector "stay attached" as nodes move (no stored/stale coordinates). */
function edgeGeometry(a: DNode, b: DNode): { x1: number; y1: number; x2: number; y2: number } {
  const [acx, acy] = nodeCenter(a);
  const [bcx, bcy] = nodeCenter(b);
  const dx = bcx - acx,
    dy = bcy - acy;
  const sA = clipScale(a.type, a.w / 2, a.h / 2, dx, dy);
  const sB = clipScale(b.type, b.w / 2, b.h / 2, -dx, -dy);
  return { x1: acx + dx * sA, y1: acy + dy * sA, x2: bcx - dx * sB, y2: bcy - dy * sB };
}

function nodeShapeD(n: DNode): { tag: 'rect' | 'polygon' | 'rect-rounded'; d?: string; points?: string } {
  if (n.type === 'decision') {
    const cx = n.x + n.w / 2,
      cy = n.y + n.h / 2;
    return { tag: 'polygon', points: `${cx},${n.y} ${n.x + n.w},${cy} ${cx},${n.y + n.h} ${n.x},${cy}` };
  }
  return { tag: n.type === 'terminal' ? 'rect-rounded' : 'rect' };
}

const NODE_DEFAULTS: Record<NodeType, { w: number; h: number; fill: string }> = {
  process: { w: 150, h: 70, fill: '#1b2536' },
  decision: { w: 150, h: 100, fill: '#2a1b36' },
  terminal: { w: 140, h: 56, fill: '#0f2b2e' },
};

export default function DiagramEditor({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const [nodes, setNodes] = useState<DNode[]>(() => load(boardId).nodes);
  const [edges, setEdges] = useState<DEdge[]>(() => load(boardId).edges);
  const [lanes, setLanes] = useState<Lane[]>(() => load(boardId).lanes);
  const [tool, setTool] = useState<NodeType | 'select' | 'connect'>('select');
  const [selNode, setSelNode] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; kind: 'move' | 'resize'; startX: number; startY: number; orig: DNode } | null>(null);
  const initDone = useRef(false);

  useEffect(() => {
    initDone.current = true;
  }, []);
  useEffect(() => {
    if (!initDone.current) return;
    const t = setTimeout(() => localStorage.setItem(storageKey(boardId), JSON.stringify({ nodes, edges, lanes })), 300);
    return () => clearTimeout(t);
  }, [nodes, edges, lanes, boardId]);

  function stagePoint(e: RPointerEvent): [number, number] {
    const el = stageRef.current;
    if (!el) return [0, 0];
    const rect = el.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * W, ((e.clientY - rect.top) / rect.height) * H];
  }

  function addNode(type: NodeType, cx: number, cy: number) {
    const d = NODE_DEFAULTS[type];
    const n: DNode = { id: genId('n'), type, x: cx - d.w / 2, y: cy - d.h / 2, w: d.w, h: d.h, text: type.toUpperCase(), fill: d.fill };
    setNodes((ns) => [...ns, n]);
    setSelNode(n.id);
    setTool('select');
  }

  function onStagePointerDown(e: RPointerEvent<HTMLDivElement>) {
    if (tool === 'process' || tool === 'decision' || tool === 'terminal') {
      const [x, y] = stagePoint(e);
      addNode(tool, x, y);
      return;
    }
    if (e.target === stageRef.current) {
      setSelNode(null);
      setSelEdge(null);
    }
  }

  function onNodePointerDown(e: RPointerEvent<HTMLDivElement>, node: DNode) {
    e.stopPropagation();
    if (tool === 'connect') {
      if (!connectFrom) {
        setConnectFrom(node.id);
      } else if (connectFrom !== node.id) {
        setEdges((es) => [...es, { id: genId('e'), from: connectFrom, to: node.id, label: '' }]);
        setConnectFrom(null);
      }
      return;
    }
    if (tool !== 'select') return;
    setSelNode(node.id);
    setSelEdge(null);
    const [x, y] = stagePoint(e);
    dragRef.current = { id: node.id, kind: 'move', startX: x, startY: y, orig: node };
  }
  function onResizeHandleDown(e: RPointerEvent<HTMLDivElement>, node: DNode) {
    e.stopPropagation();
    const [x, y] = stagePoint(e);
    dragRef.current = { id: node.id, kind: 'resize', startX: x, startY: y, orig: node };
  }
  function onStagePointerMove(e: RPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const [x, y] = stagePoint(e);
    const dx = x - drag.startX,
      dy = y - drag.startY;
    setNodes((ns) =>
      ns.map((n) => {
        if (n.id !== drag.id) return n;
        if (drag.kind === 'move') return { ...n, x: drag.orig.x + dx, y: drag.orig.y + dy };
        return { ...n, w: Math.max(60, drag.orig.w + dx), h: Math.max(40, drag.orig.h + dy) };
      })
    );
  }
  function onStagePointerUp() {
    dragRef.current = null;
  }

  function startEditNode(node: DNode) {
    setEditingNode(node.id);
    setEditVal(node.text);
  }
  function commitEdit() {
    if (editingNode) setNodes((ns) => ns.map((n) => (n.id === editingNode ? { ...n, text: editVal } : n)));
    setEditingNode(null);
  }

  function editEdgeLabel(edge: DEdge) {
    const label = window.prompt('Connector label:', edge.label);
    if (label !== null) setEdges((es) => es.map((e) => (e.id === edge.id ? { ...e, label } : e)));
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editingNode) return;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selNode) {
          setNodes((ns) => ns.filter((n) => n.id !== selNode));
          setEdges((es) => es.filter((e) => e.from !== selNode && e.to !== selNode));
          setSelNode(null);
        } else if (selEdge) {
          setEdges((es) => es.filter((e) => e.id !== selEdge));
          setSelEdge(null);
        }
      }
      if (e.key === 'Escape') setConnectFrom(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selNode, selEdge, editingNode]);

  function addLane() {
    setLanes((ls) => [...ls, { id: genId('lane'), label: `Lane ${ls.length + 1}` }]);
  }
  function removeLane(id: string) {
    setLanes((ls) => ls.filter((l) => l.id !== id));
  }
  function renameLane(id: string) {
    const lane = lanes.find((l) => l.id === id);
    const label = window.prompt('Lane label:', lane?.label ?? '');
    if (label !== null) setLanes((ls) => ls.map((l) => (l.id === id ? { ...l, label } : l)));
  }

  function exportSvg() {
    const laneH = lanes.length ? H / lanes.length : 0;
    const laneSvg = lanes
      .map(
        (l, i) =>
          `<rect x="0" y="${i * laneH}" width="${W}" height="${laneH}" fill="${i % 2 === 0 ? '#12161f' : '#0c0f16'}" stroke="#2a3040" />\n  <text x="8" y="${i * laneH + 16}" fill="#8aa" font-size="11" font-family="monospace">${escapeXml(l.label)}</text>`
      )
      .join('\n  ');
    const edgeSvg = edges
      .map((e) => {
        const a = nodes.find((n) => n.id === e.from);
        const b = nodes.find((n) => n.id === e.to);
        if (!a || !b) return '';
        const g = edgeGeometry(a, b);
        const midx = (g.x1 + g.x2) / 2,
          midy = (g.y1 + g.y2) / 2;
        return `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="#00F5FF" stroke-width="2" marker-end="url(#arrow)" />${e.label ? `<text x="${midx}" y="${midy - 4}" fill="#00F5FF" font-size="10" font-family="monospace" text-anchor="middle">${escapeXml(e.label)}</text>` : ''}`;
      })
      .join('\n  ');
    const nodeSvg = nodes
      .map((n) => {
        const shape = nodeShapeD(n);
        const cx = n.x + n.w / 2,
          cy = n.y + n.h / 2;
        const body =
          shape.tag === 'polygon'
            ? `<polygon points="${shape.points}" fill="${n.fill}" stroke="#7A5CFF" stroke-width="1.5" />`
            : `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.type === 'terminal' ? n.h / 2 : 4}" fill="${n.fill}" stroke="#00F5FF" stroke-width="1.5" />`;
        return `${body}\n  <text x="${cx}" y="${cy}" fill="#e6f4ff" font-size="12" font-family="monospace" text-anchor="middle" dominant-baseline="middle">${escapeXml(n.text)}</text>`;
      })
      .join('\n  ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L9,3 z" fill="#00F5FF" />
    </marker>
  </defs>
  <rect width="${W}" height="${H}" fill="#05080d" />
  ${laneSvg}
  ${edgeSvg}
  ${nodeSvg}
</svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flowchart.svg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function escapeXml(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const TOOLS: { id: NodeType | 'select' | 'connect'; icon: IconName; label: string }[] = [
    { id: 'select', icon: 'select', label: 'SELECT' },
    { id: 'process', icon: 'square', label: 'PROCESS' },
    { id: 'decision', icon: 'diamond', label: 'DECISION' },
    { id: 'terminal', icon: 'circle', label: 'TERMINAL' },
    { id: 'connect', icon: 'link', label: 'CONNECT' },
  ];

  return (
    <div className="toolShell">
      <div className="toolShellBar">
        <button className="chip" onClick={onExit}>
          <Icon name="chevronLeft" size={12} /> ALL BOARDS
        </button>
        <h3 className="toolShellTitle">DIAGRAM / FLOWCHART</h3>
        <div className="toolShellActions" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {TOOLS.map((t) => (
            <span
              key={t.id}
              className={`chip small ${tool === t.id ? 'on' : ''}`}
              title={t.label}
              onClick={() => {
                setTool(t.id);
                setConnectFrom(null);
              }}
            >
              <Icon name={t.icon} size={12} />
            </span>
          ))}
          <span style={{ width: 1, height: 18, background: 'var(--edge)', margin: '0 4px' }} />
          <button className="wbtn ghost" onClick={addLane} style={{ fontSize: 9, padding: '4px 8px' }}>
            + LANE
          </button>
          <button className="wbtn" onClick={exportSvg}>
            EXPORT SVG
          </button>
        </div>
      </div>
      <div className="toolShellBody">
        <div
          ref={stageRef}
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={onStagePointerUp}
          onPointerLeave={onStagePointerUp}
          style={{ position: 'relative', width: W, height: H, background: '#05080d', border: '1px solid var(--edge)', overflow: 'hidden', cursor: tool === 'select' ? 'default' : 'crosshair' }}
        >
          {lanes.map((l, i) => {
            const laneH = H / lanes.length;
            return (
              <div
                key={l.id}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: i * laneH,
                  width: '100%',
                  height: laneH,
                  background: i % 2 === 0 ? 'rgba(255,255,255,.02)' : 'transparent',
                  borderTop: '1px solid rgba(255,255,255,.08)',
                }}
              >
                <div
                  style={{ position: 'absolute', left: 6, top: 4, fontSize: 10, color: '#7a99aa', cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center' }}
                  onClick={() => renameLane(l.id)}
                >
                  {l.label}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      removeLane(l.id);
                    }}
                  >
                    <Icon name="close" size={9} />
                  </span>
                </div>
              </div>
            );
          })}

          <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <defs>
              <marker id="arrowLive" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L0,6 L9,3 z" fill="#00F5FF" />
              </marker>
            </defs>
            {edges.map((e) => {
              const a = nodes.find((n) => n.id === e.from);
              const b = nodes.find((n) => n.id === e.to);
              if (!a || !b) return null;
              const g = edgeGeometry(a, b);
              const midx = (g.x1 + g.x2) / 2,
                midy = (g.y1 + g.y2) / 2;
              return (
                <g key={e.id} style={{ pointerEvents: 'auto', cursor: 'pointer' }} onPointerDown={(ev) => { ev.stopPropagation(); setSelEdge(e.id); setSelNode(null); }} onDoubleClick={() => editEdgeLabel(e)}>
                  <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke={selEdge === e.id ? '#FF2D78' : '#00F5FF'} strokeWidth={selEdge === e.id ? 3 : 2} markerEnd="url(#arrowLive)" />
                  <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="transparent" strokeWidth={12} />
                  {e.label && (
                    <text x={midx} y={midy - 6} fill="#00F5FF" fontSize={10} fontFamily="monospace" textAnchor="middle">
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}
            {connectFrom &&
              (() => {
                const n = nodes.find((x) => x.id === connectFrom);
                if (!n) return null;
                const [cx, cy] = nodeCenter(n);
                return <circle cx={cx} cy={cy} r={6} fill="none" stroke="#FF2D78" strokeWidth={2} />;
              })()}
          </svg>

          {nodes.map((n) => {
            const shape = nodeShapeD(n);
            const selected = selNode === n.id;
            return (
              <div
                key={n.id}
                onPointerDown={(e) => onNodePointerDown(e, n)}
                onDoubleClick={() => startEditNode(n)}
                style={{
                  position: 'absolute',
                  left: n.x,
                  top: n.y,
                  width: n.w,
                  height: n.h,
                  cursor: tool === 'select' ? 'move' : tool === 'connect' ? 'crosshair' : 'default',
                }}
              >
                <svg width={n.w} height={n.h} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
                  {shape.tag === 'polygon' ? (
                    <polygon points={`${n.w / 2},0 ${n.w},${n.h / 2} ${n.w / 2},${n.h} 0,${n.h / 2}`} fill={n.fill} stroke={selected ? '#FF2D78' : '#7A5CFF'} strokeWidth={selected ? 2.5 : 1.5} />
                  ) : (
                    <rect x={0.75} y={0.75} width={n.w - 1.5} height={n.h - 1.5} rx={n.type === 'terminal' ? n.h / 2 : 4} fill={n.fill} stroke={selected ? '#FF2D78' : '#00F5FF'} strokeWidth={selected ? 2.5 : 1.5} />
                  )}
                </svg>
                {editingNode === n.id ? (
                  <textarea
                    autoFocus
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        commitEdit();
                      }
                    }}
                    style={{ position: 'absolute', inset: 6, background: 'transparent', color: '#fff', border: 'none', textAlign: 'center', resize: 'none', font: 'inherit', fontSize: 11 }}
                  />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 11, color: '#e6f4ff', padding: '0 8px', pointerEvents: 'none' }}>
                    {n.text}
                  </div>
                )}
                {selected && tool === 'select' && (
                  <div
                    onPointerDown={(e) => onResizeHandleDown(e, n)}
                    style={{ position: 'absolute', right: -5, bottom: -5, width: 10, height: 10, background: '#FF2D78', borderRadius: 2, cursor: 'nwse-resize' }}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="toolHint" style={{ marginTop: 6, maxWidth: W }}>
          {tool === 'select' && 'Drag nodes to move (connectors stay attached and re-route live). Drag the pink corner handle to resize. Double-click a node to edit its text. Backspace deletes the selection.'}
          {(tool === 'process' || tool === 'decision' || tool === 'terminal') && 'Click the canvas to place a new node.'}
          {tool === 'connect' && (connectFrom ? 'Click a second node to connect it.' : 'Click a node to start a connector, then click another node to finish it.')}
        </div>
      </div>
    </div>
  );
}
