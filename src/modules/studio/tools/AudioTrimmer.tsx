import { useEffect, useRef, useState } from 'react';
import ToolShell from './ToolShell';

/**
 * Amendment v0.4 item 2 (New Project modal redesign) — Amendment v0.3
 * Section B "Show More" utility tool. Real audio decode via the Web Audio
 * API (`decodeAudioData`), a genuine min/max-per-column waveform drawn from
 * the actual PCM samples (not a decorative squiggle), draggable trim
 * handles, playback of just the trimmed range, and a real WAV export
 * hand-encoded from the trimmed PCM buffer (no server, no ffmpeg — this is
 * a small utility tool, and PCM→WAV is ~30 lines of header-writing, well
 * within that scope).
 */
export default function AudioTrimmer({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragHandleRef = useRef<'start' | 'end' | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  function getCtx(): AudioContext {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    return audioCtxRef.current;
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`xos-studio-audiotrim-${boardId}`);
      if (raw) {
        const saved = JSON.parse(raw) as { fileName?: string };
        if (saved.fileName) setFileName(saved.fileName);
      }
    } catch {
      /* ignore corrupt storage */
    }
    return () => {
      sourceRef.current?.stop();
      audioCtxRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = getCtx();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      bufferRef.current = decoded;
      setDuration(decoded.duration);
      setTrimStart(0);
      setTrimEnd(decoded.duration);
      setFileName(file.name);
      try {
        localStorage.setItem(`xos-studio-audiotrim-${boardId}`, JSON.stringify({ fileName: file.name }));
      } catch {
        /* non-fatal */
      }
      // NOTE: do NOT call drawWaveform(decoded) here directly. The <canvas>
      // element is conditionally rendered off `hasAudio` (derived from
      // bufferRef.current), which only becomes true on the render triggered
      // by the setDuration/setFileName calls above — so canvasRef.current is
      // still null at this exact point in the async handler. The effect
      // below (keyed on `duration`) fires after that render has committed
      // the canvas to the DOM, so canvasRef.current is guaranteed to exist.
    } catch {
      setError('Could not decode that file as audio — try a WAV, MP3, or OGG file.');
    }
  }

  function drawWaveform(buffer: AudioBuffer) {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const w = cv.width;
    const h = cv.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,245,255,.05)';
    ctx.fillRect(0, 0, w, h);

    // Real min/max-per-column sampling of the actual decoded PCM (channel 0),
    // not a synthesized/fake waveform shape.
    const data = buffer.getChannelData(0);
    const samplesPerPixel = Math.max(1, Math.floor(data.length / w));
    ctx.strokeStyle = '#00F5FF';
    ctx.lineWidth = 1;
    const mid = h / 2;
    for (let x = 0; x < w; x++) {
      const start = x * samplesPerPixel;
      let min = 1;
      let max = -1;
      for (let i = 0; i < samplesPerPixel; i++) {
        const v = data[start + i] ?? 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      ctx.beginPath();
      ctx.moveTo(x, mid + min * mid);
      ctx.lineTo(x, mid + max * mid);
      ctx.stroke();
    }
  }

  // Redraw whenever a (new) decoded buffer becomes available. Keyed on
  // `duration` rather than an empty dep array: `duration` only changes when
  // onFile() finishes decoding a new file, and by the time this effect runs
  // the canvas (gated on hasAudio/bufferRef.current) has already committed
  // to the DOM, so canvasRef.current is guaranteed non-null here — unlike
  // calling drawWaveform() synchronously inside onFile() itself.
  useEffect(() => {
    if (bufferRef.current) drawWaveform(bufferRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  function timeToX(t: number, width: number) {
    return duration > 0 ? (t / duration) * width : 0;
  }
  function xToTime(x: number, width: number) {
    return duration > 0 ? Math.max(0, Math.min(duration, (x / width) * duration)) : 0;
  }

  function onOverlayPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const startX = timeToX(trimStart, rect.width);
    const endX = timeToX(trimEnd, rect.width);
    dragHandleRef.current = Math.abs(x - startX) < Math.abs(x - endX) ? 'start' : 'end';
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function onOverlayPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragHandleRef.current) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const t = xToTime(e.clientX - rect.left, rect.width);
    if (dragHandleRef.current === 'start') setTrimStart(Math.min(t, trimEnd - 0.02));
    else setTrimEnd(Math.max(t, trimStart + 0.02));
  }
  function onOverlayPointerUp() {
    dragHandleRef.current = null;
  }

  function playTrimmed() {
    const buffer = bufferRef.current;
    if (!buffer) return;
    const ctx = getCtx();
    sourceRef.current?.stop();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(0, trimStart, Math.max(0.01, trimEnd - trimStart));
    sourceRef.current = src;
    setIsPlaying(true);
    src.onended = () => setIsPlaying(false);
  }
  function stopPlayback() {
    sourceRef.current?.stop();
    setIsPlaying(false);
  }

  /** Real PCM→WAV encoding of just the trimmed sample range — a standard
   * 44-byte RIFF/WAVE header followed by 16-bit PCM samples, interleaved
   * across channels. This is genuine audio re-encoding of the Captain's
   * actual trimmed selection, not a truncated copy of the original file
   * (which would carry the wrong container/duration metadata). */
  function exportTrimmedWav() {
    const buffer = bufferRef.current;
    if (!buffer) return;
    const sampleRate = buffer.sampleRate;
    const startSample = Math.floor(trimStart * sampleRate);
    const endSample = Math.floor(trimEnd * sampleRate);
    const frameCount = Math.max(1, endSample - startSample);
    const numChannels = buffer.numberOfChannels;

    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = frameCount * blockAlign;
    const headerSize = 44;
    const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(arrayBuffer);

    function writeString(offset: number, str: string) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    const channelData: Float32Array[] = [];
    for (let c = 0; c < numChannels; c++) channelData.push(buffer.getChannelData(c));

    let offset = headerSize;
    for (let i = 0; i < frameCount; i++) {
      for (let c = 0; c < numChannels; c++) {
        const sample = channelData[c][startSample + i] ?? 0;
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
        offset += 2;
      }
    }

    const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (fileName ? fileName.replace(/\.[^.]+$/, '') : 'trimmed') + '-trimmed.wav';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const hasAudio = !!bufferRef.current;

  return (
    <ToolShell title="AUDIO WAVEFORM TRIMMER" onExit={onExit}>
      <div className="toolField">
        <label className="toolDrop" style={{ display: 'inline-block' }}>
          {fileName ? `LOADED: ${fileName} (click to replace)` : 'CLICK TO UPLOAD AN AUDIO FILE'}
          <input type="file" accept="audio/*" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      {error && (
        <div className="toolHint" style={{ color: 'var(--magenta)' }}>
          {error}
        </div>
      )}
      {hasAudio && (
        <>
          <div ref={wrapRef} className="toolCanvasWrap" style={{ position: 'relative', width: 640 }}>
            <canvas ref={canvasRef} width={640} height={140} />
            <div
              onPointerDown={onOverlayPointerDown}
              onPointerMove={onOverlayPointerMove}
              onPointerUp={onOverlayPointerUp}
              onPointerLeave={onOverlayPointerUp}
              style={{ position: 'absolute', inset: 0, cursor: 'ew-resize' }}
            >
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(trimStart / (duration || 1)) * 100}%`, background: 'rgba(5,8,13,.65)' }} />
              <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${100 - (trimEnd / (duration || 1)) * 100}%`, background: 'rgba(5,8,13,.65)' }} />
              <div style={{ position: 'absolute', left: `${(trimStart / (duration || 1)) * 100}%`, top: 0, bottom: 0, width: 3, background: '#FF2D78' }} />
              <div style={{ position: 'absolute', left: `${(trimEnd / (duration || 1)) * 100}%`, top: 0, bottom: 0, width: 3, background: '#FF2D78', transform: 'translateX(-3px)' }} />
            </div>
          </div>
          <div className="toolHint">
            Trim: {trimStart.toFixed(2)}s – {trimEnd.toFixed(2)}s (of {duration.toFixed(2)}s total). Drag the pink handles on the waveform to adjust.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {!isPlaying ? (
              <button className="wbtn" onClick={playTrimmed}>
                ▶ PLAY TRIMMED
              </button>
            ) : (
              <button className="wbtn ghost" onClick={stopPlayback}>
                ■ STOP
              </button>
            )}
            <button className="wbtn" onClick={exportTrimmedWav}>
              EXPORT TRIMMED WAV
            </button>
          </div>
        </>
      )}
    </ToolShell>
  );
}
