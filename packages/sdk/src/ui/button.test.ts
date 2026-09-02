import { describe, expect, test } from 'bun:test';

import { resolveButtonVariant } from './button.ts';

describe('resolveButtonVariant', () => {
  test('defaults to the card footer tint', () => {
    expect(resolveButtonVariant(undefined)).toBe('default');
    expect(resolveButtonVariant('ghost')).toBe('ghost');
  });
});
