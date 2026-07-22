/**
 * `polybooljs` ships no bundled TypeScript types and there's no
 * @types/polybooljs package on the registry. Minimal hand-written
 * declaration covering exactly the surface VectorEditor.tsx calls — see
 * node_modules/polybooljs/README.md for the full real API.
 */
declare module 'polybooljs' {
  export interface PolyBoolPolygon {
    regions: [number, number][][];
    inverted: boolean;
  }
  const PolyBool: {
    union(a: PolyBoolPolygon, b: PolyBoolPolygon): PolyBoolPolygon;
    intersect(a: PolyBoolPolygon, b: PolyBoolPolygon): PolyBoolPolygon;
    difference(a: PolyBoolPolygon, b: PolyBoolPolygon): PolyBoolPolygon;
    differenceRev(a: PolyBoolPolygon, b: PolyBoolPolygon): PolyBoolPolygon;
    xor(a: PolyBoolPolygon, b: PolyBoolPolygon): PolyBoolPolygon;
  };
  export default PolyBool;
}
