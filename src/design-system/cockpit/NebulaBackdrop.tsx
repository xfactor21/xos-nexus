import nebulaImg from './assets/nebula-backdrop.webp';

/**
 * Redesign pass — global nebula backdrop. Mounted once in Shell.tsx,
 * behind GlobalParticles/CockpitFrame, in front of the flat `--void` body
 * background. Real painterly space art (from the xOS Identity Kit),
 * heavily dimmed and covered by a radial dark-vignette gradient so panel
 * text stays fully legible over it everywhere — the brief's reference
 * concept renders every room over photographic nebula/galaxy art instead
 * of a flat void, so this is the shared layer that gets us there without
 * touching per-room components (Observatory keeps its own separate
 * procedural star-field canvas layered on top of this, unaffected).
 *
 * Fixed + pointer-events:none so it never intercepts input and never
 * scrolls with room content. `aria-hidden` since it's decorative.
 */
export default function NebulaBackdrop() {
  return (
    <div className="nebulaBackdrop" aria-hidden="true">
      <img src={nebulaImg} alt="" className="nebulaBackdropImg" />
      <div className="nebulaBackdropVignette" />
    </div>
  );
}
