import { useEffect, useRef, useState } from 'react';
import Icon from '../icons/Icon';
import { liveClassify } from '../../lib/copilotClient';

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
}

export default function XaiChatWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([
    { from: 'xai', text: "Hey, Captain. Tell me anything — I'll file it live." },
  ]);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      const result = await liveClassify(text);
      const first = result.nodes?.[0];
      const reply = first
        ? `Filed as ${first.kind.toUpperCase().replace('_', ' ')}${first.project_slug ? ` → ${first.project_slug}` : ''} (${first.confidence}% confidence). ${first.reasoning}`
        : "Got it — logged, though I couldn't pin down a clear category for that one.";
      setMsgs((m) => [...m, { from: 'xai', text: reply }]);
    } catch (err) {
      console.error('XaiChatWindow: liveClassify failed', err);
      setMsgs((m) => [...m, { from: 'xai', text: "Couldn't reach the Core just now — that didn't get filed. Try again in a moment?" }]);
    } finally {
      setBusy(false);
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
          <div key={i} className={`xaiChatMsg xaiChatMsg-${m.from}`}>
            {m.text}
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
