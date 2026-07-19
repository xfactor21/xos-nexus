import { useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { XAIAuto, useXAI } from './xai/xAIController-FINAL';

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
    window.addEventListener('xos-xai-thinking', onThinking);
    window.addEventListener('xos-xai-success', onSuccess);
    window.addEventListener('xos-xai-error', onError);
    return () => {
      clearRevert();
      window.removeEventListener('xos-xai-thinking', onThinking);
      window.removeEventListener('xos-xai-success', onSuccess);
      window.removeEventListener('xos-xai-error', onError);
    };
  }, [setAiStatus]);
}

export default function XaiCharacter() {
  useXaiTriggerBridge();

  return (
    <div className="xaiChar" aria-hidden="true">
      <XaiCharacterCanvas scale={1.6} />
    </div>
  );
}
