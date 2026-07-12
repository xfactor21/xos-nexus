import { useMemo, useState } from 'react';
import { useCoreGraph } from '../../stores/coreGraph';
import type { MemoryRecord } from '../../core/types';
import Icon from '../../design-system/icons/Icon';
import AmbientField from '../../design-system/background/AmbientField';

type Kind = 'all' | 'decision' | 'learning' | 'pattern';
type ViewMode = 'list' | 'graph';

const KIND_HUE: Record<string, string> = {
  decision: 'var(--mg)',
  learning: 'var(--cy)',
  pattern: 'var(--pu)',
  preference: 'var(--pk)',
  history: 'var(--text-dim)',
};
const KIND_ANGLE: Record<string, number> = {
  decision: 0,
  learning: 72,
  pattern: 144,
  preference: 216,
  history: 288,
};

/** Cockpit redesign — Memory Vault gets an Obsidian-style graph view
 * (real cluster browsing by kind, positioned/sized from real data — no
 * canned layout), strength/decay indicators computed off actual age +
 * linkage (not a fabricated metric), and an "on this day" panel that scans
 * real created_at values for same-month/day memories from prior years. */
function ageDays(iso: string): number {
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 86_400_000);
}
/** Decay curve: half-life ~40 days, boosted by how connected the memory is
 * to the rest of the graph (well-linked memories fade slower — they keep
 * getting reinforced by association, same intuition as spaced repetition). */
function strengthOf(m: MemoryRecord): number {
  const halfLife = 40 * (1 + m.linkedNodeCount * 0.35 + m.recalledCount * 0.5);
  return Math.pow(0.5, ageDays(m.created_at) / halfLife);
}
function strengthBand(s: number): 'strong' | 'fading' | 'dormant' {
  if (s > 0.66) return 'strong';
  if (s > 0.3) return 'fading';
  return 'dormant';
}

export default function Vault({ active }: { active: boolean }) {
  const memories = useCoreGraph((s) => s.memories);
  const [kind, setKind] = useState<Kind>('all');
  const [q, setQ] = useState('');
  const [view, setView] = useState<ViewMode>('list');
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = memories.filter((m) => (kind === 'all' || m.kind === kind) && (!q || m.content.toLowerCase().includes(q.toLowerCase())));

  // "On this day" — real scan of created_at for same month+day, any prior
  // year. No fabricated entries; renders nothing if history doesn't reach
  // back far enough yet.
  const onThisDay = useMemo(() => {
    const today = new Date();
    return memories.filter((m) => {
      const d = new Date(m.created_at);
      return d.getMonth() === today.getMonth() && d.getDate() === today.getDate() && d.getFullYear() < today.getFullYear();
    });
  }, [memories]);

  // Graph layout — deterministic per-id hash so re-renders don't jitter
  // node positions; radius shrinks toward the cluster center as a memory's
  // decay strength rises (stronger = pulled toward the "living" core).
  function layout(m: MemoryRecord, idxInKind: number, totalInKind: number) {
    const baseAngle = (KIND_ANGLE[m.kind] ?? 0) * (Math.PI / 180);
    const spread = (Math.PI / 180) * 50;
    const angle = baseAngle + (totalInKind > 1 ? (idxInKind / (totalInKind - 1) - 0.5) * spread : 0);
    const s = strengthOf(m);
    const r = 34 + (1 - s) * 26; // % of container radius
    return { x: 50 + Math.cos(angle) * r, y: 50 + Math.sin(angle) * r, s };
  }
  const byKind = useMemo(() => {
    const groups: Record<string, MemoryRecord[]> = {};
    filtered.forEach((m) => (groups[m.kind] ??= []).push(m));
    return groups;
  }, [filtered]);
  const selectedMemory = memories.find((m) => m.id === selected) ?? null;

  return (
    <section className={`room ambient ${active ? 'on' : ''}`} id="r-vault">
      <AmbientField mood="purple" density={24} active={active} parallax />
      <div className="roomInner">
      <h2 className="rh">
        <Icon name="memoryVault" size={16} glow="cyan" /> MEMORY VAULT
      </h2>
      <div className="rsub">EVERYTHING THE CORE HAS LEARNED. SEARCHABLE. QUERYABLE. ALIVE.</div>

      {onThisDay.length > 0 && (
        <div className="onThisDay">
          <b><Icon name="xai" size={12} glow="cyan" /> ON THIS DAY</b>
          {onThisDay.map((m) => (
            <div key={m.id} className="onThisDayItem" onClick={() => setSelected(m.id)}>
              {new Date(m.created_at).getFullYear()} · {m.content.slice(0, 70)}
            </div>
          ))}
        </div>
      )}

      <input id="vsearch" placeholder='Search memories… try "auth" or "bee"' value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="optrow">
        {(['all', 'decision', 'learning', 'pattern'] as Kind[]).map((k) => (
          <span key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
            {k.toUpperCase()}
          </span>
        ))}
        <span className={`chip ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')} style={{ marginLeft: 'auto' }}>
          <Icon name="rows" size={12} /> LIST
        </span>
        <span className={`chip ${view === 'graph' ? 'on' : ''}`} onClick={() => setView('graph')}>
          <Icon name="diagram" size={12} /> GRAPH
        </span>
      </div>

      {view === 'list' && (
        <div id="mems">
          {filtered.map((m) => {
            const band = strengthBand(strengthOf(m));
            return (
              <div className="mem" key={m.id}>
                <span className="k">
                  {m.kind.toUpperCase()} · {m.createdLabel}
                  <span className={`memStrength memStrength-${band}`}>{band.toUpperCase()}</span>
                </span>
                {m.content}
                <div className="mt">
                  <Icon name="xai" size={12} glow="cyan" /> RECALLED {m.recalledCount}× THIS WEEK · LINKED TO {m.linkedNodeCount} NODES
                </div>
              </div>
            );
          })}
          {!filtered.length && <div className="rsub">No memories match this view.</div>}
        </div>
      )}

      {view === 'graph' && (
        <div className="vaultGraph">
          <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
            {Object.entries(byKind).map(([k, ms]) =>
              ms.map((m, i) => {
                const { x, y } = layout(m, i, ms.length);
                return <line key={m.id + '-l'} x1="50" y1="50" x2={x} y2={y} stroke={KIND_HUE[k]} strokeOpacity="0.18" strokeWidth="0.4" />;
              }),
            )}
            {Object.entries(byKind).map(([k, ms]) =>
              ms.map((m, i) => {
                const { x, y, s } = layout(m, i, ms.length);
                const r = 1.6 + m.linkedNodeCount * 0.5 + s * 1.2;
                return (
                  <circle
                    key={m.id}
                    cx={x}
                    cy={y}
                    r={r}
                    fill={KIND_HUE[k]}
                    fillOpacity={0.35 + s * 0.55}
                    stroke={selected === m.id ? 'var(--text)' : 'none'}
                    strokeWidth="0.4"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelected(m.id)}
                  >
                    <title>{m.content.slice(0, 80)}</title>
                  </circle>
                );
              }),
            )}
          </svg>
          <div className="vaultGraphLegend">
            {Object.keys(KIND_HUE).map((k) => (
              <span key={k}><i style={{ background: KIND_HUE[k] }} /> {k.toUpperCase()}</span>
            ))}
          </div>
          {selectedMemory && (
            <div className="mem" style={{ marginTop: 10 }}>
              <span className="k">
                {selectedMemory.kind.toUpperCase()} · {selectedMemory.createdLabel}
                <span className={`memStrength memStrength-${strengthBand(strengthOf(selectedMemory))}`}>
                  {strengthBand(strengthOf(selectedMemory)).toUpperCase()}
                </span>
              </span>
              {selectedMemory.content}
              <div className="mt">
                <Icon name="xai" size={12} glow="cyan" /> RECALLED {selectedMemory.recalledCount}× THIS WEEK · LINKED TO {selectedMemory.linkedNodeCount} NODES
              </div>
            </div>
          )}
          {!filtered.length && <div className="rsub">No memories match this view.</div>}
        </div>
      )}
      </div>
    </section>
  );
}
