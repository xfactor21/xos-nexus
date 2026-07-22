import { useEffect, useRef, useState } from 'react';
import ToolShell from './ToolShell';
import Icon from '../../../design-system/icons/Icon';

/**
 * Item #6 (batch 1). Real video trim + real exported cut — no server, no
 * ffmpeg.wasm (heavy enough to be its own separate undertaking). Uses the
 * browser's own `HTMLVideoElement.captureStream()` + `MediaRecorder` to
 * genuinely re-record just the trimmed range as a new file: this plays the
 * source video from trimStart to trimEnd while recording its real captured
 * frames (and audio track), so the output is an actual trimmed clip, not a
 * truncated copy of the original container (which would carry the wrong
 * duration/seek metadata) and not a fake progress bar with no real file at
 * the end. Honest scope note surfaced in the UI: output is WebM (VP9/Opus),
 * the format the MediaRecorder API can actually produce client-side — not
 * an MP4 re-mux, which needs a native encoder this app doesn't have.
 */
export default function VideoTrimmer({ onExit }: { boardId: string; onExit: () => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [supported] = useState(() => typeof HTMLVideoElement !== 'undefined' && 'captureStream' in HTMLVideoElement.prototype);

  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<'start' | 'end' | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    []
  );

  function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setFileName(file.name);
    const v = videoRef.current;
    if (!v) return;
    v.src = url;
    v.onloadedmetadata = () => {
      setDuration(v.duration);
      setTrimStart(0);
      setTrimEnd(v.duration);
    };
  }

  function timeToPct(t: number) {
    return duration > 0 ? (t / duration) * 100 : 0;
  }
  function xToTime(x: number, width: number) {
    return duration > 0 ? Math.max(0, Math.min(duration, (x / width) * duration)) : 0;
  }

  function onOverlayPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const startX = (timeToPct(trimStart) / 100) * rect.width;
    const endX = (timeToPct(trimEnd) / 100) * rect.width;
    dragHandleRef.current = Math.abs(x - startX) < Math.abs(x - endX) ? 'start' : 'end';
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function onOverlayPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragHandleRef.current) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const t = xToTime(e.clientX - rect.left, rect.width);
    if (dragHandleRef.current === 'start') setTrimStart(Math.min(t, trimEnd - 0.05));
    else setTrimEnd(Math.max(t, trimStart + 0.05));
  }
  function onOverlayPointerUp() {
    dragHandleRef.current = null;
  }

  function playTrimmed() {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = trimStart;
    v.play();
    setIsPlaying(true);
    const onTime = () => {
      if (v.currentTime >= trimEnd) {
        v.pause();
        v.removeEventListener('timeupdate', onTime);
        setIsPlaying(false);
      }
    };
    v.addEventListener('timeupdate', onTime);
  }
  function stopPlayback() {
    videoRef.current?.pause();
    setIsPlaying(false);
  }

  async function exportTrimmed() {
    const v = videoRef.current;
    if (!v || !supported) return;
    setError(null);
    setBusy(true);
    setProgress(0);
    try {
      await new Promise<void>((resolve) => {
        v.currentTime = trimStart;
        const onSeeked = () => {
          v.removeEventListener('seeked', onSeeked);
          resolve();
        };
        v.addEventListener('seeked', onSeeked);
      });
      type CaptureVideo = HTMLVideoElement & { captureStream: () => MediaStream };
      const stream = (v as CaptureVideo).captureStream();
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const finished = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      });
      recorder.start();
      await v.play();
      const total = trimEnd - trimStart;
      const onTime = () => {
        setProgress(Math.min(1, (v.currentTime - trimStart) / Math.max(0.01, total)));
        if (v.currentTime >= trimEnd) {
          v.pause();
          v.removeEventListener('timeupdate', onTime);
          recorder.stop();
        }
      };
      v.addEventListener('timeupdate', onTime);
      const blob = await finished;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (fileName ? fileName.replace(/\.[^.]+$/, '') : 'trimmed') + '-trimmed.webm';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      console.error('VideoTrimmer export failed', err);
      setError("Couldn't export that clip — your browser may not support recording this video's codec.");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  const hasVideo = !!fileName;

  return (
    <ToolShell title="VIDEO TRIMMER" onExit={onExit}>
      <div className="toolField">
        <label className="toolDrop" style={{ display: 'inline-block' }}>
          {fileName ? `LOADED: ${fileName} (click to replace)` : 'CLICK TO UPLOAD A VIDEO FILE'}
          <input type="file" accept="video/*" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      {!supported && (
        <div className="toolHint" style={{ color: 'var(--amber)' }}>
          This browser doesn't support real client-side video recording (captureStream) — trimming preview works, but export is unavailable here.
        </div>
      )}
      {error && (
        <div className="toolHint" style={{ color: 'var(--magenta)' }}>
          {error}
        </div>
      )}
      <div style={{ marginTop: 10, display: hasVideo ? 'block' : 'none' }}>
        <video ref={videoRef} style={{ width: '100%', maxWidth: 640, borderRadius: 8, background: '#000' }} controls={false} muted={false} />
        <div ref={wrapRef} style={{ position: 'relative', width: '100%', maxWidth: 640, height: 28, marginTop: 10, background: 'rgba(0,245,255,.06)', borderRadius: 6 }}>
          <div
            onPointerDown={onOverlayPointerDown}
            onPointerMove={onOverlayPointerMove}
            onPointerUp={onOverlayPointerUp}
            onPointerLeave={onOverlayPointerUp}
            style={{ position: 'absolute', inset: 0, cursor: 'ew-resize' }}
          >
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${timeToPct(trimStart)}%`, background: 'rgba(5,8,13,.65)' }} />
            <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${100 - timeToPct(trimEnd)}%`, background: 'rgba(5,8,13,.65)' }} />
            <div style={{ position: 'absolute', left: `${timeToPct(trimStart)}%`, top: 0, bottom: 0, width: 3, background: '#FF2D78' }} />
            <div style={{ position: 'absolute', left: `${timeToPct(trimEnd)}%`, top: 0, bottom: 0, width: 3, background: '#FF2D78', transform: 'translateX(-3px)' }} />
          </div>
        </div>
        <div className="toolHint">
          Trim: {trimStart.toFixed(2)}s – {trimEnd.toFixed(2)}s (of {duration.toFixed(2)}s total). Drag the pink handles to adjust.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
          {!isPlaying ? (
            <button className="wbtn" onClick={playTrimmed}>
              <Icon name="play" size={12} /> PLAY TRIMMED
            </button>
          ) : (
            <button className="wbtn ghost" onClick={stopPlayback}>
              <Icon name="stop" size={12} /> STOP
            </button>
          )}
          <button className="wbtn" onClick={exportTrimmed} disabled={busy || !supported}>
            {busy ? `EXPORTING… ${Math.round(progress * 100)}%` : 'EXPORT TRIMMED CLIP (.webm)'}
          </button>
        </div>
      </div>
    </ToolShell>
  );
}
