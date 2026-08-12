import { describe, expect, test } from 'bun:test';
import type { ProviderResult } from '@/types';
import { isVisibleUsageProvider } from './usageProviderHelpers';

const result = (overrides: Partial<ProviderResult>): ProviderResult => ({
  providerId: 'claude',
  providerName: 'Claude',
  ok: true,
  configured: true,
  usage: null,
  fetchedAt: Date.now(),
  ...overrides,
});

describe('isVisibleUsageProvider', () => {
  test('shows configured providers by default', () => {
    expect(isVisibleUsageProvider(result({}), [])).toBe(true);
  });

  test('hides configured providers on the denylist', () => {
    expect(isVisibleUsageProvider(result({}), ['claude'])).toBe(false);
    expect(isVisibleUsageProvider(result({}), new Set(['claude']))).toBe(false);
  });

  test('never shows unconfigured providers', () => {
    expect(isVisibleUsageProvider(result({ configured: false }), [])).toBe(false);
  });
});
