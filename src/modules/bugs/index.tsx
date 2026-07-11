import { useMemo, useState } from 'react';
import { useCoreGraph } from '../../stores/coreGraph';
import { nodeToBug } from '../../core/mappers';
import type { BugSeverity, BugStatus } from '../../core/types';
import Icon from '../../design-system/icons/Icon';
import AmbientField from '../../design-system/background/AmbientField';

type StatusFilter = 'all' | 'open' | 'fixed';
type SavedView = 'none' | 'critical' | 'unassigned' | 'mine';

const SEVERITY_ORDER: BugSeverity[] = ['critical', 'high', 'medium', 'low', 'trivial'];

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
  const bugs = useMemo(() => nodes.filter((n) => n.kind === 'bug').map(nodeToBug), [nodes]);
  const cycleBug = useCoreGraph((s) => s.cycleBug);
  const updateBug = useCoreGraph((s) => s.updateBug);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [savedView, setSavedView] = useState<SavedView>('none');
  const [query, setQuery] = useState('');
  const [editingAssignee, setEditingAssignee] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return bugs
      .filter((b) => statusFilter === 'all' || (statusFilter === 'open' ? b.bugStatus !== 'fixed' : b.bugStatus === 'fixed'))
      .filter((b) => {
        if (savedView === 'critical') return b.severity === 'critical' || b.severity === 'high';
        if (savedView === 'unassigned') return !b.assignee;
        if (savedView === 'mine') return b.assignee === 'Captain';
        return true;
      })
      .filter((b) => !query.trim() || b.title.toLowerCase().includes(query.toLowerCase()) || b.body.toLowerCase().includes(query.toLowerCase()))
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
      <div className="rsub">NOT A LIST — A WEB. EVERY BUG KNOWS ITS RELATIVES. TAP STATUS TO CYCLE, TAP SEVERITY TO RECLASSIFY.</div>

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
        {filtered.map((b) => (
          <div key={b.id} className={`bug ${b.bugStatus === 'doing' ? 'doing' : ''} ${b.bugStatus === 'fixed' ? 'is-fixed' : ''}`}>
            <span className={`sev sev-${b.severity}`} style={{ marginRight: 8 }} onClick={() => cycleSeverity(b.id, b.severity)}>
              {b.severity}
            </span>
            {b.title} <span className="st" onClick={() => cycleBug(b.id)}>{nextStatusLabel(b.bugStatus)}</span>
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
            </div>
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
        ))}
        {!filtered.length && <div className="rsub">No bugs match this view.</div>}
      </div>
      </div>
    </section>
  );
}
