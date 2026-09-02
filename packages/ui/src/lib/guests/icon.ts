import { iconSpriteData } from '@/components/icon/sprite';
import type { IconName } from '@/components/icon/icons';

export const FALLBACK_GUEST_ICON = 'window' satisfies IconName;

/** Product marks in `scripts/generate-icon-sprite.mjs`. Guests name Remixicon only. */
const HOST_PRODUCT_ICONS = new Set([
  'claude-code',
  'cloudflare',
  'command-code',
  'cursor',
  'linear',
  'openchamber',
]);

const isGuestIconName = (name: string): name is IconName => (
  Object.hasOwn(iconSpriteData, name) && !HOST_PRODUCT_ICONS.has(name)
);

export const resolveGuestIconName = (name: string): IconName => (
  isGuestIconName(name) ? name : FALLBACK_GUEST_ICON
);
