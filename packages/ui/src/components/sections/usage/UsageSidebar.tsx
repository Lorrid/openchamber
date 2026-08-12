import React from 'react';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { ProviderLogo } from '@/components/ui/ProviderLogo';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Icon } from '@/components/icon/Icon';
import { cn } from '@/lib/utils';
import {
  QUOTA_PROVIDERS,
  USAGE_ADD_PROVIDER_ID,
  resolveUsageTone,
} from '@/lib/quota';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { updateDesktopSettings } from '@/lib/persistence';
import { useI18n } from '@/lib/i18n';
import { SETTINGS_PANEL_TITLE_CLASS } from '@/components/sections/shared/SettingsSection';
import {
  getProviderRemainingPercent,
  getProviderUsedPercent,
  isActiveProviderResult,
} from './usageProviderHelpers';

interface UsageSidebarProps {
  onItemSelect?: () => void;
}

export const UsageSidebar: React.FC<UsageSidebarProps> = ({ onItemSelect }) => {
  const { t } = useI18n();
  const results = useQuotaStore((state) => state.results);
  const selectedProviderId = useQuotaStore((state) => state.selectedProviderId);
  const setSelectedProvider = useQuotaStore((state) => state.setSelectedProvider);
  const fetchAllQuotas = useQuotaStore((state) => state.fetchAllQuotas);
  const isLoading = useQuotaStore((state) => state.isLoading);
  const usageDisplayMode = useQuotaStore((state) => state.displayMode);
  const setUsageDisplayMode = useQuotaStore((state) => state.setDisplayMode);
  const loadUsageSettings = useQuotaStore((state) => state.loadSettings);

  React.useEffect(() => {
    void loadUsageSettings();
  }, [loadUsageSettings]);

  const persistUsageSettings = React.useCallback(async (changes: { usageDisplayMode?: 'usage' | 'remaining'; usageDropdownProviders?: string[] }) => {
    try {
      await updateDesktopSettings(changes);
    } catch (error) {
      console.warn('Failed to save usage settings:', error);
    }
  }, []);

  const handleUsageDisplayModeChange = React.useCallback((value: string) => {
    if (value !== 'usage' && value !== 'remaining') {
      return;
    }
    setUsageDisplayMode(value);
    void persistUsageSettings({ usageDisplayMode: value });
  }, [persistUsageSettings, setUsageDisplayMode]);

  const activeProviders = React.useMemo(() => {
    return QUOTA_PROVIDERS.filter((provider) => {
      const result = results.find((entry) => entry.providerId === provider.id);
      return isActiveProviderResult(result);
    });
  }, [results]);

  const isOverviewSelected = selectedProviderId === null;
  const isAddSelected = selectedProviderId === USAGE_ADD_PROVIDER_ID;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b px-3 pt-4 pb-3">
        <h2 className={`${SETTINGS_PANEL_TITLE_CLASS} mb-3`}>{t('settings.usage.sidebar.title')}</h2>
        <div className="flex items-center justify-between gap-2">
          <span className="typography-meta text-muted-foreground">
            {t('settings.usage.sidebar.activeTotal', { count: activeProviders.length })}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 px-0 text-muted-foreground"
            onClick={() => fetchAllQuotas()}
            aria-label={t('settings.usage.sidebar.actions.refreshAria')}
            title={t('settings.usage.sidebar.actions.refreshTitle')}
            disabled={isLoading}
          >
            <Icon name="refresh" className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
          </Button>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="typography-micro text-muted-foreground">{t('settings.usage.sidebar.field.display')}</span>
          <Select value={usageDisplayMode} onValueChange={handleUsageDisplayModeChange}>
            <SelectTrigger className="w-fit">
              <SelectValue placeholder={t('settings.usage.sidebar.field.displayModePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="usage">{t('settings.usage.sidebar.field.displayModeUsage')}</SelectItem>
              <SelectItem value="remaining">{t('settings.usage.sidebar.field.displayModeRemaining')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <ScrollableOverlay outerClassName="flex-1 min-h-0" className="space-y-1 px-3 py-2 overflow-x-hidden">
        <button
          type="button"
          onClick={() => {
            setSelectedProvider(null);
            onItemSelect?.();
          }}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors',
            isOverviewSelected ? 'bg-interactive-selection' : 'hover:bg-interactive-hover',
          )}
        >
          <Icon name="bar-chart-2" className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="typography-ui-label font-normal truncate text-foreground">
            {t('settings.usage.sidebar.overview')}
          </span>
        </button>

        {activeProviders.length > 0 && (
          <div className="px-1.5 pt-3 pb-1 typography-micro text-muted-foreground">
            {t('settings.usage.sidebar.activeProviders')}
          </div>
        )}

        {activeProviders.map((provider) => {
          const result = results.find((entry) => entry.providerId === provider.id);
          const usedPercent = getProviderUsedPercent(result?.usage);
          const remainingPercent = getProviderRemainingPercent(result?.usage);
          const displayPercent = usageDisplayMode === 'remaining' ? remainingPercent : usedPercent;
          const tone = resolveUsageTone(usedPercent);
          const isSelected = provider.id === selectedProviderId;

          const statusStyle = tone === 'critical'
            ? { backgroundColor: 'var(--status-error)' }
            : tone === 'warn'
              ? { backgroundColor: 'var(--status-warning)' }
              : { backgroundColor: 'var(--status-success)' };

          return (
            <div
              key={provider.id}
              className={cn(
                'group relative flex items-center rounded-md px-1.5 py-1 transition-all duration-200',
                isSelected ? 'bg-interactive-selection' : 'hover:bg-interactive-hover',
              )}
            >
              <button
                type="button"
                onClick={() => {
                  setSelectedProvider(provider.id);
                  onItemSelect?.();
                }}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={statusStyle} />
                <ProviderLogo providerId={provider.id} className="h-4 w-4 flex-shrink-0" />
                <span className="typography-ui-label font-normal truncate flex-1 min-w-0 text-foreground">
                  {provider.name}
                </span>
                {displayPercent !== null && (
                  <span className="typography-micro text-muted-foreground flex-shrink-0 tabular-nums">
                    {usageDisplayMode === 'remaining'
                      ? t('settings.usage.sidebar.remainingPct', { percent: displayPercent })
                      : t('settings.usage.sidebar.usedPct', { percent: displayPercent })}
                  </span>
                )}
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => {
            setSelectedProvider(USAGE_ADD_PROVIDER_ID);
            onItemSelect?.();
          }}
          className={cn(
            'mt-2 flex w-full items-center gap-2 rounded-md border border-dashed border-[var(--interactive-border)] px-1.5 py-2 text-left transition-colors',
            isAddSelected ? 'bg-interactive-selection' : 'hover:bg-interactive-hover',
          )}
          data-settings-item="usage.add-provider"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--surface-muted)]">
            <Icon name="add" className="h-3.5 w-3.5" />
          </span>
          <span className="typography-ui-label font-normal text-foreground">
            {t('settings.usage.sidebar.addProvider')}
          </span>
        </button>
      </ScrollableOverlay>
    </div>
  );
};
