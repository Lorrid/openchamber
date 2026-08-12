import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2/client';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { ProviderLogo } from '@/components/ui/ProviderLogo';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { SettingsChipGroup, SettingsSection } from '@/components/sections/shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import {
  USAGE_ADD_PROVIDER_ID,
  averageCostPer1kTokens,
  buildPeriodUsageSummary,
  collectConnectedQuotaProviderIds,
  colorForProviderIndex,
  formatCompactNumber,
  formatPercentDelta,
  formatSignedCompact,
  formatSignedUsd,
  formatUsd,
  percentChange,
  QUOTA_PROVIDERS,
  resolveUsageTone,
  type UsageMetricMode,
  type UsagePeriodDays,
} from '@/lib/quota';
import { getAllSyncSessions } from '@/sync/sync-refs';
import { useQuotaAutoRefresh, useQuotaStore } from '@/stores/useQuotaStore';
import { useUIStore } from '@/stores/useUIStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { cn } from '@/lib/utils';
import type { ProviderResult, QuotaProviderId } from '@/types';
import { UsageAreaChart } from './UsageAreaChart';
import { UsageDonutChart } from './UsageDonutChart';
import { UsageProgressBar } from './UsageProgressBar';
import {
  getProviderRemainingPercent,
  getProviderUsedPercent,
  isIncludedUsageProvider,
  isVisibleUsageProvider,
  listProviderWindows,
} from './usageProviderHelpers';
import { formatWindowLabel } from '@/lib/quota';

const PERIOD_OPTIONS: UsagePeriodDays[] = [7, 30];
const CREDENTIAL_PROVIDERS = new Set<QuotaProviderId>(['ollama-cloud', 'cursor']);

const DeltaBadge: React.FC<{
  delta: number | null;
  invert?: boolean;
  label: string;
}> = ({ delta, invert = false, label }) => {
  if (delta === null) {
    return <span className="typography-micro text-muted-foreground">{label}</span>;
  }
  const improved = invert ? delta < 0 : delta > 0;
  const worsened = invert ? delta > 0 : delta < 0;
  // For spend/tokens/requests, increases are "worse" (red); cost-per-token decreases are better (green).
  const toneClass = invert
    ? (improved ? 'text-[var(--status-success)]' : worsened ? 'text-[var(--status-error)]' : 'text-muted-foreground')
    : (delta > 0 ? 'text-[var(--status-error)]' : delta < 0 ? 'text-[var(--status-success)]' : 'text-muted-foreground');
  return <span className={cn('typography-micro tabular-nums', toneClass)}>{label}</span>;
};

export const UsageOverview: React.FC = () => {
  const { t } = useI18n();
  const results = useQuotaStore((state) => state.results);
  const hiddenProviderIds = useQuotaStore((state) => state.hiddenProviderIds);
  const setSelectedProvider = useQuotaStore((state) => state.setSelectedProvider);
  const hideUsageProvider = useQuotaStore((state) => state.hideUsageProvider);
  const showUsageProvider = useQuotaStore((state) => state.showUsageProvider);
  const fetchAllQuotas = useQuotaStore((state) => state.fetchAllQuotas);
  const isLoading = useQuotaStore((state) => state.isLoading);
  const loadSettings = useQuotaStore((state) => state.loadSettings);
  const setSettingsPage = useUIStore((state) => state.setSettingsPage);
  const setConfigSelectedProvider = useConfigStore((state) => state.setSelectedProvider);
  const configProviders = useConfigStore((state) => state.providers);

  const [periodDays, setPeriodDays] = React.useState<UsagePeriodDays>(7);
  const [metric, setMetric] = React.useState<UsageMetricMode>('cost');
  const [sessionTick, setSessionTick] = React.useState(0);

  useQuotaAutoRefresh();

  React.useEffect(() => {
    void loadSettings();
    void fetchAllQuotas();
  }, [loadSettings, fetchAllQuotas]);

  React.useEffect(() => {
    const timer = window.setInterval(() => setSessionTick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const hiddenSet = React.useMemo(() => new Set(hiddenProviderIds), [hiddenProviderIds]);
  const connectedQuotaIds = React.useMemo(
    () => collectConnectedQuotaProviderIds(configProviders.map((provider) => provider.id)),
    [configProviders],
  );

  const activeResults = React.useMemo(() => {
    return QUOTA_PROVIDERS.flatMap((meta): ProviderResult[] => {
      const result = results.find((entry) => entry.providerId === meta.id);
      if (!isVisibleUsageProvider(meta.id, {
        configured: result?.configured,
        connectedQuotaProviderIds: connectedQuotaIds,
        hiddenProviderIds: hiddenSet,
      })) {
        return [];
      }
      return [result ?? {
        providerId: meta.id,
        providerName: meta.name,
        ok: true,
        configured: false,
        usage: null,
        fetchedAt: 0,
      }];
    });
  }, [connectedQuotaIds, hiddenSet, results]);

  const availableProviders = React.useMemo(() => {
    return QUOTA_PROVIDERS.filter((provider) => {
      const result = results.find((entry) => entry.providerId === provider.id);
      const included = isIncludedUsageProvider(provider.id, {
        configured: result?.configured,
        connectedQuotaProviderIds: connectedQuotaIds,
      });
      if (!included) return true;
      return hiddenSet.has(provider.id);
    });
  }, [connectedQuotaIds, hiddenSet, results]);

  const periodSummary = React.useMemo(() => {
    void sessionTick;
    const sessions = getAllSyncSessions() as Session[];
    return buildPeriodUsageSummary(sessions, { periodDays });
  }, [periodDays, sessionTick]);

  const providerColorById = React.useMemo(() => {
    const map = new Map<QuotaProviderId, string>();
    activeResults.forEach((result, index) => {
      map.set(result.providerId, colorForProviderIndex(index));
    });
    periodSummary.byProvider.forEach((entry, index) => {
      if (!map.has(entry.providerId)) {
        map.set(entry.providerId, colorForProviderIndex(activeResults.length + index));
      }
    });
    return map;
  }, [activeResults, periodSummary.byProvider]);

  const chartSeries = React.useMemo(() => {
    const ids = periodSummary.byProvider.map((entry) => entry.providerId);
    const fallbackIds = activeResults.map((result) => result.providerId);
    const ordered = (ids.length > 0 ? ids : fallbackIds).slice(0, 5);
    return ordered.map((id) => ({
      id,
      label: QUOTA_PROVIDERS.find((provider) => provider.id === id)?.name ?? id,
      color: providerColorById.get(id) ?? colorForProviderIndex(0),
    }));
  }, [activeResults, periodSummary.byProvider, providerColorById]);

  const spendDelta = periodSummary.totals.cost - periodSummary.previousTotals.cost;
  const spendDeltaPct = percentChange(periodSummary.totals.cost, periodSummary.previousTotals.cost);
  const tokenDelta = periodSummary.totals.tokens - periodSummary.previousTotals.tokens;
  const tokenDeltaPct = percentChange(periodSummary.totals.tokens, periodSummary.previousTotals.tokens);
  const requestDelta = periodSummary.totals.requests - periodSummary.previousTotals.requests;
  const requestDeltaPct = percentChange(periodSummary.totals.requests, periodSummary.previousTotals.requests);
  const avgCost = averageCostPer1kTokens(periodSummary.totals.cost, periodSummary.totals.tokens);
  const prevAvgCost = averageCostPer1kTokens(periodSummary.previousTotals.cost, periodSummary.previousTotals.tokens);
  const avgCostDelta = avgCost !== null && prevAvgCost !== null ? avgCost - prevAvgCost : null;
  const avgCostDeltaPct = avgCost !== null && prevAvgCost !== null ? percentChange(avgCost, prevAvgCost) : null;

  const rangeLabel = React.useMemo(() => {
    const start = new Date(periodSummary.rangeStartMs);
    const end = new Date(periodSummary.rangeEndMs);
    const format = (date: Date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${format(start)} – ${format(end)}`;
  }, [periodSummary.rangeEndMs, periodSummary.rangeStartMs]);

  const donutSlices = periodSummary.byProvider
    .filter((entry) => entry.cost > 0)
    .map((entry) => ({
      id: entry.providerId,
      label: QUOTA_PROVIDERS.find((provider) => provider.id === entry.providerId)?.name ?? entry.providerId,
      value: entry.cost,
      color: providerColorById.get(entry.providerId) ?? colorForProviderIndex(0),
    }));

  return (
    <SettingsPageLayout
      className="max-w-[1100px]"
      title={t('settings.usage.overview.title')}
      description={t('settings.usage.overview.description')}
      headerEnd={(
        <div className="flex flex-wrap items-center gap-2">
          <SettingsChipGroup
            aria-label={t('settings.usage.overview.period.aria')}
            value={String(periodDays)}
            onChange={(value) => setPeriodDays(Number(value) as UsagePeriodDays)}
            options={PERIOD_OPTIONS.map((days) => ({
              value: String(days),
              label: t(days === 7 ? 'settings.usage.overview.period.7d' : 'settings.usage.overview.period.30d'),
            }))}
          />
          <span className="typography-meta text-muted-foreground tabular-nums">{rangeLabel}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 px-0"
            onClick={() => {
              void fetchAllQuotas();
              setSessionTick((value) => value + 1);
            }}
            aria-label={t('settings.usage.sidebar.actions.refreshAria')}
            title={t('settings.usage.sidebar.actions.refreshTitle')}
            disabled={isLoading}
          >
            <Icon name="refresh" className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
          </Button>
        </div>
      )}
      showSaveStatus
    >
      <SettingsSection divider={false} settingsItem="usage.overview">
        <div className="grid gap-3 @xl:grid-cols-2 @3xl:grid-cols-4">
          {[
            {
              key: 'spend',
              icon: 'donut-chart' as const,
              label: t('settings.usage.overview.metric.totalSpend'),
              value: formatUsd(periodSummary.totals.cost),
              deltaLabel: `${formatSignedUsd(spendDelta)} (${formatPercentDelta(spendDeltaPct)})`,
              delta: spendDeltaPct,
              invert: false,
            },
            {
              key: 'tokens',
              icon: 'stack' as const,
              label: t('settings.usage.overview.metric.totalTokens'),
              value: formatCompactNumber(periodSummary.totals.tokens),
              deltaLabel: `${formatSignedCompact(tokenDelta)} (${formatPercentDelta(tokenDeltaPct)})`,
              delta: tokenDeltaPct,
              invert: false,
            },
            {
              key: 'requests',
              icon: 'chat-3' as const,
              label: t('settings.usage.overview.metric.requests'),
              value: formatCompactNumber(periodSummary.totals.requests),
              deltaLabel: `${formatSignedCompact(requestDelta)} (${formatPercentDelta(requestDeltaPct)})`,
              delta: requestDeltaPct,
              invert: false,
            },
            {
              key: 'avg',
              icon: 'bar-chart-2' as const,
              label: t('settings.usage.overview.metric.avgCost'),
              value: avgCost === null ? '—' : formatUsd(avgCost, 4),
              deltaLabel: avgCostDelta === null
                ? '—'
                : `${formatSignedUsd(avgCostDelta)} (${formatPercentDelta(avgCostDeltaPct)})`,
              delta: avgCostDeltaPct,
              invert: true,
            },
          ].map((card) => (
            <div
              key={card.key}
              className="rounded-xl border border-[var(--interactive-border)] bg-[var(--surface-elevated)] p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="typography-meta text-muted-foreground">{card.label}</span>
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--surface-muted)] text-foreground">
                  <Icon name={card.icon} className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="typography-ui-header font-medium tabular-nums text-foreground">{card.value}</div>
              <div className="mt-1">
                <DeltaBadge delta={card.delta} invert={card.invert} label={card.deltaLabel} />
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection>
        <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
          <div className="rounded-xl border border-[var(--interactive-border)] bg-[var(--surface-elevated)] p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="typography-ui-header font-medium text-foreground">
                {t('settings.usage.overview.chart.usageOverTime')}
              </h3>
              <SettingsChipGroup
                aria-label={t('settings.usage.overview.chart.metricAria')}
                value={metric}
                onChange={(value) => setMetric(value as UsageMetricMode)}
                options={[
                  { value: 'tokens', label: t('settings.usage.overview.chart.metric.tokens') },
                  { value: 'cost', label: t('settings.usage.overview.chart.metric.cost') },
                  { value: 'requests', label: t('settings.usage.overview.chart.metric.requests') },
                ]}
              />
            </div>
            <UsageAreaChart
              days={periodSummary.days}
              metric={metric}
              series={chartSeries}
              ariaLabel={t('settings.usage.overview.chart.usageOverTime')}
              emptyLabel={t('settings.usage.overview.chart.empty')}
            />
            {chartSeries.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-3">
                {chartSeries.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-1.5 typography-micro text-muted-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                    <span>{entry.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[var(--interactive-border)] bg-[var(--surface-elevated)] p-4">
            <h3 className="mb-4 typography-ui-header font-medium text-foreground">
              {t('settings.usage.overview.chart.topProviders')}
            </h3>
            <UsageDonutChart
              slices={donutSlices}
              centerLabel={t('settings.usage.overview.metric.totalSpend')}
              centerValue={formatUsd(periodSummary.totals.cost)}
              emptyLabel={t('settings.usage.overview.chart.empty')}
              ariaLabel={t('settings.usage.overview.chart.topProviders')}
            />
            <div className="mt-4 space-y-2">
              {donutSlices.map((slice) => {
                const share = periodSummary.totals.cost > 0
                  ? Math.round((slice.value / periodSummary.totals.cost) * 100)
                  : 0;
                return (
                  <div key={slice.id} className="flex items-center justify-between gap-2 typography-meta">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: slice.color }} />
                      <span className="truncate text-foreground">{slice.label}</span>
                    </div>
                    <span className="tabular-nums text-muted-foreground">
                      {formatUsd(slice.value)} ({share}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.usage.overview.providers.title')} settingsItem="usage.providers-table">
        {activeResults.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--interactive-border)] px-4 py-8 text-center">
            <p className="typography-ui-label text-foreground">{t('settings.usage.overview.empty.title')}</p>
            <p className="mt-1 typography-meta text-muted-foreground">{t('settings.usage.overview.empty.description')}</p>
            <Button
              className="mt-4"
              size="sm"
              onClick={() => setSelectedProvider(USAGE_ADD_PROVIDER_ID)}
            >
              <Icon name="add" className="mr-1.5 h-3.5 w-3.5" />
              {t('settings.usage.overview.actions.addProvider')}
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--interactive-border)]">
            <table className="w-full min-w-[40rem] border-collapse">
              <thead>
                <tr className="border-b border-[var(--interactive-border)] bg-[var(--surface-muted)]/40 text-left">
                  <th className="px-3 py-2 typography-micro font-medium text-muted-foreground">{t('settings.usage.overview.providers.col.provider')}</th>
                  <th className="px-3 py-2 typography-micro font-medium text-muted-foreground">{t('settings.usage.overview.providers.col.spend')}</th>
                  <th className="px-3 py-2 typography-micro font-medium text-muted-foreground">{t('settings.usage.overview.providers.col.tokens')}</th>
                  <th className="px-3 py-2 typography-micro font-medium text-muted-foreground">{t('settings.usage.overview.providers.col.requests')}</th>
                  <th className="px-3 py-2 typography-micro font-medium text-muted-foreground">{t('settings.usage.overview.providers.col.remaining')}</th>
                  <th className="px-3 py-2 typography-micro font-medium text-muted-foreground">{t('settings.usage.overview.providers.col.status')}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {activeResults.map((result) => {
                  const meta = QUOTA_PROVIDERS.find((provider) => provider.id === result.providerId);
                  const period = periodSummary.byProvider.find((entry) => entry.providerId === result.providerId);
                  const used = getProviderUsedPercent(result.usage);
                  const remaining = getProviderRemainingPercent(result.usage);
                  const tone = resolveUsageTone(used);
                  const windows = listProviderWindows(result.usage).slice(0, 2);
                  const statusOk = result.ok
                    || (connectedQuotaIds.has(result.providerId) && !result.configured);
                  return (
                    <tr
                      key={result.providerId}
                      className="border-b border-[var(--interactive-border)] last:border-b-0 hover:bg-interactive-hover"
                    >
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          className="flex min-w-0 items-center gap-2 text-left"
                          onClick={() => setSelectedProvider(result.providerId)}
                        >
                          <ProviderLogo providerId={result.providerId} className="h-4 w-4 shrink-0" />
                          <span className="typography-ui-label text-foreground truncate">{meta?.name ?? result.providerName}</span>
                        </button>
                      </td>
                      <td className="px-3 py-3 typography-meta tabular-nums text-foreground">
                        {formatUsd(period?.cost ?? 0)}
                      </td>
                      <td className="px-3 py-3 typography-meta tabular-nums text-foreground">
                        {formatCompactNumber(period?.tokens ?? 0)}
                      </td>
                      <td className="px-3 py-3 typography-meta tabular-nums text-foreground">
                        {formatCompactNumber(period?.requests ?? 0)}
                      </td>
                      <td className="px-3 py-3 min-w-[10rem]">
                        {windows.length === 0 ? (
                          <span className="typography-meta text-muted-foreground">
                            {remaining === null ? '—' : t('settings.usage.overview.providers.remainingPct', { percent: remaining })}
                          </span>
                        ) : (
                          <div className="space-y-1.5">
                            {windows.map(({ label, window }) => (
                              <div key={label}>
                                <div className="mb-0.5 flex items-center justify-between gap-2">
                                  <span className="typography-micro text-muted-foreground">{formatWindowLabel(label)}</span>
                                  <span className="typography-micro tabular-nums text-muted-foreground">
                                    {window.remainingPercent === null
                                      ? '—'
                                      : t('settings.usage.overview.providers.remainingPct', { percent: Math.round(window.remainingPercent) })}
                                  </span>
                                </div>
                                <UsageProgressBar percent={window.remainingPercent} tonePercent={window.usedPercent} className="h-1" />
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={cn(
                            'inline-flex rounded-md px-1.5 py-0.5 typography-micro',
                            statusOk
                              ? 'bg-[var(--status-success-background)] text-[var(--status-success)]'
                              : 'bg-[var(--status-warning-background)] text-[var(--status-warning)]',
                          )}
                        >
                          {statusOk
                            ? t('settings.usage.overview.providers.status.active')
                            : t('settings.usage.overview.providers.status.error')}
                        </span>
                        <span className="sr-only">{tone}</span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 px-0"
                            aria-label={t('settings.usage.overview.providers.removeAria', {
                              provider: meta?.name ?? result.providerName,
                            })}
                            title={t('settings.usage.sidebar.removeProviderTitle')}
                            onClick={() => hideUsageProvider(result.providerId)}
                          >
                            <Icon name="close" className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 px-0"
                            aria-label={t('settings.usage.overview.providers.openDetailAria', {
                              provider: meta?.name ?? result.providerName,
                            })}
                            onClick={() => setSelectedProvider(result.providerId)}
                          >
                            <Icon name="arrow-right-s" className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>

      {availableProviders.length > 0 && (
        <SettingsSection
          title={t('settings.usage.overview.available.title')}
          settingsItem="usage.available-providers"
        >
          <p className="mb-3 typography-meta text-muted-foreground">
            {t('settings.usage.overview.available.description')}
          </p>
          <div className="space-y-1">
            {availableProviders.map((provider) => {
              const result = results.find((entry) => entry.providerId === provider.id);
              const isHiddenIncluded = isIncludedUsageProvider(provider.id, {
                configured: result?.configured,
                connectedQuotaProviderIds: connectedQuotaIds,
              }) && hiddenSet.has(provider.id);
              return (
                <div
                  key={provider.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-interactive-hover"
                >
                  <ProviderLogo providerId={provider.id} className="h-5 w-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block typography-ui-label text-foreground">{provider.name}</span>
                    <span className="block typography-micro text-muted-foreground">
                      {isHiddenIncluded
                        ? t('settings.usage.overview.available.hiddenConfigured')
                        : t('settings.usage.overview.available.notConfigured')}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (isHiddenIncluded) {
                        showUsageProvider(provider.id);
                        setSelectedProvider(provider.id);
                        return;
                      }
                      if (CREDENTIAL_PROVIDERS.has(provider.id)) {
                        setSelectedProvider(USAGE_ADD_PROVIDER_ID);
                        return;
                      }
                      setConfigSelectedProvider(provider.id);
                      setSettingsPage('providers');
                    }}
                  >
                    {isHiddenIncluded
                      ? t('settings.usage.overview.available.restore')
                      : t('settings.usage.overview.available.connect')}
                  </Button>
                </div>
              );
            })}
          </div>
        </SettingsSection>
      )}
    </SettingsPageLayout>
  );
};
