import { useEffect, useMemo, useRef, useState } from 'react';
import { useCoreGraph } from '../../stores/coreGraph';
import { useCommsStore } from '../../stores/commsStore';
import { nodeToBug } from '../../core/mappers';
import type { BugNode, ProjectRecord, SprintRecord, SuggestionRecord } from '../../core/types';
import Icon from '../../design-system/icons/Icon';
import AmbientField from '../../design-system/background/AmbientField';
import ShipAmbience from '../../design-system/background/ShipAmbience';

interface Card {
  kind: 'project' | 'bug' | 'sprint';
  title: string;
  meta: string;
  glow: 'cyan' | 'magenta' | 'purple' | 'amber';
}
interface Msg {
  who: 'ai' | 'me';
  text: string;
  card?: Card;
  /** Set only on the opening message of a suggestion-spawned thread —
   * drives the GOT IT/DISMISS affordance wired to the real
   * `public.suggestions` row (coreGraph's actionSuggestion/dismissSuggestion). */
  suggestionId?: string;
}
interface Thread {
  id: string;
  title: string;
  msgs: Msg[];
  unread: boolean;
  xaiInitiated: boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newThread(title: string, first: Msg, xaiInitiated = false): Thread {
  return { id: `t-${Math.random().toString(36).slice(2, 9)}`, title, msgs: [first], unread: xaiInitiated, xaiInitiated };
}

/** Builds this suggestion's Comms card by looking its `related_nodes`/
 * `project_id` back up against live store state — the card is always a
 * real project/bug/sprint the Captain can act on, not baked-in text. */
function suggestionCard(sug: SuggestionRecord, ctx: { projects: ProjectRecord[]; bugs: BugNode[]; sprints: SprintRecord[] }): Card | undefined {
  if (sug.trigger === 'stale_project') {
    const proj = ctx.projects.find((p) => p.id === sug.project_id);
    if (!proj) return undefined;
    return { kind: 'project', title: proj.name, meta: `${proj.health}% HEALTH · ${proj.idleDays}D IDLE`, glow: 'amber' };
  }
  if (sug.trigger === 'duplicate_bug') {
    const bug = ctx.bugs.find((b) => sug.related_nodes.includes(b.id));
    if (!bug) return undefined;
    return { kind: 'bug', title: bug.title, meta: `${bug.severity.toUpperCase()} · ${bug.bugStatus.toUpperCase()}`, glow: 'magenta' };
  }
  if (sug.trigger === 'sprint_ending') {
    const sprint = ctx.sprints.find((s) => sug.related_nodes.includes(s.id));
    if (!sprint) return undefined;
    return { kind: 'sprint', title: sprint.name, meta: `ENDS ${sprint.ends_on ?? '—'}`, glow: 'purple' };
  }
  return undefined;
}

export default function Comms({ active }: { active: boolean }) {
  const projects = useCoreGraph((s) => s.projects);
  const nodes = useCoreGraph((s) => s.nodes);
  const memories = useCoreGraph((s) => s.memories);
  const milestones = useCoreGraph((s) => s.milestones);
  const sprints = useCoreGraph((s) => s.sprints);
  const suggestions = useCoreGraph((s) => s.suggestions);
  const commitCaptureNodes = useCoreGraph((s) => s.commitCaptureNodes);
  const recordMemoryRecall = useCoreGraph((s) => s.recordMemoryRecall);
  const generateSuggestions = useCoreGraph((s) => s.generateSuggestions);
  const markSuggestionSurfaced = useCoreGraph((s) => s.markSuggestionSurfaced);
  const dismissSuggestion = useCoreGraph((s) => s.dismissSuggestion);
  const actionSuggestion = useCoreGraph((s) => s.actionSuggestion);
  const bugs = useMemo(() => nodes.filter((n) => n.kind === 'bug').map(nodeToBug), [nodes]);
  const [threads, setThreads] = useState<Thread[]>(() => [
    newThread('GENERAL', { who: 'ai', text: "Channel open, Captain. I've been keeping an eye on things — ask me about any project, bug, or memory." }),
  ]);
  const [activeId, setActiveId] = useState<string>(() => threads[0].id);
  const [val, setVal] = useState('');
  const ranDetector = useRef(false);
  const setUnreadCount = useCommsStore((s) => s.setUnreadCount);

  // Shares a real, live "unread threads" count with the rest of the app —
  // Ship Ambience's reactive condition reads this to decide whether the
  // ambient decoration should read calm or "something needs attention",
  // without importing this whole room or its thread content.
  useEffect(() => {
    setUnreadCount(threads.filter((t) => t.unread).length);
  }, [threads, setUnreadCount]);

  // Run the real, disclosed rule-based detector (coreGraph.generateSuggestions)
  // once per Comms visit — it's safe to call opportunistically since it only
  // inserts genuinely new `suggestions` rows (DB-persisted de-dup).
  useEffect(() => {
    if (ranDetector.current) return;
    ranDetector.current = true;
    generateSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suggestion-driven thread spawning (was: one hardcoded stale-project
  // useEffect that could only ever fire once, for one specific trigger).
  // Every `pending` suggestion this owner has gets its own xAI-initiated
  // thread; immediately marking it `surfaced` (durable, DB-persisted) is
  // what stops it from spawning a second thread on the next reload — a
  // dismissed/actioned suggestion is equally "already surfaced" and never
  // revisited here either, since both are filtered out below.
  useEffect(() => {
    const toSurface = suggestions.filter((s) => s.status === 'pending');
    if (!toSurface.length) return;
    toSurface.forEach((sug) => {
      markSuggestionSurfaced(sug.id);
      const card = suggestionCard(sug, { projects, bugs, sprints });
      setThreads((ts) => [newThread(sug.trigger.replace('_', ' ').toUpperCase(), { who: 'ai', text: sug.message, card, suggestionId: sug.id }, true), ...ts]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions]);

  const activeThread = threads.find((t) => t.id === activeId) ?? threads[0];

  /** Real data-driven reply engine (was: a fixed regex → canned-string table
   * describing a fictional bug #17/#14, a "website" project, "Bee mascot"
   * memory etc. that may not exist in this Captain's account at all — plus a
   * catch-all that flatly lied, claiming "I've created a node for that"
   * without ever writing one). Every branch below reads the live store; the
   * catch-all now genuinely files a note via commitCaptureNodes instead of
   * only pretending to. */
  async function computeReply(v: string): Promise<{ text: string; card?: Card }> {
    const l = v.toLowerCase();

    if (/\bbug\b|#\d+/i.test(l)) {
      const numMatch = l.match(/#?(\d{1,4})\b/);
      const openBugs = bugs.filter((b) => b.bugStatus !== 'fixed');
      const byNumber = numMatch ? bugs.find((b) => b.title.includes(numMatch[1])) : undefined;
      const target = byNumber ?? openBugs[0] ?? bugs[0];
      if (!target) return { text: 'No bugs logged yet, Captain — clean run.' };
      const dup = target.duplicateOf ? nodes.find((n) => n.id === target.duplicateOf) : undefined;
      const similarityNote = target.similarity && dup ? ` — ${Math.round(target.similarity * 100)}% similar to "${dup.title}"` : '';
      return {
        text: `"${target.title}"${similarityNote}. Severity ${target.severity.toUpperCase()}, status ${target.bugStatus.toUpperCase()}.`,
        card: { kind: 'bug', title: target.title, meta: `${target.severity.toUpperCase()} · ${target.bugStatus.toUpperCase()}`, glow: target.bugStatus === 'fixed' ? 'cyan' : 'magenta' },
      };
    }

    const proj = projects.find((p) => l.includes(p.name.toLowerCase()) || l.includes(p.slug.toLowerCase()));
    if (proj) {
      const taskCount = nodes.filter((n) => n.kind === 'task' && n.project_id === proj.id).length;
      const status = proj.isStale ? `gone quiet for ${proj.idleDays} days` : `${proj.idleDays}d since last touch`;
      return {
        text: `${proj.name} is at ${proj.health}% health with ${taskCount} task${taskCount === 1 ? '' : 's'} — ${status}.`,
        card: { kind: 'project', title: proj.name, meta: `${proj.health}% HEALTH · ${proj.idleDays}D IDLE`, glow: proj.isStale ? 'amber' : 'cyan' },
      };
    }

    if (/roadmap|milestone|next|plan|sprint/i.test(l)) {
      const current = milestones.find((m) => m.state === 'current') ?? [...milestones].filter((m) => m.state === 'future').sort((a, b) => a.order - b.order)[0];
      if (!current) return { text: 'No milestones on the roadmap yet, Captain — add one in Roadmaps to track it here.' };
      const remaining = current.items.filter((it) => !it.done);
      return {
        text: remaining.length
          ? `${current.version} — ${current.title}: ${remaining.length} item${remaining.length === 1 ? '' : 's'} left, next up "${remaining[0].label}".`
          : `${current.version} — ${current.title} is fully checked off.`,
      };
    }

    if (/remember|memory|decision|recall/i.test(l)) {
      const sorted = [...memories].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const target = sorted.find((m) => m.kind === 'decision') ?? sorted[0];
      if (!target) return { text: 'Nothing in memory yet, Captain — decisions and patterns get logged as they come up.' };
      // Real recall tracking (Memory Vault's "RECALLED N×" stat) — this is
      // the one genuine "xAI surfaced a memory to the Captain" moment in
      // the client codebase, so it's the one place that logs a recall.
      recordMemoryRecall(target.id);
      return { text: `Most recent ${target.kind}: "${target.content}" (${target.createdLabel}), linked to ${target.linkedNodeCount} node${target.linkedNodeCount === 1 ? '' : 's'}.` };
    }

    // Catch-all: genuinely file it instead of just claiming to.
    try {
      await commitCaptureNodes([{ kind: 'note', title: v.length > 80 ? v.slice(0, 77) + '…' : v, body: v, projectId: null, confidence: 0.6, reasoning: 'Captured via Comms channel' }]);
      return { text: "Logged, Captain — filed as a note. I'll relate it to other nodes as connections emerge." };
    } catch (err) {
      console.error('Comms: catch-all commitCaptureNodes failed', err);
      return { text: "Couldn't file that just now, Captain — try again in a moment." };
    }
  }

  function send() {
    const v = val.trim();
    if (!v) return;
    const id = activeThread.id;
    setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, msgs: [...t.msgs, { who: 'me', text: v }], unread: false } : t)));
    setVal('');
    Promise.all([computeReply(v), delay(500)]).then(([{ text, card }]) => {
      setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, msgs: [...t.msgs, { who: 'ai', text, card }] } : t)));
    });
  }

  function openNewThread() {
    const t = newThread(`THREAD ${threads.length + 1}`, { who: 'ai', text: 'New channel open. What do you want to dig into?' });
    setThreads((ts) => [t, ...ts]);
    setActiveId(t.id);
  }

  const threadList = useMemo(() => threads, [threads]);

  return (
    <section className={`room ambient ${active ? 'on' : ''}`} id="r-comms">
      <AmbientField mood="cyan" density={22} active={active} parallax />
      <ShipAmbience kind="lights" corner="bl" active={active} />
      <div className="roomInner">
      <h2 className="rh">
        <Icon name="comms" size={16} glow="cyan" /> COMMS
      </h2>
      <div className="rsub">TRANSMISSION LINES TO xAI. MULTIPLE CHANNELS — SOME IT OPENS ITSELF.</div>

      <div className="commsLayout">
        <div className="commsThreads">
          <div className="commsNewThread" onClick={openNewThread}>
            <Icon name="plus" size={12} /> NEW CHANNEL
          </div>
          {threadList.map((t) => (
            <div
              key={t.id}
              className={`commsThreadRow ${t.id === activeThread.id ? 'on' : ''} ${t.unread ? 'unread' : ''}`}
              onClick={() => {
                setThreads((ts) => ts.map((x) => (x.id === t.id ? { ...x, unread: false } : x)));
                setActiveId(t.id);
              }}
            >
              {t.xaiInitiated && <Icon name="xai" size={11} glow="cyan" />}
              <span>{t.title}</span>
              {t.unread && <i className="commsUnreadDot" />}
            </div>
          ))}
        </div>

        <div className="commsMain">
          <div id="chat">
            {activeThread.msgs.map((m, i) => (
              <div className={`msg ${m.who}`} key={i}>
                {m.who === 'ai' && (
                  <b>
                    <Icon name="xai" size={12} glow="cyan" /> xAI
                  </b>
                )}
                {m.text}
                {m.card && (
                  <div className={`commsCard commsCard-${m.card.glow}`}>
                    <Icon name={m.card.kind === 'bug' ? 'bugTracker' : m.card.kind === 'sprint' ? 'gantt' : 'projects'} size={13} glow={m.card.glow} />
                    <div>
                      <div className="commsCardTitle">{m.card.title}</div>
                      <div className="commsCardMeta">{m.card.meta}</div>
                    </div>
                  </div>
                )}
                {m.suggestionId && (() => {
                  const sug = suggestions.find((s) => s.id === m.suggestionId);
                  if (!sug || sug.status === 'dismissed' || sug.status === 'actioned') {
                    return sug ? <div className="rsub" style={{ fontSize: 9, marginTop: 4 }}>{sug.status === 'dismissed' ? 'DISMISSED' : 'HANDLED'}</div> : null;
                  }
                  return (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <span className="chip" style={{ fontSize: 9 }} onClick={() => actionSuggestion(sug.id)}>GOT IT</span>
                      <span className="chip" style={{ fontSize: 9 }} onClick={() => dismissSuggestion(sug.id)}>DISMISS</span>
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
          <div id="chatBar">
            <input placeholder="Transmit to xAI…" autoComplete="off" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
            <button onClick={send}>
              <Icon name="send" size={14} />
            </button>
          </div>
        </div>
      </div>
      </div>
    </section>
  );
}
