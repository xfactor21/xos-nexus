import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { pushToast } from '../../stores/toastStore';
import { playSound } from '../../lib/sound';
import { isTauri } from '../../lib/localDb';
import { openTextFile, writeTextFileAt, saveTextFileAs, pickDirectory, type OpenedFile } from '../../lib/fileIO';
import { openExternally } from '../../lib/opener';
import { useUiStore } from '../../stores/uiStore';
import { useBrowserNavStore } from '../../stores/browserNavStore';
import Icon from '../../design-system/icons/Icon';
import AmbientField from '../../design-system/background/AmbientField';
import CodeEditor from '../../design-system/CodeEditor';

type Runtime = 'node' | 'python' | 'ruby' | 'php' | 'go' | 'shell';

/** Same "isTauri() gate + dynamic import" pattern used everywhere else in
 * xOS (uiStore's tray sync, the Browser room's browser-view commands) — the
 * web/Netlify bundle never eagerly loads @tauri-apps/api for the SHELL
 * runtime's commands, which only exist on desktop. */
async function invokeTauri<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/**
 * ROOM C — TERMINAL (Step 7). Hybrid, zero-hosted-infra execution, exactly
 * per the brief, now covering five real-but-sandboxed language runtimes
 * plus one genuinely unsandboxed one (SHELL, below):
 *   - Node/JS: StackBlitz WebContainers — a real Node.js runtime compiled to
 *     WASM, runs entirely client-side (genuine npm install/file
 *     system/process execution, not a simulation). Interactive shell.
 *   - Python: Pyodide (CPython/WASM), MPL-2.0/Apache-mixed. Line-buffered
 *     REPL, state persists across lines (one interpreter instance).
 *   - Ruby: ruby.wasm (`@ruby/3.3-wasm-wasi`, MIT), CRuby 3.3 compiled to
 *     WASI/WASM. Same persistence model as Python.
 *   - PHP: WordPress Playground's php-wasm (`@php-wasm/universal` +
 *     `@php-wasm/web-8-3`'s runtime, GPL-2.0-or-later — see
 *     `public/php/LICENSE.txt`, shipped verbatim per the license's terms).
 *     Each snippet runs as its own isolated PHP "request" (no cross-line
 *     variable persistence — a real constraint of how php-wasm's run()
 *     works, not a bug).
 *   - Go: no maintained, self-hostable Go *compiler*-to-WASM exists today
 *     (TinyGo doesn't target itself; Go's own toolchain isn't built for
 *     browser use). Instead this ships `gowasm/` — a ~39MB WASM build of
 *     yaegi (github.com/traefik/yaegi, Apache-2.0), a pure-Go interpreter,
 *     built by this repo itself (see gowasm/README.md to rebuild). Real Go
 *     semantics and stdlib, not a subset re-implementation — but a fresh
 *     interpreter per eval, so (like PHP) no cross-line state.
 *   - "OTHER" (C/C++, and anything needing E2B) stays a disabled chip, not
 *     a silently missing one. Two independent reasons, both explained in
 *     the tooltip: (1) E2B was never wired in — no account/API key,
 *     Captain's call; (2) no maintained self-hosted C/C++-to-WASM compiler
 *     exists as a consumable package the way Pyodide/ruby.wasm/php-wasm do
 *     (the one community demo, wasm-clang, was unpublished from npm in
 *     2021 and isn't a realistic dependency for a shipping app).
 *
 * All five wasm/wasi runtime payloads are self-hosted under public/ — same
 * reasoning as Pyodide originally: works offline, no CDN dependency, and
 * sidesteps needing custom response headers for anything except
 * WebContainers (which genuinely can't be self-hosted).
 *
 * SHELL (real OS shell, desktop only): the honest answer to "can I install
 * dependencies / run my project as a server" is that none of the five
 * runtimes above can — they're real language runtimes, but each one is
 * sandboxed (WASM/WASI, or WebContainers' own in-browser Node) with no
 * access to the Captain's actual filesystem/OS process table, so `npm
 * install` inside them installs into a virtual filesystem, not the
 * Captain's real project folder. SHELL instead invokes a genuine
 * `std::process::Command` child process on the Rust side
 * (`shell_run_sync`/`shell_spawn_bg`/`shell_kill_bg`, src-tauri/src/lib.rs)
 * — the actual OS shell, running with the Captain's real permissions
 * against their real filesystem. This is possible ONLY in the packaged
 * Tauri desktop build: browsers have no OS process-spawning API at all —
 * a hard platform limit, not a missing feature — so the chip below is
 * gated behind `isTauri()` and says so plainly on the web preview build
 * instead of pretending to work. "RUN DEV SERVER" (also SHELL-only) spawns
 * a real long-running background process (e.g. `npm run dev`), streams its
 * real stdout/stderr into this terminal as it runs, sniffs a
 * localhost/127.0.0.1 URL out of that real output, and hands it to the
 * Browser room (Part 1) to actually view — same real embedded webview that
 * room already has, not a second implementation of "load a URL."
 *
 * SAFETY GUARDRAIL: `runCommand(cmd, { source })` (used by every REPL
 * runtime below) is the single choke point anything types text into the
 * shell through. When `source: 'xai'` (a future xAI-suggested command —
 * nothing in xOS generates one yet, so this path is unexercised today, but
 * the gate is real and load-bearing, not decorative) it requires an
 * explicit Captain confirmation before the command reaches the runtime.
 * Never auto-runs.
 */

// ---------------------------------------------------------------------------
// Node.js (WebContainers) — unchanged from the original single-language pass.
// ---------------------------------------------------------------------------

let webcontainerBoot: Promise<import('@webcontainer/api').WebContainer> | null = null;
async function bootWebContainer() {
  if (!webcontainerBoot) {
    const { WebContainer } = await import('@webcontainer/api');
    webcontainerBoot = WebContainer.boot({ coep: 'require-corp' });
  }
  return webcontainerBoot;
}

// ---------------------------------------------------------------------------
// Python (Pyodide) — self-hosted at public/pyodide/.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Ruby (ruby.wasm) — self-hosted at public/ruby/ruby+stdlib.wasm. The npm
// package (`@ruby/3.3-wasm-wasi`) only ships that binary plus a thin
// re-export of `@ruby/wasm-wasi`'s pure-JS VM bindings, which bundle fine
// normally — only the 36MB wasm binary needs the manual self-host, same as
// Pyodide.
// ---------------------------------------------------------------------------

let rubyBoot: Promise<{ vm: import('@ruby/wasm-wasi/dist/vm').RubyVM }> | null = null;
async function bootRuby(onOut: (s: string) => void, onErr: (s: string) => void) {
  if (!rubyBoot) {
    rubyBoot = (async () => {
      const [{ WASI, OpenFile, File, PreopenDirectory }, { RubyVM }, { consolePrinter }] = await Promise.all([
        import('@bjorn3/browser_wasi_shim'),
        import('@ruby/wasm-wasi/dist/vm'),
        import('@ruby/wasm-wasi/dist/console'),
      ]);
      const bytes = await (await fetch('/ruby/ruby+stdlib.wasm')).arrayBuffer();
      const rubyModule = await WebAssembly.compile(bytes);
      const wasi = new WASI(
        [],
        [],
        [new OpenFile(new File([])), new OpenFile(new File([])), new OpenFile(new File([])), new PreopenDirectory('/', new Map())],
        { debug: false },
      );
      const printer = consolePrinter({ stdout: onOut, stderr: onErr });
      const { vm } = await RubyVM.instantiateModule({
        module: rubyModule,
        wasip1: wasi,
        addToImports: (imports) => printer.addToImports(imports),
        setMemory: (memory) => printer.setMemory(memory),
      });
      return { vm };
    })();
  }
  return rubyBoot;
}

// ---------------------------------------------------------------------------
// PHP (php-wasm) — the npm package (`@php-wasm/web-8-3`) ships its wasm
// binary via a bundler-only `import x from './file.wasm'` asset import that
// this project's build tool (rolldown-vite) doesn't support (confirmed via
// a real build attempt — MISSING_EXPORT "default"). So instead of depending
// on that package at all, `public/php/php_8_3.js` is a hand-patched copy of
// its Emscripten glue (only the broken import line changed to a plain
// string — see the comment in that file) served as a static asset and
// dynamically imported at runtime, exactly like Pyodide/Ruby's wasm
// binaries. `@php-wasm/universal` (pure JS, bundles fine) supplies
// `loadPHPRuntime`/`PHP`, which only ever calls `.init(...)` on what we
// hand it — never touches the broken export — so this is a legitimate
// integration, not a hack around a broken one.
// ---------------------------------------------------------------------------

/** Dynamically import a JS module served as a plain static file (public/,
 * not part of the Vite module graph). A direct `import(path)` against a
 * public/ path is refused by Vite's DEV server ("should not be imported
 * from source code... can only be referenced via HTML tags") even with
 * `@vite-ignore` — that comment only stops Vite's build-time bundling
 * analysis, not the dev server's runtime request guard. Fetching the text
 * ourselves and importing it as a blob: URL sidesteps that guard entirely
 * (blob: URLs never touch the dev server) and behaves identically in the
 * production build, where this restriction doesn't exist anyway. */
async function importPublicModule<T>(path: string): Promise<T> {
  const source = await (await fetch(path)).text();
  const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    return (await import(/* @vite-ignore */ blobUrl)) as T;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

let phpBoot: Promise<import('@php-wasm/universal').PHP> | null = null;
async function bootPHP() {
  if (!phpBoot) {
    phpBoot = (async () => {
      const { loadPHPRuntime, PHP } = await import('@php-wasm/universal');
      // A self-hosted static asset (see the section comment above), not an
      // npm module — TS has no declarations for it and never will.
      const mod = await importPublicModule<{ init: (runtime: string, overrides: Record<string, unknown>) => unknown }>(
        '/php/php_8_3.js',
      );
      const runtimeId = await loadPHPRuntime(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { init: mod.init } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { locateFile: () => '/php/php_8_3.wasm' } as any,
      );
      return new PHP(runtimeId);
    })();
  }
  return phpBoot;
}

// ---------------------------------------------------------------------------
// Go (yaegi compiled to WASM by this repo — see gowasm/README.md) —
// self-hosted at public/gowasm/. wasm_exec.js is a classic (non-module)
// script per Go's own convention, so it's loaded via a real <script> tag
// rather than dynamic import.
// ---------------------------------------------------------------------------

interface GoWasmExit {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}
declare global {
  interface Window {
    Go?: new () => GoWasmExit;
    yaegiReady?: boolean;
    yaegiEval?: (code: string) => { stdout: string; stderr: string; result: string; error: boolean };
  }
}

function loadClassicScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-xos-src="${src}"]`)) {
      resolve();
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.setAttribute('data-xos-src', src);
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

let goBoot: Promise<void> | null = null;
async function bootGo() {
  if (!goBoot) {
    goBoot = (async () => {
      await loadClassicScript('/gowasm/wasm_exec.js');
      if (!window.Go) throw new Error('wasm_exec.js loaded but window.Go is missing.');
      const goInstance = new window.Go();
      const bytes = await (await fetch('/gowasm/xos-go.wasm')).arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, goInstance.importObject);
      void goInstance.run(instance); // never resolves — the wasm program blocks on select{} forever
      await new Promise<void>((resolve) => {
        const check = () => (window.yaegiReady ? resolve() : setTimeout(check, 20));
        check();
      });
    })();
  }
  return goBoot;
}

function crossOriginIsolated(): boolean {
  return typeof window !== 'undefined' && 'crossOriginIsolated' in window && window.crossOriginIsolated === true;
}

// A REPL runtime is anything driven by our own line-buffered prompt rather
// than a real interactive shell (only Node/WebContainers gets the latter).
interface ReplEvaluator {
  evaluate(code: string): Promise<{ stdout: string; stderr: string }>;
}

export default function TerminalRoom({ active }: { active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const replBufferRef = useRef('');
  // Whichever runtime currently owns term.onData/onResize — cleared and
  // re-registered on every switch so keystrokes never double-fire (an easy
  // bug once there are 5 runtimes to swap between, not just 2).
  const activeListenersRef = useRef<Array<{ dispose(): void }>>([]);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [status, setStatus] = useState<'idle' | 'booting' | 'ready' | 'unsupported' | 'error'>('idle');

  // Local .py file editing — open a real file, edit it in a real editor,
  // run the whole thing through the same Pyodide instance the REPL uses
  // (so a script's top-level defs/vars are available in the REPL
  // afterward too), save back to disk. Desktop-only (see fileIO.ts).
  const [openFile, setOpenFile] = useState<OpenedFile | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [fileDirty, setFileDirty] = useState(false);
  const [fileResetKey, setFileResetKey] = useState(0);
  const [fileBusy, setFileBusy] = useState<'idle' | 'running' | 'saving'>('idle');

  // SHELL runtime (real OS process, desktop only — see module doc comment
  // above) + RUN DEV SERVER. cwdRef mirrors shellCwd so the REPL's `cd`
  // handling and the background dev-server spawn both always read the
  // latest value without stale-closure issues (same reasoning as
  // currentUrlRef in the Browser room).
  const [shellCwd, setShellCwd] = useState('');
  const shellCwdRef = useRef(shellCwd);
  useEffect(() => {
    shellCwdRef.current = shellCwd;
  }, [shellCwd]);
  const [devCmd, setDevCmd] = useState('npm run dev');
  const [devPid, setDevPid] = useState<number | null>(null);
  const devPidRef = useRef<number | null>(null);
  useEffect(() => {
    devPidRef.current = devPid;
  }, [devPid]);
  const [devBusy, setDevBusy] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);

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

  useEffect(() => {
    if (active) setTimeout(() => fitRef.current?.fit(), 50);
  }, [active]);

  function clearActiveListeners() {
    for (const d of activeListenersRef.current) d.dispose();
    activeListenersRef.current = [];
  }

  function writePrompt(term: XTerm, prompt: string) {
    term.write(`\r\n${prompt}`);
  }

  /** Shared line-buffered REPL loop for Python/Ruby/PHP/Go — one runtime's
   * worth of state (buffer, prompt, evaluator) wired to term.onData. */
  function attachRepl(term: XTerm, prompt: string, evaluator: ReplEvaluator) {
    clearActiveListeners();
    replBufferRef.current = '';
    let cursorCol = 0;
    writePrompt(term, prompt);
    const disposable = term.onData(async (data) => {
      if (data === '\r') {
        const code = replBufferRef.current;
        replBufferRef.current = '';
        cursorCol = 0;
        term.writeln('');
        if (code.trim()) {
          try {
            const { stdout, stderr } = await runCommand(code, evaluator, { source: 'user' });
            if (stdout) term.write(stdout);
            if (stderr) term.write(`\x1b[31m${stderr}\x1b[0m\n`);
          } catch (err) {
            term.write(`\x1b[31m${err instanceof Error ? err.message : String(err)}\x1b[0m\n`);
          }
        }
        writePrompt(term, prompt);
      } else if (data === '\x7f') {
        if (cursorCol > 0) {
          replBufferRef.current = replBufferRef.current.slice(0, -1);
          cursorCol--;
          term.write('\b \b');
        }
      } else if (data >= ' ') {
        replBufferRef.current += data;
        cursorCol++;
        term.write(data);
      }
    });
    activeListenersRef.current.push(disposable);
  }

  /** The safety choke point described in the module doc comment — every
   * REPL runtime's Enter-key handler routes through here. */
  async function runCommand(
    code: string,
    evaluator: ReplEvaluator,
    opts: { source: 'user' | 'xai' },
  ): Promise<{ stdout: string; stderr: string }> {
    if (opts.source === 'xai') {
      const ok = window.confirm(`xAI suggests running:\n\n${code}\n\nRun it?`);
      if (!ok) return { stdout: '', stderr: '' };
    }
    return evaluator.evaluate(code);
  }

  async function startNode() {
    const term = termRef.current;
    if (!term) return;
    clearActiveListeners();
    if (!crossOriginIsolated()) {
      setStatus('unsupported');
      term.writeln('\r\n\x1b[31mWebContainers needs cross-origin isolation (COOP/COEP), which this context isn\'t providing.\x1b[0m');
      term.writeln('This is expected on the plain web preview build — try the packaged desktop app, which sets these headers (see tauri.conf.json).');
      return;
    }
    setStatus('booting');
    term.writeln('\r\nBooting a real Node.js runtime (WebContainers, WASM, entirely client-side)…');
    try {
      const wc = await Promise.race([
        bootWebContainer(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timed out reaching the WebContainers boot service — check your network connection.')), 20000),
        ),
      ]);
      const shell = await wc.spawn('jsh', { terminal: { cols: term.cols, rows: term.rows } });
      void shell.output.pipeTo(new WritableStream({ write(data) { term.write(data); } }));
      const input = shell.input.getWriter();
      const dataDisposable = term.onData((data) => void input.write(data));
      const resizeDisposable = term.onResize(({ cols, rows }) => shell.resize({ cols, rows }));
      activeListenersRef.current.push(dataDisposable, resizeDisposable);
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
      setStatus('ready');
      term.writeln('Python ready (Pyodide). State persists across lines. Type a statement and press Enter.');
      attachRepl(term, '>>> ', {
        async evaluate(code) {
          const result = await py.runPythonAsync(code);
          return { stdout: result !== undefined && result !== null ? `${String(result)}\n` : '', stderr: '' };
        },
      });
      pushToast('Terminal: Python runtime ready', 'success');
      playSound('notice');
    } catch (e) {
      console.error('Pyodide boot failed', e);
      setStatus('error');
      term.writeln(`\r\n\x1b[31mBoot failed: ${e instanceof Error ? e.message : String(e)}\x1b[0m`);
      pushToast('Terminal: Python runtime failed to boot', 'warn');
    }
  }

  async function startRuby() {
    const term = termRef.current;
    if (!term) return;
    setStatus('booting');
    term.writeln('\r\nBooting CRuby 3.3 (ruby.wasm, WASI, standard library only)…');
    try {
      const { vm } = await bootRuby(
        (s) => term.write(s),
        (s) => term.write(`\x1b[31m${s}\x1b[0m`),
      );
      setStatus('ready');
      term.writeln('Ruby ready (ruby.wasm). State persists across lines. Type an expression and press Enter.');
      attachRepl(term, 'irb> ', {
        async evaluate(code) {
          const rbValue = vm.eval(code);
          const s = rbValue.toString();
          return { stdout: s ? `${s}\n` : '', stderr: '' };
        },
      });
      pushToast('Terminal: Ruby runtime ready', 'success');
      playSound('notice');
    } catch (e) {
      console.error('Ruby boot failed', e);
      setStatus('error');
      term.writeln(`\r\n\x1b[31mBoot failed: ${e instanceof Error ? e.message : String(e)}\x1b[0m`);
      pushToast('Terminal: Ruby runtime failed to boot', 'warn');
    }
  }

  async function startPHP() {
    const term = termRef.current;
    if (!term) return;
    setStatus('booting');
    term.writeln('\r\nBooting PHP 8.3 (php-wasm)…');
    try {
      const php = await bootPHP();
      setStatus('ready');
      term.writeln('PHP ready (php-wasm). Each line runs as its own request — variables do NOT persist across lines.');
      attachRepl(term, 'php> ', {
        async evaluate(code) {
          const wrapped = code.includes('<?php') ? code : `<?php\n${code}`;
          const response = await php.run({ code: wrapped });
          const stdout = new TextDecoder().decode(response.bytes);
          return { stdout: stdout ? (stdout.endsWith('\n') ? stdout : `${stdout}\n`) : '', stderr: response.errors ?? '' };
        },
      });
      pushToast('Terminal: PHP runtime ready', 'success');
      playSound('notice');
    } catch (e) {
      console.error('PHP boot failed', e);
      setStatus('error');
      term.writeln(`\r\n\x1b[31mBoot failed: ${e instanceof Error ? e.message : String(e)}\x1b[0m`);
      pushToast('Terminal: PHP runtime failed to boot', 'warn');
    }
  }

  async function startGo() {
    const term = termRef.current;
    if (!term) return;
    setStatus('booting');
    term.writeln('\r\nBooting Go (yaegi interpreter, self-compiled to WASM — see gowasm/README.md)…');
    try {
      await bootGo();
      setStatus('ready');
      term.writeln('Go ready (yaegi). Each line runs in a fresh interpreter — variables do NOT persist across lines. Try: fmt.Println("hi")');
      attachRepl(term, 'go> ', {
        async evaluate(code) {
          if (!window.yaegiEval) throw new Error('Go runtime not ready.');
          const r = window.yaegiEval(code);
          // Only echo the last expression's value when nothing was already
          // printed — otherwise e.g. `fmt.Println(x)` shows both "x" (real
          // output) AND its own (n int, err error) return value ("3", the
          // byte count), which reads as a second bogus line. This matches
          // how a real Go REPL (gore) resolves the same ambiguity.
          const out = r.stdout || (r.result ? `${r.result}\n` : '');
          return { stdout: out, stderr: r.stderr };
        },
      });
      pushToast('Terminal: Go runtime ready', 'success');
      playSound('notice');
    } catch (e) {
      console.error('Go boot failed', e);
      setStatus('error');
      term.writeln(`\r\n\x1b[31mBoot failed: ${e instanceof Error ? e.message : String(e)}\x1b[0m`);
      pushToast('Terminal: Go runtime failed to boot', 'warn');
    }
  }

  async function startShell() {
    const term = termRef.current;
    if (!term) return;
    if (!isTauri()) {
      // The honest, explicit "why not" — not a disabled control that just
      // silently does nothing. Real OS shell access needs a real OS
      // process-spawning API, which no web browser exposes to a page; the
      // packaged Tauri desktop build has it via src-tauri's shell_run_sync.
      pushToast('Full shell access requires the desktop app — a browser tab cannot spawn OS processes.', 'warn');
      setStatus('unsupported');
      term.writeln('\r\n\x1b[31mSHELL needs the packaged desktop app.\x1b[0m Browsers have no OS process-spawning API — this is a hard platform limit, not something the web preview can work around.');
      return;
    }
    clearActiveListeners();
    setStatus('ready');
    term.writeln('\r\nReal OS shell (genuine child processes via src-tauri, NOT a simulation). Each line runs to completion as its own process — no persistent env/exports across lines, but `cd` is tracked and applied to the next command.');
    term.writeln(`Working directory: ${shellCwdRef.current || '(app default — use PICK FOLDER below to point this at your project)'}`);
    attachRepl(term, 'sh> ', {
      async evaluate(code) {
        const trimmed = code.trim();
        const cdMatch = trimmed.match(/^cd\s+(.+)$/);
        if (cdMatch) {
          const target = cdMatch[1].trim();
          try {
            // Resolves the target (handles "~", "..", relative paths, etc.
            // the same way a real shell would) and echoes the resulting
            // absolute path back, rather than this JS trying to reimplement
            // path resolution itself. `pwd` is POSIX-only — this app's
            // tested/shipped desktop target is Linux (see shellTarget in
            // uiStore.ts), so Windows' `cd`-with-no-`pwd` shell isn't
            // specifically handled here; a plain `cd` on Windows still runs
            // fine via shell_run_sync, it just won't update shellCwd.
            const result = await invokeTauri<{ stdout: string; stderr: string; code: number | null }>('shell_run_sync', {
              cmd: `cd "${target}" && pwd`,
              cwd: shellCwdRef.current || undefined,
            });
            if (result.code === 0 && result.stdout.trim()) {
              const resolved = result.stdout.trim();
              setShellCwd(resolved);
              return { stdout: `${resolved}\n`, stderr: '' };
            }
            return { stdout: '', stderr: result.stderr || `cd: no such directory: ${target}\n` };
          } catch (e) {
            return { stdout: '', stderr: `${e instanceof Error ? e.message : String(e)}\n` };
          }
        }
        const result = await invokeTauri<{ stdout: string; stderr: string; code: number | null }>('shell_run_sync', {
          cmd: code,
          cwd: shellCwdRef.current || undefined,
        });
        const stdout = result.code !== null && result.code !== 0 ? `${result.stdout}[exit ${result.code}]\n` : result.stdout;
        return { stdout, stderr: result.stderr };
      },
    });
    pushToast('Terminal: real OS shell ready', 'success');
    playSound('notice');
  }

  async function handlePickShellCwd() {
    try {
      const dir = await pickDirectory();
      if (dir) {
        setShellCwd(dir);
        termRef.current?.writeln(`\r\n\x1b[36mWorking directory set to ${dir}\x1b[0m`);
      }
    } catch (e) {
      console.error('Pick folder failed', e);
      pushToast(e instanceof Error ? e.message : 'Could not open the folder picker', 'warn');
    }
  }

  // Sniffs a local dev-server URL (Vite/webpack/CRA/Next/etc. all print
  // one of these shapes on startup) out of real stdout — best-effort, not
  // guaranteed for every dev server's banner format, which is why the
  // running output is also just visible in the terminal regardless.
  const DEV_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?[^\s'"<>]*/i;
  function scanForDevUrl(line: string) {
    const m = line.match(DEV_URL_RE);
    if (!m) return;
    const found = m[0].replace(/\/$/, '').replace('0.0.0.0', 'localhost').replace('[::1]', 'localhost');
    setDevUrl((prev) => prev ?? found);
  }

  // Real background process streaming — registered once (Tauri only), not
  // re-registered per dev-server run, so it never misses output that
  // arrives between "runtime switched to shell" and "dev server started."
  // Filters by devPidRef so stray output from a previous (already
  // killed/exited) run can't get attributed to a new one.
  useEffect(() => {
    if (!isTauri()) return;
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const outUn = await listen<{ pid: number; stream: 'stdout' | 'stderr'; line: string }>('shell-output', (event) => {
        if (event.payload.pid !== devPidRef.current) return;
        const term = termRef.current;
        const { stream, line } = event.payload;
        term?.writeln(stream === 'stderr' ? `\x1b[31m${line}\x1b[0m` : line);
        scanForDevUrl(line);
      });
      const exitUn = await listen<{ pid: number; code: number | null }>('shell-exit', (event) => {
        if (event.payload.pid !== devPidRef.current) return;
        termRef.current?.writeln(`\x1b[36m▶ Dev server exited (code ${event.payload.code ?? 'unknown'}).\x1b[0m`);
        setDevPid(null);
        setDevBusy(false);
      });
      if (cancelled) {
        outUn();
        exitUn();
      } else {
        unlistenOutput = outUn;
        unlistenExit = exitUn;
      }
    })();
    return () => {
      cancelled = true;
      unlistenOutput?.();
      unlistenExit?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStartDevServer() {
    if (!isTauri() || devBusy || devPid !== null) return;
    setDevBusy(true);
    setDevUrl(null);
    const term = termRef.current;
    term?.writeln(`\r\n\x1b[36m▶ Starting: ${devCmd}${shellCwdRef.current ? ` (in ${shellCwdRef.current})` : ''}\x1b[0m`);
    try {
      const pid = await invokeTauri<number>('shell_spawn_bg', { cmd: devCmd, cwd: shellCwdRef.current || undefined });
      setDevPid(pid);
      pushToast(`Dev server running (pid ${pid})`, 'success');
      playSound('notice');
    } catch (e) {
      console.error('shell_spawn_bg failed', e);
      term?.writeln(`\x1b[31m${e instanceof Error ? e.message : String(e)}\x1b[0m`);
      pushToast('Could not start the dev server — see the terminal output', 'warn');
      setDevBusy(false);
    }
  }

  async function handleStopDevServer() {
    if (devPid === null) return;
    try {
      await invokeTauri('shell_kill_bg', { pid: devPid });
    } catch (e) {
      console.error('shell_kill_bg failed', e);
    } finally {
      termRef.current?.writeln('\x1b[36m▶ Dev server stopped.\x1b[0m');
      setDevPid(null);
      setDevBusy(false);
    }
  }

  function openDevServerInBrowserRoom() {
    if (!devUrl) return;
    useBrowserNavStore.getState().requestNavigate(devUrl);
    useUiStore.getState().go('browser');
    pushToast(`Opening ${devUrl} in the Browser room`, 'info');
  }

  async function handleOpenPyFile() {
    try {
      const f = await openTextFile(['py'], 'Python');
      if (!f) return;
      setOpenFile(f);
      setFileContent(f.content);
      setFileDirty(false);
      setFileResetKey((k) => k + 1);
      if (runtime !== 'python' || status !== 'ready') pick('python');
      pushToast(`Opened ${f.name}`, 'success');
    } catch (e) {
      console.error('Open .py file failed', e);
      pushToast(e instanceof Error ? e.message : 'Could not open that file', 'warn');
    }
  }

  async function handleRunFile() {
    const term = termRef.current;
    if (!term || !openFile) return;
    if (runtime !== 'python') {
      pushToast('Switch to the Python runtime to run this file', 'warn');
      return;
    }
    setFileBusy('running');
    term.writeln(`\r\n\x1b[36m▶ Running ${openFile.name}…\x1b[0m`);
    try {
      // Same memoized Pyodide instance the REPL uses — if it's already
      // booted this resolves instantly; if not, this boots it (status
      // will still say "idle"/"booting", which is fine, this call awaits
      // the real thing either way).
      const py = await bootPyodide(
        (s) => term.writeln(s),
        (s) => term.writeln(`\x1b[31m${s}\x1b[0m`),
      );
      if (status !== 'ready') setStatus('ready');
      const result = await py.runPythonAsync(fileContent);
      if (result !== undefined && result !== null) term.writeln(String(result));
      term.writeln(`\x1b[36m▶ Done.\x1b[0m`);
      playSound('notice');
    } catch (e) {
      console.error('Run file failed', e);
      term.writeln(`\x1b[31m${e instanceof Error ? e.message : String(e)}\x1b[0m`);
      pushToast('Script raised an error — see the terminal output', 'warn');
    } finally {
      setFileBusy('idle');
    }
  }

  async function handleSaveFile() {
    if (!openFile) return;
    setFileBusy('saving');
    try {
      await writeTextFileAt(openFile.path, fileContent);
      setFileDirty(false);
      pushToast(`Saved ${openFile.name}`, 'success');
    } catch (e) {
      console.error('Save .py file failed', e);
      pushToast(e instanceof Error ? e.message : 'Save failed', 'warn');
    } finally {
      setFileBusy('idle');
    }
  }

  async function handleSaveFileAs() {
    try {
      const path = await saveTextFileAs(fileContent, ['py'], 'Python', openFile?.name ?? 'script.py');
      if (!path) return;
      const name = path.split(/[/\\]/).pop() ?? path;
      setOpenFile({ path, name, content: fileContent });
      setFileDirty(false);
      pushToast(`Saved as ${name}`, 'success');
    } catch (e) {
      console.error('Save .py file as failed', e);
      pushToast(e instanceof Error ? e.message : 'Save failed', 'warn');
    }
  }

  function handleCloseFile() {
    setOpenFile(null);
    setFileContent('');
    setFileDirty(false);
  }

  function pick(r: Runtime) {
    if (r === 'shell' && !isTauri()) {
      pushToast('Full shell access requires the desktop app — a browser tab cannot spawn OS processes.', 'warn');
      return;
    }
    if (r === runtime && status === 'ready') return;
    setRuntime(r);
    playSound('nav');
    if (r === 'node') void startNode();
    else if (r === 'python') void startPython();
    else if (r === 'ruby') void startRuby();
    else if (r === 'php') void startPHP();
    else if (r === 'shell') void startShell();
    else void startGo();
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
            NODE.JS
          </span>
          <span className={`chip ${runtime === 'python' ? 'on' : ''}`} onClick={() => pick('python')}>
            PYTHON
          </span>
          <span className={`chip ${runtime === 'ruby' ? 'on' : ''}`} onClick={() => pick('ruby')}>
            RUBY
          </span>
          <span className={`chip ${runtime === 'php' ? 'on' : ''}`} onClick={() => pick('php')}>
            PHP
          </span>
          <span className={`chip ${runtime === 'go' ? 'on' : ''}`} onClick={() => pick('go')}>
            GO
          </span>
          <span
            className={`chip ${runtime === 'shell' ? 'on' : ''} ${!isTauri() ? 'shellChipWeb' : ''}`}
            onClick={() => pick('shell')}
            title={isTauri() ? 'A genuine OS shell — real child processes, your real filesystem, not a sandbox' : 'Full shell access requires the desktop app — browsers cannot spawn OS processes (a hard platform limit)'}
          >
            <Icon name={isTauri() ? 'terminal' : 'warning'} size={12} /> SHELL {isTauri() ? '(REAL OS)' : '(DESKTOP ONLY)'}
          </span>
          <span
            className="chip disabled"
            title="Two separate reasons: (1) no E2B account configured — Captain's call, no key yet. (2) No maintained self-hosted C/C++-to-WASM compiler exists as a real dependency today (the one community demo was pulled from npm in 2021)."
          >
            OTHER (C/C++, needs E2B)
          </span>
          {status === 'booting' && (
            <span className="terminalStatus">
              <Icon name="spinner" size={12} className="spin" /> BOOTING…
            </span>
          )}
          {status === 'ready' && <span className="terminalStatus ready">● READY</span>}
        </div>

        <div className="optrow" style={{ margin: '0 0 12px' }}>
          <span
            className={`chip ${!isTauri() ? 'disabled' : ''}`}
            onClick={handleOpenPyFile}
            title={isTauri() ? 'Open a .py file from disk to edit and run' : 'Desktop app only'}
          >
            <Icon name="folderOpen" size={12} /> OPEN .py FILE
          </span>
        </div>

        {runtime === 'shell' && isTauri() && (
          <div className="fileEditorPanel devServerPanel">
            <div className="fileEditorToolbar">
              <span className="fileEditorName">
                <Icon name="folderOpen" size={12} /> CWD: {shellCwd || '(app default)'}
              </span>
              <span className="fileEditorBtn" onClick={() => void handlePickShellCwd()} title="Pick your project folder">
                PICK FOLDER
              </span>
            </div>
            <div className="fileEditorToolbar">
              <span className="fileEditorName">
                <Icon name="server" size={12} /> RUN DEV SERVER
              </span>
              <input
                className="browserAddress devCmdInput"
                value={devCmd}
                disabled={devPid !== null}
                placeholder="npm run dev"
                onChange={(e) => setDevCmd(e.target.value)}
              />
              {devPid === null ? (
                <span className={`fileEditorBtn ${devBusy ? 'disabled' : ''}`} onClick={() => void handleStartDevServer()} title="Spawn a real background process">
                  <Icon name="play" size={12} /> START
                </span>
              ) : (
                <span className="fileEditorBtn" onClick={() => void handleStopDevServer()} title={`Kill pid ${devPid}`}>
                  <Icon name="stop" size={12} /> STOP (pid {devPid})
                </span>
              )}
              {devUrl && (
                <>
                  <span className="fileEditorBtn" onClick={openDevServerInBrowserRoom} title="Navigate the Browser room here">
                    <Icon name="browser" size={12} /> OPEN IN BROWSER ROOM
                  </span>
                  <span className="fileEditorBtn" onClick={() => void openExternally(devUrl)} title="Open in your system's default browser">
                    <Icon name="externalLink" size={12} /> OPEN EXTERNALLY
                  </span>
                </>
              )}
            </div>
            {devPid !== null && !devUrl && (
              <div className="browserPanelHint">Running — watching real stdout below for a localhost URL to open…</div>
            )}
          </div>
        )}

        {openFile && (
          <div className="fileEditorPanel">
            <div className="fileEditorToolbar">
              <span className="fileEditorName">
                <Icon name="file" size={12} /> {openFile.name}
                {fileDirty && <span className="fileDirtyDot" title="Unsaved changes" />}
              </span>
              <span
                className={`fileEditorBtn ${fileBusy !== 'idle' || runtime !== 'python' ? 'disabled' : ''}`}
                onClick={handleRunFile}
                title={runtime !== 'python' ? 'Switch to the Python runtime first' : 'Run this file'}
              >
                <Icon name="play" size={12} /> {fileBusy === 'running' ? 'RUNNING…' : 'RUN'}
              </span>
              <span className={`fileEditorBtn ${fileBusy !== 'idle' ? 'disabled' : ''}`} onClick={handleSaveFile} title="Save">
                <Icon name="save" size={12} /> {fileBusy === 'saving' ? 'SAVING…' : 'SAVE'}
              </span>
              <span className="fileEditorBtn" onClick={handleSaveFileAs} title="Save as a new file">
                SAVE AS
              </span>
              <span className="fileEditorBtn" onClick={handleCloseFile} title="Close editor">
                <Icon name="close" size={12} /> CLOSE
              </span>
            </div>
            <CodeEditor
              className="codeEditorBox"
              value={fileContent}
              resetKey={fileResetKey}
              language="python"
              onChange={(v) => {
                setFileContent(v);
                setFileDirty(true);
              }}
            />
          </div>
        )}

        <div className="terminalShell" ref={containerRef} />
      </div>
    </section>
  );
}
