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
 */

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
function useXaiTriggerBridge() {
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
      {/* Camera position/fov intentionally match the package's own verified
          reference setup (App-FINAL.jsx / xAIWidget.jsx: position [0,1.2,4.5],
          fov 50) — that's the framing the Captain's 14-state test pass ran
          against. Making the character bigger on screen comes from the
          container's CSS size (.xaiChar, ~2.9x the old orb's 58x68 footprint)
          plus a modest scale bump, not from blowing up scale alone — a much
          higher scale clips the model against the near plane at this camera
          distance instead of just "looking bigger". Verified via before/after
          screenshot (see verify_xai.mjs), not assumed. */}
      <Canvas camera={{ position: [0, 1.2, 4.5], fov: 50 }} dpr={[1, 2]} gl={{ alpha: true }}>
        <ambientLight intensity={0.6} />
        <pointLight position={[5, 5, 5]} intensity={2} color="#00D4FF" />
        <pointLight position={[-5, -3, -4]} intensity={1.2} color="#7A5CFF" />
        <XAIAuto scale={1.3} />
      </Canvas>
    </div>
  );
}
