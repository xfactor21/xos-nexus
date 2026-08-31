import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type {
  BugNode,
  BugSeverity,
  EdgeRecord,
  MemoryRecord,
  MilestoneRecord,
  NodeKind,
  NodeRecord,
  ProjectRecord,
} from '../core/types';
import { bugStatusToDbStatus, nodeToBug, nodeToTask, rowToMemory, rowToMilestone, rowToProject, taskStatusToDbStatus } from '../core/mappers';
import { findBestDuplicate } from '../lib/similarity';
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
 * Milestones/Roadmaps: previously the one deliberate exception (no real
 * table, local seed state only). That's now closed — see the
 * `create_milestones_table` migration (public.milestones, owner-scoped RLS,
 * added to the supabase_realtime publication same as nodes/edges/memories/
 * projects). `seedMilestones` below is kept only as the one-time bootstrap
 * content a brand-new Captain's roadmap starts with — hydrate() inserts it
 * for an owner with zero milestone rows, then everything after that is a
 * real persisted row like every other table in this store.
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
  /** Raw `public.memory_recalls` rows for the last 7 days — kept alongside
   * `memories` purely so rowToMemory can compute each memory's real rolling
   * recall count; nothing else reads this directly. */
  memoryRecalls: { memory_id: string; recalled_at: string }[];
  milestones: MilestoneRecord[];

  loading: boolean;
  loaded: boolean;
  error: string | null;

  hydrate: (ownerId: string) => Promise<void>;
  subscribe: (ownerId: string) => () => void;
  reset: () => void;

  /** Real recall tracking for Memory Vault (was: MemoryRecord.recalledCount
   * always read 0 — no backing column existed). Inserts a row into
   * `public.memory_recalls`; call this at the one genuine "xAI surfaced
   * this memory to the Captain" moment in the client codebase (Comms'
   * /remember reply branch) — not on every Vault view, since merely
   * scrolling past a memory in a list isn't xAI "recalling" it. */
  recordMemoryRecall: (memoryId: string) => Promise<void>;

  advanceTask: (id: string) => Promise<void>;
  cycleBug: (id: string) => Promise<void>;
  addBug: (bug: { title: string; project_id: string | null; severity: BugSeverity }) => Promise<void>;
  updateBug: (id: string, patch: Partial<Pick<BugNode, 'severity' | 'assignee' | 'linkedCommit' | 'duplicateOf' | 'similarity'>>) => Promise<void>;

  /** Neural Capture's real destination picker: writes the Captain-reviewed
   * (and possibly re-routed) dissection pieces directly as real nodes,
   * honoring whatever destination each piece was actually left on —
   * deliberately NOT re-running raw text through liveClassify() on commit,
   * since that would silently re-derive its own destinations from scratch
   * and discard every edit the Captain just made in the review step. */
  commitCaptureNodes: (
    items: { kind: NodeKind; title: string; body: string; projectId: string | null; confidence: number; reasoning: string }[],
  ) => Promise<void>;

  /** Ship's Log / Releases room: real CRUD instead of a hardcoded array.
   * `kind: 'release'` is already a live value in the deployed `nodes_kind_check`
   * constraint (see core/types.ts's NodeKind doc comment) — no migration
   * needed. `notes` is stored plain-text (one line per bullet) in `body`
   * rather than the old hardcoded HTML, since this is now real Captain
   * input and dangerouslySetInnerHTML on it would be an XSS hole. */
  addRelease: (r: { title: string; notes: string; status: 'in_progress' | 'done' }) => Promise<void>;
  updateRelease: (id: string, patch: Partial<{ title: string; notes: string; status: 'in_progress' | 'done' }>) => Promise<void>;

  /** Roadmaps create-milestone UI: real insert, appended after the current
   * max order_index so it lands at the end of the track (drag-to-reorder
   * handles the rest). */
  addMilestone: (m: { version: string; title: string; statusLabel: string; state: MilestoneRecord['state']; releaseDate: string | null; items?: MilestoneRecord['items'] }) => Promise<void>;
  reorderMilestones: (orderedIds: string[]) => Promise<void>;
  updateMilestoneDate: (id: string, date: string) => Promise<void>;
  deleteMilestone: (id: string) => Promise<void>;
  promoteMemoryToMilestone: (memoryId: string, milestoneId: string) => Promise<void>;
  /** Cross-room drag-and-drop (OS-grade directive): dragging a bug row onto
   * a Roadmaps milestone promotes it — same real-persist pattern as
   * promoteMemoryToMilestone now that milestones has a backing table. */
  promoteBugToMilestone: (bugId: string, milestoneId: string) => Promise<void>;
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
  memoryRecalls: [],
  milestones: seedMilestones,

  loading: false,
  loaded: false,
  error: null,

  hydrate: async (ownerId) => {
    set({ loading: true, error: null, ownerId });
    try {
      const [projectsRes, nodesRes, edgesRes, memoriesRes, milestonesRes, recallsRes] = await Promise.all([
        supabase.from('projects').select('*').eq('owner_id', ownerId).order('created_at'),
        supabase.from('nodes').select('*').eq('owner_id', ownerId).order('created_at', { ascending: false }),
        supabase.from('edges').select('*').eq('owner_id', ownerId),
        supabase.from('memories').select('*').eq('owner_id', ownerId).order('created_at', { ascending: false }),
        supabase.from('milestones').select('*').eq('owner_id', ownerId).order('order_index'),
        // Only the trailing 7 days matter (rowToMemory's rolling window) —
        // no reason to pull the Captain's full recall history every load.
        supabase
          .from('memory_recalls')
          .select('memory_id, recalled_at')
          .eq('owner_id', ownerId)
          .gte('recalled_at', new Date(Date.now() - 7 * 86_400_000).toISOString()),
      ]);
      const firstError = projectsRes.error || nodesRes.error || edgesRes.error || memoriesRes.error || milestonesRes.error || recallsRes.error;
      if (firstError) throw firstError;

      const nodes = (nodesRes.data ?? []) as NodeRecord[];
      const edges = (edgesRes.data ?? []) as EdgeRecord[];
      const memoryRecalls = recallsRes.data ?? [];
      const projects = (projectsRes.data ?? []).map((p) => rowToProject(p, nodes.filter((n) => n.project_id === p.id)));
      const memories = (memoriesRes.data ?? []).map((m) => rowToMemory(m, edges, memoryRecalls));

      // Milestones: a brand-new Captain has zero rows here (the table is
      // owner-scoped, so no seed data was ever inserted for them) — bootstrap
      // their roadmap with the same default milestones this app has always
      // shipped with, as real persisted rows this time instead of shared
      // local state. Every hydrate after that first one just reads what's
      // actually in the table.
      let milestones: MilestoneRecord[];
      if ((milestonesRes.data ?? []).length === 0) {
        const seedRows = seedMilestones.map((m) => ({
          owner_id: ownerId,
          version: m.version,
          title: m.title,
          status_label: m.statusLabel,
          state: m.state,
          release_date: m.releaseDate,
          order_index: m.order,
          items: m.items,
        }));
        const { data: inserted, error: seedError } = await supabase.from('milestones').insert(seedRows).select();
        if (seedError) {
          console.error('coreGraph.hydrate: failed to seed default milestones', seedError);
          milestones = seedMilestones;
        } else {
          milestones = (inserted ?? []).map(rowToMilestone).sort((a, b) => a.order - b.order);
        }
      } else {
        milestones = (milestonesRes.data ?? []).map(rowToMilestone).sort((a, b) => a.order - b.order);
      }

      set({ projects, nodes, edges, memories, memoryRecalls, milestones, loading: false, loaded: true });
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
            if (data) set((s) => ({ memories: data.map((m) => rowToMemory(m, s.edges, s.memoryRecalls)) }));
          });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'memory_recalls', filter: `owner_id=eq.${ownerId}` }, (payload) => {
        // A recall just landed (see recordMemoryRecall) — append it and
        // remap memories so the affected card's count updates live, same
        // as every other realtime-driven remap in this store.
        const row = payload.new as { memory_id: string; recalled_at: string };
        set((s) => {
          const memoryRecalls = [...s.memoryRecalls, row];
          return { memoryRecalls, memories: s.memories.map((m) => (m.id === row.memory_id ? { ...m, recalledCount: m.recalledCount + 1 } : m)) };
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'milestones', filter: `owner_id=eq.${ownerId}` }, (payload) => {
        set((s) => ({
          milestones:
            payload.eventType === 'DELETE'
              ? remove(s.milestones, (payload.old as { id: string }).id)
              : upsert(s.milestones, rowToMilestone(payload.new as Parameters<typeof rowToMilestone>[0])),
        }));
      })
      .subscribe();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
  },

  reset: () => set({ ownerId: null, projects: [], nodes: [], edges: [], memories: [], memoryRecalls: [], milestones: [], loaded: false, loading: false, error: null }),

  recordMemoryRecall: async (memoryId) => {
    const ownerId = get().ownerId;
    if (!ownerId) return;
    const { error } = await supabase.from('memory_recalls').insert({ owner_id: ownerId, memory_id: memoryId });
    if (error) console.error('recordMemoryRecall failed', error);
    // realtime INSERT handler above updates memoryRecalls/memories — no
    // local mutation needed here (and this is a background signal, not a
    // user-facing write, so no toast/rollback on failure).
  },

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

  /** Real duplicate detection (was: a hardcoded "92% SIMILAR TO SOLVED #14"
   * banner that referenced a bug that may not even exist in this Captain's
   * account). No AI call — Jaccard word-overlap similarity (see lib/
   * similarity.ts) against every existing bug's title+body, run at report
   * time. Above the threshold, the new bug is filed already flagged against
   * its real closest match (open or fixed — a fixed match is exactly the
   * "here's the fix" case the old banner was gesturing at). */
  addBug: async (bug) => {
    const ownerId = get().ownerId;
    if (!ownerId) return;
    const existingBugs = get().nodes.filter((n) => n.kind === 'bug');
    const dup = findBestDuplicate({ title: bug.title, body: bug.title }, existingBugs);
    const metadata: Record<string, unknown> = { severity: bug.severity };
    if (dup) {
      metadata.duplicateOf = dup.id;
      metadata.similarity = dup.similarity;
    }
    const { error } = await supabase.from('nodes').insert({
      owner_id: ownerId,
      project_id: bug.project_id,
      kind: 'bug',
      title: bug.title,
      body: bug.title,
      source: 'manual',
      ai_classified: false,
      status: 'open',
      metadata,
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

  commitCaptureNodes: async (items) => {
    const ownerId = get().ownerId;
    if (!ownerId || !items.length) return;
    // Real duplicate detection for any committed piece that's a bug — same
    // Jaccard check as addBug (see lib/similarity.ts), so a bug filed via
    // Neural Capture's review flow gets flagged against the Captain's real
    // existing bugs exactly like one filed directly from the Bug Tracker.
    const existingBugs = get().nodes.filter((n) => n.kind === 'bug');
    const rows = items.map((it) => {
      const dup = it.kind === 'bug' ? findBestDuplicate({ title: it.title, body: it.body }, existingBugs) : null;
      return {
        owner_id: ownerId,
        project_id: it.projectId,
        kind: it.kind,
        title: it.title,
        body: it.body,
        source: 'capture_text',
        ai_classified: true,
        // ai_confidence is a 0..1 column; DissectedPiece.confidence is 0..100.
        ai_confidence: Math.max(0, Math.min(1, it.confidence)),
        ai_reasoning: it.reasoning,
        status: 'open',
        ...(dup ? { metadata: { duplicateOf: dup.id, similarity: dup.similarity } } : {}),
      };
    });
    const { error } = await supabase.from('nodes').insert(rows);
    if (error) {
      console.error('commitCaptureNodes failed', error);
      pushToast('Could not save capture — try again', 'warn');
      throw error;
    }
    // realtime subscription picks up the INSERT(s) — no local mutation needed
  },

  addRelease: async (r) => {
    const ownerId = get().ownerId;
    if (!ownerId) return;
    const { error } = await supabase.from('nodes').insert({
      owner_id: ownerId,
      project_id: null,
      kind: 'release',
      title: r.title,
      body: r.notes,
      source: 'manual',
      ai_classified: false,
      status: r.status,
    });
    if (error) {
      console.error('addRelease failed', error);
      pushToast('Could not log release — try again', 'warn');
    }
    // realtime subscription picks up the INSERT — no local mutation needed
  },

  updateRelease: async (id, patch) => {
    const n = get().nodes.find((x) => x.id === id);
    if (!n) return;
    const next: NodeRecord = {
      ...n,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.notes !== undefined ? { body: patch.notes } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    };
    set((s) => ({ nodes: upsert(s.nodes, next) })); // optimistic
    const dbPatch: Record<string, unknown> = {};
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.notes !== undefined) dbPatch.body = patch.notes;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    const { error } = await supabase.from('nodes').update(dbPatch).eq('id', id);
    if (error) {
      console.error('updateRelease failed', error);
      set((s) => ({ nodes: upsert(s.nodes, n) })); // rollback
      pushToast('Could not update release — try again', 'warn');
    }
  },

  // Roadmaps/milestones: real CRUD against public.milestones (see the
  // `create_milestones_table` migration) — same optimistic-update-then-
  // persist-then-rollback-on-error shape as everything else in this store.
  addMilestone: async (m) => {
    const ownerId = get().ownerId;
    if (!ownerId) return;
    const maxOrder = get().milestones.reduce((max, x) => Math.max(max, x.order), -1);
    const { error } = await supabase.from('milestones').insert({
      owner_id: ownerId,
      version: m.version,
      title: m.title,
      status_label: m.statusLabel,
      state: m.state,
      release_date: m.releaseDate,
      order_index: maxOrder + 1,
      items: m.items ?? [],
    });
    if (error) {
      console.error('addMilestone failed', error);
      pushToast('Could not create milestone — try again', 'warn');
    }
    // realtime subscription picks up the INSERT — no local mutation needed
  },

  reorderMilestones: async (orderedIds) => {
    const prev = get().milestones;
    const next = orderedIds
      .map((id, i) => {
        const m = prev.find((x) => x.id === id)!;
        return { ...m, order: i };
      })
      .sort((a, b) => a.order - b.order);
    set({ milestones: next }); // optimistic
    const results = await Promise.all(next.map((m) => supabase.from('milestones').update({ order_index: m.order }).eq('id', m.id)));
    const failed = results.find((r) => r.error);
    if (failed) {
      console.error('reorderMilestones failed', failed.error);
      set({ milestones: prev }); // rollback
      pushToast('Could not reorder — try again', 'warn');
    }
  },

  updateMilestoneDate: async (id, date) => {
    const m = get().milestones.find((x) => x.id === id);
    if (!m) return;
    set((s) => ({ milestones: s.milestones.map((x) => (x.id === id ? { ...x, releaseDate: date || null } : x)) })); // optimistic
    const { error } = await supabase.from('milestones').update({ release_date: date || null }).eq('id', id);
    if (error) {
      console.error('updateMilestoneDate failed', error);
      set((s) => ({ milestones: s.milestones.map((x) => (x.id === id ? m : x)) })); // rollback
      pushToast('Could not update release date — try again', 'warn');
    }
  },

  deleteMilestone: async (id) => {
    const m = get().milestones.find((x) => x.id === id);
    if (!m) return;
    set((s) => ({ milestones: remove(s.milestones, id) })); // optimistic
    const { error } = await supabase.from('milestones').delete().eq('id', id);
    if (error) {
      console.error('deleteMilestone failed', error);
      set((s) => ({ milestones: upsert(s.milestones, m) })); // rollback
      pushToast('Could not delete milestone — try again', 'warn');
      return;
    }
    pushToast(`Deleted milestone "${m.version} — ${m.title}"`, 'success');
  },

  promoteMemoryToMilestone: async (memoryId, milestoneId) => {
    const mem = get().memories.find((x) => x.id === memoryId);
    const target = get().milestones.find((x) => x.id === milestoneId);
    if (!mem || !target) return;
    // Amendment v0.6 step 1: `fromMemory` flag replaces the embedded ◈
    // text marker — the render site (Roadmaps) renders the xAI icon
    // itself instead of matching on string content.
    const items = [...target.items, { label: mem.content, done: false, fromMemory: true }];
    set((s) => ({ milestones: s.milestones.map((x) => (x.id === milestoneId ? { ...x, items } : x)) })); // optimistic
    const { error } = await supabase.from('milestones').update({ items }).eq('id', milestoneId);
    if (error) {
      console.error('promoteMemoryToMilestone failed', error);
      set((s) => ({ milestones: s.milestones.map((x) => (x.id === milestoneId ? target : x)) })); // rollback
      pushToast('Could not promote memory — try again', 'warn');
    }
  },

  promoteBugToMilestone: async (bugId, milestoneId) => {
    const bug = get().nodes.find((n) => n.id === bugId);
    const target = get().milestones.find((x) => x.id === milestoneId);
    if (!bug || !target) return;
    const items = [...target.items, { label: bug.title, done: false, fromBug: true }];
    set((s) => ({ milestones: s.milestones.map((x) => (x.id === milestoneId ? { ...x, items } : x)) })); // optimistic
    const { error } = await supabase.from('milestones').update({ items }).eq('id', milestoneId);
    if (error) {
      console.error('promoteBugToMilestone failed', error);
      set((s) => ({ milestones: s.milestones.map((x) => (x.id === milestoneId ? target : x)) })); // rollback
      pushToast('Could not promote bug — try again', 'warn');
      return;
    }
    pushToast(`Promoted "${bug.title}" to a milestone`, 'success');
  },

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
