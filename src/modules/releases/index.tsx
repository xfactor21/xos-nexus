import { useMemo } from 'react';
import { useCoreGraph } from '../../stores/coreGraph';
import Icon from '../../design-system/icons/Icon';
import type { IconName } from '../../design-system/icons/registry';
import AmbientField from '../../design-system/background/AmbientField';

// Amendment v0.6 step 1: status is now an { icon, text } pair instead of a
// glyph-prefixed string — the icon renders at the JSX call site.
const releases: { v: string; color: string; date: string; statusIcon: IconName; statusText: string; statusColor: string; notes: string }[] = [
  {
    v: 'v0.5.0 — ROOMS ONLINE',
    color: 'var(--amber)',
    date: 'TODAY',
    statusIcon: 'bolt',
    statusText: 'IN PROGRESS',
    statusColor: 'var(--amber)',
    notes: '+ Observatory (4 views) · Awakening sequence<br>+ Living Neural Core redesign<br>+ Full rooms: Capture, Projects, Focus, Studio, Roadmaps, Bugs, Vault, Comms, Settings<br>+ Cross-room routing lines',
  },
  {
    v: 'v0.2.0 — DATA & DOCS',
    color: 'var(--cyan)',
    date: '2026-07-07',
    statusIcon: 'check',
    statusText: 'TAGGED',
    statusColor: 'var(--cyan)',
    notes: '+ Supabase schema: nodes, edges, memories, suggestions (RLS)<br>+ Notion HQ: Blueprint v0.2 · Design System · xAI Spec · Engineering Bible',
  },
  {
    v: 'v0.1.0 — FOUNDATION',
    color: 'var(--cyan)',
    date: 'SPRINT 001',
    statusIcon: 'check',
    statusText: 'TAGGED',
    statusColor: 'var(--cyan)',
    notes: '+ Boot screen · dashboard · sidebar · Neural Core · mission cards · cyberpunk theme',
  },
];

/** RELEASES — cockpit redesign: reframed as a Captain's ship's-log rather
 * than a changelog list, plus a live "unlogged work" entry that xAI drafts
 * itself from real completed nodes (status === 'done') that haven't been
 * folded into a tagged release yet — built from actual coreGraph data, not
 * fabricated entries, so it goes empty honestly when nothing's shipped. */
export default function Releases({ active }: { active: boolean }) {
  const nodes = useCoreGraph((s) => s.nodes);

  const unlogged = useMemo(() => {
    return nodes
      .filter((n) => n.status === 'done' && n.kind !== 'release')
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 8);
  }, [nodes]);

  return (
    <section className={`room ambient ${active ? 'on' : ''}`} id="r-releases">
      <AmbientField mood="amber" density={24} active={active} parallax />
      <div className="roomInner">
      <h2 className="rh"><Icon name="releases" size={18} /> SHIP'S LOG</h2>
      <div className="rsub">EVERY RELEASE BECOMES PART OF HISTORY. THE CORE REMEMBERS WHAT SHIPPED.</div>

      {unlogged.length > 0 && (
        <div className="shipLogDraft">
          <b><Icon name="xai" size={12} glow="cyan" /> xAI-DRAFTED — UNLOGGED WORK, THIS SESSION</b>
          <div className="rsub" style={{ margin: '4px 0 8px' }}>
            {unlogged.length} completed node{unlogged.length === 1 ? '' : 's'} not yet folded into a tagged release. Draft summary, Captain's review pending:
          </div>
          <ul>
            {unlogged.map((n) => (
              <li key={n.id}>{n.title}</li>
            ))}
          </ul>
        </div>
      )}

      {releases.map((r, i) => (
        <div className="cap shipLogEntry" key={r.v} style={{ borderLeft: `3px solid ${r.color}` }}>
          <div className="shipLogStardate">LOG ENTRY {releases.length - i} · STARDATE {r.date}</div>
          {r.v}
          <div className="meta">
            <span>{r.date}</span>
            <span style={{ color: r.statusColor }}>
              <Icon name={r.statusIcon} size={11} /> {r.statusText}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: r.notes }} />
        </div>
      ))}
      </div>
    </section>
  );
}
