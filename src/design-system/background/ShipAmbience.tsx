import { useEffect, useMemo, useState } from 'react';
import { useUiStore } from '../../stores/uiStore';

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
 */

export type ShipAmbienceKind = 'comet' | 'lights' | 'terminal';
type Corner = 'tl' | 'tr' | 'bl' | 'br';

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
  if (!enabled || reduceMotion || !active) return null;

  return (
    <div className="shipAmbience" aria-hidden="true">
      {kind === 'comet' && <Comet />}
      {kind === 'lights' && <ConsoleLights corner={corner} />}
      {kind === 'terminal' && <TinyTerminal corner={corner} />}
    </div>
  );
}

const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];

/** A streak that occasionally crosses the viewport corner-to-corner, then
 * waits a long, randomized gap before the next one — "occasionally passing
 * a window," not a constant background loop. Scheduling is plain JS
 * (setTimeout), not a long CSS keyframe animation with mostly-empty
 * percentages, so each pass genuinely randomizes both its entry corner and
 * the gap before the next one instead of looping a fixed pattern. */
function Comet() {
  const [pass, setPass] = useState<{ corner: Corner; key: number } | null>(null);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout>;
    let nextTimer: ReturnType<typeof setTimeout>;
    let key = 0;
    function schedule() {
      const gap = 15000 + Math.random() * 27000; // 15–42s between passes
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
  }, []);

  if (!pass) return null;
  return <span key={pass.key} className={`shipComet shipComet-${pass.corner}`} />;
}

/** A handful of console indicator lights blinking on independent,
 * randomized cycles — the "little blinking lights" ask, tucked in a corner
 * that stays clear of real UI (this whole layer sits behind `.roomInner`,
 * so it's only ever visible wherever a room doesn't already have opaque
 * content there). */
function ConsoleLights({ corner }: { corner: Corner }) {
  const lights = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => ({
        hue: (['cyan', 'magenta', 'purple', 'amber'] as const)[i % 4],
        delay: Math.random() * 4,
        dur: 1.6 + Math.random() * 2.4,
      })),
    [],
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

/** Flavor log lines only — decorative, never real telemetry, so this never
 * needs to be kept in sync with anything and can't be mistaken for the
 * actual Terminal room's real output. */
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

function TinyTerminal({ corner }: { corner: Corner }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % LOG_LINES.length), 3600);
    return () => clearInterval(id);
  }, []);
  return (
    <div className={`shipTerminal shipTerminal-${corner}`}>
      <span className="shipTerminalLine" key={idx}>
        {LOG_LINES[idx]}
        <i className="shipTerminalCursor" />
      </span>
    </div>
  );
}
