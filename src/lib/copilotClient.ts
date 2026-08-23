/**
 * xOS: neXus — Copilot Client (frontend gateway)
 * lib/copilotClient.ts
 *
 * This is the browser-side half of copilot/client.ts. The classify → write
 * pipeline itself (CLASSIFY via Claude, WRITE to Supabase, BROADCAST via
 * Realtime) lives server-side in the `classify-capture` Edge Function —
 * see the reference implementation delivered alongside the prototypes.
 * No room in this app calls Claude or Supabase directly for classification;
 * every capture surface (Neural Core, Neural Capture, and eventually Design
 * Studio sticky notes) calls `liveClassify()` below, exactly as
 * xos-prototype.html's coreCapture() does.
 */
import { supabase } from './supabase';
import type { IconName } from '../design-system/icons/registry';

/**
 * Step 1 ("Auth + Real Ownership") replaces the `owner_id: null` this
 * shipped with — every capture surface now writes to the currently signed-in
 * Captain's account instead of an orphaned row RLS would hide from everyone.
 */
async function currentOwnerId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export interface ClassifiedNode {
  kind: string;
  title: string;
  body: string;
  project_slug: string | null;
  confidence: number;
  reasoning: string;
  relationships: { relation: string; target_node_id: string }[];
}

export interface ClassifyResult {
  nodes: ClassifiedNode[];
  liveAI?: boolean;
  /** Bug fix: xAI chat (XaiChatWindow.tsx) used to show the *filing*
   * reasoning as its reply — e.g. asking "what's 2+3" got back "The
   * Captain is asking a direct arithmetic question, which is best handled
   * as an interactive conversation node," never an actual answer. `reply`
   * is a genuine, direct conversational response to what the Captain said,
   * generated in the same AI call alongside (not instead of) the
   * structured filing — the filing keeps happening exactly as before. */
  reply?: string;
  /** false when this call used `autoCommit: false` and the returned
   * `nodes` are unpersisted proposals (no `id` field) — the chat surface
   * uses this to decide whether to show a confirm/decline prompt. */
  committed?: boolean;
}

/** Step 7 Room B (Knowledge Matrix): a saved web page's kind/title/
 * description are already known for certain — they come straight off the
 * page's own <title>/meta description (fetched Rust-side in the Browser
 * room, no AI) — so this does NOT run through liveClassify()'s general
 * multi-node extraction. It hits the same `classify-capture` Edge
 * Function's dedicated `snapshot` branch instead, which reuses only the
 * relationship/auto-linking half of the pipeline (connects the new node to
 * whatever existing nodes it actually relates to) and writes exactly one
 * `kind: 'knowledge_snapshot'` node. */
export interface PageSnapshot {
  url: string;
  title: string;
  description: string;
  textContent: string;
}

export interface SnapshotResult {
  node: { id: string; title: string } | null;
  relationshipsFound: number;
}

/**
 * xAI status wiring (Amendment v0.9/v1.0): both `classify-capture` callers
 * below dispatch these as plain window events rather than importing the xAI
 * React context directly — this is a plain .ts module with no component
 * tree to hook into (same reasoning as the 'xos-go' navigation event
 * elsewhere), and it keeps every classify-capture call site (Neural Core,
 * Neural Capture, Knowledge Matrix snapshots) wired through one place
 * instead of threading setAiStatus calls through each caller individually.
 * XaiCharacter.tsx's trigger bridge listens for these inside <XAIProvider>.
 * Only this lifecycle is wired for now — the rest of Amendment v0.9's
 * trigger table (suggestion pending, project stale, daily briefing,
 * relationship discovery, etc.) is intentionally left unwired until those
 * systems exist as real product surfaces.
 */
function xaiThinking() {
  window.dispatchEvent(new Event('xos-xai-thinking'));
}
function xaiSuccess() {
  window.dispatchEvent(new Event('xos-xai-success'));
}
function xaiError() {
  window.dispatchEvent(new Event('xos-xai-error'));
}

export async function saveKnowledgeSnapshot(snapshot: PageSnapshot): Promise<SnapshotResult> {
  xaiThinking();
  try {
    const ownerId = await currentOwnerId();
    if (!ownerId) throw new Error('saveKnowledgeSnapshot: no signed-in Captain — sign in before saving.');
    const { data, error } = await supabase.functions.invoke('classify-capture', {
      body: { owner_id: ownerId, snapshot },
    });
    if (error) throw error;
    xaiSuccess();
    return data as SnapshotResult;
  } catch (err) {
    xaiError();
    throw err;
  }
}

/** Part C — real AI-learning feedback. When a Captain edits tags or adds an
 * association via the Neural Core details panel (coreGraph.updateNodeTags /
 * createEdge), that's a genuine human correction of what the graph should
 * look like — this pulls a small, recent sample of exactly that signal
 * (edges a human created, and nodes a human tagged) and sends it to
 * classify-capture as extra context lines so the model's prompt genuinely
 * reflects the Captain's own corrections, not just the stock recent-nodes/
 * memories context it already had. Best-effort: any failure here degrades
 * to "no extra context" rather than blocking capture. */
async function fetchUserContext(ownerId: string): Promise<string[]> {
  try {
    const [edgesRes, nodesRes] = await Promise.all([
      supabase
        .from('edges')
        .select('from_node, to_node, relation')
        .eq('owner_id', ownerId)
        .eq('created_by', 'user')
        .order('created_at', { ascending: false })
        .limit(15),
      supabase
        .from('nodes')
        .select('title, metadata')
        .eq('owner_id', ownerId)
        .not('metadata->tags', 'is', null)
        .order('created_at', { ascending: false })
        .limit(15),
    ]);
    const lines: string[] = [];
    (edgesRes.data ?? []).forEach((e) => {
      lines.push(`Captain manually linked two nodes as "${e.relation}"`);
    });
    (nodesRes.data ?? []).forEach((n) => {
      const tags = ((n.metadata as Record<string, unknown> | null)?.tags as string[] | undefined) ?? [];
      if (tags.length) lines.push(`Captain tagged "${n.title}" with: ${tags.join(', ')}`);
    });
    return lines;
  } catch (err) {
    console.error('fetchUserContext failed (non-fatal)', err);
    return [];
  }
}

/**
 * `autoCommit` plumbs through to the `classify-capture` Edge Function
 * (v15+): omitted/true (default) keeps every existing caller's behavior —
 * Neural Capture, Knowledge Matrix, etc. — writing nodes immediately, same
 * as before this param existed. The xAI chat surface passes `false` so
 * xAI answers first and proposes filing rather than filing silently; see
 * `commitClassifiedNodes()` below for the actual write, and
 * XaiChatWindow.tsx for the confirm/decline UI built on top of this.
 */
export async function liveClassify(
  text: string,
  ownerIdOverride: string | null = null,
  autoCommit: boolean = true
): Promise<ClassifyResult> {
  xaiThinking();
  try {
    const ownerId = ownerIdOverride ?? (await currentOwnerId());
    if (!ownerId) throw new Error('liveClassify: no signed-in Captain — sign in before capturing.');
    const userContext = await fetchUserContext(ownerId);
    const { data, error } = await supabase.functions.invoke('classify-capture', {
      body: { text, owner_id: ownerId, autoCommit, userContext },
    });
    if (error) throw error;
    xaiSuccess();
    return data as ClassifyResult;
  } catch (err) {
    xaiError();
    throw err;
  }
}

/** Result of the deferred `commitNodes` path — actually writes nodes that
 * a prior `liveClassify(text, owner, false)` call only proposed. Called
 * when the Captain taps "Yes" on the chat confirm prompt. */
export interface CommitResult {
  nodes: (ClassifiedNode & { id: string })[];
  committed: boolean;
}

/**
 * Item — "would you like me to log that? (no reply times out as a no)":
 * this is the "yes" path. Re-sends the exact proposed node objects xAI
 * returned from a prior `autoCommit:false` call; the Edge Function
 * re-validates relationship ids against fresh context and actually writes
 * them this time. If the Captain never answers (or says no), this is
 * simply never called — nothing was ever saved, by construction.
 */
export async function commitClassifiedNodes(
  nodes: ClassifiedNode[],
  ownerIdOverride: string | null = null
): Promise<CommitResult> {
  xaiThinking();
  try {
    const ownerId = ownerIdOverride ?? (await currentOwnerId());
    if (!ownerId) throw new Error('commitClassifiedNodes: no signed-in Captain — sign in before capturing.');
    const { data, error } = await supabase.functions.invoke('classify-capture', {
      body: { owner_id: ownerId, commitNodes: nodes },
    });
    if (error) throw error;
    xaiSuccess();
    return data as CommitResult;
  } catch (err) {
    xaiError();
    throw err;
  }
}

/**
 * Step 3 addendum: when liveClassify() fails — offline, ANTHROPIC_API_KEY
 * unset/out of credit, whatever — the app previously fell back to a
 * visual-only demo that never touched Supabase, which meant a capture could
 * silently vanish instead of becoming a real node. This still routes through
 * the exact same offlineClassify() heuristic below (so the UI behaves
 * identically to the original prototype fallback), but now actually writes
 * the result as a real node, so "capture something, watch it appear live
 * elsewhere" keeps holding even when live AI is unavailable. */
export async function offlineCommit(text: string, ownerIdOverride: string | null = null): Promise<{ nodeId: string | null }> {
  const ownerId = ownerIdOverride ?? (await currentOwnerId());
  if (!ownerId) throw new Error('offlineCommit: no signed-in Captain — sign in before capturing.');
  const c = offlineClassify(text);
  const { data: project } = await supabase.from('projects').select('id').eq('owner_id', ownerId).eq('slug', c.proj).maybeSingle();
  const kind = c.hops.includes('bugs') ? 'bug' : c.hops.includes('studio') ? 'design' : c.hops.includes('roadmaps') ? 'roadmap_item' : 'task';
  const { data, error } = await supabase
    .from('nodes')
    .insert({
      owner_id: ownerId,
      project_id: project?.id ?? null,
      kind,
      title: text.length > 80 ? text.slice(0, 77) + '…' : text,
      body: text,
      source: 'capture_text',
      ai_classified: false,
      status: 'open',
    })
    .select('id')
    .single();
  if (error) throw error;
  return { nodeId: data?.id ?? null };
}

/** Icon-name + text pair for the offline-mock capture label, rendered via
 * `<Icon>` at the JSX call site (this is a plain .ts file, so it can't embed
 * JSX itself) — mirrors the `ZONE_LABEL` pattern in projects/index.tsx. */
export interface OfflineLabel {
  icon: IconName;
  text: string;
}

/** Local fallback classifier — used when the Edge Function is unreachable
 * (offline, key not set). Mirrors the prototype's classify() so the demo
 * flow never breaks even without live AI. */
export function offlineClassify(text: string) {
  const l = text.toLowerCase();
  const proj = /studyhive|study/.test(l)
    ? 'studyhive'
    : /novel|chapter/.test(l)
      ? 'novel'
      : /music|song|track/.test(l)
        ? 'music'
        : /website|site/.test(l)
          ? 'website'
          : 'studyhive';
  const hops: string[] = ['capture'];
  if (/bug|fix|broken|crash|error/.test(l)) hops.push('bugs');
  if (/design|mockup|logo|color|screen|glow|splash|ui/.test(l)) hops.push('studio');
  if (/roadmap|milestone|release|version|someday/.test(l)) hops.push('roadmaps');
  if (/focus|session|deep work/.test(l)) hops.push('focus');
  if (!hops.includes('projects')) hops.splice(1, 0, 'projects');
  const label: OfflineLabel = hops.includes('bugs')
    ? { icon: 'bugTracker', text: 'BUG' }
    : hops.includes('studio')
      ? { icon: 'designStudio', text: 'DESIGN' }
      : { icon: 'diamond', text: 'IDEA' };
  return { hops, proj, label };
}
