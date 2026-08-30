import { useEffect, useMemo, useRef, useState } from 'react';
import { useUiStore } from '../../stores/uiStore';
import type { RoomId } from '../../stores/uiStore';
import { useCoreGraph } from '../../stores/coreGraph';
import { ROOMS } from '../../core/rooms';
import { useActionRegistry } from '../../core/actionRegistry';
import { fireWebhook } from '../../lib/webhook';
import { pushToast } from '../../stores/toastStore';
import { askConfirm } from '../../stores/confirmStore';
import { playSound } from '../../lib/sound';
import Icon from '../icons/Icon';

interface Action {
  id: string;
  label: string;
  hint: string;
  run: () => void | Promise<void>;
}

interface FrecencyEntry {
  count: number;
  last: number;
}
type FrecencyMap = Record<string, FrecencyEntry>;

function frecencyKey(ownerId: string | null): string {
  return `xos-cmdk-frecency-${ownerId ?? 'anon'}`;
}

/** Loads the "used this before" tally that powers the empty-query default
 * ordering — a lightweight local frecency, not a server-synced feature.
 * Corrupt/missing storage just yields an empty map; nothing here is
 * critical enough to surface an error over. */
function loadFrecency(ownerId: string | null): FrecencyMap {
  try {
    const raw = localStorage.getItem(frecencyKey(ownerId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as FrecencyMap) : {};
  } catch {
    return {};
  }
}

function recordUse(ownerId: string | null, actionId: string) {
  try {
    const data = loadFrecency(ownerId);
    const prev = data[actionId] ?? { count: 0, last: 0 };
    data[actionId] = { count: prev.count + 1, last: Date.now() };
    localStorage.setItem(frecencyKey(ownerId), JSON.stringify(data));
  } catch {
    // storage can fail (quota, privacy mode) — frecency is a nice-to-have, not critical
  }
}

/** count weighted by recency, half-life ~7 days, so a command run 50 times
 * a month ago eventually stops crowding out one run twice this morning. */
function frecencyScore(entry: FrecencyEntry | undefined): number {
  if (!entry) return 0;
  const ageDays = (Date.now() - entry.last) / 86_400_000;
  return entry.count * Math.pow(0.5, ageDays / 7);
}

/** Simple ordered-subsequence fuzzy match (the "type the vowels-out
 * shorthand and it still finds it" behavior of every real command
 * palette). Returns null on no match, else a score where higher = better:
 * consecutive-character runs and word-boundary starts are worth more than
 * scattered hits, and a shorter overall string breaks ties in its favor. */
function fuzzyScore(text: string, query: string): number | null {
  if (!query) return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let ti = 0;
  let score = 0;
  let consecutive = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return null;
    if (idx === ti) {
      consecutive++;
      score += 3 + consecutive;
    } else {
      consecutive = 0;
      score += 1;
    }
    if (idx === 0 || /[\s\-_/]/.test(t[idx - 1] ?? '')) score += 2;
    ti = idx + 1;
  }
  score -= t.length * 0.01;
  return score;
}

/** Cmd/Ctrl+K command palette — the brief's explicit "most OS-like
 * interaction missing" alongside cross-room drag-and-drop. Four modes in
 * one input: navigate (jump to any room), capture (jump straight to Neural
 * Capture), search (full-text over real node titles, routes to the owning
 * room), and Custom Commands (Settings > CUSTOM COMMANDS) — either a bound
 * internal action (core/actionRegistry.ts) or an outbound webhook
 * (lib/webhook.ts), both defined by the Captain, not hardcoded here.
 *
 * Ranking: an empty query shows recent/frequent commands first (local
 * frecency — see loadFrecency above), pinned behind "New capture" which
 * always leads. A non-empty query ranks by fuzzy match quality with a
 * small frecency nudge for ties, instead of plain substring order. */
export default function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const go = useUiStore((s) => s.go);
  const customCommands = useUiStore((s) => s.customCommands);
  const nodes = useCoreGraph((s) => s.nodes);
  const ownerId = useCoreGraph((s) => s.ownerId);
  const registry = useActionRegistry();
  const [q, setQ] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    if (open) {
      setQ('');
      setSelectedIndex(0);
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
            run: async () => {
              if (c.confirmBeforeRun && !(await askConfirm(`Run "${c.label}"?`, { confirmLabel: 'RUN' }))) return;
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
            run: async () => {
              if (c.confirmBeforeRun && !(await askConfirm(`Fire webhook "${c.label}" → ${webhook.url}?`, { confirmLabel: 'FIRE' }))) return;
              void fireWebhook(webhook).then((res) => pushToast(`${c.label}: ${res.message}`, res.ok ? 'success' : 'warn'));
            },
          },
        ];
      }
      return [];
    });

    const frecency = loadFrecency(ownerId);

    if (!q.trim()) {
      const rest = [...custom, ...nav]
        .map((a) => ({ a, score: frecencyScore(frecency[a.id]) }))
        .sort((x, y) => y.score - x.score)
        .map((x) => x.a);
      return [capture, ...rest].slice(0, 8);
    }

    const ql = q.trim();
    return [capture, ...custom, ...nav, ...search]
      .map((a) => {
        const best = fuzzyScore(a.label, ql) ?? fuzzyScore(a.hint, ql);
        if (best === null) return null;
        return { a, score: best + frecencyScore(frecency[a.id]) * 0.1 };
      })
      .filter((x): x is { a: Action; score: number } => x !== null)
      .sort((x, y) => y.score - x.score)
      .map((x) => x.a)
      .slice(0, 10);
  }, [q, nodes, go, customCommands, registry, ownerId]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [q]);

  useEffect(() => {
    rowRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const clampedIndex = actions.length ? Math.min(selectedIndex, actions.length - 1) : 0;

  function runAction(a: Action) {
    playSound('nav');
    recordUse(ownerId, a.id);
    setOpen(false);
    void Promise.resolve(a.run());
  }

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
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((i) => (actions.length ? (i + 1) % actions.length : 0));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((i) => (actions.length ? (i - 1 + actions.length) % actions.length : 0));
              } else if (e.key === 'Enter') {
                const target = actions[clampedIndex];
                if (target) runAction(target);
              }
            }}
          />
          <span className="cmdkEsc">ESC</span>
        </div>
        <div className="cmdkList">
          {actions.map((a, i) => (
            <div
              key={a.id}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              className={`cmdkRow ${i === clampedIndex ? 'sel' : ''}`}
              onMouseEnter={() => setSelectedIndex(i)}
              onClick={() => runAction(a)}
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
