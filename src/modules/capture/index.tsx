import { useEffect, useMemo, useRef, useState } from 'react';
import type { DissectedPiece, NodeKind } from '../../core/types';
import { commitOrQueue } from '../../lib/offlineSync';
import { playSound } from '../../lib/sound';
import { isTauri } from '../../lib/localDb';
import { pushToast } from '../../stores/toastStore';
import Icon from '../../design-system/icons/Icon';
import type { IconName } from '../../design-system/icons/registry';
import AmbientField from '../../design-system/background/AmbientField';
import ShipAmbience from '../../design-system/background/ShipAmbience';
import { useCoreGraph } from '../../stores/coreGraph';

async function openCaptureWidget() {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_capture_widget');
}

/* ---- real Web Speech API dictation ---------------------------------
 * Minimal structural typings for the SpeechRecognition API — it's not
 * part of TS's DOM lib, and only Chromium ships it unprefixed (Safari/
 * Tauri's WebKit shell ship it as `webkitSpeechRecognition`, same prefix
 * pattern already handled for AudioContext in modules/focus/index.tsx).
 * No fabricated fallback transcript anymore — unsupported browsers get a
 * toast, not a fake canned sentence pretending to be a transcription. */
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike extends ArrayLike<SpeechRecognitionAlternativeLike> {
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Real destination picker: which section a piece kind files into within
 * its target project — paired with the project name to build the same
 * "PROJECT › SECTION" / "BUG TRACKER › PROJECT" strings the room always
 * rendered, just derived instead of frozen at dissect() time so re-picking
 * a project actually updates what's shown. */
function sectionFor(kind: string): string {
  if (kind === 'TASK') return 'TASKS';
  if (kind === 'DESIGN') return 'DESIGN';
  if (kind === 'BUG') return 'BUGS';
  return 'NOTES';
}
function pieceDestination(kind: string, projectName: string | null): string {
  const proj = projectName ?? 'UNASSIGNED';
  if (kind === 'BUG') return `BUG TRACKER › ${proj}`;
  if (kind === 'DESIGN') return `DESIGN STUDIO › ${proj}`;
  return `${proj} › ${sectionFor(kind)}`;
}
const PIECE_KIND_TO_NODE_KIND: Record<string, NodeKind> = {
  TASK: 'task',
  DESIGN: 'design',
  BUG: 'bug',
  IDEA: 'idea',
  NOTE: 'note',
};

interface CapEntry {
  text: string;
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
};

export default function Capture({ active }: { active: boolean }) {
  const [raw, setRaw] = useState('');
  const [rec, setRec] = useState(false);
  const [bars, setBars] = useState<number[]>(Array(26).fill(20));
  const [pieces, setPieces] = useState<DissectedPiece[] | null>(null);
  const [caps, setCaps] = useState<CapEntry[]>([]);
  const wavT = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [changed, setChanged] = useState<Set<number>>(new Set());
  const [pickerOpen, setPickerOpen] = useState<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const nodes = useCoreGraph((s) => s.nodes);
  const projects = useCoreGraph((s) => s.projects);
  const commitCaptureNodes = useCoreGraph((s) => s.commitCaptureNodes);
  const realCaps: CapEntry[] = useMemo(
    () =>
      nodes
        .filter((n) => n.source === 'capture_text')
        .slice()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10)
        .map((n) => ({
          text: n.title || n.body || '(empty capture)',
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

  // Real dictation cleanup — stop any live recognition + waveform interval
  // if the room unmounts (or goes inactive) mid-recording, matching the
  // audio-context cleanup convention in modules/focus/index.tsx.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      clearInterval(wavT.current);
    };
  }, []);

  function stopWaveform() {
    clearInterval(wavT.current);
    setBars(Array(26).fill(20));
  }

  /** Real Web Speech API dictation — no more fake 2.6s timeout + a hardcoded
   * canned sentence. Click mic: starts continuous, interim-results speech
   * recognition and live-appends real transcribed text into `raw` as the
   * Captain talks. Click again (or a recognition-ending event) stops it.
   * The animated bar waveform stays a decorative "recording…" cue (same
   * ambient-flourish precedent as Focus's warp starfield) — it was never
   * claiming to be a literal audio-level meter, so it's left as-is; what's
   * fixed is that the actual dictated text is now real. */
  function toggleVoice() {
    if (rec) {
      recognitionRef.current?.stop();
      return; // onend below flips `rec` false and stops the waveform
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      pushToast('Voice dictation is not supported in this browser', 'warn');
      return;
    }
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    const base = raw.trim() ? raw.trim() + ' ' : '';
    let finalText = base;
    recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) finalText += transcript + ' ';
        else interim += transcript;
      }
      setRaw((finalText + interim).trim());
    };
    recognition.onerror = (e) => {
      console.error('SpeechRecognition error', e.error);
      if (e.error !== 'no-speech') pushToast(`Voice dictation stopped — ${e.error}`, 'warn');
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setRec(false);
      stopWaveform();
    };
    recognitionRef.current = recognition;
    recognition.start();
    setRec(true);
    wavT.current = setInterval(() => setBars(Array.from({ length: 26 }, () => 10 + Math.random() * 85)), 110);
  }

  /** Real destination picker: guesses one of the Captain's actual projects
   * by matching its name/slug against the thought's text (was: 4 hardcoded
   * project names — "STUDYHIVE"/"NOVEL"/"MUSIC"/"WEBSITE" — that may not
   * even exist in this Captain's account), falling back to their first
   * project, or unassigned if they have none yet. */
  function guessProject(l: string): { id: string; name: string } | null {
    for (const p of projects) {
      if (l.includes(p.name.toLowerCase()) || l.includes(p.slug.toLowerCase())) return { id: p.id, name: p.name };
    }
    return projects[0] ? { id: projects[0].id, name: projects[0].name } : null;
  }

  function dissect() {
    const v = raw.trim();
    if (!v) return;
    const l = v.toLowerCase();
    const guess = guessProject(l);
    const projectId = guess?.id ?? null;
    const projectName = guess?.name ?? null;
    const out: DissectedPiece[] = [];
    const push = (kind: string, body: string, reasoning: string, confidence: number) =>
      out.push({ kind, body, destination: pieceDestination(kind, projectName), reasoning, confidence, projectId });
    // These used to push canned generic body text ("Implement: core feature
    // from thought", "Persist preference across sessions", "Visual concept
    // -> Studio canvas") regardless of what the Captain actually typed —
    // fabricated content standing in for a real extract. Every branch now
    // files the Captain's real words; `reasoning` still explains why the
    // rule matched, which is genuinely about the match, not the content.
    if (/toggle|add|build|implement|want|feature|mode/.test(l)) push('TASK', v, 'Action verb + scope detected', 96);
    if (/remember|persist|save|choice/.test(l)) push('TASK', v, 'Dependent step extracted', 91);
    if (/logo|glow|design|color|screen|animate/.test(l)) push('DESIGN', v, 'Visual language detected', 88);
    if (/bug|fix|broken|crash/.test(l)) push('BUG', v, 'Defect language detected', 95);
    if (/what if|idea|maybe/.test(l)) push('IDEA', v, 'Speculative phrasing preserved', 84);
    if (!out.length) push('NOTE', v, 'Stored — Core will relate it later', 78);
    setPieces(out);
    setChanged(new Set());
    setPickerOpen(null);
  }

  /** Commits exactly what the Captain reviewed — including any destination
   * they re-picked below — as real nodes. Deliberately does NOT re-run the
   * raw text through liveClassify() here: that would silently re-derive its
   * own breakdown from scratch and throw away every edit just made in the
   * review step, which was the actual bug behind "the destination picker
   * doesn't do anything." (liveClassify's real Claude-backed classification
   * is still very much live — Neural Core's capture flow still uses it —
   * this room's flow is just "review a proposal, then commit it as-is.") */
  async function commitCap() {
    if (!pieces || !pieces.length) return;
    const v = raw.trim();
    const items = pieces.map((p) => ({
      kind: PIECE_KIND_TO_NODE_KIND[p.kind] ?? 'note',
      title: p.body.length > 80 ? p.body.slice(0, 77) + '…' : p.body,
      body: p.body,
      projectId: p.projectId ?? null,
      confidence: p.confidence / 100,
      reasoning: p.reasoning,
    }));
    setCaps((c) => [{ text: v, icon: 'xai', meta: 'DISSECTED', metaCount: pieces.length, time: 'SENDING…' }, ...c]);
    setPieces(null);
    setRaw('');
    try {
      await commitCaptureNodes(items);
      playSound('capture');
      setCaps((c) => c.map((entry, i) => (i === 0 && entry.time === 'SENDING…' ? { ...entry, time: 'JUST NOW', timeIcon: 'check' as IconName } : entry)));
    } catch (err) {
      console.error('commitCap: direct node write failed, falling back to offline queue', err);
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
                {pickerOpen === i ? (
                  <select
                    autoFocus
                    value={p.projectId ?? ''}
                    onChange={(e) => {
                      const val = e.target.value || null;
                      const projName = val ? (projects.find((pr) => pr.id === val)?.name ?? null) : null;
                      setPieces((cur) =>
                        cur ? cur.map((pc, idx) => (idx === i ? { ...pc, projectId: val, destination: pieceDestination(pc.kind, projName) } : pc)) : cur,
                      );
                      setChanged((s) => new Set(s).add(i));
                      setPickerOpen(null);
                    }}
                    onBlur={() => setPickerOpen(null)}
                  >
                    <option value="">UNASSIGNED</option>
                    {projects.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.name.toUpperCase()}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="fix" style={changed.has(i) ? { color: 'var(--amber)' } : undefined} onClick={() => setPickerOpen(i)}>
                    {changed.has(i) ? (
                      <>
                        <Icon name="check" size={11} /> RE-ROUTED
                      </>
                    ) : (
                      'CHANGE'
                    )}
                  </span>
                )}
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
