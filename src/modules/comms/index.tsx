import { useState } from 'react';

interface Msg {
  who: 'ai' | 'me';
  text: string;
}

const replies: [RegExp, string][] = [
  [/bug|17/i, "Bug #17 is a login redirect loop — 92% similar to #14, which you solved in Sprint 001 with token rotation. The fix is attached to the bug card."],
  [/website/i, "Website has been dark for 6 days, Captain. Its constellation is dimming. I suggest a 25-minute revival session — I can bundle bug #15 into it."],
  [/studyhive|study/i, "StudyHive is your brightest galaxy — 80% health, 14 tasks, a dark-mode cluster forming from today's captures."],
  [/roadmap|next|plan/i, "One Sprint 002 goal remains: the Electron vs Tauri shell decision. After that, Sprint 003 brings live AI routing."],
  [/remember|memory|decision/i, 'Most-recalled memory: "Bee mascot = brand anchor" (Sprint 001). It\'s linked to 6 active nodes.'],
  [/.*/, "Logged, Captain. I've created a node for that and I'm mapping its relationships now."],
];

/** COMMS — ported 1:1 from xos-prototype.html: keyword-matched xAI replies. */
export default function Comms({ active }: { active: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([{ who: 'ai', text: "Channel open, Captain. I've been keeping an eye on things — ask me about any project, bug, or memory." }]);
  const [val, setVal] = useState('');

  function send() {
    const v = val.trim();
    if (!v) return;
    setMsgs((m) => [...m, { who: 'me', text: v }]);
    setVal('');
    const reply = replies.find(([re]) => re.test(v))?.[1] ?? '';
    setTimeout(() => setMsgs((m) => [...m, { who: 'ai', text: reply }]), 650);
  }

  return (
    <section className={`room ${active ? 'on' : ''}`} id="r-comms">
      <h2 className="rh">📡 COMMS</h2>
      <div className="rsub">TRANSMISSION LINE TO xAI. ASK ABOUT YOUR UNIVERSE.</div>
      <div id="chat">
        {msgs.map((m, i) => (
          <div className={`msg ${m.who}`} key={i}>
            {m.who === 'ai' && <b>◈ xAI</b>}
            {m.text}
          </div>
        ))}
      </div>
      <div id="chatBar">
        <input placeholder="Transmit to xAI…" autoComplete="off" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button onClick={send}>▸</button>
      </div>
    </section>
  );
}
