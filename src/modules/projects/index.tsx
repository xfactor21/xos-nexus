import { useState } from 'react';
import { useCoreGraph } from '../../stores/coreGraph';

type Zone = 'zboard' | 'zdocs' | 'zbugs' | 'zfeed';

const docs = [
  { t: '📄 Dark Mode — Requirements', meta: '◈ CREATED FROM NEURAL CAPTURE', tag: 'NEW' },
  { t: '📄 Onboarding Flow Spec', meta: 'LINKED TO 4 TASKS', tag: '◈ AI-DRAFTED' },
  { t: '📄 Auth Architecture', meta: 'SPRINT 001', tag: '◈ RECALLED TODAY FOR BUG #17' },
  { t: '📄 Brand Voice Guide', meta: '6 DAYS AGO', tag: '' },
];
const feed = [
  '◈ xAI linked bug #17 → solved #14 (92% similarity) · 5H AGO',
  'Neural Capture routed 4 nodes into this project · YESTERDAY',
  '◈ "Onboarding Flow" promoted to Sprint 002 milestone · YESTERDAY',
];

/** PROJECTS — ported 1:1 from xos-prototype.html: card list → StudyHive
 * workspace with board/docs/bugs/activity zones. Board + bugs now read from
 * the shared coreGraph store instead of local arrays. */
export default function Projects({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);
  const [zone, setZone] = useState<Zone>('zboard');
  const projects = useCoreGraph((s) => s.projects);
  const tasks = useCoreGraph((s) => s.tasks);
  const bugs = useCoreGraph((s) => s.bugs);
  const advanceTask = useCoreGraph((s) => s.advanceTask);
  const cycleBug = useCoreGraph((s) => s.cycleBug);

  const cols: [0 | 1 | 2, string][] = [
    [0, 'QUEUED'],
    [1, 'IN PROGRESS'],
    [2, 'COMPLETE'],
  ];

  return (
    <section className={`room ${active ? 'on' : ''}`} id="r-projects">
      <h2 className="rh">📂 PROJECTS</h2>
      <div className="rsub">xOS DOESN'T CONTAIN PRODUCTS. IT MANAGES THEM.</div>
      {!open && (
        <div id="plist">
          {projects.map((p) => (
            <div
              key={p.id}
              className={`pcard gpanel ${p.status === 'stale' ? 'warn' : ''}`}
              onClick={() => p.id === 'p-sh' && setOpen(true)}
            >
              <span className="ic">{p.icon}</span>
              <div>
                <h3>{p.name.toUpperCase()}</h3>
                <div className="mt">
                  {p.status === 'stale' ? `⚠ ${p.idleDays} DAYS IDLE — CORE FLAGGED STALE` : `SPRINT 002 · ${tasks.filter((t) => t.project_id === p.id).length || 14} TASKS`}
                </div>
              </div>
              <span className="hp">
                <i style={{ width: p.health + '%' }} />
              </span>
            </div>
          ))}
        </div>
      )}
      {open && (
        <div id="pws">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button className="chip" onClick={() => setOpen(false)}>
              ◂ ALL
            </button>
            <h2 className="rh" style={{ margin: 0 }}>
              🐝 STUDYHIVE
            </h2>
          </div>
          <div id="vitals">
            <div className="vital">
              <div className="n">{tasks.length}</div>
              <div className="l">TASKS</div>
            </div>
            <div className="vital a">
              <div className="n">{bugs.filter((b) => b.bugStatus !== 'fixed').length}</div>
              <div className="l">BUGS</div>
            </div>
            <div className="vital">
              <div className="n">6</div>
              <div className="l">DOCS</div>
            </div>
            <div className="vital m">
              <div className="n">80%</div>
              <div className="l">HEALTH</div>
            </div>
          </div>
          <div className="zones">
            {(
              [
                ['zboard', '▦ BOARD'],
                ['zdocs', '▤ DOCS'],
                ['zbugs', '🐞 BUGS'],
                ['zfeed', '⌁ ACTIVITY'],
              ] as [Zone, string][]
            ).map(([z, label]) => (
              <span key={z} className={`zone ${zone === z ? 'on' : ''}`} onClick={() => setZone(z)}>
                {label}
              </span>
            ))}
          </div>
          <div className={`subpanel ${zone === 'zboard' ? 'on' : ''}`} id="zboard">
            <div className="rsub">TAP A CARD TO ADVANCE IT — THE CORE LOGS EVERY MOVE</div>
            <div id="board">
              {cols.map(([s, label]) => (
                <div className={`col ${s === 1 ? 'doing' : s === 2 ? 'done' : ''}`} key={s}>
                  <h4>{label}</h4>
                  {tasks
                    .filter((t) => t.taskStatus === s)
                    .map((t) => (
                      <div className="card" key={t.id} onClick={() => t.taskStatus < 2 && advanceTask(t.id)}>
                        {t.title}
                        <br />
                        {t.tags.map((tag, i) => (
                          <span key={i} className={`t ${/◈/.test(tag) ? 'ai' : /BUG/.test(tag) ? 'bug' : ''}`}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </div>
          <div className={`subpanel ${zone === 'zdocs' ? 'on' : ''}`} id="zdocs">
            {docs.map((d, i) => (
              <div className="cap" key={i}>
                {d.t}
                <div className="meta">
                  <span>{d.meta}</span>
                  {d.tag && <span style={{ color: 'var(--cyan)' }}>{d.tag}</span>}
                </div>
              </div>
            ))}
          </div>
          <div className={`subpanel ${zone === 'zbugs' ? 'on' : ''}`} id="zbugs">
            {bugs
              .filter((b) => b.project_id === 'p-sh' && b.bugStatus !== 'fixed')
              .map((b) => (
                <div className="bug" key={b.id}>
                  {b.title} <span className="st" onClick={() => cycleBug(b.id)}>{b.bugStatus.toUpperCase()}</span>
                  <div className="mt">
                    <span>{b.severity.toUpperCase()} · SPRINT 002</span>
                    {b.similarity && <span className="link">◈ {Math.round(b.similarity * 100)}% SIMILAR TO SOLVED #14 — FIX ATTACHED</span>}
                  </div>
                </div>
              ))}
          </div>
          <div className={`subpanel ${zone === 'zfeed' ? 'on' : ''}`} id="zfeed">
            {feed.map((f, i) => {
              const [body, time] = f.split(' · ');
              return (
                <div className="cap" key={i}>
                  {body}
                  <div className="meta">
                    <span>{time}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
