import React from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import { useLinearAuthStore } from '@/stores/useLinearAuthStore';
import { cn } from '@/lib/utils';
import { openExternalUrl } from '@/lib/url';
import { useI18n } from '@/lib/i18n';
import { focusDesktopWindow, isDesktopShell } from '@/lib/desktop';
import { Icon } from '@/components/icon/Icon';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { LinearProjectMapping } from './LinearProjectMapping';

const AUTHORIZATION_WATCH_MS = 3 * 60_000;
const AUTHORIZATION_POLL_MS = 1_500;

export const LinearSettings: React.FC = () => {
  const { t } = useI18n();
  const runtimeLinear = getRegisteredRuntimeAPIs()?.linear;
  const status = useLinearAuthStore((state) => state.status);
  const isLoading = useLinearAuthStore((state) => state.isLoading);
  const hasChecked = useLinearAuthStore((state) => state.hasChecked);
  const refreshStatus = useLinearAuthStore((state) => state.refreshStatus);

  const [isBusy, setIsBusy] = React.useState(false);
  const [isWaiting, setIsWaiting] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const pollTimerRef = React.useRef<number | null>(null);

  const stopWaiting = React.useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setIsWaiting(false);
  }, []);

  React.useEffect(() => {
    if (!runtimeLinear) {
      return;
    }
    if (!hasChecked) {
      void refreshStatus(runtimeLinear);
    }
    return () => {
      stopWaiting();
    };
  }, [hasChecked, refreshStatus, runtimeLinear, stopWaiting]);

  const startConnect = React.useCallback(async () => {
    if (!runtimeLinear) return;
    stopWaiting();
    setIsBusy(true);
    try {
      const payload = await runtimeLinear.authStart(isDesktopShell() ? 'desktop' : 'web');
      setIsWaiting(true);
      setOpen(true);
      void openExternalUrl(payload.authorizationUrl);

      const deadline = Date.now() + AUTHORIZATION_WATCH_MS;
      pollTimerRef.current = window.setInterval(() => {
        void (async () => {
          if (Date.now() > deadline) {
            stopWaiting();
            toast.error(t('settings.integrations.linear.toast.authorizationFailed'));
            return;
          }
          const next = await refreshStatus(runtimeLinear, { force: true });
          if (next?.connected) {
            stopWaiting();
            toast.success(t('settings.integrations.linear.toast.connected'));
            void focusDesktopWindow();
          }
        })();
      }, AUTHORIZATION_POLL_MS);
    } catch (error) {
      console.error('Failed to start Linear connect:', error);
      toast.error(t('settings.integrations.linear.toast.startConnectFailed'));
      stopWaiting();
    } finally {
      setIsBusy(false);
    }
  }, [refreshStatus, runtimeLinear, stopWaiting, t]);

  const disconnect = React.useCallback(async () => {
    if (!runtimeLinear) return;
    setIsBusy(true);
    try {
      stopWaiting();
      await runtimeLinear.authDisconnect();
      toast.success(t('settings.integrations.linear.toast.disconnected'));
      await refreshStatus(runtimeLinear, { force: true });
    } catch (error) {
      console.error('Failed to disconnect Linear:', error);
      toast.error(t('settings.integrations.linear.toast.disconnectFailed'));
    } finally {
      setIsBusy(false);
    }
  }, [refreshStatus, runtimeLinear, stopWaiting, t]);

  if (!runtimeLinear) {
    return null;
  }

  const connected = Boolean(status?.connected);
  const user = status?.user;
  const organization = status?.organization;
  const displayName = user?.displayName?.trim() || user?.name?.trim() || t('settings.integrations.linear.label.unknownUser');
  const statusLabel = isWaiting
    ? t('settings.integrations.linear.status.waiting')
    : isLoading && !hasChecked
      ? t('common.loading')
      : connected
        ? (organization?.name?.trim() || t('settings.integrations.linear.status.connected'))
        : t('settings.integrations.linear.status.notConnected');
  const statusClassName = isWaiting
    ? 'bg-[var(--status-warning)]/15 text-[var(--status-warning)]'
    : connected
      ? 'bg-[var(--status-success)]/15 text-[var(--status-success)]'
      : 'bg-[var(--surface-muted)] text-muted-foreground';
  const expanded = isWaiting || open;

  return (
    <SettingsSection
      title={t('settings.integrations.firstParty.title')}
      info={t('settings.integrations.firstParty.info')}
      divider={false}
      settingsItem="integrations.first-party"
      contentClassName="space-y-3"
    >
      <Collapsible
        open={expanded}
        onOpenChange={(nextOpen) => {
          if (isWaiting) {
            setOpen(true);
            return;
          }
          setOpen(nextOpen);
        }}
      >
        <div
          data-settings-item="integrations.linear"
          className="overflow-hidden rounded-xl border border-[var(--interactive-border)] bg-[var(--surface-elevated)]"
        >
          <CollapsibleTrigger
            className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left hover:bg-[var(--interactive-hover)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--interactive-focus-ring)]"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--surface-muted)]">
              <Icon name="linear" className="size-5 text-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">
                {t('settings.integrations.linear.title')}
              </div>
              <p className="mt-0.5 line-clamp-1 text-xs leading-snug text-muted-foreground">
                {t('settings.integrations.linear.description')}
              </p>
            </div>
            <span
              aria-live="polite"
              className={cn(
                'max-w-36 shrink-0 truncate rounded-full px-2 py-0.5 text-[10px] font-medium',
                statusClassName,
              )}
            >
              {statusLabel}
            </span>
            <Icon
              name="arrow-down-s"
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out motion-reduce:transition-none',
                expanded && 'rotate-180',
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t border-[var(--interactive-border)] px-4 py-4">
            <div className="space-y-3">
              {connected ? (
                <div className="flex min-w-0 items-center gap-3">
                  {user?.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={t('settings.integrations.linear.avatarAlt.withName', { name: displayName })}
                      className="size-10 shrink-0 rounded-full border border-[var(--interactive-border)] bg-[var(--surface-muted)] object-cover"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--interactive-border)] bg-[var(--surface-muted)]">
                      <Icon name="linear" className="size-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{displayName}</div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[organization?.name, user?.email].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
              ) : isWaiting ? (
                <p className="text-xs text-muted-foreground">
                  {t('settings.integrations.linear.flow.description')}
                </p>
              ) : null}

              {connected ? (
                <>
                  <LinearProjectMapping linear={runtimeLinear} connected={connected} />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => void disconnect()}
                      disabled={isBusy}
                    >
                      {t('settings.integrations.linear.actions.disconnect')}
                    </Button>
                  </div>
                </>
              ) : isWaiting ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="typography-micro text-muted-foreground animate-pulse">
                    {t('settings.integrations.linear.flow.waiting')}
                  </span>
                  <Button type="button" size="sm" variant="ghost" disabled={isBusy} onClick={stopWaiting}>
                    {t('settings.common.actions.cancel')}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  onClick={() => void startConnect()}
                  disabled={isBusy || (isLoading && !hasChecked)}
                >
                  {isBusy ? <Icon name="loader-4" className="size-3.5 animate-spin" /> : null}
                  {t('settings.integrations.linear.actions.connect')}
                </Button>
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </SettingsSection>
  );
};
