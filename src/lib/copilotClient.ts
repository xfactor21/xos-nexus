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

export async function liveClassify(text: string, ownerId: string | null = null): Promise<ClassifyResult> {
  const { data, error } = await supabase.functions.invoke('classify-capture', {
    body: { text, owner_id: ownerId },
  });
  if (error) throw error;
  return data as ClassifyResult;
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
  const label = hops.includes('bugs') ? '🐞 BUG' : hops.includes('studio') ? '🎨 DESIGN' : '◆ IDEA';
  return { hops, proj, label };
}
