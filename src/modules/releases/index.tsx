import { useMemo, useState } from 'react';
import { useCoreGraph } from '../../stores/coreGraph';
import { askConfirm } from '../../stores/confirmStore';
import { pushToast } from '../../stores/toastStore';
import Icon from '../../design-system/icons/Icon';
import AmbientField from '../../design-system/background/AmbientField';
import ShipAmbience from '../../design-system/background/ShipAmbience';
import type { NodeRecord } from '../../core/types';

type ReleaseStatus = 'in_progress' | 'done';

/** STARDATE label for a release entry — 'TODAY' for anything logged in the
 * last 24h (matches the room's original prototype copy), else the plain
 * ISO date. No free-text stardate field to fill in by hand anymore — the
 * timestamp is real now, so the label can be derived instead of typed. */
function stardate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'TODAY';
  return new Date(iso).toISOString().slice(0, 10);
}

/** Ship's Log / Releases — Step: real CRUD over `nodes` (kind: 'release')
 * instead of a hardcoded array. Every release a Captain logs here is a
 * real, owner-scoped, Realtime-synced node — visible instantly from any
 * device, editable and deletable in place, same conventions as Custom
 * Commands' edit-in-place and Bug Tracker's addBug/updateBug. */
export default function Releases({ active }: { active: boolean }) {
  const nodes = useCoreGraph((s) => s.nodes);
  const addRelease = useCoreGraph((s) => s.addRelease);
  const updateRelease = useCoreGraph((s) => s.updateRelease);
  const deleteNode = useCoreGraph((s) => s.deleteNode);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<ReleaseStatus>('in_progress');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const releases = useMemo(
    () =>
      nodes
        .filter((n): n is NodeRecord & { status: ReleaseStatus } => n.kind === 'release')
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [nodes],
  );

  const unlogged = useMemo(() => {
    return nodes
      .filter((n) => n.status === 'done' && n.kind !== 'release')
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 8);
  }, [nodes]);

  function resetForm() {
    setTitle('');
    setNotes('');
    setStatus('in_progress');
    setEditingId(null);
  }

  function handleEdit(r: NodeRecord) {
    setEditingId(r.id);
    setTitle(r.title);
    setNotes(r.body ?? '');
    setStatus(r.status === 'done' ? 'done' : 'in_progress');
  }

  /** Clicking a drafted-but-unlogged item folds its title into the notes
   * field as a bullet line — the "xAI-drafted" callout becomes an actual
   * shortcut into the log-a-release form instead of a static list. */
  function foldIntoDraft(n: NodeRecord) {
    setNotes((prev) => (prev.trim() ? `${prev}\n+ ${n.title}` : `+ ${n.title}`));
  }

  async function handleSubmit() {
    const t = title.trim();
    if (!t) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateRelease(editingId, { title: t, notes: notes.trim(), status });
        pushToast(`"${t}" updated.`, 'success');
      } else {
        await addRelease({ title: t, notes: notes.trim(), status });
        pushToast(`"${t}" logged to the ship's log.`, 'success');
      }
      resetForm();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(r: NodeRecord) {
    if (!(await askConfirm(`Delete release "${r.title}" from the ship's log?`, { tone: 'danger', confirmLabel: 'DELETE' }))) return;
    if (editingId === r.id) resetForm();
    await deleteNode(r.id);
  }

  return (
    <section className={`room ambient ${active ? 'on' : ''}`} id="r-releases">
      <AmbientField mood="amber" density={24} active={active} parallax />
      <ShipAmbience kind="terminal" corner="br" active={active} />
      <div className="roomInner">
      <h2 className="rh"><Icon name="releases" size={18} /> SHIP'S LOG</h2>
      <div className="rsub">EVERY RELEASE BECOMES PART OF HISTORY. THE CORE REMEMBERS WHAT SHIPPED.</div>

      {unlogged.length > 0 && (
        <div className="shipLogDraft">
          <b><Icon name="xai" size={12} glow="cyan" /> xAI-DRAFTED — UNLOGGED WORK, THIS SESSION</b>
          <div className="rsub" style={{ margin: '4px 0 8px' }}>
            {unlogged.length} completed node{unlogged.length === 1 ? '' : 's'} not yet folded into a tagged release. Click one to fold it into the draft below:
          </div>
          <ul>
            {unlogged.map((n) => (
              <li key={n.id} style={{ cursor: 'pointer' }} onClick={() => foldIntoDraft(n)} title="fold into new release notes">
                {n.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={`cmdCustomForm ${editingId ? 'editing' : ''}`} style={{ marginBottom: 18 }}>
        {editingId && (
          <div className="cmdCustomEditingNote">
            <Icon name="pencil" size={11} /> EDITING — changes replace this log entry in place
          </div>
        )}
        <input
          placeholder='Release title — e.g. "v0.6.0 — INTELLIGENCE"'
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="optrow" style={{ margin: 0 }}>
          <span className={`chip ${status === 'in_progress' ? 'on' : ''}`} onClick={() => setStatus('in_progress')}>
            <Icon name="bolt" size={11} /> IN PROGRESS
          </span>
          <span className={`chip ${status === 'done' ? 'on' : ''}`} onClick={() => setStatus('done')}>
            <Icon name="check" size={11} /> TAGGED
          </span>
        </div>
        <textarea
          placeholder={'Release notes — one line per entry, e.g.\n+ Observatory redesign\n+ Realtime wired across rooms'}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
        <div className="optrow" style={{ margin: 0 }}>
          {editingId && (
            <span className="chip" style={{ marginLeft: 'auto' }} onClick={resetForm}>
              <Icon name="close" size={12} /> CANCEL
            </span>
          )}
          <span
            className="chip"
            style={{ marginLeft: editingId ? 8 : 'auto', opacity: title.trim() && !saving ? 1 : 0.4, pointerEvents: title.trim() && !saving ? 'auto' : 'none' }}
            onClick={handleSubmit}
          >
            <Icon name={editingId ? 'save' : 'plus'} size={12} /> {saving ? 'SAVING…' : editingId ? 'SAVE CHANGES' : 'LOG RELEASE'}
          </span>
        </div>
      </div>

      {releases.length === 0 && (
        <div className="rsub" style={{ fontSize: 9 }}>
          No releases logged yet — the first entry you log becomes LOG ENTRY 1.
        </div>
      )}

      {releases.map((r, i) => {
        const tagged = r.status === 'done';
        const color = tagged ? 'var(--cyan)' : 'var(--amber)';
        return (
          <div className="cap shipLogEntry" key={r.id} style={{ borderLeft: `3px solid ${color}`, position: 'relative' }}>
            <div className="shipLogStardate">LOG ENTRY {releases.length - i} · STARDATE {stardate(r.created_at)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1 }}>{r.title}</span>
              <span className="cmdCustomEdit" onClick={() => handleEdit(r)} title="edit release">
                <Icon name="pencil" size={12} />
              </span>
              <span className="cmdCustomDel" onClick={() => handleDelete(r)} title="delete release">
                <Icon name="trash" size={12} />
              </span>
            </div>
            <div className="meta">
              <span>{stardate(r.created_at)}</span>
              <span style={{ color }}>
                <Icon name={tagged ? 'check' : 'bolt'} size={11} /> {tagged ? 'TAGGED' : 'IN PROGRESS'}
              </span>
            </div>
            {r.body && (
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.7 }}>
                {r.body.split('\n').map((line, li) => (
                  <span key={li}>
                    {line}
                    <br />
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      </div>
    </section>
  );
}
