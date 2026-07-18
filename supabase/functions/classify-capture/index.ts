/**
 * xOS: neXus — Copilot Client
 * copilot/client.ts
 *
 * The single gateway every room calls to talk to xAI.
 * No room ever calls Claude or Supabase directly for classification —
 * everything routes through capture() below.
 *
 * Pipeline: CLASSIFY → WRITE → BROADCAST → (rooms REFLECT via subscription)
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const MODEL = 'claude-sonnet-5';
const CONFIDENCE_THRESHOLD = 0.75;

/* ============================================================
   TYPES
   ============================================================ */
type NodeKind =
  | 'task' | 'note' | 'doc' | 'bug' | 'idea'
  | 'design' | 'roadmap_item' | 'conversation' | 'knowledge_snapshot';

interface ClassifiedNode {
  kind: NodeKind;
  title: string;
  body: string;
  project_slug: string | null;
  confidence: number;
  reasoning: string;
  relationships: { relation: string; target_node_id: string }[];
}

interface ClassifyResult {
  nodes: ClassifiedNode[];
}

interface CaptureContext {
  projects: { id: string; slug: string; name: string }[];
  currentSprint: { id: string; name: string } | null;
  recentNodes: { id: string; title: string; kind: string; created_at: string }[];
  memories: { id: string; content: string; kind: string }[];
}

/* ============================================================
   THE SYSTEM PROMPT
   ============================================================ */
const SYSTEM_PROMPT = `You are xAI, the intelligence layer of xOS: neXus — a personal operating
system for thought. The Captain will give you a raw, unstructured thought.
Your job is to dissect it into one or more structured nodes and route each
to the correct destination. Never ask the Captain to file anything themselves.

CONTEXT PROVIDED TO YOU EACH CALL:
- Active projects (name, slug, recent activity)
- Current sprint + open tasks
- Recent nodes (last 48h) for this owner
- Relevant long-term memories (vector recall, top 5)

FOR EACH NODE YOU EXTRACT, RETURN:
- kind: one of [task, note, doc, bug, idea, design, roadmap_item, conversation]
- title: short, human-readable
- body: the relevant portion of the original thought
- project_slug: which project this belongs to (or null if unclear)
- confidence: 0.0-1.0
- reasoning: one sentence, shown to the Captain — be specific, not generic
- relationships: array of {relation, target_node_id} if this connects to
  something in recent nodes or memories

RULES:
- A single thought MAY produce multiple nodes (e.g. a feature request that
  implies both a task and a design item). Extract every distinct unit.
- If confidence < 0.75, still return your best guess — the client will
  surface it for confirmation rather than auto-filing it.
- Always attempt at least one relationship lookup against recent memories.
  Silence here is a missed opportunity for the Captain to feel understood.
- Never fabricate a project_slug that wasn't in the provided context.
- reasoning must never restate the rule you used ("detected action verb") —
  say what you noticed, in plain language, as a teammate would.

RESPOND WITH JSON ONLY. No markdown fences, no preamble. Schema:
{ "nodes": [ { "kind": "...", "title": "...", "body": "...",
  "project_slug": "...", "confidence": 0.0, "reasoning": "...",
  "relationships": [] } ] }`;

/* ============================================================
   CONTEXT GATHERING
   ============================================================ */
async function gatherContext(ownerId: string): Promise<CaptureContext> {
  const [{ data: projects }, { data: sprint }, { data: recentNodes }, { data: memories }] =
    await Promise.all([
      supabase.from('projects').select('id, slug, name').eq('owner_id', ownerId).eq('status', 'active'),
      supabase.from('sprints').select('id, name').eq('owner_id', ownerId).eq('status', 'current').maybeSingle(),
      supabase.from('nodes').select('id, title, kind, created_at')
        .eq('owner_id', ownerId)
        .gte('created_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(30),
      supabase.from('memories').select('id, content, kind').eq('owner_id', ownerId).limit(5),
    ]);

  return {
    projects: projects ?? [],
    currentSprint: sprint ?? null,
    recentNodes: recentNodes ?? [],
    memories: memories ?? [],
  };
}

/* ============================================================
   CLASSIFY — the Claude call
   ============================================================ */
async function classify(rawText: string, ctx: CaptureContext): Promise<ClassifyResult> {
  const contextBlock = `
ACTIVE PROJECTS: ${ctx.projects.map(p => `${p.slug} ("${p.name}")`).join(', ') || 'none yet'}
CURRENT SPRINT: ${ctx.currentSprint?.name ?? 'none'}
RECENT NODES (48h): ${ctx.recentNodes.map(n => `[${n.kind}] ${n.title}`).join(' · ') || 'none'}
RELEVANT MEMORIES: ${ctx.memories.map(m => `(${m.kind}) ${m.content}`).join(' · ') || 'none'}
`.trim();

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: `${contextBlock}\n\nCAPTAIN'S THOUGHT: "${rawText}"` },
    ],
  });

  const text = resp.content
    .filter(b => b.type === 'text')
    .map(b => (b as any).text)
    .join('')
    .replace(/```json|```/g, '')
    .trim();

  try {
    return JSON.parse(text) as ClassifyResult;
  } catch (err) {
    // Fail safe: never lose the Captain's thought. File as a low-confidence note.
    return {
      nodes: [{
        kind: 'note',
        title: rawText.slice(0, 60),
        body: rawText,
        project_slug: null,
        confidence: 0.3,
        reasoning: 'Classification failed — stored as-is for manual review.',
        relationships: [],
      }],
    };
  }
}

/* ============================================================
   CAPTURE — classify → write → broadcast
   ============================================================ */
export async function capture(rawText: string, ownerId: string) {
  const ctx = await gatherContext(ownerId);
  const result = await classify(rawText, ctx);
  const written: any[] = [];

  for (const n of result.nodes) {
    const confirmed = n.confidence >= CONFIDENCE_THRESHOLD;
    const project = ctx.projects.find(p => p.slug === n.project_slug);

    const { data: node, error } = await supabase
      .from('nodes')
      .insert({
        owner_id: ownerId,
        project_id: project?.id ?? null,
        kind: n.kind,
        title: n.title,
        body: n.body,
        source: 'capture_text',
        ai_classified: true,
        ai_confidence: n.confidence,
        ai_reasoning: n.reasoning,
        status: confirmed ? 'open' : 'open', // pending_review handled via ai_confidence in UI filter
      })
      .select()
      .single();

    if (error) { console.error('capture: node insert failed', error); continue; }

    for (const rel of n.relationships ?? []) {
      await supabase.from('edges').insert({
        owner_id: ownerId,
        from_node: node.id,
        to_node: rel.target_node_id,
        relation: rel.relation,
        created_by: 'copilot',
        ai_confidence: n.confidence,
      });
    }

    if (project) {
      await supabase.channel(`project:${project.id}`).send({
        type: 'broadcast',
        event: 'node_created',
        payload: node,
      });
    }

    written.push({ node, needsConfirmation: !confirmed });
  }

  return written;
}
