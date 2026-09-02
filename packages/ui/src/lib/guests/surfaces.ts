import type { ContextSurfaceDescriptor } from '@/lib/surfaces/registry';
import { pluginModeFromId } from '@/lib/surfaces/modes';

import { resolveGuestIconName } from './icon.ts';
import type { InstalledGuest } from './types.ts';

export const guestSurfaceFromInstalled = (
  guest: InstalledGuest,
): ContextSurfaceDescriptor => ({
  id: pluginModeFromId(guest.id),
  mode: pluginModeFromId(guest.id),
  icon: resolveGuestIconName(guest.icon),
  label: guest.name,
  labelKey: 'contextRail.surface.plugin',
  descriptionKey: 'contextRail.surface.plugin.description',
  availability: 'always',
  defaultWidthFraction: 0.45,
});
