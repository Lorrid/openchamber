import { useEffect, useState, type ReactNode } from 'react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { Icon } from '@/components/icon/Icon';
import type { IconName } from '@/components/icon/icons';

/** Official Telegram Web deep link for @userinfobot (user-requested URL). */
const TELEGRAM_USERINFOBOT_URL = 'https://web.telegram.org/k/#@userinfobot';

function messengerKey(type: MessengerType, suffix: string): I18nKey {
  return `settings.integrations.${type}.${suffix}` as I18nKey;
}

function messengerBridgeKey(type: MessengerType, suffix: string): I18nKey {
  return messengerKey(type, `bridge.${suffix}`);
}

/** Clickable @userinfobot link — visible handle is the product username. */
function TelegramUserInfoBotLink({ className }: { className?: string }) {
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

export function StatusBadge({
  type,
  status,
}: {
  type: MessengerType;
  status: MessengerConnection['status'];
}) {
  const { t } = useI18n();
  const styles: Record<string, string> = {
    connected:
      'bg-[var(--status-success)]/15 text-[var(--status-success)]',
    connecting:
      'bg-[var(--status-warning)]/15 text-[var(--status-warning)]',
    error: 'bg-[var(--status-error)]/15 text-[var(--status-error)]',
    disconnected: 'bg-muted text-muted-foreground',
  };
  const label = t(messengerKey(type, `status.${status}`));
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

export function MessengerDisconnectDialog({
  type,
  open,
  onOpenChange,
  onDisconnect,
}: {
  type: MessengerType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDisconnect: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [disconnecting, setDisconnecting] = useState(false);
  const k = (suffix: string) => messengerKey(type, `disconnect.dialog.${suffix}`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(k('title'))}</DialogTitle>
          <DialogDescription>{t(k('description'))}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('settings.common.actions.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={disconnecting}
            onClick={() => {
              setDisconnecting(true);
              void onDisconnect().finally(() => {
                setDisconnecting(false);
                onOpenChange(false);
              });
            }}
          >
            {t(k('confirm'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MessengerConnectTile({
  type,
  onConnect,
}: {
  type: MessengerType;
  onConnect: () => void;
}) {
  const { t } = useI18n();
  const brandClass = type === 'discord' ? 'text-[#5865F2]' : 'text-[#2AABEE]';
  return (
    <button
      type="button"
      onClick={onConnect}
      data-settings-item={`integrations.${type}.connect`}
      className="flex size-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-4 text-center text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
    >
      <Icon name={type === 'discord' ? 'discord-fill' : 'telegram-fill'} className={cn('size-9', brandClass)} />
      <span className="flex items-center gap-1 text-xs font-medium">
        <Icon name="add" className="size-3.5" />
        {t(messengerKey(type, 'connect'))}
      </span>
      <span className="text-[10px] font-normal leading-snug text-muted-foreground/80">
        {t(messengerKey(type, 'connectHint'))}
      </span>
    </button>
  );
}

const MESSENGER_REPLY_MODES = ['always', 'mention'] as const;

export function MessengerReplyModeControl({
  type,
  value,
  onChange,
}: {
  type: MessengerType;
  value: (typeof MESSENGER_REPLY_MODES)[number];
  onChange: (value: (typeof MESSENGER_REPLY_MODES)[number]) => void;
}) {
  const { t } = useI18n();
  const keyPrefix = type === 'discord' ? 'servers.replyMode' : 'groups.replyMode';
  return (
    <div
      className="inline-flex shrink-0 items-stretch overflow-hidden rounded-md border border-[var(--interactive-border)]"
      role="group"
      aria-label={t(messengerKey(type, `${keyPrefix}.always`))}
    >
      {MESSENGER_REPLY_MODES.map((mode, index) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={cn(
            'px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors',
            index === 0 && 'border-r border-[var(--interactive-border)]',
            value === mode
              ? 'bg-[var(--interactive-selection)] text-[var(--interactive-selection-foreground)]'
              : 'text-muted-foreground hover:bg-interactive-hover hover:text-foreground',
          )}
        >
          {t(messengerKey(type, `${keyPrefix}.${mode}`))}
        </button>
      ))}
    </div>
  );
}

export function MessengerLabeledCheckbox({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
      <Checkbox checked={checked} onChange={onChange} ariaLabel={label} />
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-foreground">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
          {description}
        </span>
      </span>
    </label>
  );
}

type MessengerSyncProject = { id: string; path: string; label?: string };

// eslint-disable-next-line react-refresh/only-export-components
export function buildMessengerProjectSyncPayloads(
  projects: MessengerSyncProject[],
): { id: string; path: string; label: string; body: string }[] {
  const now = new Date().toLocaleString();
  return projects.map((project) => {
    const label = project.label || project.path.split('/').pop() || project.path;
    return {
      id: project.id,
      path: project.path,
      label,
      body: [`🤖 OpenChamber agent sync — ${label}`, '', `Last synced ${now}`].join('\n'),
    };
  });
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildMessengerProjectSyncSummary(
  type: MessengerType,
  projects: Pick<MessengerSyncProject, 'id'>[],
): string {
  const lines = [
    '🤖 OpenChamber agent sync summary',
    '',
    `• Projects: ${projects.length}`,
    '',
    `Sent ${new Date().toLocaleString()}`,
  ];
  return type === 'discord'
    ? [`**${lines[0]}**`, ...lines.slice(1, -1), `_${lines.at(-1)}_`].join('\n')
    : lines.join('\n');
}

export function MessengerOnboardingFrame({
  type,
  step,
  totalSteps,
  canAdvance,
  onSkip,
  onBack,
  onNext,
  children,
}: {
  type: MessengerType;
  step: number;
  totalSteps: number;
  canAdvance: boolean;
  onSkip: () => void;
  onBack: () => void;
  onNext: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const k = (suffix: string) => messengerKey(type, `wizard.${suffix}`);
  return (
    <div
      className="rounded-lg border border-[color-mix(in_srgb,var(--primary-base)_20%,transparent)] bg-[color-mix(in_srgb,var(--primary-base)_5%,var(--background))] p-4 space-y-4"
      data-settings-item={`integrations.${type}.wizard`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="typography-ui-header font-medium text-foreground">{t(k('title'))}</h4>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t(k('stepOf'), { current: step + 1, total: totalSteps })}
          </p>
        </div>
        <button
          type="button"
          onClick={onSkip}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          {t(k('skipToAdvanced'))}
        </button>
      </div>

      <div className="flex gap-1">
        {Array.from({ length: totalSteps }, (_, index) => (
          <div
            key={index}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              index <= step ? 'bg-[var(--primary-base)]' : 'bg-[var(--surface-muted)]',
            )}
          />
        ))}
      </div>

      {children}

      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="!font-normal"
          disabled={step === 0}
          onClick={onBack}
        >
          {t(k('back'))}
        </Button>
        <Button type="button" size="sm" disabled={!canAdvance} onClick={onNext}>
          {t(k(step >= totalSteps - 1 ? 'finish' : 'next'))}
        </Button>
      </div>
    </div>
  );
}

export function MessengerListenerStep({
  type,
  running,
  live,
  starting,
  canAdvance,
  error,
  statusText,
  onStart,
}: {
  type: MessengerType;
  running: boolean;
  live: boolean;
  starting: boolean;
  canAdvance: boolean;
  error?: string | null;
  statusText?: string | null;
  onStart: () => void;
}) {
  const { t } = useI18n();
  const stepKey = type === 'discord' ? 'wizard.step4' : 'wizard.step3';
  const k = (suffix: string) => messengerKey(type, `${stepKey}.${suffix}`);
  const stuck = running && !live && !starting;
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs font-medium text-foreground">{t(k('title'))}</div>
        <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
          {t(k('description'))}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="!font-normal"
          disabled={starting || (running && live)}
          onClick={onStart}
        >
          <Icon name={starting ? 'loader-4' : 'play'} className={cn('size-3.5', starting && 'animate-spin')} />
          {t(k(stuck ? 'retryListener' : 'startListener'))}
        </Button>
        <span
          className={cn(
            'text-[10px]',
            live
              ? 'text-[var(--status-success)]'
              : running
                ? 'text-[var(--status-warning)]'
                : 'text-muted-foreground',
          )}
        >
          {t(k(live ? 'listenerLive' : running ? 'listenerConnecting' : 'listenerStopped'))}
        </span>
      </div>
      {error ? <p className="text-[11px] text-[var(--status-error)]">{error}</p> : null}
      {statusText ? <p className="text-[11px] text-muted-foreground">{statusText}</p> : null}
      {canAdvance ? (
        <p className="text-[11px] text-[var(--status-success)]">{t(k('complete'))}</p>
      ) : null}
    </div>
  );
}

export function MessengerListenerBadge({
  type,
  conn,
}: {
  type: MessengerType;
  conn: MessengerConnection;
}) {
  const { t } = useI18n();
  const connected = Boolean(
    type === 'discord' ? conn.discordListenerConnected : conn.telegramListenerConnected,
  );
  const running = Boolean(
    type === 'discord' ? conn.discordListenerRunning : conn.telegramListenerRunning,
  );
  const status = connected ? 'live' : running ? 'connecting' : 'off';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
        connected
          ? 'bg-[var(--status-success)]/15 text-[var(--status-success)]'
          : running
            ? 'bg-[var(--status-warning)]/15 text-[var(--status-warning)]'
            : 'bg-muted text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          connected
            ? 'bg-[var(--status-success)]'
            : running
              ? 'bg-[var(--status-warning)]'
              : 'bg-muted-foreground',
        )}
      />
      {t(messengerKey(type, `listener.status.${status}`))}
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
  meta?: ReactNode;
  badge?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
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
  children: ReactNode;
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

/** Shared Discord/Telegram listener diagnostics. */
export function MessengerListenerPanel({
  type,
  conn,
}: {
  type: MessengerType;
  conn: MessengerConnection;
}) {
  const { t } = useI18n();
  const k = (suffix: string) => messengerKey(type, suffix);
  const isDiscord = type === 'discord';
  const subscribeToEvents = useOpenChamberAgentEventsStore((s) => s.subscribeToEvents);
  const inbound = useMessengerStore((s) => (isDiscord ? s.discordInbound : s.telegramInbound));
  const history = useMessengerStore((s) => s.discordHistory);
  const start = useMessengerStore((s) =>
    isDiscord ? s.startDiscordListener : s.startTelegramListener,
  );
  const stop = useMessengerStore((s) =>
    isDiscord ? s.stopDiscordListener : s.stopTelegramListener,
  );
  const refresh = useMessengerStore((s) =>
    isDiscord ? s.refreshDiscordListenerStatus : s.refreshTelegramListenerStatus,
  );
  const loadRecent = useMessengerStore((s) =>
    isDiscord ? s.loadRecentDiscordMessages : s.loadRecentTelegramMessages,
  );
  const ingest = useMessengerStore((s) =>
    isDiscord ? s.ingestDiscordInbound : s.ingestTelegramInbound,
  );
  const loadHistory = useMessengerStore((s) => s.loadDiscordHistory);

  const running = Boolean(isDiscord ? conn.discordListenerRunning : conn.telegramListenerRunning);
  const connected = Boolean(
    isDiscord ? conn.discordListenerConnected : conn.telegramListenerConnected,
  );
  const seen = (isDiscord ? conn.discordListenerTotalRawMessages : conn.telegramListenerTotalRawMessages) ?? 0;
  const forwarded =
    (isDiscord ? conn.discordListenerTotalReceived : conn.telegramListenerTotalReceived) ?? 0;
  const replied =
    (isDiscord ? conn.discordListenerTotalReplied : conn.telegramListenerTotalReplied) ?? 0;
  const lastUpdateAt =
    (isDiscord ? conn.discordListenerLastUpdateAt : conn.telegramListenerLastUpdateAt) ?? null;
  const error = isDiscord ? conn.discordListenerError : conn.telegramListenerError;
  const historyTarget = isDiscord ? conn.defaultChannelId : undefined;
  const unknownKey = (
    isDiscord ? k('listener.fromUnknown') : 'settings.integrations.telegram.recent.fromUnknown'
  ) as I18nKey;
  const nonTextKey = (
    isDiscord ? k('listener.nonText') : 'settings.integrations.telegram.recent.nonText'
  ) as I18nKey;

  useEffect(() => {
    if (!running) return;
    const eventType = isDiscord
      ? 'messenger.discord.message_received'
      : 'messenger.telegram.message_received';
    return subscribeToEvents((event: OpenChamberAgentUiRealtimeEvent) => {
      if (event.eventType !== eventType) return;
      const data = event.data as MessengerInboundMessage | undefined;
      if (data && typeof data === 'object' && 'updateId' in data) ingest(data);
    });
  }, [running, isDiscord, subscribeToEvents, ingest]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const tick = async () => {
      if (!cancelled) await Promise.all([refresh(), loadRecent()]);
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [running, refresh, loadRecent]);

  useEffect(() => {
    if (!isDiscord) return;
    void useMessengerStore.getState().resyncDiscordStatus();
    if (conn.botToken) void loadRecent();
  }, [isDiscord, conn.botToken, loadRecent]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-foreground">{t(k('listener.title'))}</div>
        <Button
          type="button"
          variant={running ? 'outline' : 'default'}
          size="xs"
          className={cn(
            '!font-normal normal-case',
            running && 'text-[var(--status-error)] hover:text-[var(--status-error)]',
          )}
          onClick={() => void (running ? stop() : start())}
        >
          <Icon name={running ? 'stop' : 'play'} className="size-3.5" />
          {t(k(running ? 'listener.stop' : 'listener.start'))}
        </Button>
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
            <div className="text-muted-foreground">{t(k(`listener.stats.${key}`))}</div>
            <div className="font-medium text-foreground">{value}</div>
          </div>
        ))}
        <div className="rounded-lg border border-border bg-background px-2 py-1.5">
          <div className="text-muted-foreground">{t(k('listener.stats.lastUpdate'))}</div>
          <div className="font-medium text-foreground">
            {formatRelative(lastUpdateAt, t, t(k('relative.never')))}
          </div>
        </div>
      </div>

      {connected && seen === 0 && (
        <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          {t(k('listener.privacyHint'))}
        </div>
      )}
      {error && (
        <div className="flex items-start gap-1.5 text-[11px] leading-snug text-destructive">
          <Icon name="alert" className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </div>
      )}

      {!running ? (
        <div className="text-[11px] leading-snug text-muted-foreground">{t(k('listener.startHint'))}</div>
      ) : inbound.length === 0 ? (
        <div className="text-[11px] italic text-muted-foreground">{t(k('listener.waiting'))}</div>
      ) : (
        <ul className="max-h-48 space-y-1.5 overflow-y-auto">
          {inbound.slice(0, 8).map((m) => (
            <li
              key={String(m.updateId)}
              className="space-y-0.5 rounded border border-border bg-background px-2 py-1.5 text-[11px]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-foreground">
                  {m.from?.firstName ?? m.from?.username ?? t(unknownKey)}
                  {m.from?.username ? (
                    <span className="text-muted-foreground"> @{m.from.username}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[9px] text-muted-foreground">
                  {new Date(m.receivedAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="break-words text-muted-foreground">
                {m.text ?? <em>{t(nonTextKey)}</em>}
              </div>
              <div className="text-[9px] text-muted-foreground">
                {isDiscord
                  ? `channel ${m.chatId}${m.discord?.guildId ? ` · guild ${m.discord.guildId}` : ''}`
                  : `${t('settings.integrations.telegram.recent.chatLabel')} ${m.chatId}${
                      m.chatTitle ? ` · ${m.chatTitle}` : ''
                    }${
                      m.telegram?.messageThreadId
                        ? ` · ${t('settings.integrations.telegram.recent.topicLabel')} ${m.telegram.messageThreadId}`
                        : ''
                    }`}
              </div>
            </li>
          ))}
        </ul>
      )}

      {isDiscord ? (
        <div className="space-y-1.5 border-t border-border/60 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-medium text-foreground">{t(k('listener.history.title'))}</div>
            <button
              type="button"
              onClick={() => historyTarget && loadHistory(historyTarget, 50)}
              disabled={!historyTarget}
              className="rounded bg-primary/10 px-2 py-0.5 text-[10px] text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              {t(k('listener.history.fetch'))}
            </button>
          </div>
          {!historyTarget && (
            <div className="text-[10px] text-muted-foreground">{t(k('listener.history.needsTarget'))}</div>
          )}
          {historyTarget && history.length === 0 && (
            <div className="text-[10px] italic text-muted-foreground">{t(k('listener.history.empty'))}</div>
          )}
          {history.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {history.slice(0, 10).map((m) => (
                <li key={m.id} className="rounded border border-border bg-background px-2 py-1 text-[10px]">
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
                          ? t(k('listener.history.noTextOne'))
                          : t(k('listener.history.noTextMany'), { count: m.attachmentCount })}
                      </em>
                    )}
                  </div>
                </li>
              ))}
              {history.length > 10 && (
                <li className="px-2 text-[10px] italic text-muted-foreground">
                  {history.length - 10 === 1
                    ? t(k('listener.history.olderOne'))
                    : t(k('listener.history.olderMany'), { count: history.length - 10 })}
                </li>
              )}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

const MESSENGER_VERBOSITIES: MessengerVerbosity[] = ['quiet', 'normal', 'verbose'];
const MESSENGER_PERMISSION_MODES: MessengerPermissionMode[] = ['ask', 'yolo', 'agent'];

export function BehaviorPanel({
  type,
  bridgeStatus,
  worktreesSlot,
  footerNotes,
}: {
  type: MessengerType;
  bridgeStatus: ReturnType<typeof useMessengerStore.getState>['bridgeStatus'];
  /** Optional platform-specific extra controls (Discord worktree sync). */
  worktreesSlot?: ReactNode;
  footerNotes?: ReactNode;
}) {
  const { t } = useI18n();
  const k = (suffix: string) => messengerBridgeKey(type, suffix);
  const settingsItemPrefix = `integrations.${type}`;
  const bridgeVerbosity = useMessengerStore((s) => s.bridgeVerbosity);
  const setBridgeVerbosity = useMessengerStore((s) => s.setBridgeVerbosity);
  const bridgePermissionMode = useMessengerStore((s) => s.bridgePermissionMode);
  const setBridgePermissionMode = useMessengerStore((s) => s.setBridgePermissionMode);
  const bridgeNotifyOnComplete = useMessengerStore((s) => s.bridgeNotifyOnComplete);
  const setBridgeNotifyOnComplete = useMessengerStore((s) => s.setBridgeNotifyOnComplete);
  const bridgeInterruptTimeoutMs = useMessengerStore((s) => s.bridgeInterruptTimeoutMs);
  const setBridgeInterruptTimeoutMs = useMessengerStore((s) => s.setBridgeInterruptTimeoutMs);

  const activeCount = bridgeStatus.active.filter((a) => a.type === type).length;
  const currentVerbosity: MessengerVerbosity = bridgeVerbosity[type] ?? 'normal';
  const currentPermissionMode: MessengerPermissionMode = bridgePermissionMode[type] ?? 'agent';
  const notifyOnComplete = bridgeNotifyOnComplete[type] ?? false;
  const interruptTimeoutMs =
    bridgeInterruptTimeoutMs[type] ?? MESSENGER_INTERRUPT_TIMEOUT_DEFAULT_MS;
  const controlsDisabled = !bridgeStatus.enabled;

  return (
    <div className="space-y-4">
      {!bridgeStatus.enabled ? (
        <p className="text-xs text-[var(--status-warning)] leading-snug">{t(k('unavailable'))}</p>
      ) : null}

      {/* Output verbosity — how much of each OpenCode turn is mirrored back. */}
      <div className="space-y-2">
        <div className="text-sm font-medium text-foreground">{t(k('verbosity.title'))}</div>
        <MessengerSegmentedControl
          value={currentVerbosity}
          disabled={controlsDisabled}
          ariaLabel={t(k('verbosity.title'))}
          onChange={(id) => setBridgeVerbosity(type, id)}
          options={MESSENGER_VERBOSITIES.map((id) => ({
            id,
            label: t(k(`verbosity.${id}.label`)),
          }))}
        />
        <div className="text-xs text-muted-foreground leading-snug">
          {t(k(`verbosity.${currentVerbosity}.desc`))}
        </div>
      </div>

      {/* Tool permission mode — same defaults as /yolo and /permissions. */}
      <div className="space-y-2">
        <div className="text-sm font-medium text-foreground">{t(k('permissionMode.title'))}</div>
        <MessengerSegmentedControl
          value={currentPermissionMode}
          disabled={controlsDisabled}
          ariaLabel={t(k('permissionMode.title'))}
          onChange={(id) => setBridgePermissionMode(type, id)}
          options={MESSENGER_PERMISSION_MODES.map((id) => ({
            id,
            label: t(k(`permissionMode.${id}.label`)),
          }))}
        />
        <div className="text-xs text-muted-foreground leading-snug">
          {t(k(`permissionMode.${currentPermissionMode}.desc`))}
        </div>
      </div>

      <div data-settings-item={`${settingsItemPrefix}.notify-on-complete`} className="space-y-1">
        <label className="flex cursor-pointer items-start gap-2">
          <Checkbox
            checked={notifyOnComplete}
            onChange={(checked) => setBridgeNotifyOnComplete(type, checked)}
            disabled={controlsDisabled}
            ariaLabel={t(k('notifyOnComplete.title'))}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">
              {t(k('notifyOnComplete.title'))}
            </span>
            <span className="block text-xs text-muted-foreground leading-snug">
              {t(k('notifyOnComplete.description'))}
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
          {t(k('interruptTimeout.title'))}
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
          <span className="text-xs text-muted-foreground">{t(k('interruptTimeout.unit'))}</span>
        </div>
        <div className="text-xs text-muted-foreground leading-snug">
          {t(k('interruptTimeout.description'))}
        </div>
      </div>

      {activeCount > 0 && (
        <div className="text-xs text-muted-foreground">
          <span className="text-primary">▶</span>{' '}
          {activeCount === 1
            ? t(k('activeOne'))
            : t(k('activeMany'), { count: activeCount })}
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
