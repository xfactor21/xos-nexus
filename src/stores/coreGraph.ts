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
import { pushToast } from './toastStore';

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
  deleteMilestone: (id: string) => void;
  promoteMemoryToMilestone: (memoryId: string, milestoneId: string) => void;
  /** Cross-room drag-and-drop (OS-grade directive): dragging a bug row onto
   * a Roadmaps milestone promotes it — mirrors promoteMemoryToMilestone's
   * local-only milestones model. */
  promoteBugToMilestone: (bugId: string, milestoneId: string) => void;
  /** Cross-room drag-and-drop: dragging an unassigned capture node onto a
   * project card assigns it — a real write, not local-only, since
   * project_id lives on the `nodes` table itself. */
  assignNodeToProject: (nodeId: string, projectId: string) => Promise<void>;

  /** Neural Core drag/details panel (part B): rename a node — same
   * optimistic+rollback pattern as everything else in this store. */
  updateNodeTitle: (id: string, title: string) => Promise<void>;
  /** Tags live in nodes.metadata.tags (jsonb), shallow-merged same as
   * updateBug's severity/assignee patch. */
  updateNodeTags: (id: string, tags: string[]) => Promise<void>;
  /** Neural Core association editing: create/delete an edge row directly
   * (relation defaults to 'associated' when the caller doesn't care). */
  createEdge: (fromNode: string, toNode: string, relation?: EdgeRecord['relation']) => Promise<void>;
  deleteEdge: (edgeId: string) => Promise<void>;

  /** "Review xAI's Tags & Associations" (Settings + Neural Core panel):
   * accepting an AI-authored edge re-stamps it `created_by: 'user'` — the
   * same column classify-capture's writeNodes() checks to tell AI proposals
   * from human ones, and the exact column fetchUserContext() (copilotClient.ts)
   * already filters on for what to feed back into future classification. So
   * "accept" isn't cosmetic: it genuinely promotes that edge into the pool
   * of confirmed-correct associations xAI's next classification call sees. */
  confirmEdge: (edgeId: string) => Promise<void>;
  /** Correcting an edge (wrong relation and/or wrong target) is a distinct
   * action from delete-and-hope — it patches the row in place AND re-stamps
   * `created_by: 'user'` for the same reason confirmEdge does: a correction
   * is by definition Captain-verified ground truth now. */
  correctEdge: (edgeId: string, patch: { relation?: EdgeRecord['relation']; to_node?: string }) => Promise<void>;
  /** Marks a node's current tag set as Captain-confirmed-correct. Stored in
   * metadata.tagsConfirmed (same shallow-merge jsonb pattern as updateBug) —
   * fetchUserContext reads this to phrase confirmed tags differently
   * ("Captain confirmed this tagging is correct") from freshly-edited ones,
   * a stronger training signal than an edit alone. */
  confirmNodeTags: (id: string) => Promise<void>;

  /** Generic delete for any `nodes`-backed row — used by Bug Tracker and
   * Knowledge Matrix (both just filtered views over `nodes`). Optimistic
   * local removal (the Realtime DELETE handler in `subscribe` above would
   * also catch this, but the round-trip has visible latency — the delete
   * button should feel immediate, same as every other optimistic write in
   * this store) + a real `.delete()` against Supabase, scoped by RLS's
   * `own nodes` policy (auth.uid() = owner_id) so this can never delete
   * another user's row even if the id were guessable. */
  deleteNode: (id: string) => Promise<void>;
  /** RLS's `own projects` policy covers DELETE the same way. The `nodes`
   * table's `project_id` FK is ON DELETE SET NULL (confirmed live via the
   * Supabase schema, not assumed) — deleting a project un-assigns its
   * captures rather than deleting or orphaning them, so this is safe to
   * offer without a "this will also delete N items" warning. */
  deleteProject: (id: string) => Promise<void>;
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
        // Toast system: every live capture landing is a real background
        // event worth surfacing app-wide, not just in whatever room happens
        // to be open — this is the "real capture event" the toast system
        // is wired+tested against.
        if (payload.eventType === 'INSERT') {
          const n = payload.new as NodeRecord;
          pushToast(`Captured: ${n.title || n.kind}`, 'success');
        }
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

  // Milestones have no backing table (see the module doc comment) — delete
  // is a plain local `set()`, same shape as reorderMilestones/updateMilestoneDate.
  deleteMilestone: (id) => set((s) => ({ milestones: remove(s.milestones, id) })),

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

  promoteBugToMilestone: (bugId, milestoneId) =>
    set((s) => {
      const bug = s.nodes.find((n) => n.id === bugId);
      if (!bug) return s;
      pushToast(`Promoted "${bug.title}" to a milestone`, 'success');
      return {
        milestones: s.milestones.map((m) =>
          m.id === milestoneId ? { ...m, items: [...m.items, { label: bug.title, done: false, fromBug: true }] } : m,
        ),
      };
    }),

  assignNodeToProject: async (nodeId, projectId) => {
    const n = get().nodes.find((x) => x.id === nodeId);
    if (!n) return;
    set((s) => ({ nodes: upsert(s.nodes, { ...n, project_id: projectId }) })); // optimistic
    const { error } = await supabase.from('nodes').update({ project_id: projectId }).eq('id', nodeId);
    if (error) {
      console.error('assignNodeToProject failed', error);
      pushToast('Could not assign capture — try again', 'warn');
      return;
    }
    const proj = get().projects.find((p) => p.id === projectId);
    pushToast(`Assigned "${n.title}" to ${proj?.name ?? 'project'}`, 'success');
  },

  updateNodeTitle: async (id, title) => {
    const n = get().nodes.find((x) => x.id === id);
    if (!n) return;
    set((s) => ({ nodes: upsert(s.nodes, { ...n, title }) })); // optimistic
    const { error } = await supabase.from('nodes').update({ title }).eq('id', id);
    if (error) {
      console.error('updateNodeTitle failed', error);
      set((s) => ({ nodes: upsert(s.nodes, n) })); // rollback
      pushToast('Could not rename — try again', 'warn');
    }
  },

  updateNodeTags: async (id, tags) => {
    const n = get().nodes.find((x) => x.id === id);
    if (!n) return;
    const meta = { ...((n.metadata ?? {}) as Record<string, unknown>), tags };
    set((s) => ({ nodes: upsert(s.nodes, { ...n, metadata: meta }) })); // optimistic
    const { error } = await supabase.from('nodes').update({ metadata: meta }).eq('id', id);
    if (error) {
      console.error('updateNodeTags failed', error);
      set((s) => ({ nodes: upsert(s.nodes, n) })); // rollback
      pushToast('Could not update tags — try again', 'warn');
    }
  },

  createEdge: async (fromNode, toNode, relation = 'relates_to') => {
    const ownerId = get().ownerId;
    if (!ownerId || fromNode === toNode) return;
    const { data, error } = await supabase
      .from('edges')
      .insert({ owner_id: ownerId, from_node: fromNode, to_node: toNode, relation, created_by: 'user' })
      .select()
      .single();
    if (error) {
      console.error('createEdge failed', error);
      pushToast('Could not create association — try again', 'warn');
      return;
    }
    if (data) set((s) => ({ edges: upsert(s.edges, data as EdgeRecord) })); // realtime would also catch this, but no need to wait
  },

  deleteEdge: async (edgeId) => {
    const e = get().edges.find((x) => x.id === edgeId);
    if (!e) return;
    set((s) => ({ edges: remove(s.edges, edgeId) })); // optimistic
    const { error } = await supabase.from('edges').delete().eq('id', edgeId);
    if (error) {
      console.error('deleteEdge failed', error);
      set((s) => ({ edges: upsert(s.edges, e) })); // rollback
      pushToast('Could not remove association — try again', 'warn');
    }
  },

  confirmEdge: async (edgeId) => {
    const e = get().edges.find((x) => x.id === edgeId);
    if (!e) return;
    const next = { ...e, created_by: 'user' as const };
    set((s) => ({ edges: upsert(s.edges, next) })); // optimistic
    const { error } = await supabase.from('edges').update({ created_by: 'user' }).eq('id', edgeId);
    if (error) {
      console.error('confirmEdge failed', error);
      set((s) => ({ edges: upsert(s.edges, e) })); // rollback
      pushToast('Could not confirm association — try again', 'warn');
      return;
    }
    pushToast('Confirmed — xAI will treat this as ground truth going forward.', 'success');
  },

  correctEdge: async (edgeId, patch) => {
    const e = get().edges.find((x) => x.id === edgeId);
    if (!e) return;
    const next = { ...e, ...patch, created_by: 'user' as const };
    set((s) => ({ edges: upsert(s.edges, next) })); // optimistic
    const { error } = await supabase.from('edges').update({ ...patch, created_by: 'user' }).eq('id', edgeId);
    if (error) {
      console.error('correctEdge failed', error);
      set((s) => ({ edges: upsert(s.edges, e) })); // rollback
      pushToast('Could not correct association — try again', 'warn');
      return;
    }
    pushToast('Correction saved — xAI will learn from this.', 'success');
  },

  confirmNodeTags: async (id) => {
    const n = get().nodes.find((x) => x.id === id);
    if (!n) return;
    const meta = { ...((n.metadata ?? {}) as Record<string, unknown>), tagsConfirmed: true };
    set((s) => ({ nodes: upsert(s.nodes, { ...n, metadata: meta }) })); // optimistic
    const { error } = await supabase.from('nodes').update({ metadata: meta }).eq('id', id);
    if (error) {
      console.error('confirmNodeTags failed', error);
      set((s) => ({ nodes: upsert(s.nodes, n) })); // rollback
      pushToast('Could not confirm tags — try again', 'warn');
      return;
    }
    pushToast('Confirmed — xAI will treat this tagging as correct.', 'success');
  },

  deleteNode: async (id) => {
    const n = get().nodes.find((x) => x.id === id);
    if (!n) return;
    set((s) => ({ nodes: remove(s.nodes, id) })); // optimistic
    const { error } = await supabase.from('nodes').delete().eq('id', id);
    if (error) {
      console.error('deleteNode failed', error);
      set((s) => ({ nodes: upsert(s.nodes, n) })); // roll back the optimistic removal
      pushToast('Could not delete — try again', 'warn');
      return;
    }
    pushToast(`Deleted "${n.title || n.kind}"`, 'success');
  },

  deleteProject: async (id) => {
    const p = get().projects.find((x) => x.id === id);
    if (!p) return;
    set((s) => ({ projects: remove(s.projects, id) })); // optimistic
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) {
      console.error('deleteProject failed', error);
      set((s) => ({ projects: upsert(s.projects, p) })); // roll back
      pushToast('Could not delete project — try again', 'warn');
      return;
    }
    // nodes/memories/suggestions referencing this project have project_id
    // SET NULL by the FK, not deleted — re-pull nodes so any that were
    // showing under this project immediately reflect as unassigned rather
    // than needing a refresh to notice the FK took effect.
    const ownerId = get().ownerId;
    if (ownerId) {
      const { data } = await supabase.from('nodes').select('*').eq('owner_id', ownerId).order('created_at', { ascending: false });
      if (data) set({ nodes: data as NodeRecord[] });
    }
    pushToast(`Deleted "${p.name}"`, 'success');
  },
}));
