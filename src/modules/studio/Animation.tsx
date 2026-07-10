import { useEffect, useRef, useState } from 'react';
import { AnimationEngine, ANIM_PROPS } from './animation/AnimationEngine';
import type { AnimObject, AnimProp, EaseType } from './animation/AnimationEngine';

type Tool = 'select' | 'rect' | 'ellipse' | 'text' | 'bone';

const PROP_LABEL: Record<AnimProp, string> = {
  x: 'X',
  y: 'Y',
  rotation: 'Rotation °',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  opacity: 'Opacity',
};

const PX_PER_FRAME = 14;

/**
 * ANIMATION MODE — Blueprint v0.3 Amendment v0.2/v0.3, built out fully in
 * Amendment v0.4 item 3. Flagship reference: After Effects / Rive. See
 * `animation/AnimationEngine.ts` for the actual keyframe/tween/FK-rig/
 * export implementation — this component is the UI + canvas interaction
 * wiring on top of it: a real per-object, per-property keyframe timeline
 * with tweening and per-segment easing, onion-skinning with an adjustable
 * range, a bone/puppet rig built by chaining bones (drag a child bone's
 * tip to rotate it — forward kinematics ripples the change to every
 * bone below it in the chain, live), play/pause/loop/fps controls, and
 * real GIF + PNG sprite-sheet export.
 *
 * Deliberately NOT built this pass (disclosed, not faked): inverse
 * kinematics, mesh deformation, a particle emitter, gravity/bounce
 * physics, audio-waveform sync, and nested reusable animated symbols —
 * see the engine file's own doc comment for the full reasoning. GIF and
 * PNG sprite-sheet are the two real, working export formats shipped here.
 */
export default function Animation({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const engineRef = useRef<AnimationEngine | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [tick, forceTick] = useState(0);
  const bump = () => forceTick((n) => n + 1);

  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [exporting, setExporting] = useState<'gif' | 'sheet' | null>(null);
  const [propDraft, setPropDraft] = useState<Record<AnimProp, string> | null>(null);

  const dragRef = useRef<{
    mode: 'move' | 'rotate';
    objId: string;
    // for rotate: bone's parent world origin + angle at drag start
    parentOriginX?: number;
    parentOriginY?: number;
    parentAngle?: number;
  } | null>(null);
  const playTimerRef = useRef<number | null>(null);

  useEffect(() => {
    engineRef.current = AnimationEngine.load(boardId);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  const eng = engineRef.current;

  // Redraw whenever frame, selection, tick (edits), or onion settings change.
  useEffect(() => {
    if (!ready || !eng) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#05080d';
    ctx.fillRect(0, 0, cv.width, cv.height);

    if (eng.doc.onionSkin) {
      const range = eng.doc.onionRange;
      for (let i = range; i >= 1; i--) {
        if (frame - i >= 0) eng.renderFrame(ctx, frame - i, { tint: '#3aa0ff', alphaMul: 0.16 * (1 - (i - 1) / (range + 1)) + 0.06 });
      }
      for (let i = 1; i <= range; i++) {
        if (frame + i < eng.doc.frameCount) eng.renderFrame(ctx, frame + i, { tint: '#ff8a3a', alphaMul: 0.16 * (1 - (i - 1) / (range + 1)) + 0.06 });
      }
    }

    eng.renderFrame(ctx, frame);

    // selection outline
    if (selectedId) {
      const obj = eng.find(selectedId);
      if (obj) {
        ctx.save();
        ctx.strokeStyle = '#00F5FF';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        if (obj.type === 'bone') {
          const w = eng.boneWorld(obj, frame);
          ctx.beginPath();
          ctx.arc(w.originX, w.originY, 9, 0, Math.PI * 2);
          ctx.moveTo(w.tipX, w.tipY);
          ctx.arc(w.tipX, w.tipY, 6, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          const x = eng.getValue(obj, 'x', frame);
          const y = eng.getValue(obj, 'y', frame);
          const rot = eng.getValue(obj, 'rotation', frame);
          const sx = eng.getValue(obj, 'scaleX', frame);
          const sy = eng.getValue(obj, 'scaleY', frame);
          ctx.translate(x, y);
          ctx.rotate((rot * Math.PI) / 180);
          ctx.scale(sx || 0.001, sy || 0.001);
          ctx.strokeRect(-obj.w / 2 - 6, -obj.h / 2 - 6, obj.w + 12, obj.h + 12);
        }
        ctx.restore();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, frame, selectedId, tick]);

  // Sync the property draft panel whenever selection or frame changes.
  useEffect(() => {
    if (!eng || !selectedId) {
      setPropDraft(null);
      return;
    }
    const obj = eng.find(selectedId);
    if (!obj) {
      setPropDraft(null);
      return;
    }
    const draft: Record<AnimProp, string> = { x: '', y: '', rotation: '', scaleX: '', scaleY: '', opacity: '' };
    for (const p of ANIM_PROPS) draft[p] = String(round2(eng.getValue(obj, p, frame)));
    setPropDraft(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, frame, tick]);

  // Playback loop.
  useEffect(() => {
    if (!isPlaying || !eng) return;
    const fps = eng.doc.fps;
    playTimerRef.current = window.setInterval(() => {
      setFrame((f) => {
        const next = f + 1;
        if (next >= eng.doc.frameCount) {
          if (eng.doc.loop) return 0;
          setIsPlaying(false);
          return f;
        }
        return next;
      });
    }, Math.round(1000 / fps));
    return () => {
      if (playTimerRef.current) window.clearInterval(playTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, eng?.doc.fps]);

  function canvasPoint(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const scaleX = cv.width / rect.width;
    const scaleY = cv.height / rect.height;
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  }

  function onCanvasPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!eng) return;
    const [px, py] = canvasPoint(e);

    if (tool !== 'select') {
      let obj: AnimObject;
      if (tool === 'bone') obj = eng.addBone(px, py, null);
      else obj = eng.addShape(tool, px, py);
      setSelectedId(obj.id);
      setTool('select');
      bump();
      return;
    }

    const hit = eng.hitTest(px, py, frame);
    setSelectedId(hit?.id ?? null);
    if (!hit) return;

    (e.target as Element).setPointerCapture(e.pointerId);
    eng.beginLiveEdit();
    if (hit.type === 'bone' && hit.parentId) {
      const parent = eng.find(hit.parentId);
      if (parent) {
        const pw = eng.boneWorld(parent, frame);
        dragRef.current = { mode: 'rotate', objId: hit.id, parentOriginX: pw.tipX, parentOriginY: pw.tipY, parentAngle: pw.angle };
      }
    } else {
      dragRef.current = { mode: 'move', objId: hit.id };
    }
  }

  function onCanvasPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || !eng) return;
    const [px, py] = canvasPoint(e);
    const obj = eng.find(drag.objId);
    if (!obj) return;
    if (drag.mode === 'move') {
      eng.pokeValue(drag.objId, 'x', frame, px);
      eng.pokeValue(drag.objId, 'y', frame, py);
    } else {
      const worldAngle = (Math.atan2(py - drag.parentOriginY!, px - drag.parentOriginX!) * 180) / Math.PI;
      const localAngle = worldAngle - (drag.parentAngle ?? 0);
      eng.pokeValue(drag.objId, 'rotation', frame, localAngle);
    }
    bump();
  }

  function onCanvasPointerUp() {
    if (!dragRef.current || !eng) return;
    eng.commitLiveEdit();
    dragRef.current = null;
    bump();
  }

  function commitProp(prop: AnimProp) {
    if (!eng || !selectedId || !propDraft) return;
    const v = parseFloat(propDraft[prop]);
    if (Number.isNaN(v)) return;
    const obj = eng.find(selectedId);
    const existingEase = obj?.keys[prop].find((k) => k.frame === frame)?.ease ?? 'linear';
    eng.setKeyframe(selectedId, prop, frame, v, existingEase);
    bump();
  }

  function setPropEase(prop: AnimProp, easeType: EaseType) {
    if (!eng || !selectedId || !propDraft) return;
    const v = parseFloat(propDraft[prop]);
    if (Number.isNaN(v)) return;
    eng.setKeyframe(selectedId, prop, frame, v, easeType);
    bump();
  }

  function deleteKeyAt(prop: AnimProp) {
    if (!eng || !selectedId) return;
    eng.removeKeyframe(selectedId, prop, frame);
    bump();
  }

  function addChildBone() {
    if (!eng || !selectedId) return;
    const parent = eng.find(selectedId);
    if (!parent || parent.type !== 'bone') return;
    const child = eng.addBone(0, 0, selectedId);
    setSelectedId(child.id);
    bump();
  }

  function deleteSelected() {
    if (!eng || !selectedId) return;
    eng.removeObject(selectedId);
    setSelectedId(null);
    bump();
  }

  function seekFromRuler(e: React.MouseEvent<HTMLDivElement>) {
    if (!eng) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const f = Math.round((e.clientX - rect.left) / PX_PER_FRAME);
    setFrame(Math.max(0, Math.min(eng.doc.frameCount - 1, f)));
  }

  async function doExportGif() {
    if (!eng) return;
    setExporting('gif');
    // Yield a frame so the "EXPORTING…" state paints before the (synchronous,
    // potentially chunky) GIF encode blocks the main thread.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const blob = eng.exportGif();
      downloadBlob(blob, 'xos-animation.gif');
    } finally {
      setExporting(null);
    }
  }

  async function doExportSheet() {
    if (!eng) return;
    setExporting('sheet');
    try {
      const blob = await eng.exportSpriteSheet();
      downloadBlob(blob, 'xos-animation-sheet.png');
    } finally {
      setExporting(null);
    }
  }

  if (!ready || !eng) return null;

  const selected = selectedId ? eng.find(selectedId) : null;
  const isBone = selected?.type === 'bone';
  const isRootLike = !isBone || !selected?.parentId;
  const visibleProps: AnimProp[] = isBone ? (isRootLike ? ['x', 'y', 'rotation', 'opacity'] : ['rotation', 'opacity']) : ANIM_PROPS;

  return (
    <div id="animRoot">
      <div id="animTopbar">
        <button className="chip" onClick={onExit}>
          ◂ ALL BOARDS
        </button>
        <div id="animToolgroup">
          {(
            [
              ['select', '▽', 'Select / Move'],
              ['rect', '▭', 'Add Rectangle'],
              ['ellipse', '◯', 'Add Ellipse'],
              ['text', '🅣', 'Add Text'],
              ['bone', '🦴', 'Add Root Bone'],
            ] as [Tool, string, string][]
          ).map(([t, icon, label]) => (
            <span key={t} className={`tool ${tool === t ? 'on' : ''}`} onClick={() => setTool(t)} title={label}>
              {icon}
            </span>
          ))}
        </div>
        <div id="animTopActions">
          <button className="chip" disabled={!eng.canUndo()} onClick={() => { eng.undo(); bump(); }}>
            ↺ UNDO
          </button>
          <button className="chip" disabled={!eng.canRedo()} onClick={() => { eng.redo(); bump(); }}>
            ↻ REDO
          </button>
          <span
            className={`chip small ${eng.doc.onionSkin ? 'on' : ''}`}
            onClick={() => {
              eng.doc.onionSkin = !eng.doc.onionSkin;
              eng.persist();
              bump();
            }}
          >
            ONION SKIN
          </span>
          {eng.doc.onionSkin && (
            <select
              className="chip small"
              value={eng.doc.onionRange}
              onChange={(e) => {
                eng.doc.onionRange = Number(e.target.value);
                eng.persist();
                bump();
              }}
            >
              <option value={1}>±1 frame</option>
              <option value={2}>±2 frames</option>
              <option value={3}>±3 frames</option>
            </select>
          )}
          <button className="wbtn" disabled={exporting !== null} onClick={doExportGif}>
            {exporting === 'gif' ? 'ENCODING…' : 'EXPORT GIF'}
          </button>
          <button className="wbtn ghost" disabled={exporting !== null} onClick={doExportSheet}>
            {exporting === 'sheet' ? 'RENDERING…' : 'EXPORT SPRITE SHEET'}
          </button>
        </div>
      </div>

      <div id="animBody">
        <div id="animSidebar" className="gpanel">
          <h3>OBJECTS</h3>
          <div className="toolCol" style={{ gap: 4, maxHeight: 160, overflowY: 'auto' }}>
            {eng.doc.objects.length === 0 && (
              <div className="rsub" style={{ fontSize: 9, marginBottom: 0 }}>
                Pick a tool above, then click the canvas to add your first object.
              </div>
            )}
            {eng.doc.objects.map((o) => (
              <div
                key={o.id}
                className="layer-row"
                onClick={() => setSelectedId(o.id)}
                style={{ borderColor: selectedId === o.id ? 'var(--cyan)' : undefined, cursor: 'pointer' }}
              >
                <span className="lbl">
                  {o.type === 'bone' ? '🦴' : o.type === 'rect' ? '▭' : o.type === 'ellipse' ? '◯' : '🅣'} {o.name}
                </span>
              </div>
            ))}
          </div>

          {selected && (
            <>
              <h3 style={{ marginTop: 14 }}>PROPERTIES — {selected.name}</h3>
              {selected.type === 'text' && (
                <div className="toolField" style={{ marginBottom: 8 }}>
                  <label className="toolHint">Text content</label>
                  <input
                    type="text"
                    value={selected.text ?? ''}
                    onChange={(e) => {
                      selected.text = e.target.value;
                      eng.persist();
                      bump();
                    }}
                  />
                </div>
              )}
              {selected.type !== 'bone' && (
                <div className="toolField" style={{ marginBottom: 8 }}>
                  <label className="toolHint">Fill</label>
                  <input
                    type="color"
                    value={selected.fill}
                    onChange={(e) => {
                      selected.fill = e.target.value;
                      eng.persist();
                      bump();
                    }}
                  />
                </div>
              )}

              {propDraft &&
                visibleProps.map((p) => {
                  const hasKey = eng.hasKeyAt(selected, p, frame);
                  const currentEase = selected.keys[p].find((k) => k.frame === frame)?.ease ?? 'linear';
                  return (
                    <div key={p} className="toolRow" style={{ alignItems: 'center', gap: 4, marginBottom: 4 }}>
                      <span className="toolHint" style={{ width: 62 }}>
                        {PROP_LABEL[p]}
                      </span>
                      <input
                        type="number"
                        step="1"
                        value={propDraft[p]}
                        onChange={(e) => setPropDraft((d) => (d ? { ...d, [p]: e.target.value } : d))}
                        style={{ width: 64 }}
                      />
                      <select
                        className="chip small"
                        value={currentEase}
                        disabled={!hasKey}
                        onChange={(e) => setPropEase(p, e.target.value as EaseType)}
                        title="Easing into this keyframe"
                      >
                        <option value="linear">Linear</option>
                        <option value="easeIn">Ease In</option>
                        <option value="easeOut">Ease Out</option>
                        <option value="easeInOut">Ease In/Out</option>
                      </select>
                      <span
                        className={`chip small ${hasKey ? 'on' : ''}`}
                        title={hasKey ? 'Keyframe set at this frame — click to update its value' : 'Set a keyframe at this frame'}
                        onClick={() => commitProp(p)}
                        data-prop={p}
                        data-testid={`anim-key-${p}`}
                      >
                        {hasKey ? '◆' : '◇'}
                      </span>
                      {hasKey && (
                        <span className="chip small" onClick={() => deleteKeyAt(p)} title="Remove keyframe">
                          ✕
                        </span>
                      )}
                    </div>
                  );
                })}

              <div className="toolRow" style={{ marginTop: 10, gap: 6 }}>
                {isBone && (
                  <button className="wbtn" onClick={addChildBone}>
                    + CHILD BONE
                  </button>
                )}
                <button className="wbtn ghost" onClick={deleteSelected}>
                  DELETE
                </button>
              </div>
            </>
          )}
        </div>

        <div id="animCanvasWrap">
          <canvas
            ref={canvasRef}
            width={eng.doc.width}
            height={eng.doc.height}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerLeave={onCanvasPointerUp}
          />
        </div>
      </div>

      <div id="animTimeline">
        <div id="animPlayControls">
          <span className="chip small" onClick={() => setFrame(0)}>
            ⏮
          </span>
          <span className="chip small" onClick={() => setFrame((f) => Math.max(0, f - 1))}>
            ◀
          </span>
          <span className="chip small" onClick={() => setIsPlaying((p) => !p)} id="animPlayBtn">
            {isPlaying ? '⏸' : '▶'}
          </span>
          <span className="chip small" onClick={() => setFrame((f) => Math.min(eng.doc.frameCount - 1, f + 1))}>
            ▶|
          </span>
          <span
            className={`chip small ${eng.doc.loop ? 'on' : ''}`}
            onClick={() => {
              eng.doc.loop = !eng.doc.loop;
              eng.persist();
              bump();
            }}
          >
            LOOP
          </span>
          <select
            className="chip small"
            value={eng.doc.fps}
            onChange={(e) => {
              eng.doc.fps = Number(e.target.value);
              eng.persist();
              bump();
            }}
          >
            <option value={12}>12 fps</option>
            <option value={24}>24 fps</option>
            <option value={30}>30 fps</option>
          </select>
          <span className="rsub" id="animFrameCounter" style={{ marginBottom: 0 }}>
            Frame {frame} / {eng.doc.frameCount - 1}
          </span>
          <span
            className="chip small"
            onClick={() => {
              eng.doc.frameCount += 30;
              eng.persist();
              bump();
            }}
          >
            +30 FRAMES
          </span>
        </div>

        <div id="animRulerWrap">
          <div id="animRuler" style={{ width: eng.doc.frameCount * PX_PER_FRAME }} onClick={seekFromRuler}>
            {Array.from({ length: Math.ceil(eng.doc.frameCount / 5) }, (_, i) => i * 5).map((f) => (
              <span key={f} className="animRulerTick" style={{ left: f * PX_PER_FRAME }}>
                {f}
              </span>
            ))}
            <div id="animPlayhead" style={{ left: frame * PX_PER_FRAME }} />
          </div>
          <div id="animTracks">
            {eng.doc.objects.map((o) => (
              <div key={o.id} className="animTrackRow" onClick={() => setSelectedId(o.id)} style={{ width: eng.doc.frameCount * PX_PER_FRAME }}>
                {eng.allKeyframedFrames(o).map((f) => (
                  <span
                    key={f}
                    className={`animKeyDot ${o.id === selectedId ? 'sel' : ''}`}
                    style={{ left: f * PX_PER_FRAME }}
                    title={`frame ${f}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(o.id);
                      setFrame(f);
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
