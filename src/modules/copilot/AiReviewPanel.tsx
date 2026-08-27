import { useState } from 'react';
import Icon from '../../design-system/icons/Icon';
import type { EdgeRecord, NodeRecord } from '../../core/types';

/**
 * "Review xAI's Tags & Associations" — Captain's explicit ask: a way to
 * look at, correct, and define what xAI has done on its own, rather than
 * only deleting/undoing it. Reachable from Neural Core's REVIEW xAI header
 * button and from Settings.
 *
 * Real, not cosmetic: an AI-authored edge (`created_by: 'copilot'`) that
 * gets Accepted or Corrected here is re-stamped `created_by: 'user'` —
 * the exact column `fetchUserContext()` (copilotClient.ts) already filters
 * on when it pulls context for the next classify-capture call. A
 * Confirmed node tag set is flagged `metadata.tagsConfirmed`, which
 * fetchUserContext reads to phrase it as ground truth rather than a plain
 * edit. Both queues genuinely drain as items get reviewed — a
 * corrected/confirmed edge no longer shows up here (it's no longer
 * AI-authored), which is the intended "help him learn" feedback loop, not
 * a fabricated one.
 *
 * Reuses #corePanelOverlay / #corePanel's existing CSS (NeuralCore.tsx
 * ensures the two never render at once — opening this closes any open
 * node panel, and vice versa) so this needed almost no new layout CSS,
 * just review-specific row styling (see legacy.css's AI REVIEW PANEL block).
 */
export default function AiReviewPanel({
  nodes,
  edges,
  onClose,
  confirmEdge,
  correctEdge,
  deleteEdge,
  confirmNodeTags,
  updateNodeTags,
}: {
  nodes: NodeRecord[];
  edges: EdgeRecord[];
  onClose: () => void;
  confirmEdge: (id: string) => Promise<void>;
  correctEdge: (id: string, patch: { relation?: EdgeRecord['relation']; to_node?: string }) => Promise<void>;
  deleteEdge: (id: string) => Promise<void>;
  confirmNodeTags: (id: string) => Promise<void>;
  updateNodeTags: (id: string, tags: string[]) => Promise<void>;
}) {
  const nodeName = (id: string) => nodes.find((n) => n.id === id)?.title || id;
  const aiEdges = edges.filter((e) => e.created_by === 'copilot');
  const aiTaggedNodes = nodes.filter((n) => {
    const meta = n.metadata as Record<string, unknown> | undefined;
    const tags = (meta?.tags as string[] | undefined) ?? [];
    return n.ai_classified && tags.length > 0 && meta?.tagsConfirmed !== true;
  });

  return (
    <div id="corePanelOverlay" onClick={onClose}>
      <aside id="corePanel" onClick={(e) => e.stopPropagation()}>
        <div id="corePanelHead">
          <h3>REVIEW xAI</h3>
          <button id="corePanelClose" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="corePanelSection">
          <div className="corePanelEmpty">
            Everything below is something xAI decided on its own. Accept what&apos;s right, correct what&apos;s
            wrong, or reject it — accepted and corrected items become confirmed ground truth xAI actually
            reads back before its next classification.
          </div>
        </div>

        <div className="corePanelSection">
          <div className="corePanelLabel">ASSOCIATIONS xAI CREATED ({aiEdges.length})</div>
          {aiEdges.length === 0 && <div className="corePanelEmpty">Nothing unreviewed right now.</div>}
          <div className="aiReviewList">
            {aiEdges.map((e) => (
              <AiEdgeRow key={e.id} edge={e} nodes={nodes} nodeName={nodeName} confirmEdge={confirmEdge} correctEdge={correctEdge} deleteEdge={deleteEdge} />
            ))}
          </div>
        </div>

        <div className="corePanelSection">
          <div className="corePanelLabel">TAGS xAI ASSIGNED ({aiTaggedNodes.length})</div>
          {aiTaggedNodes.length === 0 && <div className="corePanelEmpty">Nothing unreviewed right now.</div>}
          <div className="aiReviewList">
            {aiTaggedNodes.map((n) => (
              <AiTagRow key={n.id} node={n} confirmNodeTags={confirmNodeTags} updateNodeTags={updateNodeTags} />
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

const RELATIONS: EdgeRecord['relation'][] = ['relates_to', 'duplicates', 'blocks', 'solves', 'references', 'derived_from', 'affects'];

function AiEdgeRow({
  edge,
  nodes,
  nodeName,
  confirmEdge,
  correctEdge,
  deleteEdge,
}: {
  edge: EdgeRecord;
  nodes: NodeRecord[];
  nodeName: (id: string) => string;
  confirmEdge: (id: string) => Promise<void>;
  correctEdge: (id: string, patch: { relation?: EdgeRecord['relation']; to_node?: string }) => Promise<void>;
  deleteEdge: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [relation, setRelation] = useState<EdgeRecord['relation']>(edge.relation);
  const [toNode, setToNode] = useState(edge.to_node);
  const busy = false;

  return (
    <div className="aiReviewRow">
      <div className="aiReviewMeta">
        <span>{nodeName(edge.from_node)}</span>
        <Icon name="link" size={11} />
        {editing ? (
          <select value={relation} onChange={(e) => setRelation(e.target.value as EdgeRecord['relation'])}>
            {RELATIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        ) : (
          <em>{edge.relation}</em>
        )}
        <Icon name="link" size={11} />
        {editing ? (
          <select value={toNode} onChange={(e) => setToNode(e.target.value)}>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>{n.title || n.kind}</option>
            ))}
          </select>
        ) : (
          <span>{nodeName(edge.to_node)}</span>
        )}
        {typeof edge.ai_confidence === 'number' && (
          <span className="aiReviewConfidence">{Math.round(edge.ai_confidence * 100)}%</span>
        )}
      </div>
      <div className="aiReviewActions">
        {editing ? (
          <>
            <button onClick={() => { void correctEdge(edge.id, { relation, to_node: toNode }); setEditing(false); }} disabled={busy}>
              <Icon name="check" size={12} /> SAVE
            </button>
            <button onClick={() => setEditing(false)}>CANCEL</button>
          </>
        ) : (
          <>
            <button onClick={() => void confirmEdge(edge.id)}>
              <Icon name="check" size={12} /> ACCEPT
            </button>
            <button onClick={() => setEditing(true)}>
              <Icon name="pencil" size={12} /> CORRECT
            </button>
            <button onClick={() => void deleteEdge(edge.id)}>
              <Icon name="trash" size={12} /> REJECT
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AiTagRow({
  node,
  confirmNodeTags,
  updateNodeTags,
}: {
  node: NodeRecord;
  confirmNodeTags: (id: string) => Promise<void>;
  updateNodeTags: (id: string, tags: string[]) => Promise<void>;
}) {
  const meta = node.metadata as Record<string, unknown> | undefined;
  const tags = (meta?.tags as string[] | undefined) ?? [];
  const [tagInput, setTagInput] = useState('');

  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) return;
    void updateNodeTags(node.id, [...tags, t]);
    setTagInput('');
  }
  function removeTag(t: string) {
    void updateNodeTags(node.id, tags.filter((x) => x !== t));
  }

  return (
    <div className="aiReviewRow">
      <div className="aiReviewMeta">
        <strong>{node.title || node.kind}</strong>
        {typeof node.ai_confidence === 'number' && node.ai_confidence > 0 && (
          <span className="aiReviewConfidence">{Math.round(node.ai_confidence * 100)}%</span>
        )}
      </div>
      <div className="corePanelChips">
        {tags.map((t) => (
          <span key={t} className="corePanelChip">
            {t} <span className="corePanelChipX" onClick={() => removeTag(t)}>×</span>
          </span>
        ))}
        <input
          className="corePanelTagInput"
          placeholder="+ tag"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTag()}
          onBlur={addTag}
        />
      </div>
      <div className="aiReviewActions">
        <button onClick={() => void confirmNodeTags(node.id)}>
          <Icon name="check" size={12} /> ACCEPT AS CORRECT
        </button>
        <button onClick={() => void updateNodeTags(node.id, [])}>
          <Icon name="trash" size={12} /> REJECT ALL
        </button>
      </div>
    </div>
  );
}
