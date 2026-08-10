import React, { useEffect } from 'react';
import {
  MESSENGER_INTERRUPT_TIMEOUT_DEFAULT_MS,
  MESSENGER_INTERRUPT_TIMEOUT_MAX_MS,
  MESSENGER_INTERRUPT_TIMEOUT_MIN_MS,
  useMessengerStore,
  type MessengerType,
  type MessengerConnection,
  type MessengerInboundMessage,
  type MessengerVerbosity,
  type MessengerPermissionMode,
} from '@/stores/useMessengerStore';
import {
  useOpenChamberAgentEventsStore,
  type OpenChamberAgentUiRealtimeEvent,
} from '@/stores/useOpenChamberAgentEventsStore';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { Icon } from '@/components/icon/Icon';
import type { IconName } from '@/components/icon/icons';

/**
 * Presentational building blocks shared by the Discord and Telegram cards in
 * the Integrations settings section. Platform copy is injected per card —
 * every user-facing string arrives already localized (see the call sites in
 * MessengerSection.tsx / TelegramCard.tsx).
 */

/** Official Telegram Web deep link for @userinfobot (user-requested URL). */
const TELEGRAM_USERINFOBOT_URL = 'https://web.telegram.org/k/#@userinfobot';

/** Clickable @userinfobot link — visible handle is the product username. */
export function TelegramUserInfoBotLink({ className }: { className?: string }) {
  return (
    <a
      href={TELEGRAM_USERINFOBOT_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('text-primary hover:underline', className)}
    >
      @userinfobot
    </a>
  );
}

/** Localized copy with an embedded @userinfobot link (before + after keys). */
export function TelegramUserInfoBotHint({
  beforeKey,
  afterKey,
  className,
}: {
  beforeKey: I18nKey;
  afterKey: I18nKey;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <span className={className}>
      {t(beforeKey)}
      <TelegramUserInfoBotLink />
      {t(afterKey)}
    </span>
  );
}

/** Parse comma/whitespace/newline-separated messenger ids into a unique list. */
// eslint-disable-next-line react-refresh/only-export-components
export function parseMessengerIdList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\s,]+/)
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  );
}

/**
 * True when the messenger listener is enabled. The listener flag is the
 * authoritative runtime setting; the legacy connection `enabled` field can
 * be stale after the server auto-starts or another client changes the
 * listener state.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function isMessengerIntegrationEnabled(conn: {
  type: MessengerType;
  /** Legacy UI flag retained for callers; listener state below is authoritative. */
  enabled?: boolean;
  discordListenerEnabled?: boolean;
  telegramListenerEnabled?: boolean;
}): boolean {
  const listenerEnabled =
    conn.type === 'discord' ? conn.discordListenerEnabled : conn.telegramListenerEnabled;
  return listenerEnabled !== false;
}

export type MessengerStatusLabels = Record<
  MessengerConnection['status'],
  string
>;

export function StatusBadge({
  status,
  labels,
}: {
  status: MessengerConnection['status'];
  labels: MessengerStatusLabels;
}) {
  const styles: Record<string, string> = {
    connected:
      'bg-[var(--status-success)]/15 text-[var(--status-success)]',
    connecting:
      'bg-[var(--status-warning)]/15 text-[var(--status-warning)]',
    error: 'bg-[var(--status-error)]/15 text-[var(--status-error)]',
    disconnected: 'bg-muted text-muted-foreground',
  };
  const label = labels[status];
  // Connected: checkmark only (label stays for accessibility). Other states keep text.
  if (status === 'connected') {
    return (
      <span
        className={cn(
          'inline-flex size-5 items-center justify-center rounded-full',
          styles.connected,
        )}
        title={label}
        aria-label={label}
      >
        <Icon name="check" className="size-3" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
        styles[status],
      )}
      aria-label={label}
    >
      {status === 'connecting' ? (
        <Icon name="loader-4" className="size-3 animate-spin" />
      ) : null}
      {label}
    </span>
  );
}

type TranslateFn = (key: I18nKey, params?: Record<string, string | number | boolean | null | undefined>) => string;

// eslint-disable-next-line react-refresh/only-export-components
export function formatRelative(ts: number | null | undefined, t: TranslateFn, neverLabel: string): string {
  if (!ts) return neverLabel;
  const diff = Date.now() - ts;
  if (diff < 60_000) return t('common.relative.justNow');
  if (diff < 3_600_000) {
    return t('common.relative.minutesAgoShort', { count: Math.floor(diff / 60_000) });
  }
  if (diff < 86_400_000) {
    return t('common.relative.hoursAgoShort', { count: Math.floor(diff / 3_600_000) });
  }
  return new Date(ts).toLocaleString();
}

/** Collapsible card used by messenger Advanced settings accordion sections. */
export function AdvancedSectionCard({
  icon,
  title,
  meta,
  badge,
  open,
  onOpenChange,
  children,
}: {
  icon: IconName;
  title: string;
  meta?: React.ReactNode;
  badge?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="overflow-hidden rounded-xl border border-[var(--interactive-border)] bg-[var(--surface-elevated)]">
        <CollapsibleTrigger className="flex w-full items-center gap-2.5 rounded-none px-4 py-3 hover:bg-[var(--interactive-hover)]/50">
          <Icon name={icon} className="size-4 shrink-0 text-primary" />
          <span className="shrink-0 text-sm font-semibold text-foreground">{title}</span>
          {badge}
          {meta ? (
            <span className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground">
              {meta}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <Icon
            name={open ? 'arrow-up-s' : 'arrow-down-s'}
            className="size-4 shrink-0 text-muted-foreground"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-[var(--interactive-border)] px-4 py-3">
          {children}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/** Segmented chip picker shared by the messenger behavior panels. */
export function MessengerSegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <Button
          key={opt.id}
          type="button"
          variant="chip"
          size="xs"
          disabled={disabled}
          aria-pressed={value === opt.id}
          className="!font-normal normal-case"
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}

export function AccessControlRow({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-[var(--interactive-hover)]/40"
      >
        <span className="text-sm font-medium text-foreground">{label}</span>
        <Icon
          name={open ? 'arrow-down-s' : 'arrow-right-s'}
          className="size-4 shrink-0 text-muted-foreground"
        />
      </button>
      {open ? <div className="space-y-2 px-4 pb-3">{children}</div> : null}
    </div>
  );
}

type DiscordHistoryMessage = ReturnType<
  typeof useMessengerStore.getState
>['discordHistory'][number];

export type MessengerListenerPanelProps = {
  type: MessengerType;
  conn: MessengerConnection;
  /** Platform-specific panel title. */
  title: string;
  /** Shown when connected but no inbound messages have been seen yet. */
  privacyHint: string;
  /** Shown while listening with an empty inbound list. */
  waiting: string;
  /** Discord-only channel history controls. */
  history?: {
    messages: DiscordHistoryMessage[];
    targetChannelId?: string;
    loadHistory: (channelId: string, limit?: number) => Promise<boolean>;
    title: string;
    fetchLabel: string;
    needsTarget: string;
    empty: string;
    olderOne: string;
    olderMany: (count: number) => string;
    noTextOne: string;
    noTextMany: (count: number) => string;
  };
};

/**
 * Shared Discord/Telegram listener diagnostics panel. Platform differences are
 * expressed via props (`privacyHint`, `waiting`, optional Discord history).
 */
export function MessengerListenerPanel({
  type,
  conn,
  title,
  privacyHint,
  waiting,
  history,
}: MessengerListenerPanelProps) {
  const { t } = useI18n();
  const subscribeToEvents = useOpenChamberAgentEventsStore((s) => s.subscribeToEvents);
  const discordInbound = useMessengerStore((s) => s.discordInbound);
  const telegramInbound = useMessengerStore((s) => s.telegramInbound);
  const startDiscordListener = useMessengerStore((s) => s.startDiscordListener);
  const stopDiscordListener = useMessengerStore((s) => s.stopDiscordListener);
  const refreshDiscordListenerStatus = useMessengerStore((s) => s.refreshDiscordListenerStatus);
  const loadRecentDiscordMessages = useMessengerStore((s) => s.loadRecentDiscordMessages);
  const ingestDiscordInbound = useMessengerStore((s) => s.ingestDiscordInbound);
  const startTelegramListener = useMessengerStore((s) => s.startTelegramListener);
  const stopTelegramListener = useMessengerStore((s) => s.stopTelegramListener);
  const refreshTelegramListenerStatus = useMessengerStore((s) => s.refreshTelegramListenerStatus);
  const loadRecentTelegramMessages = useMessengerStore((s) => s.loadRecentTelegramMessages);
  const ingestTelegramInbound = useMessengerStore((s) => s.ingestTelegramInbound);

  const isDiscord = type === 'discord';
  const running = Boolean(
    isDiscord ? conn.discordListenerRunning : conn.telegramListenerRunning,
  );
  const connected = Boolean(
    isDiscord ? conn.discordListenerConnected : conn.telegramListenerConnected,
  );
  const seen = isDiscord
    ? (conn.discordListenerTotalRawMessages ?? 0)
    : (conn.telegramListenerTotalRawMessages ?? 0);
  const forwarded = isDiscord
    ? (conn.discordListenerTotalReceived ?? 0)
    : (conn.telegramListenerTotalReceived ?? 0);
  const replied = isDiscord
    ? (conn.discordListenerTotalReplied ?? 0)
    : (conn.telegramListenerTotalReplied ?? 0);
  const lastUpdateAt = isDiscord
    ? (conn.discordListenerLastUpdateAt ?? null)
    : (conn.telegramListenerLastUpdateAt ?? null);
  const error = isDiscord ? conn.discordListenerError : conn.telegramListenerError;
  const inbound: MessengerInboundMessage[] = isDiscord ? discordInbound : telegramInbound;
  const eventType = isDiscord
    ? 'messenger.discord.message_received'
    : 'messenger.telegram.message_received';
  const neverLabel = t('settings.integrations.relative.never');

  useEffect(() => {
    if (!running) return;
    const ingest = isDiscord ? ingestDiscordInbound : ingestTelegramInbound;
    const handler = (event: OpenChamberAgentUiRealtimeEvent) => {
      if (event.eventType !== eventType) return;
      const data = event.data as MessengerInboundMessage | undefined;
      if (data && typeof data === 'object' && 'updateId' in data) {
        ingest(data);
      }
    };
    return subscribeToEvents(handler);
  }, [
    running,
    subscribeToEvents,
    isDiscord,
    eventType,
    ingestDiscordInbound,
    ingestTelegramInbound,
  ]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const refresh = isDiscord ? refreshDiscordListenerStatus : refreshTelegramListenerStatus;
    const loadRecent = isDiscord ? loadRecentDiscordMessages : loadRecentTelegramMessages;
    const tick = async () => {
      if (cancelled) return;
      await Promise.all([refresh(), loadRecent()]);
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    running,
    isDiscord,
    refreshDiscordListenerStatus,
    refreshTelegramListenerStatus,
    loadRecentDiscordMessages,
    loadRecentTelegramMessages,
  ]);

  useEffect(() => {
    if (!isDiscord) return;
    void useMessengerStore.getState().resyncDiscordStatus();
    if (conn.botToken) void loadRecentDiscordMessages();
  }, [isDiscord, conn.botToken, loadRecentDiscordMessages]);

  const startListener = isDiscord ? startDiscordListener : startTelegramListener;
  const stopListener = isDiscord ? stopDiscordListener : stopTelegramListener;
  const historyTarget = history?.targetChannelId;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">{title}</div>
        <div className="flex items-center gap-2">
          {!running ? (
            <Button
              type="button"
              variant="default"
              size="xs"
              className="!font-normal normal-case"
              onClick={() => void startListener()}
            >
              <Icon name="play" className="size-3.5" />
              {t('settings.integrations.listener.start')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="!font-normal normal-case text-[var(--status-error)] hover:text-[var(--status-error)]"
              onClick={() => void stopListener()}
            >
              <Icon name="stop" className="size-3.5" />
              {t('settings.integrations.listener.stop')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px] @xl:grid-cols-4">
        {(
          [
            ['seen', seen],
            ['forwarded', forwarded],
            ['replied', replied],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="rounded-lg border border-border bg-background px-2 py-1.5">
            <div className="text-muted-foreground">
              {t(`settings.integrations.listener.stats.${key}` as I18nKey)}
            </div>
            <div className="font-medium text-foreground">{value}</div>
          </div>
        ))}
        <div className="rounded-lg border border-border bg-background px-2 py-1.5">
          <div className="text-muted-foreground">
            {t('settings.integrations.listener.stats.lastUpdate')}
          </div>
          <div className="font-medium text-foreground">
            {formatRelative(lastUpdateAt, t, neverLabel)}
          </div>
        </div>
      </div>

      {connected && seen === 0 && (
        <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          {privacyHint}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-1.5 text-[11px] leading-snug text-destructive">
          <Icon name="alert" className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </div>
      )}

      {!running ? (
        <div className="text-[11px] leading-snug text-muted-foreground">
          {t('settings.integrations.listener.startHint')}
        </div>
      ) : inbound.length === 0 ? (
        <div className="text-[11px] italic text-muted-foreground">{waiting}</div>
      ) : (
        <ul className="max-h-48 space-y-1.5 overflow-y-auto">
          {inbound.slice(0, 8).map((m) => (
            <li
              key={String(m.updateId)}
              className="space-y-0.5 rounded border border-border bg-background px-2 py-1.5 text-[11px]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-foreground">
                  {m.from?.firstName ??
                    m.from?.username ??
                    t('settings.integrations.listener.fromUnknown')}
                  {m.from?.username ? (
                    <span className="text-muted-foreground"> @{m.from.username}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[9px] text-muted-foreground">
                  {new Date(m.receivedAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="break-words text-muted-foreground">
                {m.text ?? <em>{t('settings.integrations.listener.nonText')}</em>}
              </div>
              <div className="text-[9px] text-muted-foreground">
                {isDiscord ? (
                  <>
                    channel {m.chatId}
                    {m.discord?.guildId ? ` · guild ${m.discord.guildId}` : ''}
                  </>
                ) : (
                  <>
                    {t('settings.integrations.telegram.recent.chatLabel')} {m.chatId}
                    {m.chatTitle ? ` · ${m.chatTitle}` : ''}
                    {m.telegram?.messageThreadId
                      ? ` · ${t('settings.integrations.telegram.recent.topicLabel')} ${m.telegram.messageThreadId}`
                      : ''}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {history ? (
        <div className="space-y-1.5 border-t border-border/60 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-medium text-foreground">{history.title}</div>
            <button
              type="button"
              onClick={() => historyTarget && history.loadHistory(historyTarget, 50)}
              disabled={!historyTarget}
              className="rounded bg-primary/10 px-2 py-0.5 text-[10px] text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              {history.fetchLabel}
            </button>
          </div>
          {!historyTarget && (
            <div className="text-[10px] text-muted-foreground">{history.needsTarget}</div>
          )}
          {historyTarget && history.messages.length === 0 && (
            <div className="text-[10px] italic text-muted-foreground">{history.empty}</div>
          )}
          {history.messages.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {history.messages.slice(0, 10).map((m) => (
                <li
                  key={m.id}
                  className="rounded border border-border bg-background px-2 py-1 text-[10px]"
                >
                  <span className="font-medium text-foreground">
                    {m.author.globalName ?? m.author.username ?? m.author.id}
                  </span>{' '}
                  <span className="text-[9px] text-muted-foreground">
                    {new Date(m.timestamp).toLocaleTimeString()}
                  </span>
                  <div className="break-words text-muted-foreground">
                    {m.content || (
                      <em>
                        {m.attachmentCount === 1
                          ? history.noTextOne
                          : history.noTextMany(m.attachmentCount)}
                      </em>
                    )}
                  </div>
                </li>
              ))}
              {history.messages.length > 10 && (
                <li className="px-2 text-[10px] italic text-muted-foreground">
                  {history.messages.length - 10 === 1
                    ? history.olderOne
                    : history.olderMany(history.messages.length - 10)}
                </li>
              )}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Fully localized copy for the behavior panel — resolved per platform. */
export interface MessengerBehaviorStrings {
  unavailable: string;
  verbosityTitle: string;
  verbosityOptions: { id: MessengerVerbosity; label: string; desc: string }[];
  permissionTitle: string;
  permissionOptions: { id: MessengerPermissionMode; label: string; desc: string }[];
  notifyTitle: string;
  notifyDescription: string;
  interruptTitle: string;
  interruptUnit: string;
  interruptDescription: string;
  activeLabel: (count: number) => string;
}

export function BehaviorPanel({
  type,
  bridgeStatus,
  refreshBridgeStatus,
  strings,
  settingsItemPrefix,
  worktreesSlot,
  footerNotes,
}: {
  type: MessengerType;
  bridgeStatus: ReturnType<typeof useMessengerStore.getState>['bridgeStatus'];
  refreshBridgeStatus: (t?: MessengerType) => Promise<void>;
  strings: MessengerBehaviorStrings;
  /** data-settings-item anchor prefix, e.g. 'integrations.discord'. */
  settingsItemPrefix: string;
  /** Optional platform-specific extra controls (Discord worktree sync). */
  worktreesSlot?: React.ReactNode;
  footerNotes?: React.ReactNode;
}) {
  const bridgeVerbosity = useMessengerStore((s) => s.bridgeVerbosity);
  const setBridgeVerbosity = useMessengerStore((s) => s.setBridgeVerbosity);
  const bridgePermissionMode = useMessengerStore((s) => s.bridgePermissionMode);
  const setBridgePermissionMode = useMessengerStore((s) => s.setBridgePermissionMode);
  const bridgeNotifyOnComplete = useMessengerStore((s) => s.bridgeNotifyOnComplete);
  const setBridgeNotifyOnComplete = useMessengerStore((s) => s.setBridgeNotifyOnComplete);
  const bridgeInterruptTimeoutMs = useMessengerStore((s) => s.bridgeInterruptTimeoutMs);
  const setBridgeInterruptTimeoutMs = useMessengerStore((s) => s.setBridgeInterruptTimeoutMs);
  useEffect(() => {
    refreshBridgeStatus(type);
    const id = setInterval(() => refreshBridgeStatus(type), 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const active = bridgeStatus.active.filter((a) => a.type === type);
  const currentVerbosity: MessengerVerbosity = bridgeVerbosity[type] ?? 'normal';
  const currentVerbosityOption =
    strings.verbosityOptions.find((o) => o.id === currentVerbosity) ?? strings.verbosityOptions[0];
  const currentPermissionMode: MessengerPermissionMode = bridgePermissionMode[type] ?? 'agent';
  const currentPermissionOption =
    strings.permissionOptions.find((o) => o.id === currentPermissionMode) ??
    strings.permissionOptions[0];
  const notifyOnComplete = bridgeNotifyOnComplete[type] ?? false;
  const interruptTimeoutMs =
    bridgeInterruptTimeoutMs[type] ?? MESSENGER_INTERRUPT_TIMEOUT_DEFAULT_MS;
  const controlsDisabled = !bridgeStatus.enabled;

  return (
    <div className="space-y-4">
      {!bridgeStatus.enabled ? (
        <p className="text-xs text-[var(--status-warning)] leading-snug">{strings.unavailable}</p>
      ) : null}

      {/* Output verbosity — how much of each OpenCode turn is mirrored back. */}
      <div className="space-y-2">
        <div className="text-sm font-medium text-foreground">{strings.verbosityTitle}</div>
        <MessengerSegmentedControl
          value={currentVerbosity}
          disabled={controlsDisabled}
          ariaLabel={strings.verbosityTitle}
          onChange={(id) => setBridgeVerbosity(type, id)}
          options={strings.verbosityOptions.map((opt) => ({
            id: opt.id,
            label: opt.label,
          }))}
        />
        <div className="text-xs text-muted-foreground leading-snug">
          {currentVerbosityOption.desc}
        </div>
      </div>

      {/* Tool permission mode — same defaults as /yolo and /permissions. */}
      <div className="space-y-2">
        <div className="text-sm font-medium text-foreground">{strings.permissionTitle}</div>
        <MessengerSegmentedControl
          value={currentPermissionMode}
          disabled={controlsDisabled}
          ariaLabel={strings.permissionTitle}
          onChange={(id) => setBridgePermissionMode(type, id)}
          options={strings.permissionOptions.map((opt) => ({
            id: opt.id,
            label: opt.label,
          }))}
        />
        <div className="text-xs text-muted-foreground leading-snug">
          {currentPermissionOption.desc}
        </div>
      </div>

      <div data-settings-item={`${settingsItemPrefix}.notify-on-complete`} className="space-y-1">
        <label className="flex cursor-pointer items-start gap-2">
          <Checkbox
            checked={notifyOnComplete}
            onChange={(checked) => setBridgeNotifyOnComplete(type, checked)}
            disabled={controlsDisabled}
            ariaLabel={strings.notifyTitle}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">{strings.notifyTitle}</span>
            <span className="block text-xs text-muted-foreground leading-snug">
              {strings.notifyDescription}
            </span>
          </span>
        </label>
      </div>

      {worktreesSlot}

      <div data-settings-item={`${settingsItemPrefix}.interrupt-timeout`} className="space-y-2">
        <label
          className="text-sm font-medium text-foreground"
          htmlFor={`${settingsItemPrefix.replace(/\./g, '-')}-interrupt-timeout-ms`}
        >
          {strings.interruptTitle}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`${settingsItemPrefix.replace(/\./g, '-')}-interrupt-timeout-ms`}
            type="number"
            min={MESSENGER_INTERRUPT_TIMEOUT_MIN_MS}
            max={MESSENGER_INTERRUPT_TIMEOUT_MAX_MS}
            step={500}
            disabled={controlsDisabled}
            value={interruptTimeoutMs}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) {
                setBridgeInterruptTimeoutMs(type, next);
              }
            }}
            className="h-8 w-28 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
          <span className="text-xs text-muted-foreground">{strings.interruptUnit}</span>
        </div>
        <div className="text-xs text-muted-foreground leading-snug">
          {strings.interruptDescription}
        </div>
      </div>

      {active.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <span className="text-primary">▶</span> {strings.activeLabel(active.length)}
        </div>
      )}

      {footerNotes ? (
        <div className="space-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground leading-snug">
          {footerNotes}
        </div>
      ) : null}
    </div>
  );
}

export function SessionBindingsPanel({
  type,
  bridgeStatus,
  emptyText,
}: {
  type: MessengerType;
  bridgeStatus: ReturnType<typeof useMessengerStore.getState>['bridgeStatus'];
  emptyText: string;
}) {
  const bindings = bridgeStatus.bindings.filter((b) => b.type === type);
  if (bindings.length === 0) {
    return <div className="text-xs text-muted-foreground">{emptyText}</div>;
  }
  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto">
      {bindings.map((b) => (
        <li
          key={`${b.type}:${b.targetKey}:${b.sessionId}`}
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground"
        >
          <code className="rounded bg-muted px-1 text-foreground">{b.targetKey}</code>
          {' → '}
          <code className="rounded bg-muted px-1 text-foreground">
            {b.sessionId.slice(0, 16)}…
          </code>
          {b.projectLabel ? ` · ${b.projectLabel}` : ''}
        </li>
      ))}
    </ul>
  );
}
