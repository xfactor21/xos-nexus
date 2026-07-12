import { useMemo, useState } from 'react';
import { useCoreGraph } from '../../stores/coreGraph';
import { nodeToBug } from '../../core/mappers';
import type { BugSeverity, BugStatus } from '../../core/types';
import Icon from '../../design-system/icons/Icon';
import AmbientField from '../../design-system/background/AmbientField';

type StatusFilter = 'all' | 'open' | 'fixed';
type SavedView = 'none' | 'critical' | 'unassigned' | 'mine';

const SEVERITY_ORDER: BugSeverity[] = ['critical', 'high', 'medium', 'low', 'trivial'];

/** Aging — real client-side calc off created_at (no separate "age" column
 * exists), same pattern coreGraph already uses for ProjectRecord.idleDays.
 * Bands loosely mirror the severity palette so an old-and-untouched bug
 * reads as visually "hot" the same way a critical one does. */
function ageDays(createdAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000));
}
function agingBand(days: number): 'fresh' | 'watch' | 'stale' | 'ancient' {
  if (days < 2) return 'fresh';
  if (days < 7) return 'watch';
  if (days < 21) return 'stale';
  return 'ancient';
}
const RELATION_VERB: Record<string, string> = {
  relates_to: 'relates to',
  duplicates: 'duplicates',
  blocks: 'blocks',
  solves: 'solves',
  references: 'references',
  derived_from: 'derived from',
  affects: 'affects',
};

/** BUG TRACKER — Step 5: ported 1:1 from xos-prototype.html (status-cycle
 * chips, ALL/OPEN/FIXED filter) and extended per the Feature Uplift notes:
 * severity levels beyond HIGH/MED/LOW with color coding, an assignee field,
 * a linked-commit placeholder field, duplicate-detection as a real UI
 * affordance (not just a caption), full-text search, and saved filter
 * views. */
export default function Bugs({ active }: { active: boolean }) {
  // See Projects room for why this derives locally via useMemo instead of
  // a `(s) => s.bugs()`-style store selector (unstable snapshot → risk of
  // "Maximum update depth exceeded").
  const nodes = useCoreGraph((s) => s.nodes);
  const edges = useCoreGraph((s) => s.edges);
  const bugs = useMemo(() => nodes.filter((n) => n.kind === 'bug').map(nodeToBug), [nodes]);
  const cycleBug = useCoreGraph((s) => s.cycleBug);
  const updateBug = useCoreGraph((s) => s.updateBug);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [savedView, setSavedView] = useState<SavedView>('none');
  const [query, setQuery] = useState('');
  const [editingAssignee, setEditingAssignee] = useState<string | null>(null);
  const [openTimeline, setOpenTimeline] = useState<string | null>(null);

  const nodeTitle = useMemo(() => {
    const m = new Map<string, string>();
    nodes.forEach((n) => m.set(n.id, n.title));
    return m;
  }, [nodes]);

  // "Life of a bug" — built from real data only (creation date, current
  // status, and graph edges touching this node), never fabricated
  // intermediate history, since the schema has no persisted change-log.
  function bugEdges(bugId: string) {
    return edges.filter((e) => e.from_node === bugId || e.to_node === bugId);
  }

  const filtered = useMemo(() => {
    return bugs
      .filter((b) => statusFilter === 'all' || (statusFilter === 'open' ? b.bugStatus !== 'fixed' : b.bugStatus === 'fixed'))
      .filter((b) => {
        if (savedView === 'critical') return b.severity === 'critical' || b.severity === 'high';
        if (savedView === 'unassigned') return !b.assignee;
        if (savedView === 'mine') return b.assignee === 'Captain';
        return true;
      })
      .filter((b) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return (
          b.title.toLowerCase().includes(q) ||
          b.body.toLowerCase().includes(q) ||
          (b.assignee ?? '').toLowerCase().includes(q) ||
          (b.linkedCommit ?? '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  }, [bugs, statusFilter, savedView, query]);

  function nextStatusLabel(s: BugStatus) {
    return s === 'open' ? 'OPEN' : s === 'doing' ? 'IN PROGRESS' : 'FIXED';
  }
  function cycleSeverity(id: string, cur: BugSeverity) {
    const i = SEVERITY_ORDER.indexOf(cur);
    updateBug(id, { severity: SEVERITY_ORDER[(i + 1) % SEVERITY_ORDER.length] });
  }

  return (
    <section className={`room ambient ${active ? 'on' : ''}`} id="r-bugs">
      {/* Amendment v0.6 step 3: Bug Tracker gets the "slightly warmer" mood
          variation the amendment names explicitly. */}
      <AmbientField mood="warm" density={26} active={active} parallax />
      <div className="roomInner">
      <h2 className="rh">
        <Icon name="bugTracker" size={18} /> BUG TRACKER
      </h2>
      <div className="rsub">NOT A LIST — A WEB. EVERY BUG KNOWS ITS RELATIVES. TAP STATUS TO CYCLE, TAP SEVERITY TO RECLASSIFY. DRAG A BUG ONTO A ROADMAPS MILESTONE TO PROMOTE IT.</div>

      <input id="bugSearch" placeholder="Search bugs… try “redirect” or “#17”" value={query} onChange={(e) => setQuery(e.target.value)} />

      <div className="optrow">
        {(['all', 'open', 'fixed'] as StatusFilter[]).map((f) => (
          <span key={f} className={`chip ${statusFilter === f ? 'on' : ''}`} onClick={() => setStatusFilter(f)}>
            {f.toUpperCase()}
          </span>
        ))}
      </div>

      {/* Feature uplift: saved filter views */}
      <div className="optrow" style={{ marginTop: -6 }}>
        <span className={`savedview ${savedView === 'none' ? 'on' : ''}`} onClick={() => setSavedView('none')}>
          <Icon name="star" size={11} /> MY DEFAULT VIEW
        </span>
        <span className={`savedview ${savedView === 'critical' ? 'on' : ''}`} onClick={() => setSavedView('critical')}>
          <Icon name="star" size={11} /> CRITICAL + HIGH
        </span>
        <span className={`savedview ${savedView === 'unassigned' ? 'on' : ''}`} onClick={() => setSavedView('unassigned')}>
          <Icon name="star" size={11} /> UNASSIGNED
        </span>
        <span className={`savedview ${savedView === 'mine' ? 'on' : ''}`} onClick={() => setSavedView('mine')}>
          <Icon name="star" size={11} /> ASSIGNED TO ME
        </span>
      </div>

      <div id="bugList">
        {filtered.map((b) => {
          const days = ageDays(b.created_at);
          const band = agingBand(days);
          const related = bugEdges(b.id);
          return (
          <div
            key={b.id}
            className={`bug ${b.bugStatus === 'doing' ? 'doing' : ''} ${b.bugStatus === 'fixed' ? 'is-fixed' : ''}`}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('application/x-xos-bug', b.id)}
          >
            <span className={`sev sev-${b.severity}`} style={{ marginRight: 8 }} onClick={() => cycleSeverity(b.id, b.severity)}>
              {b.severity}
            </span>
            {b.title} <span className="st" onClick={() => cycleBug(b.id)}>{nextStatusLabel(b.bugStatus)}</span>
            {b.bugStatus !== 'fixed' && (
              <span className={`aging aging-${band}`} title={`Open ${days}d`}>
                {days}D
              </span>
            )}
            <div className="mt">
              <span>{b.severity.toUpperCase()} · SPRINT 002</span>
              {b.linkedCommit && (
                <span className="link">
                  <Icon name="branch" size={12} /> {b.linkedCommit}
                </span>
              )}
              <span
                className="assignee-pill"
                onClick={() => setEditingAssignee(editingAssignee === b.id ? null : b.id)}
                style={{ cursor: 'pointer' }}
              >
                <Icon name="user" size={12} /> {b.assignee ?? 'UNASSIGNED'}
              </span>
              <span className="link" style={{ cursor: 'pointer' }} onClick={() => setOpenTimeline(openTimeline === b.id ? null : b.id)}>
                <Icon name="chevronDown" size={12} /> LIFE OF THIS BUG
              </span>
            </div>
            {openTimeline === b.id && (
              <div className="bugTimeline">
                <div className="bugTimelineNode">
                  <span className="bugTimelineDot" />
                  <b>REPORTED</b> {new Date(b.created_at).toLocaleDateString()} · {days}D AGO
                </div>
                <div className="bugTimelineNode">
                  <span className="bugTimelineDot" style={{ background: b.bugStatus === 'fixed' ? 'var(--cy)' : 'var(--mg)' }} />
                  <b>CURRENT STATE</b> {nextStatusLabel(b.bugStatus)}
                </div>
                {related.map((e) => {
                  const other = e.from_node === b.id ? e.to_node : e.from_node;
                  return (
                    <div className="bugTimelineNode" key={e.id}>
                      <span className="bugTimelineDot" style={{ background: 'var(--pu)' }} />
                      {RELATION_VERB[e.relation] ?? e.relation} <b>{nodeTitle.get(other) ?? other.slice(0, 8)}</b>
                    </div>
                  );
                })}
                {!related.length && <div className="bugTimelineNode rsub">No known relationships yet.</div>}
              </div>
            )}
            {editingAssignee === b.id && (
              <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                {['Captain', 'xAI', null].map((a) => (
                  <span
                    key={String(a)}
                    className="chip"
                    style={{ fontSize: 9 }}
                    onClick={() => {
                      updateBug(b.id, { assignee: a });
                      setEditingAssignee(null);
                    }}
                  >
                    {a ?? 'CLEAR'}
                  </span>
                ))}
              </div>
            )}
            {/* Feature uplift: duplicate-detection surfaced as a real, actionable affordance */}
            {b.duplicateOf && b.similarity && (
              <div className="dup-banner" onClick={() => updateBug(b.id, { duplicateOf: null, similarity: null })}>
                <span>
                  <Icon name="xai" size={12} glow="cyan" /> {Math.round(b.similarity * 100)}% SIMILAR TO SOLVED #14 — FIX ATTACHED
                </span>
                <span style={{ textDecoration: 'underline' }}>DISMISS</span>
              </div>
            )}
          </div>
          );
        })}
        {!filtered.length && <div className="rsub">No bugs match this view.</div>}
      </div>
      </div>
    </section>
  );
}
