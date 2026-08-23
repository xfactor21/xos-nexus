import { useEffect, useRef, useState } from 'react';
import Icon from '../icons/Icon';
import { liveClassify, commitClassifiedNodes, type ClassifiedNode } from '../../lib/copilotClient';

/** How long an unanswered confirm prompt waits before it silently expires
 * (Captain's explicit spec: "no reply times out as a no"). */
const CONFIRM_TIMEOUT_MS = 20_000;

/**
 * Item #4 — direct chat with xAI, opened by tapping/clicking the character
 * (see XaiCharacter.tsx's onClick). This is a genuine round-trip, not a
 * scripted chatbot: every message the Captain sends goes through the same
 * `liveClassify()` call every other capture surface in the app uses (Neural
 * Core, Neural Capture, Knowledge Matrix) — the one real AI pipeline that
 * exists in this codebase (see copilotClient.ts / the `classify-capture`
 * Edge Function). xAI's reply is its actual classification of what was
 * said — what it filed it as, where, and why — rendered as a chat message
 * rather than a capture-review card. No separate open-ended conversational
 * backend exists yet, so the honest scope here is "talk to xAI and watch it
 * genuinely think about and file what you say," not general Q&A.
 */
interface ChatMsg {
  from: 'you' | 'xai';
  text: string;
  pending?: boolean;
  /** Small "Filed as X" note shown under a real xAI reply — only set once
   * a proposed node has actually been committed (accepted or auto-filed). */
  filedNote?: string;
  /** Present when xAI proposed loggable nodes for this reply but hasn't
   * been told yes/no yet — renders the confirm/decline prompt beneath the
   * message. Cleared (undefined) once resolved one way or another. */
  confirm?: {
    id: number;
    nodes: ClassifiedNode[];
    resolved: 'pending' | 'yes' | 'no' | 'timeout';
  };
}

export default function XaiChatWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([
    { from: 'xai', text: "Hey, Captain. Tell me anything — I'll file it live." },
  ]);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmIdRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    // Cancel any in-flight confirm timeouts on unmount so they don't fire
    // (and try to update state) after the window is gone.
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, open]);

  async function send() {
    const text = val.trim();
    if (!text || busy) return;
    setVal('');
    setMsgs((m) => [...m, { from: 'you', text }]);
    setBusy(true);
    try {
      // autoCommit:false — xAI answers the message for real (result.reply)
      // but does NOT write anything to the Core yet. Per Captain feedback,
      // it should ask before filing, not file silently on every message;
      // any proposed nodes come back unpersisted (no `id`) and only become
      // real via the Yes/No prompt below (resolveConfirm).
      const result = await liveClassify(text, null, false);
      const nodes = result.nodes ?? [];
      const reply = result.reply || (nodes.length ? "Got it — want me to log that?" : 'Got it.');
      if (nodes.length) {
        const id = ++confirmIdRef.current;
        setMsgs((m) => [
          ...m,
          { from: 'xai', text: reply, confirm: { id, nodes, resolved: 'pending' } },
        ]);
        const timer = setTimeout(() => resolveConfirm(id, 'timeout'), CONFIRM_TIMEOUT_MS);
        timersRef.current.set(id, timer);
      } else {
        setMsgs((m) => [...m, { from: 'xai', text: reply }]);
      }
    } catch (err) {
      console.error('XaiChatWindow: liveClassify failed', err);
      setMsgs((m) => [...m, { from: 'xai', text: "Couldn't reach the Core just now — that didn't get filed. Try again in a moment?" }]);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Resolves one pending confirm prompt — 'yes' actually writes the
   * proposed nodes via commitClassifiedNodes(); 'no' and 'timeout' both
   * just discard the proposal (nothing was ever saved either way, so
   * there's nothing to undo). Guards against double-resolution (e.g. the
   * timeout firing after a manual click already resolved it).
   */
  async function resolveConfirm(id: number, outcome: 'yes' | 'no' | 'timeout') {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    let alreadyResolved = false;
    setMsgs((m) =>
      m.map((msg) => {
        if (!msg.confirm || msg.confirm.id !== id) return msg;
        if (msg.confirm.resolved !== 'pending') {
          alreadyResolved = true;
          return msg;
        }
        return { ...msg, confirm: { ...msg.confirm, resolved: outcome } };
      })
    );
    if (alreadyResolved) return;

    if (outcome === 'yes') {
      const target = msgs.find((m) => m.confirm?.id === id);
      const nodes = target?.confirm?.nodes;
      if (!nodes?.length) return;
      try {
        const result = await commitClassifiedNodes(nodes);
        const first = result.nodes?.[0];
        const filedNote = first
          ? `Filed as ${first.kind.toUpperCase().replace('_', ' ')}${first.project_slug ? ` → ${first.project_slug}` : ''}.`
          : 'Filed.';
        setMsgs((m) => [...m, { from: 'xai', text: 'Logged.', filedNote }]);
      } catch (err) {
        console.error('XaiChatWindow: commitClassifiedNodes failed', err);
        setMsgs((m) => [...m, { from: 'xai', text: "Couldn't save that just now — nothing was logged. Try again?" }]);
      }
    }
  }

  if (!open) return null;

  return (
    <div className="xaiChatWindow" role="dialog" aria-label="xAI chat">
      <div className="xaiChatHead">
        <span>
          <Icon name="xai" size={13} glow="cyan" /> xAI
        </span>
        <span className="xaiChatClose" onClick={onClose}>
          <Icon name="close" size={14} />
        </span>
      </div>
      <div className="xaiChatBody" ref={listRef}>
        {msgs.map((m, i) => (
          <div key={i}>
            <div className={`xaiChatMsg xaiChatMsg-${m.from}`}>
              {m.text}
              {m.filedNote && <div className="xaiChatFiledNote">{m.filedNote}</div>}
            </div>
            {m.confirm && (
              <div className="xaiChatConfirm">
                {m.confirm.resolved === 'pending' ? (
                  <>
                    <div className="xaiChatConfirmRow">
                      <span>
                        Log as {m.confirm.nodes.map((n) => n.kind.toUpperCase()).join(', ')}?
                      </span>
                      <div className="xaiChatConfirmBtns">
                        <button className="xaiChatConfirmYes" onClick={() => resolveConfirm(m.confirm!.id, 'yes')}>
                          Yes
                        </button>
                        <button className="xaiChatConfirmNo" onClick={() => resolveConfirm(m.confirm!.id, 'no')}>
                          No
                        </button>
                      </div>
                    </div>
                    {/* Visual countdown to the timeout — "no reply times out as a no". */}
                    <div className="xaiChatConfirmBar" style={{ animationDuration: `${CONFIRM_TIMEOUT_MS}ms` }} />
                  </>
                ) : (
                  <div className="xaiChatConfirmDone">
                    {m.confirm.resolved === 'yes'
                      ? 'Logging…'
                      : m.confirm.resolved === 'timeout'
                        ? "No reply — didn't log that."
                        : "Okay, didn't log that."}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="xaiChatMsg xaiChatMsg-xai xaiChatMsg-pending">thinking…</div>}
      </div>
      <div className="xaiChatInputRow">
        <input
          ref={inputRef}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Say something…"
          disabled={busy}
        />
        <button onClick={send} disabled={busy || !val.trim()} aria-label="Send">
          <Icon name="send" size={14} />
        </button>
      </div>
    </div>
  );
}
