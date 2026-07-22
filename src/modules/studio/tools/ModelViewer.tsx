import { Suspense, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stage, useGLTF } from '@react-three/drei';
import type { Group } from 'three';
import ToolShell from './ToolShell';
import Icon from '../../../design-system/icons/Icon';

/**
 * Item #6 (batch 1) — the stretch goal. Real glTF/GLB model loading via
 * three.js's GLTFLoader (through @react-three/drei's useGLTF, already a
 * project dependency — no new library) with real orbit/zoom/pan camera
 * controls. Scope is genuinely "preview a 3D model file," as the original
 * blurb says — not a full modeling/editing suite.
 */
function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const ref = useRef<Group>(null);
  return <primitive ref={ref} object={scene} />;
}

export default function ModelViewer({ onExit }: { boardId: string; onExit: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    if (!/\.(glb|gltf)$/i.test(file.name)) {
      setError('This viewer reads .glb / .gltf model files — try exporting your model to one of those formats first.');
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const next = URL.createObjectURL(file);
    objectUrlRef.current = next;
    setUrl(next);
    setFileName(file.name);
  }

  return (
    <ToolShell title="3D MODEL VIEWER" onExit={onExit}>
      <div className="toolField">
        <label className="toolDrop" style={{ display: 'inline-block' }}>
          {fileName ? `LOADED: ${fileName} (click to replace)` : 'CLICK TO UPLOAD A .glb / .gltf MODEL'}
          <input type="file" accept=".glb,.gltf" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      {error && (
        <div className="toolHint" style={{ color: 'var(--magenta)' }}>
          {error}
        </div>
      )}
      <div className="toolCanvasWrap" style={{ width: '100%', maxWidth: 700, height: 460, marginTop: 10 }}>
        {url ? (
          <Canvas camera={{ position: [3, 2, 5], fov: 45 }} dpr={[1, 2]}>
            <Suspense fallback={null}>
              <Stage environment="city" intensity={0.5}>
                <Model url={url} />
              </Stage>
            </Suspense>
            <OrbitControls makeDefault enableDamping />
          </Canvas>
        ) : (
          <div className="toolHint" style={{ display: 'flex', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'center' }}>
            <Icon name="hexagon" size={14} /> Upload a model to preview it here — drag to orbit, scroll to zoom.
          </div>
        )}
      </div>
    </ToolShell>
  );
}
