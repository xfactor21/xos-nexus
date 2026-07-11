import { useEffect, useRef, useState } from 'react';
import ToolShell from './ToolShell';
import Icon from '../../../design-system/icons/Icon';

type OutFormat = 'png' | 'jpeg' | 'webp';

const FORMAT_MIME: Record<OutFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const FORMAT_EXT: Record<OutFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
};

interface StoredPrefs {
  format?: OutFormat;
  quality?: number;
}

function loadPrefs(boardId: string): StoredPrefs {
  try {
    const raw = localStorage.getItem(`xos-studio-imgconv-${boardId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as StoredPrefs;
    return {};
  } catch {
    return {};
  }
}

function savePrefs(boardId: string, prefs: StoredPrefs) {
  try {
    localStorage.setItem(`xos-studio-imgconv-${boardId}`, JSON.stringify(prefs));
  } catch {
    // ignore write failures (private browsing, quota, etc.)
  }
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

export default function ImageConverter({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const initialPrefs = useRef(loadPrefs(boardId)).current;
  const [format, setFormat] = useState<OutFormat>(initialPrefs.format ?? 'png');
  const [quality, setQuality] = useState<number>(initialPrefs.quality ?? 85);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [status, setStatus] = useState<string>('');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    savePrefs(boardId, { format, quality });
  }, [boardId, format, quality]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    setResultBlob(null);
    setStatus('');
    setSourceFile(file);

    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;

    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
        }
      }
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
    img.onerror = () => {
      setStatus('COULD NOT LOAD IMAGE');
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
    img.src = url;
  }

  function handleConvert() {
    const canvas = canvasRef.current;
    if (!canvas || !sourceFile) return;
    setStatus('CONVERTING…');
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setStatus('CONVERSION FAILED');
          return;
        }
        setResultBlob(blob);
        setStatus('');
      },
      FORMAT_MIME[format],
      quality / 100
    );
  }

  function handleDownload() {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `converted.${FORMAT_EXT[format]}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const pctChange =
    sourceFile && resultBlob
      ? Math.round(((resultBlob.size - sourceFile.size) / sourceFile.size) * 100)
      : null;

  return (
    <ToolShell title="IMAGE CONVERTER" onExit={onExit}>
      <div className="toolCol">
        <label className="toolDrop">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          {sourceFile ? `SELECTED: ${sourceFile.name}` : 'CLICK OR DROP AN IMAGE'}
        </label>

        {dims && (
          <div className="toolHint">
            {dims.w} × {dims.h}px — original {kb(sourceFile ? sourceFile.size : 0)}
          </div>
        )}

        <div className="toolCanvasWrap" style={{ maxWidth: 480 }}>
          <canvas
            ref={canvasRef}
            style={dims ? { width: '100%', maxWidth: 480, height: 'auto', display: 'block' } : { display: 'none' }}
          />
        </div>

        <div className="toolRow">
          <button className={`chip${format === 'png' ? ' on' : ''}`} onClick={() => setFormat('png')}>
            PNG
          </button>
          <button className={`chip${format === 'jpeg' ? ' on' : ''}`} onClick={() => setFormat('jpeg')}>
            JPEG
          </button>
          <button className={`chip${format === 'webp' ? ' on' : ''}`} onClick={() => setFormat('webp')}>
            WEBP
          </button>
        </div>

        <div className="toolField">
          <label>
            QUALITY: {quality}
            {format === 'png' ? ' (N/A FOR PNG)' : ''}
          </label>
          <input
            type="range"
            min={1}
            max={100}
            value={quality}
            disabled={format === 'png'}
            onChange={(e) => setQuality(Number(e.target.value))}
          />
        </div>

        <div className="toolRow">
          <button className="wbtn" onClick={handleConvert} disabled={!sourceFile}>
            CONVERT
          </button>
          <button className="wbtn ghost" onClick={handleDownload} disabled={!resultBlob}>
            DOWNLOAD
          </button>
        </div>

        {status && <div className="toolHint">{status}</div>}

        {resultBlob && sourceFile && (
          <div className="toolHint">
            {kb(sourceFile.size)} <Icon name="arrowRight" size={11} /> {kb(resultBlob.size)} ({pctChange !== null && pctChange > 0 ? '+' : ''}
            {pctChange}%)
          </div>
        )}
      </div>
    </ToolShell>
  );
}
