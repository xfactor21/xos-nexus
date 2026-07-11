import { useRef, useState } from 'react';
import { useCoreGraph } from '../../stores/coreGraph';
import Icon from '../../design-system/icons/Icon';
import AmbientField from '../../design-system/background/AmbientField';

/** ROADMAPS — Step 5: ported 1:1 from xos-prototype.html (.track vertical
 * timeline) and extended per the Feature Uplift notes: drag-to-reorder
 * milestones, editable release dates + a timeline/Gantt-lite view,
 * per-milestone progress bars computed from linked item completion, and
 * promoting a Memory Vault pattern directly into a milestone. */
export default function Roadmaps({ active }: { active: boolean }) {
  const milestones = useCoreGraph((s) => s.milestones);
  const memories = useCoreGraph((s) => s.memories);
  const reorderMilestones = useCoreGraph((s) => s.reorderMilestones);
  const updateMilestoneDate = useCoreGraph((s) => s.updateMilestoneDate);
  const promoteMemoryToMilestone = useCoreGraph((s) => s.promoteMemoryToMilestone);
  const [view, setView] = useState<'track' | 'gantt'>('track');
  const [promoting, setPromoting] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);

  const ordered = [...milestones].sort((a, b) => a.order - b.order);
  const patterns = memories.filter((m) => m.kind === 'pattern');

  function progressOf(items: { done: boolean }[]) {
    if (!items.length) return 0;
    return Math.round((items.filter((i) => i.done).length / items.length) * 100);
  }

  function onDrop(targetId: string) {
    if (!dragId.current || dragId.current === targetId) return;
    const ids = ordered.map((m) => m.id);
    const from = ids.indexOf(dragId.current);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    reorderMilestones(ids);
    dragId.current = null;
  }

  // rough date bounds for the gantt-lite scale
  const dated = ordered.filter((m) => m.releaseDate);
  const minT = dated.length ? Math.min(...dated.map((m) => new Date(m.releaseDate!).getTime())) : Date.now();
  const maxT = dated.length ? Math.max(...dated.map((m) => new Date(m.releaseDate!).getTime())) : Date.now() + 1;
  const span = Math.max(1, maxT - minT);

  return (
    <section className={`room ambient ${active ? 'on' : ''}`} id="r-roadmaps">
      <AmbientField mood="purple" density={26} active={active} parallax />
      <div className="roomInner">
      <h2 className="rh"><Icon name="roadmaps" size={18} /> ROADMAPS</h2>
      <div className="rsub">PROJECTS ANSWER "WHAT ARE WE BUILDING?" — THIS ANSWERS "WHERE ARE WE GOING?"</div>

      <div className="optrow">
        <span className={`chip ${view === 'track' ? 'on' : ''}`} onClick={() => setView('track')}>
          <Icon name="rows" size={12} /> TRACK
        </span>
        <span className={`chip ${view === 'gantt' ? 'on' : ''}`} onClick={() => setView('gantt')}>
          <Icon name="gantt" size={12} /> TIMELINE (GANTT-LITE)
        </span>
      </div>

      {view === 'track' && (
        <div className="track">
          {ordered.map((m) => (
            <div
              key={m.id}
              className={`rel gpanel ${m.state === 'current' ? 'cur' : m.state === 'future' ? 'fut' : ''}`}
              draggable
              onDragStart={() => (dragId.current = m.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(m.id)}
            >
              <h3>
                <span>
                  <span className="drag-handle">⠿</span>
                  {m.version} — {m.title}
                </span>
                <span className="st">
                  <Icon name={m.state === 'shipped' ? 'check' : m.state === 'current' ? 'bolt' : 'hourglass'} size={11} glow={m.state === 'current' ? 'cyan' : 'none'} /> {m.statusLabel}
                </span>
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                <span style={{ fontSize: 9, letterSpacing: 1, color: 'var(--text-dim)' }}>RELEASE:</span>
                <input
                  type="date"
                  className="date-input"
                  value={m.releaseDate ?? ''}
                  onChange={(e) => updateMilestoneDate(m.id, e.target.value)}
                />
              </div>
              <ul>
                {m.items.map((it, i) => (
                  <li key={i} className={it.done ? 'done' : ''}>
                    {it.fromMemory && <Icon name="xai" size={10} glow="cyan" />} {it.label}
                  </li>
                ))}
              </ul>
              <div className="milestone-progress">
                <i style={{ width: progressOf(m.items) + '%' }} />
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4 }}>{progressOf(m.items)}% COMPLETE</div>

              <div style={{ marginTop: 10 }}>
                {promoting === m.id ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {patterns.map((p) => (
                      <span
                        key={p.id}
                        className="promote-target"
                        onClick={() => {
                          promoteMemoryToMilestone(p.id, m.id);
                          setPromoting(null);
                        }}
                      >
                        + {p.content.slice(0, 36)}…
                      </span>
                    ))}
                    <span className="chip" style={{ fontSize: 9 }} onClick={() => setPromoting(null)}>
                      CANCEL
                    </span>
                  </div>
                ) : (
                  <span className="promote-target" onClick={() => setPromoting(m.id)}>
                    <Icon name="xai" size={11} glow="cyan" /> PROMOTE A MEMORY VAULT PATTERN <Icon name="chevronRight" size={11} />
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'gantt' && (
        <div id="gantt">
          {ordered.map((m) => {
            const t = m.releaseDate ? new Date(m.releaseDate).getTime() : minT;
            const leftPct = ((t - minT) / span) * 90;
            return (
              <div className="gantt-row" key={m.id}>
                <div className="gantt-label">
                  {m.version} — {m.title}
                </div>
                <div className="gantt-track">
                  <div className="gantt-bar" style={{ left: leftPct + '%', width: Math.max(6, progressOf(m.items) / 4) + '%' }} title={`${progressOf(m.items)}% complete`} />
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-dim)', width: 74, flexShrink: 0 }}>{m.releaseDate ?? 'TBD'}</div>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </section>
  );
}
