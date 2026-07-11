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

/** RELEASES — ported 1:1 from xos-prototype.html. */
export default function Releases({ active }: { active: boolean }) {
  return (
    <section className={`room ambient ${active ? 'on' : ''}`} id="r-releases">
      <AmbientField mood="amber" density={24} active={active} parallax />
      <div className="roomInner">
      <h2 className="rh"><Icon name="releases" size={18} /> RELEASES</h2>
      <div className="rsub">EVERY RELEASE BECOMES PART OF HISTORY. THE CORE REMEMBERS WHAT SHIPPED.</div>
      {releases.map((r) => (
        <div className="cap" key={r.v} style={{ borderLeft: `3px solid ${r.color}` }}>
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
