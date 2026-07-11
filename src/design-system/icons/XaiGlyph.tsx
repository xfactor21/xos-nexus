/**
 * Bespoke xAI presence glyph — NOT from lucide-react. This is xOS's own
 * recurring brand mark for "xAI is here" (dock toggle, error states, auth
 * notices, onboarding), styled as a faceted diamond/orb consistent with the
 * holographic gyroscope-orb visual language the Flight Simulator prototype
 * established and Amendment v0.4 item 4 (xAI hologram overhaul) will build
 * out fully. Drawn as a rotated square with an inner cross-facet and a
 * center core dot — reads as a small gem/orb rather than a generic diamond
 * playing-card suit, and rotates slowly via CSS (`.xIcon.xai`) to hint at
 * the gyroscope without needing the full 3D hologram build yet.
 */
export default function XaiGlyph({ size = 18, strokeWidth = 1.75, ...rest }: { size?: number; strokeWidth?: number; [key: string]: unknown }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d="M12 2 L20 12 L12 22 L4 12 Z" />
      <path d="M12 2 L12 22 M4 12 L20 12" strokeOpacity="0.55" />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
