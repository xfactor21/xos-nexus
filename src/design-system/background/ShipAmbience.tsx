import { useEffect, useMemo, useState } from 'react';
import { useUiStore } from '../../stores/uiStore';
import { useCoreGraph } from '../../stores/coreGraph';
import { useCommsStore } from '../../stores/commsStore';
import { nodeToBug } from '../../core/mappers';

/**
 * SHIP AMBIENCE — Captain's ask: "various slight animations throughout the
 * program; each page could have something different... a comet occasionally
 * passing a window, or even just little blinking lights or seemingly active
 * terminals off on the side that look like it's part of a ship." Explicitly
 * requested LAST and explicitly required to be easy to back out of if it
 * doesn't land well.
 *
 * Two independent ways back out, by design:
 *  1. Settings > SHIP AMBIENCE toggle (uiStore.shipAmbience, persisted) —
 *     flips every room's decoration off instantly, no code change needed.
 *  2. This is one isolated component + one CSS block + a single call added
 *     to each room's render — reverting is a clean `git revert` of this
 *     commit with no entanglement in any room's real logic.
 *
 * Purely decorative: pointer-events:none, aria-hidden, renders into the same
 * z-index:0 layer AmbientField already established (behind `.roomInner`'s
 * z-index:1 — see design-system.css), so it can never sit on top of or
 * intercept clicks on real content. Also respects the existing Reduce
 * Motion setting (uiStore.reduceMotion) — skipped outright rather than
 * relying solely on the global `.force-reduce-motion` CSS override, so a
 * Captain with motion sensitivity doesn't even get the JS-driven comet
 * scheduling loop running in the background.
 *
 * Reactive condition (Tier 1 follow-up): the "ship" now reads real ship-wide
 * state — open critical bugs, stale projects, unread Comms threads — and
 * bumps to 'amber'/'red' accordingly. That condition biases the console
 * lights' color mix and blink speed and the comet's color and pass
 * frequency, so a Captain who's just glancing at the ambient decoration (not
 * actively reading a status panel) still picks up "something needs
 * attention" the way a real console's mood lighting would communicate it.
 * The tiny corner terminal goes one step further: instead of purely canned
 * flavor lines, it leads with real derived events (the loudest open
 * critical bug, the stalest project, unread comms, the most recent capture)
 * and only falls back to flavor lines to fill out the rotation.
 */

export type ShipAmbienceKind = 'comet' | 'lights' | 'terminal';
type Corner = 'tl' | 'tr' | 'bl' | 'br';
type Condition = 'green' | 'amber' | 'red';

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Derives the ship-wide condition and a short list of real event lines
 * from live app state. Computed once here (not per-consumer) even though
 * ShipAmbience itself is mounted once per room — every call site shares
 * the same `active` gate, and this hook short-circuits to near-zero work
 * for the (many) inactive instances via the `active` param. */
function useShipCondition(active: boolean): { condition: Condition; lines: string[] } {
  const nodes = useCoreGraph((s) => s.nodes);
  const projects = useCoreGraph((s) => s.projects);
  const unreadCount = useCommsStore((s) => s.unreadCount);

  return useMemo(() => {
    if (!active) return { condition: 'green' as Condition, lines: [] };

    const openCriticalBugs = nodes
      .filter((n) => n.kind === 'bug')
      .map(nodeToBug)
      .filter((b) => b.severity === 'critical' && b.bugStatus !== 'fixed')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const staleProjects = [...projects].filter((p) => p.isStale).sort((a, b) => b.idleDays - a.idleDays);

    const condition: Condition = openCriticalBugs.length > 0 ? 'red' : staleProjects.length > 0 || unreadCount > 0 ? 'amber' : 'green';

    const lines: string[] = [];
    if (openCriticalBugs[0]) lines.push(`bug: "${openCriticalBugs[0].title}" flagged critical`);
    if (staleProjects[0]) lines.push(`project: ${staleProjects[0].name} idle ${staleProjects[0].idleDays}d`);
    if (unreadCount > 0) lines.push(`comms: ${unreadCount} unread thread${unreadCount === 1 ? '' : 's'}`);
    const mostRecent = [...nodes].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    if (mostRecent) lines.push(`log: "${mostRecent.title}" captured ${relTime(mostRecent.created_at)}`);

    return { condition, lines };
  }, [active, nodes, projects, unreadCount]);
}

export default function ShipAmbience({
  kind,
  corner = 'br',
  active = true,
}: {
  kind: ShipAmbienceKind;
  corner?: Corner;
  active?: boolean;
}) {
  const enabled = useUiStore((s) => s.shipAmbience);
  const reduceMotion = useUiStore((s) => s.reduceMotion);
  const { condition, lines } = useShipCondition(active && enabled && !reduceMotion);
  if (!enabled || reduceMotion || !active) return null;

  return (
    <div className="shipAmbience" aria-hidden="true">
      {kind === 'comet' && <Comet condition={condition} />}
      {kind === 'lights' && <ConsoleLights corner={corner} condition={condition} />}
      {kind === 'terminal' && <TinyTerminal corner={corner} eventLines={lines} />}
    </div>
  );
}

const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];

/** A streak that occasionally crosses the viewport corner-to-corner, then
 * waits a long, randomized gap before the next one — "occasionally passing
 * a window," not a constant background loop. Scheduling is plain JS
 * (setTimeout), not a long CSS keyframe animation with mostly-empty
 * percentages, so each pass genuinely randomizes both its entry corner and
 * the gap before the next one instead of looping a fixed pattern.
 *
 * Under a non-green ship condition the pass rate quickens and the streak
 * itself reskins to a warning color — a Captain glancing at any room with a
 * comet still picks up "something's off" from the ambient motion alone. */
function Comet({ condition }: { condition: Condition }) {
  const [pass, setPass] = useState<{ corner: Corner; key: number } | null>(null);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout>;
    let nextTimer: ReturnType<typeof setTimeout>;
    let key = 0;
    function schedule() {
      const [minGap, spread] = condition === 'red' ? [6000, 10000] : condition === 'amber' ? [10000, 18000] : [15000, 27000];
      const gap = minGap + Math.random() * spread;
      nextTimer = setTimeout(() => {
        key += 1;
        setPass({ corner: CORNERS[Math.floor(Math.random() * CORNERS.length)], key });
        hideTimer = setTimeout(() => setPass(null), 1700);
        schedule();
      }, gap);
    }
    schedule();
    return () => {
      clearTimeout(nextTimer);
      clearTimeout(hideTimer);
    };
  }, [condition]);

  if (!pass) return null;
  return <span key={pass.key} className={`shipComet shipComet-${pass.corner} ${condition !== 'green' ? 'warn' : ''}`} />;
}

/** A handful of console indicator lights blinking on independent,
 * randomized cycles — the "little blinking lights" ask, tucked in a corner
 * that stays clear of real UI (this whole layer sits behind `.roomInner`,
 * so it's only ever visible wherever a room doesn't already have opaque
 * content there).
 *
 * The hue pool and blink speed both shift with the ship condition: green
 * cycles the full calm palette, amber leans warm, red leans hot and blinks
 * noticeably faster — mirroring how a real console's status lights would
 * read at a glance. */
const HUE_POOL: Record<Condition, readonly ('cyan' | 'magenta' | 'purple' | 'amber')[]> = {
  green: ['cyan', 'magenta', 'purple', 'amber'],
  amber: ['cyan', 'amber', 'purple', 'amber', 'magenta'],
  red: ['magenta', 'amber', 'magenta', 'cyan', 'magenta'],
};
const SPEED_RANGE: Record<Condition, [number, number]> = {
  green: [1.6, 2.4],
  amber: [1.2, 1.9],
  red: [0.7, 1.3],
};

function ConsoleLights({ corner, condition }: { corner: Corner; condition: Condition }) {
  const pool = HUE_POOL[condition];
  const [base, spread] = SPEED_RANGE[condition];
  const lights = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => ({
        hue: pool[i % pool.length],
        delay: Math.random() * 4,
        dur: base + Math.random() * spread,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [condition],
  );
  return (
    <div className={`shipLights shipLights-${corner}`}>
      {lights.map((l, i) => (
        <span
          key={i}
          className={`shipLight shipLight-${l.hue}`}
          style={{ animationDelay: `${l.delay}s`, animationDuration: `${l.dur}s` }}
        />
      ))}
    </div>
  );
}

/** Flavor log lines — filler only, used to pad out the rotation once real
 * derived events (passed in as `eventLines`) run out. Never mistaken for
 * the actual Terminal room's real output; a fresh workspace with no bugs,
 * no stale projects, and no unread comms just shows these on their own. */
const LOG_LINES = [
  'diag: coolant loop nominal',
  'sync: nav array 98.2%',
  'ping: relay 7 … ack',
  'buffer: telemetry flush ok',
  'scan: no anomalies',
  'link: subspace channel stable',
  'cache: warm',
  'watch: sensor sweep complete',
  'trim: attitude thrusters idle',
  'log: rotation complete',
];

function TinyTerminal({ corner, eventLines }: { corner: Corner; eventLines: string[] }) {
  const feed = useMemo(() => (eventLines.length ? [...eventLines, ...LOG_LINES] : LOG_LINES), [eventLines]);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
    const id = setInterval(() => setIdx((i) => (i + 1) % feed.length), 3600);
    return () => clearInterval(id);
  }, [feed]);
  return (
    <div className={`shipTerminal shipTerminal-${corner}`}>
      <span className="shipTerminalLine" key={idx}>
        {feed[idx]}
        <i className="shipTerminalCursor" />
      </span>
    </div>
  );
}
