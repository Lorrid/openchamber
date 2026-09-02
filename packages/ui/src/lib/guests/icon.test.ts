import { describe, expect, test } from 'bun:test';

import { FALLBACK_GUEST_ICON, resolveGuestIconName } from './icon.ts';

describe('resolveGuestIconName', () => {
  test('keeps a Remixicon name from the host sprite', () => {
    expect(resolveGuestIconName('git-merge')).toBe('git-merge');
    expect(resolveGuestIconName('task')).toBe('task');
    const gitlab = { icon: 'gitlab' };
    expect(resolveGuestIconName(gitlab.icon)).toBe('gitlab');
  });

  test('falls back for a host product mark', () => {
    expect(resolveGuestIconName('linear')).toBe(FALLBACK_GUEST_ICON);
    expect(resolveGuestIconName('openchamber')).toBe(FALLBACK_GUEST_ICON);
  });

  test('falls back when the sprite has no such Remixicon', () => {
    expect(resolveGuestIconName('icon.svg')).toBe(FALLBACK_GUEST_ICON);
    expect(resolveGuestIconName('not-an-icon')).toBe(FALLBACK_GUEST_ICON);
  });
});
