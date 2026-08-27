import { useEffect, useState } from 'react';
import Icon from '../../design-system/icons/Icon';

/**
 * FeatureTour — separate from the 12-scene cinematic Onboarding (which
 * sells the *feeling* of xOS) and from the returning-Captain "ENTER xOS"
 * abbreviated replay. This is a plain, fast, skippable spotlight/tooltip
 * walkthrough that actually teaches the handful of features that are easy
 * to miss or non-obvious — most importantly Neural Core's drag/click
 * interactivity added alongside this component, since there's no other
 * affordance in the UI hinting that nodes are draggable or clickable.
 *
 * Shown once: after the cinematic completes for brand-new Captains, or on
 * next load for existing Captains who signed up before this tour existed
 * (both cases are the same "!has_seen_feature_tour" condition — see
 * App.tsx). Tracked via authStore.markFeatureTourComplete, mirroring
 * markOnboardingComplete's user_metadata pattern exactly.
 *
 * Deliberately NOT a spotlight-over-real-DOM implementation (which would
 * need to know Shell's exact room layout, ref-forward every target element,
 * and re-measure on resize/room-change) — that's a much larger, riskier
 * change for a "explain the features" tour. Instead each step is a single
 * centered card describing one feature with a small illustrative icon,
 * shown over a dim scrim — same trade real product tours (e.g. a v1 tour)
 * make before investing in true element-anchored spotlights.
 */

type Step = {
  icon: Parameters<typeof Icon>[0]['name'];
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    icon: 'neuralCapture',
    title: 'Neural Core is interactive',
    body: 'Drag any node to reposition it — the lines connecting it to other nodes follow along. Drop two nodes near each other to group them. Click a node (without dragging) to open its details: rename it, edit tags, and manage its associations.',
  },
  {
    icon: 'xai',
    title: 'xAI chat asks before it acts',
    body: 'Type a thought into the Core capture bar and xAI classifies it live. Anything it wants to file gets confirmed with you first — nothing lands in your graph without a Yes.',
  },
  {
    icon: 'neuralCapture',
    title: 'Capture anything, instantly',
    body: 'Capture is the fastest way to get a thought out of your head and into xOS — it gets classified and routed to the right project automatically.',
  },
  {
    icon: 'projects',
    title: 'Projects keep your universe organized',
    body: 'Every project you create becomes a node on the Neural Core ring, and everything you capture gets linked to one.',
  },
  {
    icon: 'bugTracker',
    title: 'Bug Tracker learns from you',
    body: 'Severity, assignee, and duplicates are editable — and every correction you make helps xAI classify future captures more accurately.',
  },
  {
    icon: 'memoryVault',
    title: 'Memory Vault remembers the important stuff',
    body: 'Promote a memory straight to a Roadmap milestone when it turns out to matter.',
  },
  {
    icon: 'chevronRight',
    title: "Cmd/Ctrl+K from anywhere in the Core",
    body: 'Jump straight to any room without touching your mouse — the command palette is always one keystroke away while the Core is open.',
  },
];

export default function FeatureTour({ onComplete }: { onComplete: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onComplete();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') setI((v) => Math.min(v + 1, STEPS.length - 1));
      else if (e.key === 'ArrowLeft') setI((v) => Math.max(v - 1, 0));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div id="tourOverlay" role="dialog" aria-modal="true">
      <div id="tourCard">
        <div id="tourSkip" onClick={onComplete}>
          SKIP TOUR
        </div>
        <div id="tourIcon">
          <Icon name={step.icon} size={28} glow="cyan" />
        </div>
        <h2 id="tourTitle">{step.title}</h2>
        <p id="tourBody">{step.body}</p>
        <div id="tourDots">
          {STEPS.map((_, idx) => (
            <span key={idx} className={`tourDot ${idx === i ? 'on' : ''}`} onClick={() => setI(idx)} />
          ))}
        </div>
        <div id="tourNav">
          <button id="tourBack" disabled={i === 0} onClick={() => setI((v) => Math.max(v - 1, 0))}>
            <Icon name="back" size={12} /> BACK
          </button>
          <button
            id="tourNext"
            onClick={() => {
              if (last) onComplete();
              else setI((v) => Math.min(v + 1, STEPS.length - 1));
            }}
          >
            {last ? 'FINISH' : 'NEXT'} <Icon name="chevronRight" size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
