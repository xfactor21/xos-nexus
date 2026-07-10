const releases = [
  {
    v: 'v0.5.0 — ROOMS ONLINE',
    color: 'var(--amber)',
    date: 'TODAY',
    status: '▸ IN PROGRESS',
    statusColor: 'var(--amber)',
    notes: '+ Observatory (4 views) · Awakening sequence<br>+ Living Neural Core redesign<br>+ Full rooms: Capture, Projects, Focus, Studio, Roadmaps, Bugs, Vault, Comms, Settings<br>+ Cross-room routing lines',
  },
  {
    v: 'v0.2.0 — DATA & DOCS',
    color: 'var(--cyan)',
    date: '2026-07-07',
    status: '✓ TAGGED',
    statusColor: 'var(--cyan)',
    notes: '+ Supabase schema: nodes, edges, memories, suggestions (RLS)<br>+ Notion HQ: Blueprint v0.2 · Design System · xAI Spec · Engineering Bible',
  },
  {
    v: 'v0.1.0 — FOUNDATION',
    color: 'var(--cyan)',
    date: 'SPRINT 001',
    status: '✓ TAGGED',
    statusColor: 'var(--cyan)',
    notes: '+ Boot screen · dashboard · sidebar · Neural Core · mission cards · cyberpunk theme',
  },
];

/** RELEASES — ported 1:1 from xos-prototype.html. */
export default function Releases({ active }: { active: boolean }) {
  return (
    <section className={`room ${active ? 'on' : ''}`} id="r-releases">
      <h2 className="rh">📦 RELEASES</h2>
      <div className="rsub">EVERY RELEASE BECOMES PART OF HISTORY. THE CORE REMEMBERS WHAT SHIPPED.</div>
      {releases.map((r) => (
        <div className="cap" key={r.v} style={{ borderLeft: `3px solid ${r.color}` }}>
          {r.v}
          <div className="meta">
            <span>{r.date}</span>
            <span style={{ color: r.statusColor }}>{r.status}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: r.notes }} />
        </div>
      ))}
    </section>
  );
}
