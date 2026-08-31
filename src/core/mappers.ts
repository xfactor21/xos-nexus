/**
 * xOS: neXus — Supabase row → view-model mappers (Step 3)
 *
 * TaskNode/BugNode need fields the live `nodes` table doesn't have as real
 * columns (taskStatus, tags, severity, assignee, linkedCommit, duplicateOf,
 * similarity). Rather than a migration, these live in `nodes.metadata`
 * (jsonb) — the same "no-migration-needed" pattern Step 4 already
 * established for Design Studio's canvas items. `status`/`kind` stay real
 * columns and drive the mapping (see the status↔taskStatus/bugStatus tables
 * below); everything else is read out of metadata with safe defaults so a
 * node with no metadata yet (e.g. one Neural Core just wrote) still renders.
 */
import type { BugNode, BugSeverity, EdgeRecord, MemoryRecord, MilestoneRecord, NodeRecord, ProjectRecord, TaskNode } from './types';

export function nodeToTask(n: NodeRecord): TaskNode {
  const taskStatus = n.status === 'done' || n.status === 'archived' ? 2 : n.status === 'in_progress' ? 1 : 0;
  const meta = (n.metadata ?? {}) as Record<string, unknown>;
  // Amendment v0.6 step 1: tag text no longer embeds the ◈ glyph as an
  // ad-hoc "this is AI-authored" marker for downstream regex-matching —
  // that was a fragile pattern (a UI concern smuggled into data). The tag
  // reads as plain text; call sites that want to style AI-authored tags
  // differently match on the text itself (see Projects' `/FROM CAPTURE/`
  // check) or, better, should read `n.ai_classified` directly.
  const tags = Array.isArray(meta.tags) ? (meta.tags as string[]) : n.ai_classified ? ['FROM CAPTURE'] : [];
  return { ...n, kind: 'task', taskStatus, tags };
}

export function taskStatusToDbStatus(taskStatus: 0 | 1 | 2): NodeRecord['status'] {
  return taskStatus === 2 ? 'done' : taskStatus === 1 ? 'in_progress' : 'open';
}

export function nodeToBug(n: NodeRecord): BugNode {
  const bugStatus = n.status === 'done' || n.status === 'archived' ? 'fixed' : n.status === 'in_progress' ? 'doing' : 'open';
  const meta = (n.metadata ?? {}) as Record<string, unknown>;
  return {
    ...n,
    kind: 'bug',
    bugStatus,
    severity: (meta.severity as BugSeverity | undefined) ?? 'medium',
    assignee: (meta.assignee as string | null | undefined) ?? null,
    linkedCommit: (meta.linkedCommit as string | null | undefined) ?? null,
    duplicateOf: (meta.duplicateOf as string | null | undefined) ?? null,
    similarity: (meta.similarity as number | null | undefined) ?? null,
  };
}

export function bugStatusToDbStatus(bugStatus: 'open' | 'doing' | 'fixed'): NodeRecord['status'] {
  return bugStatus === 'fixed' ? 'done' : bugStatus === 'doing' ? 'in_progress' : 'open';
}

const STALE_DAYS = 3;

/** health: % of that project's tasks marked done — a reasonable proxy until
 * a real "project health" signal exists; idleDays: days since the most
 * recent node touching that project (or the project row's own updated_at if
 * it has none yet). Both computed client-side, not stored. */
export function rowToProject(
  p: { id: string; slug: string; name: string; icon: string | null; color: string | null; status: string; updated_at: string },
  nodesForProject: NodeRecord[],
): ProjectRecord {
  const mostRecent = nodesForProject.reduce<string | null>((latest, n) => {
    return !latest || n.created_at > latest ? n.created_at : latest;
  }, null);
  const lastActivity = mostRecent ?? p.updated_at;
  const idleDays = Math.max(0, Math.floor((Date.now() - new Date(lastActivity).getTime()) / 86_400_000));
  const tasks = nodesForProject.filter((n) => n.kind === 'task');
  const health = tasks.length ? Math.round((tasks.filter((t) => t.status === 'done').length / tasks.length) * 100) : 70;
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    // Amendment v0.6 step 1: default is now an IconName ('projects', the
    // same key the sidebar's Projects room icon uses) instead of a raw
    // emoji fallback. An existing row's own `p.icon` may still legitimately
    // be a legacy emoji or Captain-chosen character — see DataIcon.tsx for
    // why that's a disclosed exception, not silently broken.
    icon: p.icon ?? 'projects',
    color: p.color ?? '#00F5FF',
    status: (p.status as ProjectRecord['status']) ?? 'active',
    health,
    idleDays,
    isStale: p.status === 'active' && idleDays >= STALE_DAYS,
  };
}

function relativeLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'TODAY';
  if (days === 1) return 'YESTERDAY';
  if (days < 7) return `${days} DAYS AGO`;
  if (days < 30) return `${Math.floor(days / 7)} WEEK${Math.floor(days / 7) > 1 ? 'S' : ''} AGO`;
  return `${Math.floor(days / 30)} MONTH${Math.floor(days / 30) > 1 ? 'S' : ''} AGO`;
}

export function rowToMemory(
  m: { id: string; project_id: string | null; source_node: string | null; content: string; kind: string; created_at: string },
  edges: EdgeRecord[],
): MemoryRecord {
  const linkedNodeCount = m.source_node ? edges.filter((e) => e.from_node === m.source_node || e.to_node === m.source_node).length : 0;
  return {
    id: m.id,
    project_id: m.project_id,
    source_node: m.source_node,
    content: m.content,
    kind: m.kind as MemoryRecord['kind'],
    recalledCount: 0,
    linkedNodeCount,
    createdLabel: relativeLabel(m.created_at),
    created_at: m.created_at,
  };
}

/** Roadmaps: the `public.milestones` table (see `create_milestones_table`
 * migration) uses snake_case DB column names (`status_label`, `order_index`,
 * `release_date`) — this maps a raw row to the camelCase MilestoneRecord
 * shape every room already reads/writes. */
export function rowToMilestone(row: {
  id: string;
  version: string;
  title: string;
  status_label: string;
  state: string;
  release_date: string | null;
  order_index: number;
  items: unknown;
}): MilestoneRecord {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    statusLabel: row.status_label,
    state: row.state as MilestoneRecord['state'],
    releaseDate: row.release_date,
    order: row.order_index,
    items: Array.isArray(row.items) ? (row.items as MilestoneRecord['items']) : [],
  };
}
