import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { useCoreGraph } from '../../stores/coreGraph';
import { nodeToBug, nodeToTask } from '../../core/mappers';
import { supabase } from '../../lib/supabase';
import {
  PROJECT_CLASSES,
  getProjectClass,
  setProjectClass,
  getWidgetOrder,
  setWidgetOrder,
  slugify,
  type ProjectClassId,
  type WidgetId,
} from './local';
import type { NodeRecord, ProjectRecord } from '../../core/types';
import Icon from '../../design-system/icons/Icon';
import DataIcon from '../../design-system/icons/DataIcon';
import type { IconName } from '../../design-system/icons/registry';
import AmbientField from '../../design-system/background/AmbientField';

type Zone = 'zoverview' | 'zboard' | 'zdocs' | 'zbugs' | 'zfeed';

// Amendment v0.6 step 1: mock/demo copy no longer embeds icon glyphs in the
// string data itself (📄/◈ prefixes) — icons render at the JSX call site
// instead, driven by an explicit `fromAI` flag rather than a text marker.
const docs = [
  { t: 'Dark Mode — Requirements', meta: 'CREATED FROM NEURAL CAPTURE', fromAI: true, tag: 'NEW' },
  { t: 'Onboarding Flow Spec', meta: 'LINKED TO 4 TASKS', fromAI: false, tag: 'AI-DRAFTED' },
  { t: 'Auth Architecture', meta: 'SPRINT 001', fromAI: false, tag: 'RECALLED TODAY FOR BUG #17' },
  { t: 'Brand Voice Guide', meta: '6 DAYS AGO', fromAI: false, tag: '' },
];
const feed = [
  // ASCII "->" (not a Unicode arrow) since `body` renders as plain text, not JSX.
  { body: 'xAI linked bug #17 -> solved #14 (92% similarity)', time: '5H AGO', fromAI: true },
  { body: 'Neural Capture routed 4 nodes into this project', time: 'YESTERDAY', fromAI: false },
  { body: '"Onboarding Flow" promoted to Sprint 002 milestone', time: 'YESTERDAY', fromAI: true },
];

const ZONE_LABEL: Record<Zone, { icon: IconName; label: string }> = {
  zoverview: { icon: 'xai', label: 'OVERVIEW' },
  zboard: { icon: 'gridDense', label: 'BOARD' },
  zdocs: { icon: 'rows', label: 'DOCS' },
  zbugs: { icon: 'bugTracker', label: 'BUGS' },
  zfeed: { icon: 'bolt', label: 'ACTIVITY' },
};

function relTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** GitHub-contributions-style activity heatmap — real counts of this
 * project's nodes grouped by the day they were created, over the last 12
 * weeks. No fixed/fake data: a project with no recent activity renders an
 * honestly empty grid. */
function ActivityHeatmap({ projectNodes }: { projectNodes: NodeRecord[] }) {
  const weeks = 12;
  const days = weeks * 7;
  const counts = useMemo(() => {
    const byDay = new Map<string, number>();
    projectNodes.forEach((n) => {
      const key = new Date(n.created_at).toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    });
    const out: { key: string; n: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      out.push({ key, n: byDay.get(key) ?? 0 });
    }
    return out;
  }, [projectNodes]);
  const maxN = Math.max(1, ...counts.map((c) => c.n));
  function levelOf(n: number) {
    if (n === 0) return 0;
    const t = n / maxN;
    return t > 0.75 ? 4 : t > 0.5 ? 3 : t > 0.25 ? 2 : 1;
  }
  return (
    <div className="heatmap" title="node activity, last 12 weeks">
      {counts.map((c) => (
        <span key={c.key} className={`hcell l${levelOf(c.n)}`} title={`${c.key}: ${c.n} node${c.n === 1 ? '' : 's'}`} />
      ))}
    </div>
  );
}

/** Cross-project dependency visualization — real, derived from the actual
 * `edges` table: any edge whose two endpoints belong to different projects
 * counts as a link between those projects, tallied and listed by count. */
function DependencyList({ openId, nodes, edges, projects }: { openId: string; nodes: NodeRecord[]; edges: { from_node: string; to_node: string; relation: string }[]; projects: ProjectRecord[] }) {
  const links = useMemo(() => {
    const nodeProject = new Map(nodes.map((n) => [n.id, n.project_id]));
    const tally = new Map<string, number>();
    edges.forEach((e) => {
      const a = nodeProject.get(e.from_node);
      const b = nodeProject.get(e.to_node);
      if (!a || !b || a === b) return;
      const other = a === openId ? b : b === openId ? a : null;
      if (!other) return;
      tally.set(other, (tally.get(other) ?? 0) + 1);
    });
    return [...tally.entries()]
      .map(([id, n]) => ({ project: projects.find((p) => p.id === id), n }))
      .filter((x): x is { project: ProjectRecord; n: number } => !!x.project)
      .sort((a, b) => b.n - a.n);
  }, [openId, nodes, edges, projects]);
  if (!links.length) return <div className="rsub" style={{ fontSize: 9 }}>No cross-project links yet — they form when xAI relates a node here to one in another project.</div>;
  return (
    <div className="depList">
      {links.map(({ project, n }) => (
        <div className="depRow" key={project.id}>
          <span>
            <DataIcon value={project.icon} size={13} /> {project.name.toUpperCase()}
          </span>
          <span className="depCount">
            <Icon name="link" size={12} /> {n}
          </span>
        </div>
      ))}
    </div>
  );
}

/** PROJECTS — Room Overhaul Batch 3: raised to a Linear/Notion-caliber
 * per-project workspace. Ported originally 1:1 from xos-prototype.html's
 * card list → board/docs/bugs/activity zones; now adds a real "New Project"
 * flow with a class picker that reshapes the workspace per class, a
 * draggable-widget OVERVIEW zone (health, activity heatmap, cross-project
 * dependencies, recent activity — all computed from real graph data, not
 * fixtures), improved health (task-completion blended with recency), and
 * dormant-project dimming that echoes the Observatory's star-brightness
 * metaphor. Board + bugs still read live from the shared coreGraph store
 * (Step 3); docs/legacy activity feed stay illustrative — no real `docs`
 * table exists in the deployed schema yet. */
export default function Projects({ active }: { active: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [zone, setZone] = useState<Zone>('zoverview');
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newClass, setNewClass] = useState<ProjectClassId>('dev');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const [widgetOrder, setWidgetOrderState] = useState<WidgetId[]>(['health', 'heatmap', 'deps', 'activity']);
  const [dragId, setDragId] = useState<WidgetId | null>(null);

  const projects = useCoreGraph((s) => s.projects);
  const ownerId = useCoreGraph((s) => s.ownerId);
  // Select the raw, store-stable `nodes` array and derive tasks/bugs locally
  // via useMemo, rather than a store selector that builds a fresh array on
  // every call (`(s) => s.tasks()` style) — that pattern makes
  // useSyncExternalStore's snapshot unstable and can cascade into "Maximum
  // update depth exceeded". Found and fixed across all rooms that used it.
  const nodes = useCoreGraph((s) => s.nodes);
  const edges = useCoreGraph((s) => s.edges);
  const tasks = useMemo(() => nodes.filter((n) => n.kind === 'task').map(nodeToTask), [nodes]);
  const bugs = useMemo(() => nodes.filter((n) => n.kind === 'bug').map(nodeToBug), [nodes]);
  const advanceTask = useCoreGraph((s) => s.advanceTask);
  const cycleBug = useCoreGraph((s) => s.cycleBug);
  const assignNodeToProject = useCoreGraph((s) => s.assignNodeToProject);
  // Cross-room drag-and-drop: real unassigned capture nodes, draggable onto
  // a project card below to assign them (a real project_id write, not a
  // local-only UI flag).
  const unassignedCaptures = useMemo(() => nodes.filter((n) => n.kind === 'capture' && !n.project_id), [nodes]);

  const open = projects.find((p) => p.id === openId) ?? null;
  const cls = open ? getProjectClass(open.id) : PROJECT_CLASSES[0];
  const projectTasks = tasks.filter((t) => t.project_id === openId);
  const projectBugs = bugs.filter((b) => b.project_id === openId);
  const projectNodes = useMemo(() => nodes.filter((n) => n.project_id === openId), [nodes, openId]);

  useEffect(() => {
    if (open) {
      setWidgetOrderState(getWidgetOrder(open.id));
      setZone(cls.zones[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  const cols: [0 | 1 | 2, string][] = [
    [0, cls.boardCols[0]],
    [1, cls.boardCols[1]],
    [2, cls.boardCols[2]],
  ];

  async function createProject() {
    const name = newName.trim();
    if (!name || !ownerId) return;
    setCreating(true);
    setCreateErr('');
    const picked = PROJECT_CLASSES.find((c) => c.id === newClass)!;
    try {
      const { data, error } = await supabase
        .from('projects')
        .insert({ owner_id: ownerId, name, slug: slugify(name), icon: picked.icon, color: picked.color, status: 'active' })
        .select('id')
        .single();
      if (error) throw error;
      if (data?.id) setProjectClass(data.id, newClass);
      setShowNew(false);
      setNewName('');
      setNewClass('dev');
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : 'Could not create the project.');
    } finally {
      setCreating(false);
    }
  }

  function reorderWidget(overId: WidgetId) {
    if (!dragId || dragId === overId || !open) {
      setDragId(null);
      return;
    }
    const without = widgetOrder.filter((w) => w !== dragId);
    const overIdx = without.indexOf(overId);
    const next = [...without.slice(0, overIdx), dragId, ...without.slice(overIdx)];
    setWidgetOrderState(next);
    setWidgetOrder(open.id, next);
    setDragId(null);
  }

  const WIDGETS: Record<WidgetId, { icon: IconName; title: string; render: () => ReactElement }> = {
    health: {
      icon: 'xai',
      title: 'HEALTH',
      render: () => (
        <div className="wStat">
          <div className="wStatN">{open?.health ?? 0}%</div>
          <div className="rsub" style={{ fontSize: 9 }}>
            Blends task-completion rate with how recently this project saw activity ({open?.idleDays ?? 0}d idle).
          </div>
        </div>
      ),
    },
    heatmap: { icon: 'xai', title: 'ACTIVITY HEATMAP · 12 WEEKS', render: () => <ActivityHeatmap projectNodes={projectNodes} /> },
    deps: {
      icon: 'xai',
      title: 'LINKED PROJECTS',
      render: () => <DependencyList openId={openId!} nodes={nodes} edges={edges} projects={projects} />,
    },
    activity: {
      icon: 'xai',
      title: 'RECENT NODES',
      render: () => {
        const recent = [...projectNodes].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 4);
        if (!recent.length) return <div className="rsub" style={{ fontSize: 9 }}>No nodes yet.</div>;
        return (
          <div className="wActivity">
            {recent.map((n) => (
              <div key={n.id} className="wActivityRow">
                <span>{n.title}</span>
                <span className="wActivityTime">{relTime(n.created_at)}</span>
              </div>
            ))}
          </div>
        );
      },
    },
  };

  return (
    <section className={`room ambient ${active ? 'on' : ''}`} id="r-projects">
      <AmbientField mood="cyan" density={28} active={active} parallax />
      <div className="roomInner">
      <h2 className="rh">
        <Icon name="projects" size={18} /> PROJECTS
      </h2>
      <div className="rsub">xOS DOESN'T CONTAIN PRODUCTS. IT MANAGES THEM.</div>
      {!open && (
        <div id="plist">
          <button className="chip" id="newProjectBtn" onClick={() => setShowNew(true)}>
            <Icon name="plus" size={13} /> NEW PROJECT
          </button>
          {unassignedCaptures.length > 0 && (
            <div className="unassignedCaptures">
              <div className="rsub" style={{ margin: '4px 0 8px' }}>
                UNASSIGNED CAPTURES — DRAG ONTO A PROJECT TO ASSIGN
              </div>
              {unassignedCaptures.map((n) => (
                <div
                  key={n.id}
                  className="unassignedCapChip"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('application/x-xos-capture', n.id)}
                >
                  <Icon name="neuralCapture" size={11} /> {n.title}
                </div>
              ))}
            </div>
          )}
          {!projects.length && <div className="rsub">No projects yet — capture a thought and xAI will start one, or create one above.</div>}
          {projects.map((p) => {
            const pc = getProjectClass(p.id);
            const dim = p.status !== 'active' ? 0.4 : Math.max(0.45, p.health / 100);
            return (
              <div
                key={p.id}
                className={`pcard gpanel ${p.isStale ? 'warn' : ''}`}
                style={{ opacity: dim, filter: p.isStale ? 'saturate(.5)' : undefined }}
                onClick={() => setOpenId(p.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const nodeId = e.dataTransfer.getData('application/x-xos-capture');
                  if (nodeId) assignNodeToProject(nodeId, p.id);
                }}
              >
                <span className="ic">
                  <DataIcon value={p.icon} size={16} />
                </span>
                <div>
                  <h3>
                    {p.name.toUpperCase()}{' '}
                    <span className="classTag">
                      <DataIcon value={pc.icon} size={12} /> {pc.label}
                    </span>
                  </h3>
                  <div className="mt">
                    {p.isStale ? (
                      <>
                        <Icon name="warning" size={11} glow="amber" /> {p.idleDays} DAYS IDLE — CORE FLAGGED STALE
                      </>
                    ) : (
                      `${tasks.filter((t) => t.project_id === p.id).length} TASKS · ${p.health}% HEALTH`
                    )}
                  </div>
                </div>
                <span className="hp">
                  <i style={{ width: p.health + '%' }} />
                </span>
              </div>
            );
          })}
        </div>
      )}
      {showNew && (
        <div className="dpModal" onClick={() => !creating && setShowNew(false)}>
          <div className="dpModalBody" onClick={(e) => e.stopPropagation()}>
            <h3>NEW PROJECT</h3>
            <input
              id="newProjectName"
              placeholder="Project name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
            <div className="rsub" style={{ marginTop: 10 }}>
              CLASS — changes which panels this project's workspace shows
            </div>
            <div className="classPicker">
              {PROJECT_CLASSES.map((c) => (
                <div key={c.id} className={`classOpt ${newClass === c.id ? 'on' : ''}`} onClick={() => setNewClass(c.id)}>
                  <div className="classIc">
                    <DataIcon value={c.icon} size={20} />
                  </div>
                  <div className="classLbl">{c.label}</div>
                  <div className="classBlurb">{c.blurb}</div>
                </div>
              ))}
            </div>
            {createErr && <div className="rsub" style={{ color: 'var(--magenta)', marginTop: 8 }}>{createErr}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="chip" onClick={() => setShowNew(false)} disabled={creating}>CANCEL</button>
              <button className="chip on" id="createProjectSubmit" onClick={createProject} disabled={creating || !newName.trim()}>
                {creating ? (
                  'CREATING…'
                ) : (
                  <>
                    CREATE <Icon name="chevronRight" size={13} />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {open && (
        <div id="pws">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button className="chip" onClick={() => setOpenId(null)}>
              <Icon name="chevronLeft" size={13} /> ALL
            </button>
            <h2 className="rh" style={{ margin: 0 }}>
              <DataIcon value={open.icon} size={18} /> {open.name.toUpperCase()}
            </h2>
            <span className="classTag" style={{ marginLeft: 'auto' }}>
              <DataIcon value={cls.icon} size={12} /> {cls.label}
            </span>
          </div>
          <div id="vitals">
            <div className="vital">
              <div className="n">{projectTasks.length}</div>
              <div className="l">TASKS</div>
            </div>
            {cls.zones.includes('zbugs') && (
              <div className="vital a">
                <div className="n">{projectBugs.filter((b) => b.bugStatus !== 'fixed').length}</div>
                <div className="l">BUGS</div>
              </div>
            )}
            {cls.zones.includes('zdocs') && (
              <div className="vital">
                <div className="n">{docs.length}</div>
                <div className="l">DOCS</div>
              </div>
            )}
            <div className="vital m">
              <div className="n">{open.health}%</div>
              <div className="l">HEALTH</div>
            </div>
          </div>
          <div className="zones">
            {cls.zones.map((z) => (
              <span key={z} className={`zone ${zone === z ? 'on' : ''}`} onClick={() => setZone(z)}>
                <Icon name={ZONE_LABEL[z].icon} size={13} /> {ZONE_LABEL[z].label}
              </span>
            ))}
          </div>
          <div className={`subpanel ${zone === 'zoverview' ? 'on' : ''}`} id="zoverview">
            <div className="rsub" style={{ marginBottom: 8 }}>DRAG A WIDGET'S HEADER TO REORDER — YOUR LAYOUT IS REMEMBERED</div>
            <div id="widgetGrid">
              {widgetOrder.map((wid) => (
                <div
                  key={wid}
                  className={`widgetCard ${dragId === wid ? 'dragging' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={() => reorderWidget(wid)}
                >
                  <div
                    className="widgetHead"
                    draggable
                    onDragStart={() => setDragId(wid)}
                    onDragEnd={() => setDragId(null)}
                  >
                    <span className="dragHandle">⠿</span> <Icon name={WIDGETS[wid].icon} size={13} glow="cyan" /> {WIDGETS[wid].title}
                  </div>
                  <div className="widgetBody">{WIDGETS[wid].render()}</div>
                </div>
              ))}
            </div>
          </div>
          <div className={`subpanel ${zone === 'zboard' ? 'on' : ''}`} id="zboard">
            <div className="rsub">TAP A CARD TO ADVANCE IT — THE CORE LOGS EVERY MOVE</div>
            <div id="board">
              {cols.map(([s, label]) => (
                <div className={`col ${s === 1 ? 'doing' : s === 2 ? 'done' : ''}`} key={s}>
                  <h4>{label}</h4>
                  {projectTasks
                    .filter((t) => t.taskStatus === s)
                    .map((t) => (
                      <div className="card" key={t.id} onClick={() => t.taskStatus < 2 && advanceTask(t.id)}>
                        {t.title}
                        <br />
                        {t.tags.map((tag, i) => (
                          // Amendment v0.6 step 1: tags no longer embed the ◈
                          // glyph as a text marker (see mappers.ts) — match on
                          // the actual tag text instead.
                          <span key={i} className={`t ${/FROM CAPTURE/.test(tag) ? 'ai' : /BUG/.test(tag) ? 'bug' : ''}`}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    ))}
                  {!projectTasks.filter((t) => t.taskStatus === s).length && <div className="rsub" style={{ fontSize: 9 }}>—</div>}
                </div>
              ))}
            </div>
          </div>
          {cls.zones.includes('zdocs') && (
            <div className={`subpanel ${zone === 'zdocs' ? 'on' : ''}`} id="zdocs">
              {docs.map((d, i) => (
                <div className="cap" key={i}>
                  <Icon name="file" size={12} /> {d.t}
                  <div className="meta">
                    {d.fromAI && <Icon name="xai" size={11} glow="cyan" />} <span>{d.meta}</span>
                    {d.tag && <span style={{ color: 'var(--cyan)' }}>{d.tag}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {cls.zones.includes('zbugs') && (
            <div className={`subpanel ${zone === 'zbugs' ? 'on' : ''}`} id="zbugs">
              {projectBugs
                .filter((b) => b.bugStatus !== 'fixed')
                .map((b) => (
                  <div className="bug" key={b.id}>
                    {b.title} <span className="st" onClick={() => cycleBug(b.id)}>{b.bugStatus.toUpperCase()}</span>
                    <div className="mt">
                      <span>{b.severity.toUpperCase()}</span>
                      {b.similarity && (
                        <span className="link">
                          <Icon name="xai" size={12} glow="cyan" /> {Math.round(b.similarity * 100)}% SIMILAR TO A SOLVED BUG — FIX ATTACHED
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              {!projectBugs.filter((b) => b.bugStatus !== 'fixed').length && <div className="rsub">No open bugs — clean run.</div>}
            </div>
          )}
          <div className={`subpanel ${zone === 'zfeed' ? 'on' : ''}`} id="zfeed">
            {feed.map((f, i) => (
              <div className="cap" key={i}>
                {f.fromAI && <Icon name="xai" size={11} glow="cyan" />} {f.body}
                <div className="meta">
                  <span>{f.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>
    </section>
  );
}
