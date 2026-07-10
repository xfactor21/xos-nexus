/**
 * `gifenc` ships no bundled TypeScript types and there's no @types/gifenc
 * package on the registry. This is a minimal hand-written declaration
 * covering exactly the surface AnimationEngine.ts actually calls — see
 * node_modules/gifenc/README.md for the full (larger) real API.
 */
declare module 'gifenc' {
  export type GifColor = [number, number, number] | [number, number, number, number];

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: 'rgb565' | 'rgb444' | 'rgba4444' },
  ): GifColor[];

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifColor[],
    format?: 'rgb565' | 'rgb444' | 'rgba4444',
  ): Uint8Array;

  export interface GIFEncoderWriteFrameOpts {
    palette?: GifColor[];
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    delay?: number;
    repeat?: number;
    dispose?: number;
  }

  export interface GIFEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: GIFEncoderWriteFrameOpts): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    writeHeader(): void;
    reset(): void;
    buffer: ArrayBuffer;
  }

  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GIFEncoderInstance;
}
