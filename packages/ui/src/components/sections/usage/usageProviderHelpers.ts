import type { ProviderResult, UsageWindow } from '@/types';
import { clampPercent } from '@/lib/quota';

export const getProviderUsedPercent = (
  usage: ProviderResult['usage'] | null | undefined,
): number | null => {
  const windows = usage?.windows ?? {};
  const values = Object.values(windows)
    .map((window) => window.usedPercent)
    .filter((value): value is number => typeof value === 'number');
  if (values.length === 0) return null;
  return Math.max(...values);
};

export const getProviderRemainingPercent = (
  usage: ProviderResult['usage'] | null | undefined,
): number | null => {
  const used = getProviderUsedPercent(usage);
  if (used === null) return null;
  const remaining = 100 - used;
  return clampPercent(remaining);
};

export const listProviderWindows = (
  usage: ProviderResult['usage'] | null | undefined,
): Array<{ label: string; window: UsageWindow }> => {
  if (!usage?.windows) return [];
  return Object.entries(usage.windows).map(([label, window]) => ({ label, window }));
};

export const isActiveProviderResult = (result: ProviderResult | undefined): boolean =>
  Boolean(result?.configured);
