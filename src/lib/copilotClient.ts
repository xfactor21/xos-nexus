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
}

export async function liveClassify(text: string, ownerIdOverride: string | null = null): Promise<ClassifyResult> {
  const ownerId = ownerIdOverride ?? (await currentOwnerId());
  if (!ownerId) throw new Error('liveClassify: no signed-in Captain — sign in before capturing.');
  const { data, error } = await supabase.functions.invoke('classify-capture', {
    body: { text, owner_id: ownerId },
  });
  if (error) throw error;
  return data as ClassifyResult;
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
