import { useRef, useState } from 'react';
import type { DissectedPiece } from '../../core/types';
import { liveClassify } from '../../lib/copilotClient';
import { commitOrQueue } from '../../lib/offlineSync';
import Icon from '../../design-system/icons/Icon';
import type { IconName } from '../../design-system/icons/registry';
import AmbientField from '../../design-system/background/AmbientField';

// Amendment v0.6 step 1: "kind" strings used as both lookup keys and
// displayed labels no longer embed a glyph in the string itself — the
// glyph becomes an explicit `icon: IconName` looked up alongside the plain
// label, and renders via the shared Icon component at the JSX call site.
// Same fix pattern as core/mappers.ts and modules/projects/index.tsx.
type CapKind = 'IDEA' | 'BUG' | 'WRITING';

const CAP_ICON: Record<CapKind, IconName> = {
  IDEA: 'idea',
  BUG: 'bugTracker',
  WRITING: 'book',
};

const capDest: Record<CapKind, string> = {
  IDEA: 'DESIGN STUDIO › STUDYHIVE',
  BUG: 'BUG TRACKER › #17',
  WRITING: 'NOVEL › DRAFT NOTES',
};

interface CapEntry {
  text: string;
  /** Category key for the capDest lookup — null for transient system/status
   * rows (e.g. the "just dissected" entry written by commitCap) that were
   * never meant to match a destination. */
  kind: CapKind | null;
  /** Headline icon: the category icon for seeded entries, or `xai` for
   * AI/system-generated status rows. */
  icon: IconName;
  /** Headline label text (plain, no glyph). */
  meta: string;
  /** Optional trailing "→ N NODES" count rendered after meta. */
  metaCount?: number;
  /** Status text (plain, no glyph). */
  time: string;
  /** Icon shown before `time`; defaults to `check`. */
  timeIcon?: IconName;
  /** AI-detected relationship note (e.g. "LINKED TO SOLVED #14"), rendered
   * with the xai glyph when present. */
  linked?: string;
}

const seedCaps: CapEntry[] = [
  { text: 'Bee mascot should fly between onboarding steps', kind: 'IDEA', icon: CAP_ICON.IDEA, meta: 'IDEA', time: '2H AGO' },
  { text: 'fix the login redirect loop on mobile', kind: 'BUG', icon: CAP_ICON.BUG, meta: 'BUG', time: '5H AGO', linked: 'LINKED TO SOLVED #14' },
  { text: 'what if chapter 3 opens from the villain\'s POV', kind: 'WRITING', icon: CAP_ICON.WRITING, meta: 'WRITING', time: 'YESTERDAY' },
];

// dissect() heuristic piece kinds — plain labels now; icon looked up
// separately at render time so the "kind" string never carries a glyph.
const PIECE_ICON: Record<string, IconName> = {
  TASK: 'checkCircle',
  DESIGN: 'designStudio',
  BUG: 'bugTracker',
  IDEA: 'idea',
  NOTE: 'note',
  EDGE: 'link', // graph-relationship edge — not AI-branding, so `link` not `xai`
};

/** NEURAL CAPTURE — ported 1:1 from xos-prototype.html: textarea + simulated
 * voice waveform, dissect() keyword-based splitter, commitCap() logging. */
export default function Capture({ active }: { active: boolean }) {
  const [raw, setRaw] = useState('');
  const [rec, setRec] = useState(false);
  const [bars, setBars] = useState<number[]>(Array(26).fill(20));
  const [pieces, setPieces] = useState<DissectedPiece[] | null>(null);
  const [caps, setCaps] = useState(seedCaps);
  const wavT = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [changed, setChanged] = useState<Set<number>>(new Set());

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

  /** COMMIT — the dissect() preview above stays exactly as ported (same
   * keyword heuristic, same instant feedback — the interaction model isn't
   * being touched). Step 3 adds a real side effect underneath it: commit
   * now actually calls the classify-capture pipeline via liveClassify(), so
   * the thought becomes a real node the Captain's Realtime subscription
   * will pick up — satisfying the handoff's literal acceptance test
   * ("capture a thought in Neural Capture, watch it appear live in
   * Projects and the Observatory without a refresh"). */
  async function commitCap() {
    const v = raw.trim();
    if (!pieces) return;
    setCaps((c) => [{ text: v, kind: null, icon: 'xai', meta: 'DISSECTED', metaCount: pieces.length, time: 'SENDING…' }, ...c]);
    setPieces(null);
    setRaw('');
    try {
      const result = await liveClassify(v);
      setCaps((c) =>
        c.map((entry, i) =>
          i === 0 && entry.time === 'SENDING…'
            ? { ...entry, time: result.liveAI ? 'JUST NOW (xAI LIVE)' : 'JUST NOW (fallback mode)', timeIcon: 'check' as IconName }
            : entry,
        ),
      );
    } catch (err) {
      console.error('commitCap: liveClassify failed, writing via offline fallback', err);
      try {
        // Step 8: commitOrQueue is offlineCommit with one extra path — if
        // Supabase itself is unreachable (genuinely offline, not just "AI
        // unavailable") and we're running inside the packaged Tauri shell,
        // the capture is queued to local SQLite instead of failing, and
        // syncEngine drains it back to Supabase once the network returns.
        const { queued } = await commitOrQueue(v);
        setCaps((c) =>
          c.map((entry, i) =>
            i === 0 && entry.time === 'SENDING…'
              ? { ...entry, time: queued ? 'QUEUED — will sync when reconnected' : 'JUST NOW (offline mock)', timeIcon: (queued ? 'xai' : 'check') as IconName }
              : entry,
          ),
        );
      } catch (fallbackErr) {
        console.error('commitCap: offline fallback also failed', fallbackErr);
        setCaps((c) => c.map((entry, i) => (i === 0 && entry.time === 'SENDING…' ? { ...entry, time: 'NOT SAVED — retry later', timeIcon: 'warning' as IconName } : entry)));
      }
    }
  }

  return (
    <section className={`room ambient ${active ? 'on' : ''}`} id="r-capture">
      <AmbientField mood="cyan" density={30} active={active} parallax />
      <div className="roomInner">
      <h2 className="rh">
        <Icon name="neuralCapture" size={16} /> NEURAL CAPTURE
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
        {caps.map((c, i) => (
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
