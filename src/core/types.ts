/**
 * xOS: neXus — core data model
 *
 * Mirrors the deployed Supabase schema (Engineering Bible: "Everything is
 * a node. Captures, tasks, docs, bugs, releases — all nodes in one graph.
 * Relationships are first-class. Edges carry type + AI confidence.")
 *
 * Rooms are filtered views over this one shape — nothing gets its own
 * bespoke storage model, per the System Architecture doc.
 */

/**
 * Verified against the live `nodes` table (Supabase project hkfasnoxhowjjfpnnvqb,
 * checked directly via the Supabase MCP during this session — see the
 * session log). The deployed `kind` CHECK constraint additionally allows
 * 'capture' and 'release', which copilot-client.ts's ClassifiedNode type
 * does not declare; flagged as a follow-up for whoever wires Step 1 Auth.
 */
export type NodeKind =
  | 'capture'
  | 'task'
  | 'note'
  | 'doc'
  | 'bug'
  | 'idea'
  | 'design'
  | 'roadmap_item'
  | 'release'
  | 'conversation';

export type TaskStatus = 0 | 1 | 2; // queued / in progress / complete

/** Feature-uplift addition (Step 5): severities beyond HIGH/MED/LOW. */
export type BugSeverity = 'critical' | 'high' | 'medium' | 'low' | 'trivial';
export type BugStatus = 'open' | 'doing' | 'fixed';

export interface EdgeRecord {
  id: string;
  owner_id: string | null;
  from_node: string;
  to_node: string;
  relation: 'relates_to' | 'duplicates' | 'blocks' | 'solves' | 'references' | 'derived_from' | 'affects';
  /** Matches the live `created_by` CHECK constraint — 'user', not the
   * 'captain' a naive read of the Blueprint's flavor text might suggest. */
  created_by: 'user' | 'copilot';
  ai_confidence?: number | null;
  created_at?: string;
}

export interface NodeRecord {
  id: string;
  owner_id: string | null;
  project_id: string | null;
  kind: NodeKind;
  title: string;
  body: string;
  source: string;
  ai_classified: boolean;
  ai_confidence: number;
  ai_reasoning: string;
  /** Matches the live `status` CHECK constraint exactly (not the 'open'/'closed'
   * pair a naive read of the prototype might suggest). */
  status: 'open' | 'in_progress' | 'done' | 'archived';
  created_at: string;
  /** jsonb — used by Design Studio to persist canvas items without a migration. */
  metadata?: Record<string, unknown>;
}

/** Task-flavored node, as rendered on the Projects kanban board. */
export interface TaskNode extends NodeRecord {
  kind: 'task';
  taskStatus: TaskStatus;
  tags: string[];
}

/** Bug-flavored node with Step-5 uplift fields. */
export interface BugNode extends NodeRecord {
  kind: 'bug';
  bugStatus: BugStatus;
  severity: BugSeverity;
  assignee: string | null;
  linkedCommit: string | null;
  duplicateOf: string | null; // node id of a similar/duplicate bug, surfaced in UI
  similarity: number | null; // 0-1, drives the "92% similar" affordance
}

/**
 * Verified against the live `projects` table (Step 3 session). The deployed
 * `status` CHECK constraint is ('active'|'paused'|'archived') — there is no
 * stored 'stale' status. "Stale" is a computed UI signal (`isStale`), derived
 * client-side from `idleDays`, not a persisted value.
 */
export interface ProjectRecord {
  id: string;
  slug: string;
  name: string;
  icon: string;
  color: string;
  status: 'active' | 'paused' | 'archived';
  /** Computed client-side from that project's task completion ratio — not a
   * stored column (none exists). Refreshed on hydrate/re-hydrate. */
  health: number; // 0-100
  /** Computed client-side from the most recent related node's created_at
   * (or the project's own updated_at if it has no nodes yet). */
  idleDays: number;
  isStale: boolean;
}

/**
 * The live `memories` table's `kind` CHECK constraint also allows
 * 'preference' and 'history' beyond the three the prototype/UI use today.
 * `recalledCount` has no backing column (not tracked yet) and always reads 0
 * until a future step adds one; `linkedNodeCount` is computed client-side by
 * counting edges touching `source_node`.
 */
export interface MemoryRecord {
  id: string;
  project_id?: string | null;
  source_node?: string | null;
  content: string;
  kind: 'decision' | 'learning' | 'pattern' | 'preference' | 'history';
  recalledCount: number;
  linkedNodeCount: number;
  createdLabel: string;
}

/** Roadmap milestone, uplifted in Step 5 with dates/progress/reorder. */
export interface MilestoneRecord {
  id: string;
  version: string;
  title: string;
  statusLabel: string;
  state: 'shipped' | 'current' | 'future';
  releaseDate: string | null; // ISO date, editable
  order: number;
  items: { label: string; done: boolean; fromMemory?: boolean }[];
}

export interface DissectedPiece {
  kind: string;
  body: string;
  destination: string;
  reasoning: string;
  confidence: number;
}
