import { useEffect, useRef, useState } from 'react';

const LINES = [
  '<span style="opacity:.45">· · · a quiet hum · · ·</span>',
  '<span style="color:var(--magenta)">❤</span>',
  'systems initialize',
  '<span class="ok">"Welcome back, Captain."</span>',
  '<span class="ok">"Your Neural Core is online."</span>',
  '"I\'ve been keeping an eye on things."',
];

/** Boot sequence — ported 1:1 from xos-prototype.html #boot (same ids/classes,
 * same 650ms cadence, same "lit" glow trigger at line 2, same skip control). */
export default function Boot({ onDone }: { onDone: () => void }) {
  const [lit, setLit] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const biRef = useRef(0);

  useEffect(() => {
    const t = setInterval(() => {
      const bi = biRef.current;
      if (bi === 2) setLit(true);
      if (bi < LINES.length) {
        setLog(LINES.slice(Math.max(0, bi - 1), bi + 1));
        biRef.current = bi + 1;
      } else {
        finish();
      }
    }, 650);
    function finish() {
      clearInterval(t);
      setDone(true);
      setTimeout(onDone, 700);
    }
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function skip() {
    setDone(true);
    setTimeout(onDone, 0);
  }

  return (
    <div id="boot" className={`${lit ? 'lit' : ''} ${done ? 'done' : ''}`}>
      <div className="logo">
        xOS <em>//</em> neXus
      </div>
      <div id="bootlog" dangerouslySetInnerHTML={{ __html: log.join('<br>') }} />
      <div id="skip" onClick={skip}>
        TAP TO SKIP ▸
      </div>
    </div>
  );
}
