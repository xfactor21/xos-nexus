import Icon from './Icon';
import { ICONS } from './registry';
import type { IconName } from './registry';
import type { IconGlow } from './Icon';

function isIconName(v: string): v is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, v);
}

/**
 * Renders a *data-sourced* icon value (currently: `projects.icon`) that may
 * be one of our own IconName keys (the normal case going forward — see
 * `local.ts`'s PROJECT_CLASSES) OR a raw emoji character from an existing
 * Supabase row / a Captain's own custom choice from before this pass.
 *
 * This is a deliberate, disclosed exception to "kill all emoji, no
 * exceptions": that directive targets xOS's OWN systemic UI iconography
 * (room nav, mode pickers, toolbars) — not arbitrary per-row data a
 * Captain may have already saved. Rather than silently breaking existing
 * projects or requiring an unauthorized migration (same no-migration
 * stance as the rest of this room), unrecognized values render as-is; only
 * our own new default IconName values route through the shared Icon
 * system. See core/mappers.ts and modules/projects/local.ts for where the
 * new defaults are set.
 */
export default function DataIcon({ value, size = 16, glow = 'none' }: { value: string; size?: number; glow?: IconGlow }) {
  if (isIconName(value)) return <Icon name={value} size={size} glow={glow} />;
  return <span style={{ fontSize: size }}>{value}</span>;
}
