import { create } from 'zustand';
import type {
  BugNode,
  MemoryRecord,
  MilestoneRecord,
  ProjectRecord,
  TaskNode,
} from '../core/types';

/**
 * coreGraph — the single source-of-truth store every room reads from.
 *
 * Step 3 of the handoff ("Wire Realtime + Zustand Across All Rooms") calls
 * for this store to be populated from Supabase and subscribed to Realtime
 * per project channel. That wiring is still open — see the session log —
 * but every room in this port already reads from *this* store rather than
 * local component state or hardcoded markup, so Step 3 becomes "swap the
 * seed calls for Supabase queries + a realtime subscription" instead of a
 * rewrite.
 */

const seedProjects: ProjectRecord[] = [
  { id: 'p-sh', slug: 'studyhive', name: 'StudyHive', icon: '🐝', status: 'active', health: 80, idleDays: 0 },
  { id: 'p-mu', slug: 'music', name: 'Music', icon: '🎵', status: 'active', health: 45, idleDays: 1 },
  { id: 'p-we', slug: 'website', name: 'Website', icon: '🌐', status: 'stale', health: 25, idleDays: 6 },
  { id: 'p-no', slug: 'novel', name: 'Novel', icon: '📖', status: 'active', health: 60, idleDays: 0 },
];

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${++uid}`;

const seedTasks: TaskNode[] = [
  mkTask('Implement dark mode toggle', 0, ['SPRINT 002', '◈ FROM CAPTURE']),
  mkTask('Persist theme preference', 0, ['◈ FROM CAPTURE']),
  mkTask('Fix login redirect loop (#17)', 1, ['BUG', '◈ FIX ATTACHED']),
  mkTask('Onboarding copy — 3 screens', 1, ['SPRINT 002']),
  mkTask('Splash screen v2', 2, ['SHIPPED']),
  mkTask('Bee mascot motion study', 2, ['◈ FROM CAPTURE']),
];
function mkTask(title: string, taskStatus: 0 | 1 | 2, tags: string[]): TaskNode {
  return {
    id: nextId('task'),
    owner_id: null,
    project_id: 'p-sh',
    kind: 'task',
    title,
    body: title,
    source: 'seed',
    ai_classified: tags.some((t) => t.includes('◈')),
    ai_confidence: 0.9,
    ai_reasoning: '',
    status: 'open',
    created_at: new Date().toISOString(),
    taskStatus,
    tags,
  };
}

const seedBugs: BugNode[] = [
  mkBug('#17 — Login redirect loop on mobile Safari', 'open', 'high', 'p-sh', {
    linkedCommit: null,
    duplicateOf: 'bug-solved-14',
    similarity: 0.92,
    assignee: null,
  }),
  mkBug('#16 — Subject chips overflow on small screens', 'open', 'medium', 'p-sh', {
    linkedCommit: null,
    duplicateOf: null,
    similarity: null,
    assignee: null,
  }),
  mkBug('#15 — Website contact form silent failure', 'open', 'low', 'p-we', {
    linkedCommit: null,
    duplicateOf: null,
    similarity: null,
    assignee: null,
  }),
  mkBug('#14 — OAuth token refresh failure', 'fixed', 'high', 'p-sh', {
    linkedCommit: 'a1b2c3d — token rotation on 401',
    duplicateOf: null,
    similarity: null,
    assignee: 'Captain',
  }),
];
function mkBug(
  title: string,
  bugStatus: 'open' | 'doing' | 'fixed',
  severity: BugNode['severity'],
  project_id: string,
  extra: Pick<BugNode, 'linkedCommit' | 'duplicateOf' | 'similarity' | 'assignee'>,
): BugNode {
  return {
    id: nextId('bug'),
    owner_id: null,
    project_id,
    kind: 'bug',
    title,
    body: title,
    source: 'seed',
    ai_classified: true,
    ai_confidence: 0.9,
    ai_reasoning: '',
    status: bugStatus === 'fixed' ? 'done' : bugStatus === 'doing' ? 'in_progress' : 'open',
    created_at: new Date().toISOString(),
    bugStatus,
    severity,
    ...extra,
  };
}

const seedMemories: MemoryRecord[] = [
  { id: 'm1', kind: 'decision', content: '"Bee mascot = brand anchor" — all StudyHive visual identity flows from this.', recalledCount: 2, linkedNodeCount: 6, createdLabel: 'SPRINT 001' },
  { id: 'm2', kind: 'learning', content: 'OAuth refresh fix pattern — token rotation on 401, documented in Auth Architecture.', recalledCount: 1, linkedNodeCount: 1, createdLabel: 'SPRINT 001' },
  { id: 'm3', kind: 'pattern', content: '"Dark aesthetics cluster" — 6 related nodes across StudyHive + xOS itself.', recalledCount: 0, linkedNodeCount: 6, createdLabel: 'DETECTED TODAY' },
  { id: 'm4', kind: 'decision', content: 'Observatory becomes the landing experience; Neural Core hub is the navigator.', recalledCount: 0, linkedNodeCount: 0, createdLabel: 'SPRINT 002' },
  { id: 'm5', kind: 'pattern', content: 'Best focus sessions: 50-minute StudyHive blocks in the evening.', recalledCount: 3, linkedNodeCount: 0, createdLabel: 'THIS MONTH' },
];

const seedMilestones: MilestoneRecord[] = [
  {
    id: 'v0.1.0', version: 'v0.1.0', title: 'FOUNDATION', statusLabel: '✓ SHIPPED · SPRINT 001', state: 'shipped',
    releaseDate: '2026-06-20', order: 0,
    items: [
      { label: 'Boot screen · dashboard · sidebar', done: true },
      { label: 'Neural Core · xAI panel · mission cards', done: true },
      { label: 'Cyberpunk theme', done: true },
    ],
  },
  {
    id: 'v0.5.0', version: 'v0.5.0', title: 'ROOMS ONLINE', statusLabel: '▸ CURRENT · SPRINT 002', state: 'current',
    releaseDate: '2026-07-15', order: 1,
    items: [
      { label: 'Supabase Neural Core schema', done: true },
      { label: 'Notion Docs HQ', done: true },
      { label: 'Observatory + Awakening sequence', done: true },
      { label: 'Living Core redesign', done: true },
      { label: 'Shell decision: Electron vs Tauri', done: false },
    ],
  },
  {
    id: 'v0.7.0', version: 'v0.7.0', title: 'INTELLIGENCE', statusLabel: 'SPRINT 003–004', state: 'future',
    releaseDate: '2026-08-15', order: 2,
    items: [
      { label: 'Live AI classification (Claude API)', done: false },
      { label: 'Suggestion engine + Memory Vault (real)', done: false },
      { label: 'Cloud sync · StudyHive managed for real', done: false },
    ],
  },
  {
    id: 'v1.0.0', version: 'v1.0.0', title: 'THE SHIP FLIES', statusLabel: 'FUTURE', state: 'future',
    releaseDate: null, order: 3,
    items: [
      { label: 'Constellations form emergent shapes (bee, guitar…)', done: false },
      { label: 'Full Design Studio toolset', done: false },
      { label: 'Mobile OS territory · public release', done: false },
    ],
  },
];

interface CoreGraphState {
  projects: ProjectRecord[];
  tasks: TaskNode[];
  bugs: BugNode[];
  memories: MemoryRecord[];
  milestones: MilestoneRecord[];

  advanceTask: (id: string) => void;
  cycleBug: (id: string) => void;
  addBug: (bug: Omit<BugNode, 'id' | 'created_at' | 'kind' | 'owner_id' | 'source' | 'ai_classified' | 'ai_confidence' | 'ai_reasoning' | 'status' | 'body'>) => void;
  updateBug: (id: string, patch: Partial<BugNode>) => void;
  reorderMilestones: (orderedIds: string[]) => void;
  updateMilestoneDate: (id: string, date: string) => void;
  promoteMemoryToMilestone: (memoryId: string, milestoneId: string) => void;
}

export const useCoreGraph = create<CoreGraphState>((set) => ({
  projects: seedProjects,
  tasks: seedTasks,
  bugs: seedBugs,
  memories: seedMemories,
  milestones: seedMilestones,

  advanceTask: (id) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id && t.taskStatus < 2 ? { ...t, taskStatus: (t.taskStatus + 1) as 0 | 1 | 2 } : t)),
    })),

  cycleBug: (id) =>
    set((s) => ({
      bugs: s.bugs.map((b) => {
        if (b.id !== id) return b;
        const next = b.bugStatus === 'open' ? 'doing' : b.bugStatus === 'doing' ? 'fixed' : 'fixed';
        return { ...b, bugStatus: next, status: next === 'fixed' ? 'done' : next === 'doing' ? 'in_progress' : 'open' };
      }),
    })),

  addBug: (bug) =>
    set((s) => ({
      bugs: [
        {
          ...bug,
          id: nextId('bug'),
          owner_id: null,
          kind: 'bug',
          source: 'capture_text',
          ai_classified: false,
          ai_confidence: 0,
          ai_reasoning: '',
          status: 'open',
          body: bug.title,
          created_at: new Date().toISOString(),
        },
        ...s.bugs,
      ],
    })),

  updateBug: (id, patch) =>
    set((s) => ({ bugs: s.bugs.map((b) => (b.id === id ? { ...b, ...patch } : b)) })),

  reorderMilestones: (orderedIds) =>
    set((s) => ({
      milestones: orderedIds
        .map((id, i) => {
          const m = s.milestones.find((x) => x.id === id)!;
          return { ...m, order: i };
        })
        .sort((a, b) => a.order - b.order),
    })),

  updateMilestoneDate: (id, date) =>
    set((s) => ({ milestones: s.milestones.map((m) => (m.id === id ? { ...m, releaseDate: date } : m)) })),

  promoteMemoryToMilestone: (memoryId, milestoneId) =>
    set((s) => {
      const mem = s.memories.find((m) => m.id === memoryId);
      if (!mem) return s;
      return {
        milestones: s.milestones.map((m) =>
          m.id === milestoneId ? { ...m, items: [...m.items, { label: `◈ ${mem.content}`, done: false }] } : m,
        ),
      };
    }),
}));
