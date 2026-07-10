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
  from_node: string;
  to_node: string;
  relation: string;
  created_by: 'copilot' | 'captain';
  ai_confidence?: number;
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

export interface ProjectRecord {
  id: string;
  slug: string;
  name: string;
  icon: string;
  status: 'active' | 'stale' | 'archived';
  health: number; // 0-100
  idleDays: number;
}

export interface MemoryRecord {
  id: string;
  content: string;
  kind: 'decision' | 'learning' | 'pattern';
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
  items: { label: string; done: boolean }[];
}

export interface DissectedPiece {
  kind: string;
  body: string;
  destination: string;
  reasoning: string;
  confidence: number;
}
