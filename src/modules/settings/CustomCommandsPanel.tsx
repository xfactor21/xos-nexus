import { useState } from 'react';
import { useUiStore } from '../../stores/uiStore';
import type { CustomCommand, CustomCommandKind, WebhookMethod } from '../../stores/uiStore';
import { useActionRegistry } from '../../core/actionRegistry';
import { fireWebhook } from '../../lib/webhook';
import { pushToast } from '../../stores/toastStore';
import Icon from '../../design-system/icons/Icon';

const METHODS: WebhookMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Parses the simple "Key: Value" per-line header textarea into a plain
 * object. Blank lines and lines without a colon are silently skipped
 * rather than rejected outright — this is a convenience field, not a
 * strict config format, and a Captain mid-typing a header shouldn't see
 * an error for an incomplete line. */
function parseHeaders(raw: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Settings > CUSTOM COMMANDS — the Captain's ask made a real feature:
 * user-defined command-palette entries, either rebinding an existing xOS
 * capability (core/actionRegistry.ts) or firing an outbound webhook
 * (lib/webhook.ts, routed through the Rust process on desktop — see
 * fire_webhook in src-tauri/src/lib.rs). Everything created here shows up
 * immediately in Cmd/Ctrl+K, searchable and runnable exactly like a
 * built-in action — no separate "custom stuff" surface. */
export default function CustomCommandsPanel() {
  const commands = useUiStore((s) => s.customCommands);
  const addCustomCommand = useUiStore((s) => s.addCustomCommand);
  const removeCustomCommand = useUiStore((s) => s.removeCustomCommand);
  const registry = useActionRegistry();

  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<CustomCommandKind>('action');
  const [actionId, setActionId] = useState(registry[0]?.id ?? '');
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState<WebhookMethod>('POST');
  const [headersRaw, setHeadersRaw] = useState('');
  const [body, setBody] = useState('');
  const [confirmBeforeRun, setConfirmBeforeRun] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const canAdd = label.trim() && (kind === 'action' ? !!actionId : url.trim());

  function resetForm() {
    setLabel('');
    setUrl('');
    setHeadersRaw('');
    setBody('');
    setConfirmBeforeRun(false);
  }

  function handleAdd() {
    if (!canAdd) return;
    const base = { label: label.trim(), confirmBeforeRun };
    if (kind === 'action') {
      addCustomCommand({ ...base, kind: 'action', actionId });
    } else {
      addCustomCommand({
        ...base,
        kind: 'webhook',
        webhook: { url: url.trim(), method, headers: parseHeaders(headersRaw), body: body.trim() || undefined },
      });
    }
    pushToast(`"${label.trim()}" added to the command palette.`, 'success');
    resetForm();
  }

  function handleDelete(c: CustomCommand) {
    if (!confirm(`Delete custom command "${c.label}"?`)) return;
    removeCustomCommand(c.id);
  }

  async function handleTest(c: CustomCommand) {
    setTestingId(c.id);
    if (c.kind === 'action') {
      const target = registry.find((r) => r.id === c.actionId);
      if (!target) {
        pushToast(`"${c.label}" points at an action that no longer exists.`, 'warn');
      } else {
        target.run();
      }
    } else if (c.kind === 'webhook' && c.webhook) {
      const res = await fireWebhook(c.webhook);
      pushToast(`${c.label}: ${res.message}`, res.ok ? 'success' : 'warn');
    }
    setTestingId(null);
  }

  return (
    <div className="gpanel setrow">
      <h3>
        <Icon name="command" size={14} glow="cyan" /> CUSTOM COMMANDS
      </h3>
      <div className="d">
        Add your own entries to the Cmd/Ctrl+K command palette — bind one to an existing xOS capability, or fire an
        outbound webhook (Zapier, n8n, Discord, your own endpoint). Runs from the same palette as everything else.
      </div>

      {commands.length > 0 && (
        <div className="cmdCustomList">
          {commands.map((c) => (
            <div className="cmdCustomRow" key={c.id}>
              <div className="cmdCustomMain">
                <span className="cmdCustomLabel">{c.label}</span>
                <span className="cmdCustomMeta">
                  {c.kind === 'action'
                    ? (registry.find((r) => r.id === c.actionId)?.label ?? 'unknown action')
                    : `${c.webhook?.method} ${c.webhook?.url}`}
                </span>
              </div>
              <span
                className="chip"
                style={{ fontSize: 9, opacity: testingId === c.id ? 0.5 : 1, pointerEvents: testingId === c.id ? 'none' : 'auto' }}
                onClick={() => handleTest(c)}
              >
                {testingId === c.id ? 'RUNNING…' : 'RUN'}
              </span>
              <span className="cmdCustomDel" onClick={() => handleDelete(c)} title="delete command">
                <Icon name="trash" size={12} />
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="cmdCustomForm">
        <input
          placeholder="Command label — e.g. “Notify team” or “Jump to Bugs”"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <div className="optrow" style={{ margin: 0 }}>
          <span className={`chip ${kind === 'action' ? 'on' : ''}`} onClick={() => setKind('action')}>
            <Icon name="bolt" size={11} /> INTERNAL ACTION
          </span>
          <span className={`chip ${kind === 'webhook' ? 'on' : ''}`} onClick={() => setKind('webhook')}>
            <Icon name="send" size={11} /> WEBHOOK
          </span>
        </div>

        {kind === 'action' && (
          <select value={actionId} onChange={(e) => setActionId(e.target.value)}>
            {registry.map((r) => (
              <option key={r.id} value={r.id}>
                {r.category} — {r.label}
              </option>
            ))}
          </select>
        )}

        {kind === 'webhook' && (
          <>
            <div className="optrow" style={{ margin: 0, gap: 8 }}>
              <select value={method} onChange={(e) => setMethod(e.target.value as WebhookMethod)} style={{ flex: '0 0 auto' }}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                placeholder="https://hooks.example.com/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
            <textarea
              placeholder={'Headers (optional) — one per line, e.g.\nAuthorization: Bearer …'}
              value={headersRaw}
              onChange={(e) => setHeadersRaw(e.target.value)}
              rows={2}
            />
            {method !== 'GET' && (
              <textarea placeholder="Body (optional — raw JSON or text)" value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
            )}
          </>
        )}

        <div className="optrow" style={{ margin: 0 }}>
          <span className={`chip ${confirmBeforeRun ? 'on' : ''}`} onClick={() => setConfirmBeforeRun(!confirmBeforeRun)}>
            <Icon name={confirmBeforeRun ? 'checkCircle' : 'circle'} size={12} /> CONFIRM BEFORE RUNNING
          </span>
          <span
            className="chip"
            style={{ marginLeft: 'auto', opacity: canAdd ? 1 : 0.4, pointerEvents: canAdd ? 'auto' : 'none' }}
            onClick={handleAdd}
          >
            <Icon name="plus" size={12} /> ADD COMMAND
          </span>
        </div>
      </div>
    </div>
  );
}
