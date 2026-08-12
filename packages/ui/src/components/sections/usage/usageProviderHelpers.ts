import type { ProviderResult, QuotaProviderId, UsageWindow } from '@/types';
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

const hasProviderId = (
  providerIds: ReadonlySet<string> | readonly string[] | undefined,
  providerId: string,
): boolean => {
  if (!providerIds) return false;
  if ('has' in providerIds) return providerIds.has(providerId);
  return providerIds.includes(providerId);
};

export type UsageProviderInclusionOptions = {
  configured?: boolean;
  /** Quota IDs mapped from OpenCode-connected providers (Settings → Providers). */
  connectedQuotaProviderIds?: ReadonlySet<string> | readonly string[];
};

/** Provider is eligible for Usage (quota-configured and/or OpenCode-connected). */
export const isIncludedUsageProvider = (
  providerId: QuotaProviderId,
  options: UsageProviderInclusionOptions,
): boolean => {
  if (options.configured) return true;
  return hasProviderId(options.connectedQuotaProviderIds, providerId);
};

export const isActiveProviderResult = (result: ProviderResult | undefined): boolean =>
  Boolean(result?.configured);

/**
 * Included providers appear in Usage unless the user explicitly removed them.
 * OpenCode-connected providers count even when the quota API reports not configured.
 */
export const isVisibleUsageProvider = (
  providerId: QuotaProviderId,
  options: UsageProviderInclusionOptions & {
    hiddenProviderIds: ReadonlySet<string> | readonly string[];
  },
): boolean => {
  if (!isIncludedUsageProvider(providerId, options)) return false;
  return !hasProviderId(options.hiddenProviderIds, providerId);
};
