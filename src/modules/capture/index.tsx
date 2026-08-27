import { useMemo, useRef, useState } from 'react';
import type { DissectedPiece, NodeKind } from '../../core/types';
import { liveClassify } from '../../lib/copilotClient';
import { commitOrQueue } from '../../lib/offlineSync';
import { playSound } from '../../lib/sound';
import { isTauri } from '../../lib/localDb';
import Icon from '../../design-system/icons/Icon';
import type { IconName } from '../../design-system/icons/registry';
import AmbientField from '../../design-system/background/AmbientField';
import ShipAmbience from '../../design-system/background/ShipAmbience';
import { useCoreGraph } from '../../stores/coreGraph';

async function openCaptureWidget() {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_capture_widget');
}

type CapKind = 'IDEA' | 'BUG' | 'WRITING';

const capDest: Record<CapKind, string> = {
  IDEA: 'DESIGN STUDIO › STUDYHIVE',
  BUG: 'BUG TRACKER › #17',
  WRITING: 'NOVEL › DRAFT NOTES',
};

interface CapEntry {
  text: string;
  kind: CapKind | null;
  icon: IconName;
  meta: string;
  metaCount?: number;
  time: string;
  timeIcon?: IconName;
  linked?: string;
}

const NODE_KIND_TO_CAP_ICON: Partial<Record<NodeKind, IconName>> = {
  idea: 'idea',
  bug: 'bugTracker',
  task: 'checkCircle',
  design: 'designStudio',
  note: 'note',
  doc: 'note',
  roadmap_item: 'link',
  release: 'link',
  conversation: 'xai',
  knowledge_snapshot: 'note',
  capture: 'idea',
};

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'JUST NOW';
  if (min < 60) return `${min}M AGO`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}H AGO`;
  const days = Math.floor(hr / 24);
  return days === 1 ? 'YESTERDAY' : `${days}D AGO`;
}

const PIECE_ICON: Record<string, IconName> = {
  TASK: 'checkCircle',
  DESIGN: 'designStudio',
  BUG: 'bugTracker',
  IDEA: 'idea',
  NOTE: 'note',
  EDGE: 'link',
};

export default function Capture({ active }: { active: boolean }) {
  const [raw, setRaw] = useState('');
  const [rec, setRec] = useState(false);
  const [bars, setBars] = useState<number[]>(Array(26).fill(20));
  const [pieces, setPieces] = useState<DissectedPiece[] | null>(null);
  const [caps, setCaps] = useState<CapEntry[]>([]);
  const wavT = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [changed, setChanged] = useState<Set<number>>(new Set());

  const nodes = useCoreGraph((s) => s.nodes);
  const realCaps: CapEntry[] = useMemo(
    () =>
      nodes
        .filter((n) => n.source === 'capture_text')
        .slice()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10)
        .map((n) => ({
          text: n.title || n.body || '(empty capture)',
          kind: null,
          icon: NODE_KIND_TO_CAP_ICON[n.kind] ?? 'idea',
          meta: n.kind.toUpperCase().replace('_', ' '),
          time: relTime(n.created_at),
          timeIcon: 'check' as IconName,
        })),
    [nodes],
  );
  const visibleCaps = useMemo(() => {
    const realTexts = new Set(realCaps.map((r) => r.text));
    return [...caps.filter((c) => c.time === 'SENDING…' || !realTexts.has(c.text)), ...realCaps];
  }, [caps, realCaps]);

  function toggleVoice() {
    setRec((r) => {
      const next = !r;
      if (next) {
        wavT.current = setInterval(() => setBars(Array.from({ length: 26 }, () => 10 + Math.random() * 85)), 110);
        setTimeout(() => {
          setRec((cur) => {
            if (cur) {
              clearInterval(wavT.current);
              setBars(Array(26).fill(20));
              setRaw("I want a dark mode for StudyHive — toggle in settings, remember the choice, and the logo should glow when it's on");
              return false;
            }
            return cur;
          });
        }, 2600);
      } else {
        clearInterval(wavT.current);
        setBars(Array(26).fill(20));
      }
      return next;
    });
  }

  function dissect() {
    const v = raw.trim();
    if (!v) return;
    const l = v.toLowerCase();
    const proj = /studyhive/.test(l) ? 'STUDYHIVE' : /novel|chapter/.test(l) ? 'NOVEL' : /music|song/.test(l) ? 'MUSIC' : /website/.test(l) ? 'WEBSITE' : 'STUDYHIVE';
    const out: DissectedPiece[] = [];
    if (/toggle|add|build|implement|want|feature|mode/.test(l)) out.push({ kind: 'TASK', body: 'Implement: core feature from thought', destination: proj + ' › TASKS › SPRINT 002', reasoning: 'Action verb + scope detected', confidence: 96 });
    if (/remember|persist|save|choice/.test(l)) out.push({ kind: 'TASK', body: 'Persist preference across sessions', destination: proj + ' › TASKS', reasoning: 'Dependent step extracted', confidence: 91 });
    if (/logo|glow|design|color|screen|animate/.test(l)) out.push({ kind: 'DESIGN', body: 'Visual concept -> Studio canvas', destination: 'DESIGN STUDIO › ' + proj, reasoning: 'Visual language detected', confidence: 88 });
    if (/bug|fix|broken|crash/.test(l)) out.push({ kind: 'BUG', body: v, destination: 'BUG TRACKER › ' + proj, reasoning: 'Defect language detected', confidence: 95 });
    if (/what if|idea|maybe/.test(l)) out.push({ kind: 'IDEA', body: v, destination: proj + ' › NOTES', reasoning: 'Speculative phrasing preserved', confidence: 84 });
    if (!out.length) out.push({ kind: 'NOTE', body: v, destination: proj + ' › NOTES', reasoning: 'Stored — Core will relate it later', confidence: 78 });
    out.push({ kind: 'EDGE', body: 'Relates to: "Cyberpunk theme" (Sprint 001)', destination: 'NEURAL CORE › RELATIONSHIPS', reasoning: 'Memory Vault recall', confidence: 90 });
    setPieces(out);
    setChanged(new Set());
  }

  async function commitCap() {
    const v = raw.trim();
    if (!pieces) return;
    setCaps((c) => [{ text: v, kind: null, icon: 'xai', meta: 'DISSECTED', metaCount: pieces.length, time: 'SENDING…' }, ...c]);
    setPieces(null);
    setRaw('');
    try {
      const result = await liveClassify(v);
      playSound('capture');
      const first = result.nodes?.[0];
      setCaps((c) =>
        c.map((entry, i) =>
          i === 0 && entry.time === 'SENDING…'
            ? first
              ? {
                  ...entry,
                  meta: first.kind.toUpperCase().replace('_', ' '),
                  time: 'JUST NOW',
                  timeIcon: 'check' as IconName,
                  linked: first.relationships?.length ? `LINKED TO ${first.relationships.length} NODE${first.relationships.length > 1 ? 'S' : ''}` : undefined,
                }
              : { ...entry, time: 'JUST NOW', timeIcon: 'check' as IconName }
            : entry,
        ),
      );
    } catch (err) {
      console.error('commitCap: liveClassify failed, writing via offline fallback', err);
      try {
        const { queued } = await commitOrQueue(v);
        playSound(queued ? 'notice' : 'capture');
        setCaps((c) =>
          c.map((entry, i) =>
            i === 0 && entry.time === 'SENDING…'
              ? { ...entry, time: queued ? 'QUEUED — will sync when reconnected' : 'JUST NOW (offline mock)', timeIcon: (queued ? 'xai' : 'check') as IconName }
              : entry,
          ),
        );
      } catch (fallbackErr) {
        console.error('commitCap: offline fallback also failed', fallbackErr);
        playSound('error');
        setCaps((c) => c.map((entry, i) => (i === 0 && entry.time === 'SENDING…' ? { ...entry, time: 'NOT SAVED — retry later', timeIcon: 'warning' as IconName } : entry)));
      }
    }
  }

  return (
    <section className={`room ambient ${active ? 'on' : ''}`} id="r-capture">
      <AmbientField mood="cyan" density={30} active={active} parallax />
      <ShipAmbience kind="comet" active={active} />
      <div className="roomInner">
      <h2 className="rh">
        <Icon name="neuralCapture" size={16} /> NEURAL CAPTURE
        {isTauri() && (
          <span className="popOutBtn" onClick={openCaptureWidget} title="Open as a floating window">
            <Icon name="externalLink" size={12} /> POP OUT
          </span>
        )}
      </h2>
      <div className="rsub">DON'T ORGANIZE. JUST THINK. THE CORE DISSECTS EVERYTHING.</div>
      <div className="gpanel" id="mouth">
        <textarea
          id="raw"
          placeholder='Try: "I want a dark mode for StudyHive — toggle in settings, remember the choice, and the logo should glow when it&apos;s on"'
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
        <div className="bar">
          <button id="voice" className={rec ? 'rec' : ''} onClick={toggleVoice}>
            <Icon name="mic" size={16} />
          </button>
          <div id="wave" className={rec ? 'on' : ''}>
            {bars.map((h, i) => (
              <i key={i} style={{ height: h + '%' }} />
            ))}
          </div>
          <button id="capSend" onClick={dissect}>
            CAPTURE <Icon name="xai" size={13} glow="cyan" />
          </button>
        </div>
      </div>
      {pieces && (
        <div style={{ marginTop: 20 }}>
          <div className="rsub" style={{ marginBottom: 10 }}>
            <Icon name="xai" size={12} glow="cyan" /> CORE DISSECTION — "{raw.slice(0, 60)}
            {raw.length > 60 ? '…' : ''}"
          </div>
          {pieces.map((p, i) => (
            <div className="piece" key={i} style={{ animationDelay: `${i * 0.15}s` }}>
              <div className="kind">
                <Icon name={PIECE_ICON[p.kind] ?? 'circle'} size={12} /> {p.kind}
                <span style={{ color: 'var(--text-dim)' }}>CONF {p.confidence}%</span>
              </div>
              <div className="body">{p.body}</div>
              <div className="route">
                <span className="dest">
                  <Icon name="arrowRight" size={11} /> {p.destination}
                </span>
                <span className="why">{p.reasoning}</span>
                <span
                  className="fix"
                  style={changed.has(i) ? { color: 'var(--amber)' } : undefined}
                  onClick={() => setChanged((s) => new Set(s).add(i))}
                >
                  {changed.has(i) ? (
                    <>
                      <Icon name="check" size={11} /> RETRAINED
                    </>
                  ) : (
                    'CHANGE'
                  )}
                </span>
              </div>
            </div>
          ))}
          <button className="bigbtn" style={{ margin: '6px 0 22px' }} onClick={commitCap}>
            COMMIT ALL TO CORE <Icon name="chevronRight" size={13} />
          </button>
        </div>
      )}
      <h2 className="rh" style={{ fontSize: 11, marginTop: 26 }}>
        RECENT CAPTURES
      </h2>
      <div id="caps">
        {visibleCaps.length === 0 && (
          <div className="rsub" style={{ fontSize: 9 }}>
            No captures yet — type a thought above and hit CAPTURE to begin.
          </div>
        )}
        {visibleCaps.map((c, i) => (
          <div className="cap" key={i}>
            "{c.text}"
            <div className="meta">
              <b>
                <Icon name={c.icon} size={12} glow={c.icon === 'xai' ? 'cyan' : 'none'} /> {c.meta}
                {c.metaCount !== undefined && (
                  <>
                    {' '}
                    <Icon name="arrowRight" size={11} /> {c.metaCount} NODES
                  </>
                )}
              </b>
              <span>
                {c.kind && capDest[c.kind] && (
                  <>
                    <Icon name="arrowRight" size={11} /> {capDest[c.kind]}
                  </>
                )}
              </span>
              {c.linked && (
                <span style={{ color: 'var(--cyan)' }}>
                  <Icon name="xai" size={11} glow="cyan" /> {c.linked}
                </span>
              )}
              <span style={{ color: 'var(--cyan)' }}>
                <Icon name={c.timeIcon ?? 'check'} size={11} /> {c.time}
              </span>
            </div>
          </div>
        ))}
      </div>
      </div>
    </section>
  );
}
