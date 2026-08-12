import { describe, expect, test } from 'bun:test';
import { isIncludedUsageProvider, isVisibleUsageProvider } from './usageProviderHelpers';

describe('isIncludedUsageProvider', () => {
  test('includes quota-configured providers', () => {
    expect(isIncludedUsageProvider('claude', { configured: true })).toBe(true);
  });

  test('includes OpenCode-connected providers mapped to quota IDs', () => {
    expect(isIncludedUsageProvider('google', {
      configured: false,
      connectedQuotaProviderIds: new Set(['google', 'github-copilot']),
    })).toBe(true);
  });

  test('excludes providers that are neither configured nor connected', () => {
    expect(isIncludedUsageProvider('claude', {
      configured: false,
      connectedQuotaProviderIds: new Set(['google']),
    })).toBe(false);
  });
});

describe('isVisibleUsageProvider', () => {
  test('shows configured providers by default', () => {
    expect(isVisibleUsageProvider('claude', {
      configured: true,
      hiddenProviderIds: [],
    })).toBe(true);
  });

  test('shows connected providers even when quota is not configured', () => {
    expect(isVisibleUsageProvider('github-copilot', {
      configured: false,
      connectedQuotaProviderIds: ['github-copilot'],
      hiddenProviderIds: [],
    })).toBe(true);
  });

  test('hides included providers on the denylist', () => {
    expect(isVisibleUsageProvider('claude', {
      configured: true,
      hiddenProviderIds: ['claude'],
    })).toBe(false);
    expect(isVisibleUsageProvider('google', {
      configured: false,
      connectedQuotaProviderIds: new Set(['google']),
      hiddenProviderIds: new Set(['google']),
    })).toBe(false);
  });

  test('never shows providers that are neither configured nor connected', () => {
    expect(isVisibleUsageProvider('claude', {
      configured: false,
      connectedQuotaProviderIds: [],
      hiddenProviderIds: [],
    })).toBe(false);
  });
});
