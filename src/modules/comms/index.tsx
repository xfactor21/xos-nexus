import { useEffect, useMemo, useRef, useState } from 'react';
import { useCoreGraph } from '../../stores/coreGraph';
import Icon from '../../design-system/icons/Icon';
import AmbientField from '../../design-system/background/AmbientField';
import ShipAmbience from '../../design-system/background/ShipAmbience';

interface Card {
  kind: 'project' | 'bug';
  title: string;
  meta: string;
  glow: 'cyan' | 'magenta' | 'purple' | 'amber';
}
interface Msg {
  who: 'ai' | 'me';
  text: string;
  card?: Card;
}
interface Thread {
  id: string;
  title: string;
  msgs: Msg[];
  unread: boolean;
  xaiInitiated: boolean;
}

const replies: [RegExp, string][] = [
  [/bug|17/i, 'Bug #17 is a login redirect loop — 92% similar to #14, which you solved in Sprint 001 with token rotation. The fix is attached to the bug card.'],
  [/website/i, 'Website has been dark for 6 days, Captain. Its constellation is dimming. I suggest a 25-minute revival session — I can bundle bug #15 into it.'],
  [/studyhive|study/i, "StudyHive is your brightest galaxy — 80% health, 14 tasks, a dark-mode cluster forming from today's captures."],
  [/roadmap|next|plan/i, 'One Sprint 002 goal remains: the Electron vs Tauri shell decision. After that, Sprint 003 brings live AI routing.'],
  [/remember|memory|decision/i, 'Most-recalled memory: "Bee mascot = brand anchor" (Sprint 001). It\'s linked to 6 active nodes.'],
  [/.*/, "Logged, Captain. I've created a node for that and I'm mapping its relationships now."],
];

function newThread(title: string, first: Msg, xaiInitiated = false): Thread {
  return { id: `t-${Math.random().toString(36).slice(2, 9)}`, title, msgs: [first], unread: xaiInitiated, xaiInitiated };
}

export default function Comms({ active }: { active: boolean }) {
  const projects = useCoreGraph((s) => s.projects);
  const [threads, setThreads] = useState<Thread[]>(() => [
    newThread('GENERAL', { who: 'ai', text: "Channel open, Captain. I've been keeping an eye on things — ask me about any project, bug, or memory." }),
  ]);
  const [activeId, setActiveId] = useState<string>(() => threads[0].id);
  const [val, setVal] = useState('');
  const spawnedStale = useRef(false);

  useEffect(() => {
    if (spawnedStale.current) return;
    const stale = projects.find((p) => p.isStale);
    if (!stale) return;
    spawnedStale.current = true;
    const t = setTimeout(() => {
      setThreads((ts) => [
        newThread(
          stale.name.toUpperCase(),
          {
            who: 'ai',
            text: `Opening this channel myself, Captain — ${stale.name} has gone quiet for ${stale.idleDays} days. Want me to line up a revival session?`,
            card: { kind: 'project', title: stale.name, meta: `${stale.health}% HEALTH · ${stale.idleDays}D IDLE`, glow: 'amber' },
          },
          true,
        ),
        ...ts,
      ]);
    }, 2400);
    return () => clearTimeout(t);
  }, [projects]);

  const activeThread = threads.find((t) => t.id === activeId) ?? threads[0];

  function buildCard(v: string): Card | undefined {
    if (/bug|17/i.test(v)) return { kind: 'bug', title: 'Bug #17 — Login redirect loop', meta: 'HIGH · 92% MATCH TO #14', glow: 'magenta' };
    const proj = projects.find((p) => v.toLowerCase().includes(p.name.toLowerCase()));
    if (proj) return { kind: 'project', title: proj.name, meta: `${proj.health}% HEALTH · ${proj.idleDays}D IDLE`, glow: proj.isStale ? 'amber' : 'cyan' };
    return undefined;
  }

  function send() {
    const v = val.trim();
    if (!v) return;
    const id = activeThread.id;
    setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, msgs: [...t.msgs, { who: 'me', text: v }], unread: false } : t)));
    setVal('');
    const reply = replies.find(([re]) => re.test(v))?.[1] ?? '';
    const card = buildCard(v);
    setTimeout(() => {
      setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, msgs: [...t.msgs, { who: 'ai', text: reply, card }] } : t)));
    }, 650);
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
                    <Icon name={m.card.kind === 'bug' ? 'bugTracker' : 'projects'} size={13} glow={m.card.glow === 'amber' ? 'amber' : m.card.glow === 'magenta' ? 'magenta' : 'cyan'} />
                    <div>
                      <div className="commsCardTitle">{m.card.title}</div>
                      <div className="commsCardMeta">{m.card.meta}</div>
                    </div>
                  </div>
                )}
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
