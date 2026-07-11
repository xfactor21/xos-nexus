import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type {
  BugNode,
  BugSeverity,
  EdgeRecord,
  MemoryRecord,
  MilestoneRecord,
  NodeRecord,
  ProjectRecord,
} from '../core/types';
import { bugStatusToDbStatus, nodeToBug, nodeToTask, rowToMemory, rowToProject, taskStatusToDbStatus } from '../core/mappers';

/**
 * coreGraph — the single source-of-truth store every room reads from.
 *
 * Step 3 of the handoff ("Wire Realtime + Zustand Across All Rooms") is now
 * live: `nodes`/`edges`/`projects`/`memories` are populated from Supabase
 * (scoped to the signed-in Captain via RLS) and kept in sync over a
 * Postgres Changes subscription — every room reading `nodes`/`bugs`/`tasks`
 * derived from this store reflects writes from anywhere (Neural Core,
 * Neural Capture, another device) without a refresh.
 *
 * Milestones/Roadmaps are the one deliberate exception: there's no real
 * table for them in the deployed schema, and adding one wasn't authorized
 * by this step (no migration called for in the handoff for Step 3) — they
 * stay on local seed state, same as before. Flagged in the session log.
 */

const seedMilestones: MilestoneRecord[] = [
  {
    id: 'v0.1.0', version: 'v0.1.0', title: 'FOUNDATION', statusLabel: 'SHIPPED · SPRINT 001', state: 'shipped',
    releaseDate: '2026-06-20', order: 0,
    items: [
      { label: 'Boot screen · dashboard · sidebar', done: true },
      { label: 'Neural Core · xAI panel · mission cards', done: true },
      { label: 'Cyberpunk theme', done: true },
    ],
  },
  {
    id: 'v0.5.0', version: 'v0.5.0', title: 'ROOMS ONLINE', statusLabel: 'CURRENT · SPRINT 002', state: 'current',
    releaseDate: '2026-07-15', order: 1,
    items: [
      { label: 'Supabase Neural Core schema', done: true },
      { label: 'Notion Docs HQ', done: true },
      { label: 'Observatory + Awakening sequence', done: true },
      { label: 'Living Core redesign', done: true },
      { label: 'Auth + real ownership', done: true },
      { label: 'Realtime wired across rooms', done: true },
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
  ownerId: string | null;
  projects: ProjectRecord[];
  nodes: NodeRecord[];
  edges: EdgeRecord[];
  memories: MemoryRecord[];
  milestones: MilestoneRecord[];

  loading: boolean;
  loaded: boolean;
  error: string | null;

  hydrate: (ownerId: string) => Promise<void>;
  subscribe: (ownerId: string) => () => void;
  reset: () => void;

  advanceTask: (id: string) => Promise<void>;
  cycleBug: (id: string) => Promise<void>;
  addBug: (bug: { title: string; project_id: string | null; severity: BugSeverity }) => Promise<void>;
  updateBug: (id: string, patch: Partial<Pick<BugNode, 'severity' | 'assignee' | 'linkedCommit' | 'duplicateOf' | 'similarity'>>) => Promise<void>;

  reorderMilestones: (orderedIds: string[]) => void;
  updateMilestoneDate: (id: string, date: string) => void;
  promoteMemoryToMilestone: (memoryId: string, milestoneId: string) => void;
}

function upsert<T extends { id: string }>(arr: T[], row: T): T[] {
  const idx = arr.findIndex((x) => x.id === row.id);
  if (idx === -1) return [row, ...arr];
  const copy = arr.slice();
  copy[idx] = row;
  return copy;
}
function remove<T extends { id: string }>(arr: T[], id: string): T[] {
  return arr.filter((x) => x.id !== id);
}

let channel: RealtimeChannel | null = null;

export const useCoreGraph = create<CoreGraphState>((set, get) => ({
  ownerId: null,
  projects: [],
  nodes: [],
  edges: [],
  memories: [],
  milestones: seedMilestones,

  loading: false,
  loaded: false,
  error: null,

  hydrate: async (ownerId) => {
    set({ loading: true, error: null, ownerId });
    try {
      const [projectsRes, nodesRes, edgesRes, memoriesRes] = await Promise.all([
        supabase.from('projects').select('*').eq('owner_id', ownerId).order('created_at'),
        supabase.from('nodes').select('*').eq('owner_id', ownerId).order('created_at', { ascending: false }),
        supabase.from('edges').select('*').eq('owner_id', ownerId),
        supabase.from('memories').select('*').eq('owner_id', ownerId).order('created_at', { ascending: false }),
      ]);
      const firstError = projectsRes.error || nodesRes.error || edgesRes.error || memoriesRes.error;
      if (firstError) throw firstError;

      const nodes = (nodesRes.data ?? []) as NodeRecord[];
      const edges = (edgesRes.data ?? []) as EdgeRecord[];
      const projects = (projectsRes.data ?? []).map((p) => rowToProject(p, nodes.filter((n) => n.project_id === p.id)));
      const memories = (memoriesRes.data ?? []).map((m) => rowToMemory(m, edges));

      set({ projects, nodes, edges, memories, loading: false, loaded: true });
    } catch (err) {
      console.error('coreGraph.hydrate failed', err);
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load your data.' });
    }
  },

  subscribe: (ownerId) => {
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
    channel = supabase
      .channel(`coreGraph:${ownerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nodes', filter: `owner_id=eq.${ownerId}` }, (payload) => {
        set((s) => ({
          nodes: payload.eventType === 'DELETE' ? remove(s.nodes, (payload.old as NodeRecord).id) : upsert(s.nodes, payload.new as NodeRecord),
        }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'edges', filter: `owner_id=eq.${ownerId}` }, (payload) => {
        set((s) => ({
          edges: payload.eventType === 'DELETE' ? remove(s.edges, (payload.old as EdgeRecord).id) : upsert(s.edges, payload.new as EdgeRecord),
        }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'memories', filter: `owner_id=eq.${ownerId}` }, () => {
        // Memory rows are cheap and infrequent — just re-pull + remap
        // (linkedNodeCount depends on the current edges list anyway).
        supabase
          .from('memories')
          .select('*')
          .eq('owner_id', ownerId)
          .order('created_at', { ascending: false })
          .then(({ data }) => {
            if (data) set((s) => ({ memories: data.map((m) => rowToMemory(m, s.edges)) }));
          });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects', filter: `owner_id=eq.${ownerId}` }, () => {
        supabase
          .from('projects')
          .select('*')
          .eq('owner_id', ownerId)
          .order('created_at')
          .then(({ data }) => {
            if (data) set((s) => ({ projects: data.map((p) => rowToProject(p, s.nodes.filter((n) => n.project_id === p.id))) }));
          });
      })
      .subscribe();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
  },

  reset: () => set({ ownerId: null, projects: [], nodes: [], edges: [], memories: [], loaded: false, loading: false, error: null }),

  advanceTask: async (id) => {
    const n = get().nodes.find((x) => x.id === id);
    if (!n) return;
    const current = nodeToTask(n).taskStatus;
    if (current >= 2) return;
    const nextStatus = taskStatusToDbStatus((current + 1) as 0 | 1 | 2);
    set((s) => ({ nodes: upsert(s.nodes, { ...n, status: nextStatus }) })); // optimistic
    const { error } = await supabase.from('nodes').update({ status: nextStatus }).eq('id', id);
    if (error) console.error('advanceTask failed', error);
  },

  cycleBug: async (id) => {
    const n = get().nodes.find((x) => x.id === id);
    if (!n) return;
    const current = nodeToBug(n).bugStatus;
    const next = current === 'open' ? 'doing' : 'fixed';
    const nextStatus = bugStatusToDbStatus(next);
    set((s) => ({ nodes: upsert(s.nodes, { ...n, status: nextStatus }) })); // optimistic
    const { error } = await supabase.from('nodes').update({ status: nextStatus }).eq('id', id);
    if (error) console.error('cycleBug failed', error);
  },

  addBug: async (bug) => {
    const ownerId = get().ownerId;
    if (!ownerId) return;
    const { error } = await supabase.from('nodes').insert({
      owner_id: ownerId,
      project_id: bug.project_id,
      kind: 'bug',
      title: bug.title,
      body: bug.title,
      source: 'manual',
      ai_classified: false,
      status: 'open',
      metadata: { severity: bug.severity },
    });
    if (error) console.error('addBug failed', error);
    // realtime subscription picks up the INSERT — no local mutation needed
  },

  updateBug: async (id, patch) => {
    const n = get().nodes.find((x) => x.id === id);
    if (!n) return;
    const meta = { ...((n.metadata ?? {}) as Record<string, unknown>), ...patch };
    set((s) => ({ nodes: upsert(s.nodes, { ...n, metadata: meta }) })); // optimistic
    const { error } = await supabase.from('nodes').update({ metadata: meta }).eq('id', id);
    if (error) console.error('updateBug failed', error);
  },

  // Roadmaps/milestones: local-only, unchanged from the Step 5 pass — see
  // the module doc comment above for why.
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
          // Amendment v0.6 step 1: `fromMemory` flag replaces the embedded ◈
          // text marker — the render site (Roadmaps) renders the xAI icon
          // itself instead of matching on string content.
          m.id === milestoneId ? { ...m, items: [...m.items, { label: mem.content, done: false, fromMemory: true }] } : m,
        ),
      };
    }),
}));
