import { useMemo, useState } from 'react';
import { useCoreGraph } from '../../stores/coreGraph';
import type { EdgeRecord, KnowledgeSnapshotMeta, NodeRecord } from '../../core/types';
import Icon from '../../design-system/icons/Icon';
import AmbientField from '../../design-system/background/AmbientField';
import ShipAmbience from '../../design-system/background/ShipAmbience';

function metaOf(n: NodeRecord): KnowledgeSnapshotMeta {
  const m = (n.metadata ?? {}) as Partial<KnowledgeSnapshotMeta>;
  return { url: m.url ?? '', description: m.description ?? '', textContent: m.textContent ?? '', savedAt: m.savedAt ?? n.created_at };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function Knowledge({ active }: { active: boolean }) {
  const nodes = useCoreGraph((s) => s.nodes);
  const edges = useCoreGraph((s) => s.edges);
  const deleteNode = useCoreGraph((s) => s.deleteNode);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  function handleDeleteSnapshot(id: string, title: string) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    deleteNode(id);
    setSelected((cur) => (cur === id ? null : cur));
  }

  const snapshots = useMemo(
    () =>
      nodes
        .filter((n) => n.kind === 'knowledge_snapshot')
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [nodes],
  );

  const filtered = useMemo(() => {
    if (!q.trim()) return snapshots;
    const ql = q.toLowerCase();
    return snapshots.filter((n) => {
      const meta = metaOf(n);
      return n.title.toLowerCase().includes(ql) || meta.description.toLowerCase().includes(ql) || meta.url.toLowerCase().includes(ql);
    });
  }, [snapshots, q]);

  const selectedNode = snapshots.find((n) => n.id === selected) ?? null;
  const selectedMeta = selectedNode ? metaOf(selectedNode) : null;

  const linkedNodes = useMemo(() => {
    if (!selectedNode) return [];
    return edges
      .filter((e) => e.from_node === selectedNode.id || e.to_node === selectedNode.id)
      .map((e) => {
        const otherId = e.from_node === selectedNode.id ? e.to_node : e.from_node;
        const other = nodes.find((n) => n.id === otherId);
        return other ? { node: other, relation: e.relation } : null;
      })
      .filter((x): x is { node: NodeRecord; relation: EdgeRecord['relation'] } => x !== null);
  }, [edges, nodes, selectedNode]);

  return (
    <section className={`room ambient ${active ? 'on' : ''}`} id="r-knowledge">
      <AmbientField mood="purple" density={16} active={active} parallax />
      <ShipAmbience kind="terminal" corner="tr" active={active} />
      <div className="roomInner">
        <h2 className="rh">
          <Icon name="knowledgeMatrix" size={16} glow="purple" /> KNOWLEDGE MATRIX
        </h2>
        <div className="rsub">{snapshots.length} SAVED · OFFLINE REFERENCE</div>

        <div className="optrow" style={{ margin: '0 0 14px' }}>
          <input
            className="browserAddress"
            style={{ maxWidth: 420 }}
            placeholder="Search saved pages…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {!filtered.length && (
          <div className="knowledgeEmpty">
            <Icon name="knowledgeMatrix" size={28} />
            <div>{snapshots.length ? 'No matches.' : 'Nothing saved yet — use ADD TO MATRIX in the Browser room.'}</div>
          </div>
        )}

        <div className="knowledgeGrid">
          {filtered.map((n) => {
            const meta = metaOf(n);
            return (
              <div key={n.id} className="knowledgeCard" onClick={() => setSelected(n.id)}>
                <button
                  className="dpBoardDel"
                  title="delete snapshot"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteSnapshot(n.id, n.title);
                  }}
                >
                  <Icon name="trash" size={12} />
                </button>
                <div className="knowledgeCardTitle">{n.title}</div>
                <div className="knowledgeCardDesc">{meta.description || 'No description available.'}</div>
                <div className="knowledgeCardMeta">
                  <span className="knowledgeCardHost">
                    <Icon name="link" size={11} /> {hostOf(meta.url)}
                  </span>
                  <span>{new Date(meta.savedAt).toLocaleDateString()}</span>
                </div>
              </div>
            );
          })}
        </div>

        {selectedNode && selectedMeta && (
          <div className="knowledgeOverlay" onClick={() => setSelected(null)}>
            <div className="knowledgePanel" onClick={(e) => e.stopPropagation()}>
              <div className="knowledgePanelHeader">
                <div>
                  <div className="knowledgePanelTitle">{selectedNode.title}</div>
                  <a href={selectedMeta.url} target="_blank" rel="noreferrer" className="knowledgePanelUrl">
                    {selectedMeta.url}
                  </a>
                </div>
                <span
                  className="browserNavBtn"
                  title="delete snapshot"
                  onClick={() => handleDeleteSnapshot(selectedNode.id, selectedNode.title)}
                >
                  <Icon name="trash" size={14} />
                </span>
                <span className="browserNavBtn" onClick={() => setSelected(null)}>
                  <Icon name="close" size={14} />
                </span>
              </div>
              <div className="knowledgePanelSaved">
                Saved offline {new Date(selectedMeta.savedAt).toLocaleString()} — reading the stored snapshot, not a live re-fetch.
              </div>
              {linkedNodes.length > 0 && (
                <div className="knowledgePanelLinks">
                  {linkedNodes.map(({ node, relation }) => (
                    <span key={node.id} className="chip">
                      <Icon name="tag" size={11} /> {relation.replace('_', ' ')} · {node.title}
                    </span>
                  ))}
                </div>
              )}
              <div className="knowledgePanelBody">{selectedMeta.textContent || selectedMeta.description || 'No offline text was captured for this page.'}</div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
