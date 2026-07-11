import { ICONS } from './registry';
import type { IconName } from './registry';

export type IconGlow = 'cyan' | 'purple' | 'magenta' | 'amber' | 'none';

export interface IconProps {
  name: IconName;
  size?: number;
  /** Glow color keyed to the design system's neon palette tokens. Default
   * 'none' — most icons sit inline in already-colored text (nav rows,
   * buttons) and don't need their own glow; pass a color explicitly for
   * icons that should visually "emit," per the amendment's depth directive
   * (active nav icon, xAI presence glyph, room accents). */
  glow?: IconGlow;
  /** 0-1, only meaningful when `filled` is true or for the bespoke `xai`
   * glyph's core dot — most icons here are stroke-only line icons per the
   * amendment ("consistent stroke weight"), not filled pictograms. */
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

const GLOW_VAR: Record<Exclude<IconGlow, 'none'>, string> = {
  cyan: 'var(--cyan)',
  purple: 'var(--purple)',
  magenta: 'var(--magenta)',
  amber: 'var(--amber)',
};

/**
 * The ONE icon component used app-wide (Blueprint v0.3 Amendment v0.6 step
 * 1) — every render call site imports this instead of writing a raw emoji
 * or dingbat character. Enforces the amendment's "consistent stroke
 * weight, glowing outline treatment matching the neon palette" directive
 * in exactly one place rather than per-component, so the treatment can't
 * drift room to room.
 */
export default function Icon({ name, size = 16, glow = 'none', strokeWidth = 1.75, className, style, title }: IconProps) {
  const Cmp = ICONS[name];
  if (!Cmp) return null;
  const glowColor = glow !== 'none' ? GLOW_VAR[glow] : undefined;
  return (
    <Cmp
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      className={`xIcon${className ? ` ${className}` : ''}`}
      style={{
        display: 'inline-block',
        verticalAlign: '-0.15em',
        color: glowColor,
        filter: glowColor ? `drop-shadow(0 0 2px ${glowColor}) drop-shadow(0 0 6px ${glowColor})` : undefined,
        ...style,
      }}
    />
  );
}
