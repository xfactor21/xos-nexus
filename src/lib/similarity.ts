/**
 * xOS: neXus — lightweight text similarity for real bug duplicate detection.
 *
 * Deliberately NOT an AI call: this runs synchronously on every new bug
 * report against the Captain's existing bugs, so it needs to be instant and
 * free. Jaccard similarity over normalized, stopword-filtered word sets is a
 * simple, deterministic, honest signal — "these two bug reports share most
 * of their meaningful words" — not a claim of semantic understanding.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'for',
  'and', 'or', 'it', 'this', 'that', 'with', 'as', 'at', 'by', 'be', 'has',
  'have', 'had', 'not', 'but', 'when', 'then', 'than', 'from', 'into', 'up',
  'out', 'so', 'if', 'do', 'does', 'did', 'can', 'will', 'would', 'should',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** Jaccard similarity (0..1) between two texts' significant word sets. */
export function textSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.size || !tb.size) return 0;
  let intersection = 0;
  ta.forEach((w) => {
    if (tb.has(w)) intersection++;
  });
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Finds the best-matching existing item above `threshold`, if any — used to
 * flag a newly-reported bug as a likely duplicate of one already tracked. */
export function findBestDuplicate<T extends { id: string; title: string; body: string }>(
  candidate: { title: string; body: string },
  existing: T[],
  threshold = 0.34,
): { id: string; similarity: number } | null {
  const candidateText = `${candidate.title} ${candidate.body}`;
  let best: { id: string; similarity: number } | null = null;
  for (const item of existing) {
    const score = textSimilarity(candidateText, `${item.title} ${item.body}`);
    if (score >= threshold && (!best || score > best.similarity)) {
      best = { id: item.id, similarity: score };
    }
  }
  return best;
}
