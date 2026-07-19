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

// NOTE: the old `DOCK_CONTENT` map (the #dock/#tgDock "xAI tips" panel's
// per-room copy) lived here and has been deliberately deleted, not just
// unused. It shared the xAI character's bottom-right corner and, being
// open by default, its text rendered directly behind the character —
// which is what read as "old caption text still peeking out" during
// review. See the removal note in Shell.tsx for the full DOM-verified
// investigation.
