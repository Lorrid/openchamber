import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { ProviderLogo } from '@/components/ui/ProviderLogo';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import { QUOTA_PROVIDERS, USAGE_ADD_PROVIDER_ID } from '@/lib/quota';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { useUIStore } from '@/stores/useUIStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { QuotaCredentials } from './QuotaCredentials';
import type { QuotaProviderId } from '@/types';

const CREDENTIAL_PROVIDERS = new Set<QuotaProviderId>(['ollama-cloud', 'cursor']);

export const UsageAddProvider: React.FC = () => {
  const { t } = useI18n();
  const results = useQuotaStore((state) => state.results);
  const hiddenProviderIds = useQuotaStore((state) => state.hiddenProviderIds);
  const setSelectedProvider = useQuotaStore((state) => state.setSelectedProvider);
  const showUsageProvider = useQuotaStore((state) => state.showUsageProvider);
  const setSettingsPage = useUIStore((state) => state.setSettingsPage);
  const setConfigSelectedProvider = useConfigStore((state) => state.setSelectedProvider);
  const [credentialProviderId, setCredentialProviderId] = React.useState<QuotaProviderId | null>(null);

  const hiddenSet = React.useMemo(() => new Set(hiddenProviderIds), [hiddenProviderIds]);

  const availableProviders = React.useMemo(() => {
    return QUOTA_PROVIDERS.filter((provider) => {
      const result = results.find((entry) => entry.providerId === provider.id);
      if (!result?.configured) return true;
      return hiddenSet.has(provider.id);
    });
  }, [hiddenSet, results]);

  const openProvidersSettings = React.useCallback((providerId?: string) => {
    if (providerId) {
      setConfigSelectedProvider(providerId);
    } else {
      setConfigSelectedProvider(USAGE_ADD_PROVIDER_ID);
    }
    setSettingsPage('providers');
  }, [setConfigSelectedProvider, setSettingsPage]);

  const handleSelect = React.useCallback((providerId: QuotaProviderId) => {
    const result = results.find((entry) => entry.providerId === providerId);
    if (result?.configured && hiddenSet.has(providerId)) {
      showUsageProvider(providerId);
      setSelectedProvider(providerId);
      return;
    }
    if (CREDENTIAL_PROVIDERS.has(providerId)) {
      setCredentialProviderId(providerId);
      return;
    }
    openProvidersSettings(providerId);
  }, [hiddenSet, openProvidersSettings, results, setSelectedProvider, showUsageProvider]);

  const credentialMeta = credentialProviderId
    ? QUOTA_PROVIDERS.find((provider) => provider.id === credentialProviderId)
    : null;

  return (
    <SettingsPageLayout
      title={t('settings.usage.add.title')}
      description={t('settings.usage.add.description')}
      titleLeading={(
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 px-0"
          aria-label={t('settings.usage.add.backAria')}
          onClick={() => setSelectedProvider(null)}
        >
          <Icon name="arrow-left-s" className="h-4 w-4" />
        </Button>
      )}
      showSaveStatus
    >
      <SettingsSection divider={false} settingsItem="usage.add-provider">
        {availableProviders.length === 0 ? (
          <p className="typography-meta text-muted-foreground">{t('settings.usage.add.empty')}</p>
        ) : (
          <div className="space-y-1">
            {availableProviders.map((provider) => {
              const result = results.find((entry) => entry.providerId === provider.id);
              const isHiddenConfigured = Boolean(result?.configured) && hiddenSet.has(provider.id);
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => handleSelect(provider.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-interactive-hover"
                >
                  <ProviderLogo providerId={provider.id} className="h-5 w-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block typography-ui-label text-foreground">{provider.name}</span>
                    <span className="block typography-micro text-muted-foreground">
                      {isHiddenConfigured
                        ? t('settings.usage.add.restoreHint')
                        : CREDENTIAL_PROVIDERS.has(provider.id)
                          ? t('settings.usage.add.viaCredentials')
                          : t('settings.usage.add.viaProviders')}
                    </span>
                  </span>
                  <Icon name="arrow-right-s" className="h-4 w-4 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={() => openProvidersSettings()}>
            {t('settings.usage.add.openProviders')}
          </Button>
        </div>
      </SettingsSection>

      {credentialProviderId && credentialMeta && (credentialProviderId === 'ollama-cloud' || credentialProviderId === 'cursor') && (
        <SettingsSection title={t('settings.usage.add.credentialsTitle', { provider: credentialMeta.name })}>
          <QuotaCredentials providerId={credentialProviderId} providerName={credentialMeta.name} />
          <Button
            className="mt-2"
            size="sm"
            onClick={() => {
              showUsageProvider(credentialProviderId);
              setSelectedProvider(credentialProviderId);
            }}
          >
            {t('settings.usage.add.viewProvider')}
          </Button>
        </SettingsSection>
      )}
    </SettingsPageLayout>
  );
};
