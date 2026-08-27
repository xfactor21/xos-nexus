import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { XAIAuto, useXAI } from './xai/xAIController-FINAL';
import XaiChatWindow from './XaiChatWindow';

/**
 * Amendment v1.0 — real, face-expressive xAI character. Replaces the old
 * gyroscope-orb-only hologram (design-system/cockpit/XaiHologram.tsx,
 * deleted) AND its floating caption popup entirely; neither exists anywhere
 * in the codebase anymore. Package files (xAI.jsx / xAIController-FINAL.jsx
 * / xAIWidget.jsx under ./xai/) are the Captain-verified drop-in as
 * delivered — not re-derived, per the integration brief.
 *
 * Mounted once inside <XAIProvider> in Shell.tsx, same persistent
 * bottom-right position the old hologram occupied (.xaiChar in
 * design-system.css) — fixed, survives room swaps, visible in every room.
 *
 * Bug-fix pass: the first cut clipped the character (scale was bumped 2-3x
 * without enlarging the container/camera framing to match) — rings extended
 * past the canvas edge and read as "rotation isn't working" because most of
 * the rotating geometry was invisible. Fixed by pulling the camera back
 * AND growing the container together, verified empirically via screenshots
 * (not just widened until it "should" fit) — see the room-verification pass
 * that shipped alongside this fix.
 */

/** The bare Canvas + lights + character, no fixed positioning or trigger
 * wiring — reused by both Shell's persistent corner presence (below) and
 * Onboarding's Flight Simulator hologram slot (Onboarding.tsx), which needs
 * the same verified character in a completely different container/position. */
export function XaiCharacterCanvas({ scale = 0.85 }: { scale?: number }) {
  // Camera distance is DERIVED from `scale`, not a fixed magic number, so
  // whatever `scale` a caller passes always gets a properly-fitted frame.
  // (Bug-fix history: an earlier pass hardcoded camera z=6.2 and verified
  // clipping against that value, but Shell.tsx actually renders scale={1.6}
  // -- a mismatch between what was tested and what shipped, which is why
  // the "fixed" clipping bug was still visible in production. Deriving the
  // distance from the real prop closes that gap for every call site.)
  //
  // Character's max radius at scale=1 is the outer ring's torus radius +
  // tube (~1.92 + 0.19 ≈ 2.11) with a small buffer for the sparkle field
  // (~2.3). At vertical fov=50°, half the visible height at distance d is
  // d * tan(25°) ≈ d * 0.4663. Solving for a ~55% safety margin over the
  // character's radius: d ≈ 3.0 * radius * scale.
  const cameraZ = 6.9 * scale;
  return (
    <Canvas camera={{ position: [0, 0.35 * scale, cameraZ], fov: 50 }} dpr={[1, 2]} gl={{ alpha: true }}>
      <ambientLight intensity={0.6} />
      <pointLight position={[5, 5, 5]} intensity={2} color="#00D4FF" />
      <pointLight position={[-5, -3, -4]} intensity={1.2} color="#7A5CFF" />
      <XAIAuto scale={scale} />
    </Canvas>
  );
}

/** Bridges real app events into setAiStatus(). Only the classify-capture
 * lifecycle is wired right now (see copilotClient.ts's xaiThinking/
 * xaiSuccess/xaiError dispatches, fired from liveClassify() and
 * saveKnowledgeSnapshot() — every real classify-capture call site: Neural
 * Core, Neural Capture, and Knowledge Matrix snapshots). The rest of
 * Amendment v0.9's trigger table (suggestion pending, project stale, daily
 * briefing, relationship discovery, etc.) is deliberately left unwired
 * until those systems exist as real product surfaces — not fabricated
 * ahead of time. success/error are transient (auto-revert to idle) since
 * they represent a single completed call, not a standing state.
 */
export function useXaiTriggerBridge() {
  // useXAI() resolves through the .jsx package's untyped createContext
  // default (allowJs infers `setAiStatus: () => void` from that default
  // value, not from the real implementation) — cast locally rather than
  // editing the verified drop-in package to satisfy TS.
  const { setAiStatus } = useXAI() as { setAiStatus: (status: string) => void };
  const revertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function clearRevert() {
      if (revertTimer.current) {
        clearTimeout(revertTimer.current);
        revertTimer.current = null;
      }
    }
    function scheduleRevert(ms: number) {
      clearRevert();
      revertTimer.current = setTimeout(() => setAiStatus('idle'), ms);
    }
    function onThinking() {
      clearRevert();
      setAiStatus('thinking');
    }
    function onSuccess() {
      setAiStatus('success');
      scheduleRevert(4000);
    }
    function onError() {
      setAiStatus('error');
      scheduleRevert(4000);
    }
    function onGreeting() {
      clearRevert();
      setAiStatus('greeting');
      scheduleRevert(4500);
    }
    window.addEventListener('xos-xai-thinking', onThinking);
    window.addEventListener('xos-xai-success', onSuccess);
    window.addEventListener('xos-xai-error', onError);
    window.addEventListener('xos-xai-greeting', onGreeting);
    return () => {
      clearRevert();
      window.removeEventListener('xos-xai-thinking', onThinking);
      window.removeEventListener('xos-xai-success', onSuccess);
      window.removeEventListener('xos-xai-error', onError);
      window.removeEventListener('xos-xai-greeting', onGreeting);
    };
  }, [setAiStatus]);
}

/** Item #3 — short, status-tied proactive lines. NOT a resurrection of the
 * old always-open #dock "tips" panel (that was permanent, unrelated text
 * sitting behind the character) — this is a small transient bubble that
 * only appears while status is non-idle, keyed off the exact same
 * setAiStatus() lifecycle #4's chat window and the classify-capture pipeline
 * already drive, so it's genuinely tied to what xAI is doing, not decorative
 * copy running on its own timer. */
const STATUS_LINES: Record<string, string> = {
  greeting: 'Good to see you, Captain.',
  thinking: 'Analyzing…',
  success: 'Got it — filed and linked.',
  error: "That didn't go through — want to try again?",
  chatting: "I'm listening.",
};

export default function XaiCharacter() {
  useXaiTriggerBridge();
  const { status } = useXAI() as { status: string };
  const [chatOpen, setChatOpen] = useState(false);

  // Fires once per app mount (real sign-in, not a demo timer loop) — the
  // one proactive line that isn't a reaction to something the Captain just
  // did, since nothing has happened yet at this point.
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('xos-xai-greeting')), 600);
    return () => clearTimeout(t);
  }, []);

  const line = STATUS_LINES[status];

  return (
    <>
      {/* Item #4 — tapping/clicking the character opens direct chat.
          pointer-events is re-enabled only on this element (the container's
          default in CSS is `none` so the character never eats clicks meant
          for whatever sits behind its 320x320 bounding box in a given
          room). */}
      <div
        className="xaiChar"
        style={{ pointerEvents: 'auto', cursor: 'pointer' }}
        role="button"
        aria-label="Open xAI chat"
        tabIndex={0}
        onClick={() => setChatOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setChatOpen((o) => !o);
          }
        }}
      >
        {line && !chatOpen && <div className={`xaiCaption xaiCaption-${status}`}>{line}</div>}
        {/* Captain feedback: character read as way too large. Container
            shrunk to ~65% (design-system.css .xaiChar 320px -> 210px);
            scale is derived the same proportion so the fitted framing
            (see cameraZ math above) stays correct instead of clipping. */}
        <XaiCharacterCanvas scale={1.6 * 0.656} />
      </div>
      <XaiChatWindow open={chatOpen} onClose={() => setChatOpen(false)} />
    </>
  );
}
