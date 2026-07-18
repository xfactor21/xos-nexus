import { useEffect, useRef, useState } from 'react';
import type { EditorView as EditorViewType } from '@codemirror/view';
import Icon from './icons/Icon';

export type EditorLanguage = 'python' | 'html';

interface CodeEditorProps {
  /** Initial document text. Treated as UNCONTROLLED after mount — CodeMirror
   * owns keystroke-by-keystroke state internally (fighting React for that on
   * every render would reset the cursor/undo-history each time). To load a
   * genuinely new document (opening a different file), change `resetKey` —
   * that remounts the editor with fresh `value` as the new starting doc.
   * Use `onChange` to read the live text out (for Run/Save). */
  value: string;
  resetKey: string | number;
  onChange: (value: string) => void;
  language: EditorLanguage;
  readOnly?: boolean;
  className?: string;
}

/** Small, self-hosted CodeMirror 6 wrapper — used by the Terminal room
 * (editing/running local .py files) and the Browser room (editing local
 * .html files). Deliberately not Monaco: CodeMirror 6 is ~10x lighter and
 * this app already leans "self-hosted WASM/JS runtime, no heavy CDN
 * dependency" everywhere else (Pyodide, ruby.wasm, php-wasm all bundled
 * the same way) — same philosophy applied to the editor itself.
 *
 * CodeMirror's packages are dynamically imported (not statically at the
 * top of this file) for the same reason WebContainers/Pyodide/etc. boot
 * lazily in the Terminal room: RoomOutlet mounts every room simultaneously
 * (never-unmount pattern), so a static import here would put ~600KB of
 * editor code in the app's main bundle even for Captains who never open a
 * file. */
export default function CodeEditor({ value, resetKey, onChange, language, readOnly, className }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorViewType | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [{ EditorView, basicSetup }, { EditorState }, { python }, { html }] = await Promise.all([
        import('codemirror'),
        import('@codemirror/state'),
        import('@codemirror/lang-python'),
        import('@codemirror/lang-html'),
      ]);
      if (cancelled || !containerRef.current) return;
      const xosDarkTheme = EditorView.theme(
        {
          '&': { backgroundColor: '#05080Dcc', color: '#d8e6f2', height: '100%', fontSize: '13px' },
          '.cm-content': { fontFamily: '"JetBrains Mono", "Fira Code", monospace', caretColor: '#00F5FF' },
          '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#00F5FF' },
          '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
            backgroundColor: 'rgba(255,45,120,0.35)',
          },
          '.cm-gutters': {
            backgroundColor: '#05080Dcc',
            color: '#5c7285',
            border: 'none',
            borderRight: '1px solid rgba(255,255,255,0.08)',
          },
          '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
          '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.06)' },
          '&.cm-editor.cm-focused': { outline: 'none' },
        },
        { dark: true },
      );
      const langExt = language === 'python' ? python() : html();
      const state = EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          langExt,
          xosDarkTheme,
          EditorView.editable.of(!readOnly),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      });
      const view = new EditorView({ state, parent: containerRef.current });
      viewRef.current = view;
      setLoading(false);
    })();
    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // Intentionally re-creates only when the file identity or language
    // changes — see the `value` doc comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, language, readOnly]);

  return (
    <div className={className} style={{ position: 'relative' }}>
      {loading && (
        <div className="codeEditorLoading">
          <Icon name="spinner" size={16} className="spin" /> Loading editor…
        </div>
      )}
      <div ref={containerRef} style={{ height: '100%' }} />
    </div>
  );
}
