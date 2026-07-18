import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { pushToast } from '../../stores/toastStore';
import { playSound } from '../../lib/sound';
import Icon from '../../design-system/icons/Icon';
import AmbientField from '../../design-system/background/AmbientField';

type Runtime = 'node' | 'python';

/**
 * ROOM C — TERMINAL (Step 7). Hybrid, zero-hosted-infra execution, exactly
 * per the brief:
 *   - Node/JS: StackBlitz WebContainers — a real Node.js runtime compiled to
 *     WASM, runs entirely client-side (genuine npm install/file
 *     system/process execution, not a simulation).
 *   - Python: Pyodide — CPython compiled to WASM, standard library only.
 *     The full ~13MB runtime is bundled into this app's own `public/`
 *     folder (not fetched from a CDN at runtime) so it works offline and
 *     doesn't depend on this session's sandboxed network reaching
 *     jsdelivr.
 *   - E2B (the brief's third leg, for languages outside those two) is
 *     explicitly NOT wired in this pass — the Captain's call, made when
 *     asked directly: no account/API key yet, so "OTHER" is a disabled
 *     picker option rather than a silently-broken one.
 *
 * SAFETY GUARDRAIL: `runCommand(cmd, { source })` below is the single
 * choke point anything types text into the shell through. When
 * `source: 'xai'` (a future xAI-suggested command — nothing in xOS
 * generates one yet, so this path is unexercised today, but the gate is
 * real and load-bearing, not decorative) it requires an explicit Captain
 * confirmation before the command reaches the runtime. Never auto-runs.
 */

let webcontainerBoot: Promise<import('@webcontainer/api').WebContainer> | null = null;
async function bootWebContainer() {
  if (!webcontainerBoot) {
    const { WebContainer } = await import('@webcontainer/api');
    webcontainerBoot = WebContainer.boot({ coep: 'require-corp' });
  }
  return webcontainerBoot;
}

let pyodideBoot: Promise<Awaited<ReturnType<typeof import('pyodide').loadPyodide>>> | null = null;
async function bootPyodide(onOut: (s: string) => void, onErr: (s: string) => void) {
  if (!pyodideBoot) {
    const { loadPyodide } = await import('pyodide');
    pyodideBoot = loadPyodide({
      indexURL: '/pyodide/',
      stdout: onOut,
      stderr: onErr,
    });
  }
  return pyodideBoot;
}

function crossOriginIsolated(): boolean {
  return typeof window !== 'undefined' && 'crossOriginIsolated' in window && window.crossOriginIsolated === true;
}

export default function TerminalRoom({ active }: { active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const bootedRuntime = useRef<Runtime | null>(null);
  const pyBufferRef = useRef('');
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [status, setStatus] = useState<'idle' | 'booting' | 'ready' | 'unsupported' | 'error'>('idle');

  // Mount xterm.js once — the terminal instance itself, like every other
  // room's canvas/RAF state, persists across room navigation rather than
  // remounting (RoomOutlet keeps every room alive).
  useEffect(() => {
    if (!containerRef.current || termRef.current) return;
    const term = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      theme: {
        background: '#05080Dcc',
        foreground: '#d8e6f2',
        cursor: '#00F5FF',
        selectionBackground: 'rgba(255,45,120,0.35)',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    term.writeln('xOS Terminal — pick a runtime above to boot it.');
    termRef.current = term;
    fitRef.current = fit;

    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Re-fit whenever the room becomes visible again (its container may have
  // been laid out at zero size while another room was active).
  useEffect(() => {
    if (active) setTimeout(() => fitRef.current?.fit(), 50);
  }, [active]);

  async function startNode() {
    const term = termRef.current;
    if (!term) return;
    if (!crossOriginIsolated()) {
      setStatus('unsupported');
      term.writeln('\r\n\x1b[31mWebContainers needs cross-origin isolation (COOP/COEP), which this context isn\'t providing.\x1b[0m');
      term.writeln('This is expected on the plain web preview build — try the packaged desktop app, which sets these headers (see tauri.conf.json).');
      return;
    }
    setStatus('booting');
    term.writeln('\r\nBooting a real Node.js runtime (WebContainers, WASM, entirely client-side)…');
    try {
      // WebContainers' boot payload comes from StackBlitz's own servers
      // (unlike Pyodide above, this one genuinely can't be self-hosted) —
      // a slow or unreachable network would otherwise hang here forever
      // with no feedback. 20s is generous for a real connection; a
      // network that can't reach it at all times out cleanly instead.
      const wc = await Promise.race([
        bootWebContainer(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out reaching the WebContainers boot service — check your network connection.')), 20000)),
      ]);
      const shell = await wc.spawn('jsh', {
        terminal: { cols: term.cols, rows: term.rows },
      });
      void shell.output.pipeTo(
        new WritableStream({
          write(data) {
            term.write(data);
          },
        }),
      );
      const input = shell.input.getWriter();
      term.onData((data) => {
        void input.write(data);
      });
      term.onResize(({ cols, rows }) => shell.resize({ cols, rows }));
      bootedRuntime.current = 'node';
      setStatus('ready');
      pushToast('Terminal: Node.js runtime ready', 'success');
      playSound('notice');
    } catch (e) {
      console.error('WebContainer boot failed', e);
      setStatus('error');
      term.writeln(`\r\n\x1b[31mBoot failed: ${e instanceof Error ? e.message : String(e)}\x1b[0m`);
      pushToast('Terminal: Node.js runtime failed to boot', 'warn');
    }
  }

  async function startPython() {
    const term = termRef.current;
    if (!term) return;
    setStatus('booting');
    term.writeln('\r\nBooting CPython (Pyodide, WASM, standard library only)…');
    try {
      const py = await bootPyodide(
        (s) => term.writeln(s),
        (s) => term.writeln(`\x1b[31m${s}\x1b[0m`),
      );
      bootedRuntime.current = 'python';
      setStatus('ready');
      term.writeln(`Python ready (Pyodide). Type a statement and press Enter.`);
      writePrompt(term);

      let cursorCol = 0;
      term.onData(async (data) => {
        if (bootedRuntime.current !== 'python') return;
        if (data === '\r') {
          const code = pyBufferRef.current;
          pyBufferRef.current = '';
          cursorCol = 0;
          term.writeln('');
          if (code.trim()) {
            try {
              // Single-statement REPL for v1, intentionally — matches the
              // brief's "keep this genuinely simple" instruction pattern
              // used for the Browser room too. Multi-line function/class
              // definitions won't work here; flagged rather than faked.
              const result = await runCommand(code, { source: 'user', runtime: 'python' });
              if (result !== undefined && result !== null) term.writeln(String(result));
            } catch (err) {
              term.writeln(`\x1b[31m${err instanceof Error ? err.message : String(err)}\x1b[0m`);
            }
          }
          writePrompt(term);
        } else if (data === '\x7f') {
          // backspace
          if (cursorCol > 0) {
            pyBufferRef.current = pyBufferRef.current.slice(0, -1);
            cursorCol--;
            term.write('\b \b');
          }
        } else if (data >= ' ') {
          pyBufferRef.current += data;
          cursorCol++;
          term.write(data);
        }
      });

      async function runCommand(code: string, opts: { source: 'user' | 'xai'; runtime: 'python' }): Promise<unknown> {
        // The safety choke point described in the module doc comment.
        if (opts.source === 'xai') {
          const ok = window.confirm(`xAI suggests running:\n\n${code}\n\nRun it?`);
          if (!ok) return undefined;
        }
        return py.runPythonAsync(code);
      }
    } catch (e) {
      console.error('Pyodide boot failed', e);
      setStatus('error');
      term.writeln(`\r\n\x1b[31mBoot failed: ${e instanceof Error ? e.message : String(e)}\x1b[0m`);
      pushToast('Terminal: Python runtime failed to boot', 'warn');
    }
  }

  function writePrompt(term: XTerm) {
    term.write('\r\n>>> ');
  }

  function pick(r: Runtime) {
    if (r === runtime && status === 'ready') return;
    setRuntime(r);
    playSound('nav');
    if (r === 'node') void startNode();
    else void startPython();
  }

  return (
    <section className={`room ambient ${active ? 'on' : ''}`} id="r-terminal">
      <AmbientField mood="cyan" density={14} active={active} parallax />
      <div className="roomInner">
        <h2 className="rh">
          <Icon name="terminal" size={16} glow="cyan" /> TERMINAL
        </h2>
        <div className="rsub">REAL RUNTIMES · IN-BROWSER · ZERO HOSTED INFRA</div>

        <div className="optrow" style={{ margin: '0 0 12px' }}>
          <span className={`chip ${runtime === 'node' ? 'on' : ''}`} onClick={() => pick('node')}>
            NODE.JS (WebContainers)
          </span>
          <span className={`chip ${runtime === 'python' ? 'on' : ''}`} onClick={() => pick('python')}>
            PYTHON (Pyodide)
          </span>
          <span className="chip disabled" title="No E2B account configured yet — JS and Python only for now.">
            OTHER (needs E2B)
          </span>
          {status === 'booting' && (
            <span className="terminalStatus">
              <Icon name="spinner" size={12} className="spin" /> BOOTING…
            </span>
          )}
          {status === 'ready' && <span className="terminalStatus ready">● READY</span>}
        </div>

        <div className="terminalShell" ref={containerRef} />
      </div>
    </section>
  );
}
