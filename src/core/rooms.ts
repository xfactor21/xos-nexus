import type { RoomId } from '../stores/uiStore';
import type { IconName } from '../design-system/icons/registry';

export interface RoomMeta {
  id: RoomId;
  icon: IconName;
  name: string;
  section: 'FLOW' | 'SYSTEMS';
}

/** Nav order + grouping — ported 1:1 from xos-prototype.html's #sb markup.
 * Amendment v0.6 step 1: icons are IconName keys into the shared
 * design-system Icon registry, not raw emoji — this is the single source
 * both the sidebar (rebuilt as a neural spine in step 2) and any other
 * room-icon call site reads from. */
export const ROOMS: RoomMeta[] = [
  { id: 'obs', icon: 'observatory', name: 'OBSERVATORY', section: 'FLOW' },
  { id: 'core', icon: 'neuralCore', name: 'NEURAL CORE', section: 'FLOW' },
  { id: 'capture', icon: 'neuralCapture', name: 'NEURAL CAPTURE', section: 'FLOW' },
  { id: 'projects', icon: 'projects', name: 'PROJECTS', section: 'FLOW' },
  { id: 'focus', icon: 'focusTime', name: 'FOCUS TIME', section: 'FLOW' },
  { id: 'studio', icon: 'designStudio', name: 'DESIGN STUDIO', section: 'FLOW' },
  { id: 'roadmaps', icon: 'roadmaps', name: 'ROADMAPS', section: 'FLOW' },
  { id: 'bugs', icon: 'bugTracker', name: 'BUG TRACKER', section: 'FLOW' },
  { id: 'releases', icon: 'releases', name: 'RELEASES', section: 'FLOW' },
  { id: 'vault', icon: 'memoryVault', name: 'MEMORY VAULT', section: 'SYSTEMS' },
  { id: 'comms', icon: 'comms', name: 'COMMS', section: 'SYSTEMS' },
  // Step 7: three new rooms, desktop-first, added after the cockpit
  // redesign — grouped under SYSTEMS alongside Vault/Comms/Settings since
  // they're ship-utility surfaces rather than FLOW's thought-capture loop.
  { id: 'browser', icon: 'browser', name: 'BROWSER', section: 'SYSTEMS' },
  { id: 'knowledge', icon: 'knowledgeMatrix', name: 'KNOWLEDGE MATRIX', section: 'SYSTEMS' },
  { id: 'terminal', icon: 'terminal', name: 'TERMINAL', section: 'SYSTEMS' },
  { id: 'settings', icon: 'settings', name: 'SETTINGS', section: 'SYSTEMS' },
];

export const ROOM_NAME: Record<RoomId, string> = Object.fromEntries(ROOMS.map((r) => [r.id, r.name])) as Record<
  RoomId,
  string
>;

/** xAI dock copy per room — ported verbatim from the prototype's dockContent map. */
export const DOCK_CONTENT: Record<RoomId, { tip?: string; body: string }[]> = {
  obs: [{ body: 'This is your universe. Stars are nodes, constellations are projects. Website is dimming — 6 days dark.' }, { body: 'Try: switch views, tap stars, drift and zoom.' }],
  core: [{ body: 'The Core is alive — every element of your work swirling in one mass. Feed it a thought below and watch the routing.' }],
  capture: [{ body: 'Compound thoughts dissect into multiple nodes. Tap CHANGE on any routing to retrain me.' }],
  projects: [{ body: 'Dark-mode cluster forming in StudyHive — 3 nodes today.' }, { body: 'Warning: Bug #17 blocks the onboarding demo. Fix attached.' }],
  focus: [{ body: 'State an intent. I hold captures during the session so you stay locked in.' }, { body: 'Recall: your best sessions are 50-min StudyHive blocks.' }],
  studio: [{ body: '"Logo glow" capture routed here. Frame "Onboarding 01" is affected by bug #16.' }],
  roadmaps: [{ body: 'Position: Mid-Sprint 002. One goal remains: the shell decision.' }],
  bugs: [{ body: '#17 is 92% similar to solved #14 — fix attached. #15 could bundle with a Website revival.' }],
  releases: [{ body: 'History: Two tagged releases. v0.5.0 tags when you approve this build.' }],
  vault: [{ body: 'Memory: 147 nodes retained. Most-recalled: the bee mascot decision.' }],
  comms: [{ body: 'Channel: Ask me about bugs, projects, memories, or the roadmap.' }],
  browser: [{ body: 'Bring back what you find — ADD TO MATRIX saves a page for offline recall, fully wired into the graph.' }],
  knowledge: [{ body: 'Every saved page becomes a node — I link it to whatever it relates to, same as any capture.' }],
  terminal: [{ body: 'A real Node + Python runtime, right here. I’ll never run a command without you confirming it first.' }],
  settings: [{ body: 'Autonomy: I currently SUGGEST. Promote me when you trust the routing.' }],
};
