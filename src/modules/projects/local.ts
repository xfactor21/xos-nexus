/**
 * Room Overhaul Batch 3 — Projects "classes" + dashboard widget layout.
 *
 * The live `projects` table (verified via Supabase MCP against project
 * hkfasnoxhowjjfpnnvqb) has no `class`/`metadata` column and adding one
 * wasn't authorized by this pass (no migration called for) — same
 * no-unauthorized-migration stance already established for Roadmaps'
 * milestones and Design Studio's canvas data. A project's "class" (which
 * changes what panels/labels the workspace shows — Blueprint v0.3's
 * directive) and a Captain's chosen widget order for the new OVERVIEW zone
 * both live in localStorage, keyed by project id, exactly like those two
 * precedents.
 */

export type ProjectClassId = 'dev' | 'creative' | 'personal' | 'research';

export interface ProjectClass {
  id: ProjectClassId;
  label: string;
  icon: string;
  color: string;
  /** Which workspace zones this class shows, in order. */
  zones: Array<'zoverview' | 'zboard' | 'zbugs' | 'zdocs' | 'zfeed'>;
  /** Board column labels for the three task-status columns (queued/doing/done). */
  boardCols: [string, string, string];
  blurb: string;
}

export const PROJECT_CLASSES: ProjectClass[] = [
  { id: 'dev', label: 'DEV', icon: '💻', color: '#00F5FF', zones: ['zoverview', 'zboard', 'zbugs', 'zdocs', 'zfeed'], boardCols: ['QUEUED', 'IN PROGRESS', 'COMPLETE'], blurb: 'Sprint board, bug tracking, docs — a software project.' },
  { id: 'creative', label: 'CREATIVE', icon: '🎨', color: '#8B5CF6', zones: ['zoverview', 'zboard', 'zdocs', 'zfeed'], boardCols: ['SPARK', 'SHAPING', 'POLISHED'], blurb: 'A creative work-in-progress — no bug tracker, no sprints.' },
  { id: 'personal', label: 'PERSONAL', icon: '🌱', color: '#FFB800', zones: ['zoverview', 'zboard', 'zfeed'], boardCols: ['SOMEDAY', 'ACTIVE', 'DONE'], blurb: 'A personal goal or habit — lightweight, no docs zone.' },
  { id: 'research', label: 'RESEARCH', icon: '🔭', color: '#FF2D78', zones: ['zoverview', 'zboard', 'zdocs', 'zfeed'], boardCols: ['QUESTIONS', 'INVESTIGATING', 'ANSWERED'], blurb: 'An open-ended investigation — tracked as questions, not tickets.' },
];

const CLASS_KEY = 'xos-project-classes-v1';
const WIDGET_KEY = 'xos-project-widgets-v1';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* best-effort — a full/blocked localStorage shouldn't crash the room */
  }
}

export function getProjectClass(projectId: string): ProjectClass {
  const map = readJson<Record<string, ProjectClassId>>(CLASS_KEY, {});
  const id = map[projectId] ?? 'dev';
  return PROJECT_CLASSES.find((c) => c.id === id) ?? PROJECT_CLASSES[0];
}
export function setProjectClass(projectId: string, classId: ProjectClassId) {
  const map = readJson<Record<string, ProjectClassId>>(CLASS_KEY, {});
  map[projectId] = classId;
  writeJson(CLASS_KEY, map);
}

export type WidgetId = 'health' | 'heatmap' | 'deps' | 'activity';
const DEFAULT_WIDGET_ORDER: WidgetId[] = ['health', 'heatmap', 'deps', 'activity'];

export function getWidgetOrder(projectId: string): WidgetId[] {
  const map = readJson<Record<string, WidgetId[]>>(WIDGET_KEY, {});
  const order = map[projectId];
  if (!order || !order.length) return DEFAULT_WIDGET_ORDER;
  // guard against a stale saved order missing a widget added since (forward-compat)
  const missing = DEFAULT_WIDGET_ORDER.filter((w) => !order.includes(w));
  return [...order, ...missing];
}
export function setWidgetOrder(projectId: string, order: WidgetId[]) {
  const map = readJson<Record<string, WidgetId[]>>(WIDGET_KEY, {});
  map[projectId] = order;
  writeJson(WIDGET_KEY, map);
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = Math.random().toString(36).slice(2, 6);
  return (base || 'project') + '-' + suffix;
}
