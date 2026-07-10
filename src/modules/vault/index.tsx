import { useState } from 'react';
import { useCoreGraph } from '../../stores/coreGraph';

type Kind = 'all' | 'decision' | 'learning' | 'pattern';

/** MEMORY VAULT — ported 1:1 from xos-prototype.html: search + kind filter
 * chips over the memories list, now reading from the shared store so
 * Roadmaps' "promote a pattern into a milestone" affordance stays in sync. */
export default function Vault({ active }: { active: boolean }) {
  const memories = useCoreGraph((s) => s.memories);
  const [kind, setKind] = useState<Kind>('all');
  const [q, setQ] = useState('');

  const filtered = memories.filter((m) => (kind === 'all' || m.kind === kind) && (!q || m.content.toLowerCase().includes(q.toLowerCase())));

  return (
    <section className={`room ${active ? 'on' : ''}`} id="r-vault">
      <h2 className="rh">🗄 MEMORY VAULT</h2>
      <div className="rsub">EVERYTHING THE CORE HAS LEARNED. SEARCHABLE. QUERYABLE. ALIVE.</div>
      <input id="vsearch" placeholder='Search memories… try "auth" or "bee"' value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="optrow">
        {(['all', 'decision', 'learning', 'pattern'] as Kind[]).map((k) => (
          <span key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
            {k.toUpperCase()}
          </span>
        ))}
      </div>
      <div id="mems">
        {filtered.map((m) => (
          <div className="mem" key={m.id}>
            <span className="k">
              {m.kind.toUpperCase()} · {m.createdLabel}
            </span>
            {m.content}
            <div className="mt">
              ◈ RECALLED {m.recalledCount}× THIS WEEK · LINKED TO {m.linkedNodeCount} NODES
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
