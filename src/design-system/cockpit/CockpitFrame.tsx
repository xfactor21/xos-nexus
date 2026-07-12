/**
 * Cockpit redesign — structural frame (brackets, canopy arc, perspective
 * floor grid). Mounted ONCE in Shell.tsx as a fixed-position overlay behind
 * the HUD/wings/rooms, per the brief's "shared design-system layer" rule —
 * not duplicated per room. Static SVG/CSS only (no per-frame JS); the
 * ambient particle field drifting over the floor grid is what supplies the
 * motion (see GlobalParticles.tsx), matching the reference mockup's own
 * "static SVG is fine — the particles create the motion" note.
 */
export default function CockpitFrame() {
  return (
    <div className="cockpitCanopy" aria-hidden="true">
      <div className="canopyArc" />
      <div className="bracket bracketTl" />
      <div className="bracket bracketTr" />
      <div className="bracket bracketBl" />
      <div className="bracket bracketBr" />
      <div className="floorGrid">
        <svg viewBox="0 0 1440 400" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="floorFadeCy" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(0,245,255,0)" />
              <stop offset="40%" stopColor="rgba(0,245,255,0.06)" />
              <stop offset="100%" stopColor="rgba(0,245,255,0.02)" />
            </linearGradient>
          </defs>
          <g stroke="rgba(0,245,255,0.22)" strokeWidth="0.8">
            <line x1="0" y1="380" x2="1440" y2="380" />
            <line x1="80" y1="340" x2="1360" y2="340" />
            <line x1="200" y1="295" x2="1240" y2="295" />
            <line x1="350" y1="248" x2="1090" y2="248" />
            <line x1="500" y1="205" x2="940" y2="205" />
            <line x1="620" y1="168" x2="820" y2="168" />
            <line x1="680" y1="138" x2="760" y2="138" />
            <line x1="706" y1="112" x2="734" y2="112" />
          </g>
          <g stroke="rgba(255,45,120,0.16)" strokeWidth="0.8">
            <line x1="720" y1="100" x2="0" y2="400" />
            <line x1="720" y1="100" x2="180" y2="400" />
            <line x1="720" y1="100" x2="360" y2="400" />
            <line x1="720" y1="100" x2="540" y2="400" />
            <line x1="720" y1="100" x2="720" y2="400" />
            <line x1="720" y1="100" x2="900" y2="400" />
            <line x1="720" y1="100" x2="1080" y2="400" />
            <line x1="720" y1="100" x2="1260" y2="400" />
            <line x1="720" y1="100" x2="1440" y2="400" />
          </g>
          <rect width="1440" height="400" fill="url(#floorFadeCy)" opacity="0.5" />
        </svg>
      </div>
    </div>
  );
}
