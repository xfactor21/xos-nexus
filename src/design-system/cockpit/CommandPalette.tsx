import { useEffect, useMemo, useRef, useState } from 'react';
import { useUiStore } from '../../stores/uiStore';
import type { RoomId } from '../../stores/uiStore';
import { useCoreGraph } from '../../stores/coreGraph';
import { ROOMS } from '../../core/rooms';
import { useActionRegistry } from '../../core/actionRegistry';
import { fireWebhook } from '../../lib/webhook';
import { pushToast } from '../../stores/toastStore';
import { playSound } from '../../lib/sound';
import Icon from '../icons/Icon';

interface Action {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

/** Cmd/Ctrl+K command palette — the brief's explicit "most OS-like
 * interaction missing" alongside cross-room drag-and-drop. Four modes in
 * one input: navigate (jump to any room), capture (jump straight to Neural
 * Capture), search (full-text over real node titles, routes to the owning
 * room), and Custom Commands (Settings > CUSTOM COMMANDS) — either a bound
 * internal action (core/actionRegistry.ts) or an outbound webhook
 * (lib/webhook.ts), both defined by the Captain, not hardcoded here. */
export default function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const go = useUiStore((s) => s.go);
  const customCommands = useUiStore((s) => s.customCommands);
  const nodes = useCoreGraph((s) => s.nodes);
  const registry = useActionRegistry();
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useUiStore.getState().commandPaletteOpen);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  const kindToRoom: Record<string, RoomId> = {
    bug: 'bugs',
    task: 'projects',
    roadmap_item: 'roadmaps',
    release: 'releases',
    conversation: 'comms',
  };

  const actions = useMemo<Action[]>(() => {
    const nav: Action[] = ROOMS.map((r) => ({
      id: `nav-${r.id}`,
      label: `Go to ${r.name}`,
      hint: 'NAVIGATE',
      run: () => go(r.id),
    }));
    const capture: Action = { id: 'capture', label: 'New capture', hint: 'CAPTURE', run: () => go('capture') };
    const search: Action[] = q.trim()
      ? nodes
          .filter((n) => n.title.toLowerCase().includes(q.toLowerCase()))
          .slice(0, 6)
          .map((n) => ({
            id: `node-${n.id}`,
            label: n.title,
            hint: `SEARCH · ${n.kind.toUpperCase()}`,
            run: () => go(kindToRoom[n.kind] ?? 'obs'),
          }))
      : [];
    // Custom Commands (Settings > CUSTOM COMMANDS): action-kind resolves
    // against the live registry by id (skipped if its target ever
    // disappears rather than crashing the palette); webhook-kind fires a
    // real outbound request and reports back via toast, since a webhook's
    // result isn't visible in the UI the way a room-jump is.
    const custom: Action[] = customCommands.flatMap((c): Action[] => {
      if (c.kind === 'action') {
        const target = registry.find((r) => r.id === c.actionId);
        if (!target) return [];
        return [
          {
            id: `custom-${c.id}`,
            label: c.label,
            hint: 'CUSTOM',
            run: () => {
              if (c.confirmBeforeRun && !confirm(`Run "${c.label}"?`)) return;
              target.run();
            },
          },
        ];
      }
      if (c.kind === 'webhook' && c.webhook) {
        const webhook = c.webhook;
        return [
          {
            id: `custom-${c.id}`,
            label: c.label,
            hint: 'CUSTOM · WEBHOOK',
            run: () => {
              if (c.confirmBeforeRun && !confirm(`Fire webhook "${c.label}" → ${webhook.url}?`)) return;
              void fireWebhook(webhook).then((res) => pushToast(`${c.label}: ${res.message}`, res.ok ? 'success' : 'warn'));
            },
          },
        ];
      }
      return [];
    });
    const all = [capture, ...custom, ...nav, ...search];
    if (!q.trim()) return all.slice(0, 8);
    const ql = q.toLowerCase();
    return all.filter((a) => a.label.toLowerCase().includes(ql) || a.hint.toLowerCase().includes(ql));
  }, [q, nodes, go, customCommands, registry]);

  if (!open) return null;
  return (
    <div className="cmdkOverlay" onClick={() => setOpen(false)}>
      <div className="cmdkPanel" onClick={(e) => e.stopPropagation()}>
        <div className="cmdkInputRow">
          <Icon name="search" size={14} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Navigate, capture, or search your universe…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && actions[0]) {
                playSound('nav');
                actions[0].run();
                setOpen(false);
              }
            }}
          />
          <span className="cmdkEsc">ESC</span>
        </div>
        <div className="cmdkList">
          {actions.map((a) => (
            <div
              key={a.id}
              className="cmdkRow"
              onClick={() => {
                playSound('nav');
                a.run();
                setOpen(false);
              }}
            >
              <span>{a.label}</span>
              <span className="cmdkHint">{a.hint}</span>
            </div>
          ))}
          {!actions.length && <div className="cmdkRow cmdkEmpty">No matches.</div>}
        </div>
      </div>
    </div>
  );
}
