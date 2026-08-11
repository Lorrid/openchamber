import { useEffect, useState } from 'react';
import {
  deriveTelegramDisplayStatus,
  isTelegramChatProjectSyncable,
  isTelegramChatSyncing,
  listTelegramManagedChats,
  telegramChatOpenUrl,
  useMessengerStore,
  type MessengerConnection,
  type TelegramViewState,
} from '@/stores/useMessengerStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/icon/Icon';
import {
  AccessControlRow,
  AdvancedSectionCard,
  BehaviorPanel,
  MessengerDisconnectDialog,
  MessengerLabeledCheckbox,
  MessengerListenerBadge,
  MessengerListenerPanel,
  MessengerReplyModeControl,
  MessengerSegmentedControl,
  SessionBindingsPanel,
  StatusBadge,
  TelegramUserInfoBotHint,
  buildMessengerProjectSyncPayloads,
  buildMessengerProjectSyncSummary,
  isMessengerIntegrationEnabled,
  parseMessengerIdList,
} from './messenger-shared';
import { TelegramOnboardingWizard } from './TelegramOnboardingWizard';
import { MessengerCommandsButton } from './MessengerCommandPalette';

/** Telegram brand mark — intentional product color, not a theme token. */
const TELEGRAM_BRAND_CLASS = 'text-[#2AABEE]';

type TelegramAccessControlKey = 'fallback' | 'allowed' | 'owners';

function TelegramChatRow({
  conn,
  chat,
}: {
  conn: MessengerConnection;
  chat: { id: string; title: string; chatType: string | null };
}) {
  const { t } = useI18n();
  const setTelegramChatPolicy = useMessengerStore((s) => s.setTelegramChatPolicy);
  const critiqueEnabled = useMessengerStore((s) => s.bridgeCritiqueEnabled.telegram ?? false);
  const setBridgeCritiqueEnabled = useMessengerStore((s) => s.setBridgeCritiqueEnabled);
  const syncTelegramChatProjects = useMessengerStore((s) => s.syncTelegramChatProjects);
  const sendTestMessage = useMessengerStore((s) => s.sendTestMessage);
  const projects = useProjectsStore((s) => s.projects);
  const [expanded, setExpanded] = useState(false);
  const [rowAction, setRowAction] = useState<null | 'test' | 'sync'>(null);

  const policy = conn.telegramChatPolicies?.[chat.id];
  const respond = policy?.enabled !== false;
  const storedReplyMode = policy?.replyMode ?? 'inherit';
  const replyMode: 'always' | 'mention' =
    storedReplyMode === 'mention' || storedReplyMode === 'always'
      ? storedReplyMode
      : conn.telegramDefaultReplyMode === 'mention'
        ? 'mention'
        : 'always';
  const syncable = isTelegramChatProjectSyncable(chat);
  const syncing = syncable && isTelegramChatSyncing(conn, chat.id);
  const configured = Boolean(conn.botToken || conn.telegramServerConfigured);
  const busy = conn.lastSyncStatus === 'sending';
  const isDm = chat.chatType === 'private' || chat.chatType === 'dm';
  const title =
    chat.title && chat.title !== chat.id
      ? chat.title
      : isDm
        ? t('settings.integrations.telegram.groups.dm')
        : t('settings.integrations.telegram.groups.untitled', { id: chat.id });
  const openUrl = telegramChatOpenUrl(chat.id);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Icon name="telegram-fill" className={cn('size-5 shrink-0', TELEGRAM_BRAND_CLASS)} />
          <div className="min-w-0">
            {openUrl ? (
              <button
                type="button"
                className="min-w-0 break-words text-left text-sm font-semibold leading-snug text-foreground hover:underline"
                onClick={() => window.open(openUrl, '_blank', 'noopener,noreferrer')}
                aria-label={t('settings.integrations.telegram.groups.openChat', { title })}
                title={t('settings.integrations.telegram.groups.openChat', { title })}
              >
                {title}
              </button>
            ) : (
              <div className="min-w-0 break-words text-sm font-semibold leading-snug text-foreground">
                {title}
              </div>
            )}
            <div className="truncate text-[10px] text-muted-foreground">{chat.id}</div>
          </div>
        </div>

        <label className="flex shrink-0 cursor-pointer items-center gap-2">
          <Switch
            checked={respond}
            onCheckedChange={(checked) => setTelegramChatPolicy(chat.id, { enabled: checked })}
            aria-label={t('settings.integrations.telegram.groups.enabled.label')}
            className="data-[checked]:bg-[var(--status-success)]"
          />
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {t('settings.integrations.telegram.groups.enabled.label')}
          </span>
        </label>

        {respond && (
          <MessengerReplyModeControl
            type="telegram"
            value={replyMode}
            onChange={(mode) => setTelegramChatPolicy(chat.id, { replyMode: mode })}
          />
        )}

        <Button
          type="button"
          variant={expanded ? 'secondary' : 'ghost'}
          size="icon"
          className="size-8 shrink-0"
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t('settings.integrations.telegram.groups.collapseSettings')
              : t('settings.integrations.telegram.groups.expandSettings')
          }
          onClick={() => setExpanded((v) => !v)}
        >
          <Icon name="more-2" className="size-4" />
        </Button>
      </div>

      {expanded && (
        <div className="relative ml-4 space-y-3 rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-3 py-3">
          <button
            type="button"
            className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-interactive-hover hover:text-foreground"
            onClick={() => setExpanded(false)}
            aria-label={t('settings.integrations.telegram.groups.collapseSettings')}
          >
            <Icon name="arrow-up-s" className="size-4" />
          </button>

          <div className="flex flex-wrap items-start gap-3 pr-8">
            {syncable && (
              <MessengerLabeledCheckbox
                checked={syncing}
                onChange={(checked) => setTelegramChatPolicy(chat.id, { syncProjects: checked })}
                label={t('settings.integrations.telegram.groups.syncProjects.label')}
                description={t('settings.integrations.telegram.groups.syncProjects.hint')}
              />
            )}

            {syncable && (
              <MessengerLabeledCheckbox
                checked={critiqueEnabled}
                onChange={(checked) => void setBridgeCritiqueEnabled('telegram', checked)}
                label={t('settings.integrations.telegram.bridge.critique.title')}
                description={t('settings.integrations.telegram.bridge.critique.description')}
              />
            )}

            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {syncable && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="!font-normal"
                  disabled={!configured || busy || !syncing}
                  onClick={() => {
                    setRowAction('sync');
                    void syncTelegramChatProjects(
                      buildMessengerProjectSyncPayloads(projects),
                      buildMessengerProjectSyncSummary('telegram', projects),
                      { chatId: chat.id },
                    ).finally(() => setRowAction(null));
                  }}
                >
                  {rowAction === 'sync' ? (
                    <Icon name="loader-4" className="size-3.5 animate-spin" />
                  ) : (
                    <Icon name="refresh" className="size-3.5" />
                  )}
                  {t('settings.integrations.telegram.groups.syncNow')}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="!font-normal"
                disabled={!configured || busy}
                onClick={() => {
                  setRowAction('test');
                  void sendTestMessage('telegram', { chatId: chat.id }).finally(() =>
                    setRowAction(null),
                  );
                }}
              >
                {rowAction === 'test' ? (
                  <Icon name="loader-4" className="size-3.5 animate-spin" />
                ) : (
                  <Icon name="send-plane" className="size-3.5" />
                )}
                {t('settings.integrations.telegram.groups.sendTest')}
              </Button>
            </div>
          </div>

          {syncable && conn.telegramCanReadAllGroupMessages === false && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t('settings.integrations.telegram.groups.restriction.privacy')}
            </p>
          )}
          {syncable && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t('settings.integrations.telegram.groups.restriction.topics')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TelegramOwnerUserIdsEditor({ conn }: { conn: MessengerConnection }) {
  const { t } = useI18n();
  const updateConnection = useMessengerStore((s) => s.updateConnection);
  const saveTelegramConfig = useMessengerStore((s) => s.saveTelegramConfig);
  const persist = () => setTimeout(() => saveTelegramConfig(), 0);
  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <div data-settings-item="integrations.telegram.owner-user" className="space-y-2">
      <div className="text-xs text-muted-foreground leading-snug">
        <TelegramUserInfoBotHint
          beforeKey="settings.integrations.telegram.advanced.ownerUserIds.description.before"
          afterKey="settings.integrations.telegram.advanced.ownerUserIds.description.after"
        />
      </div>
      <p className="text-xs text-[var(--status-warning)] leading-snug">
        {t('settings.integrations.telegram.advanced.ownerUserIds.required')}
      </p>
      <textarea
        value={(conn.telegramOwnerUserIds ?? []).join('\n')}
        onChange={(e) => {
          const telegramOwnerUserIds = parseMessengerIdList(e.target.value);
          updateConnection('telegram', {
            telegramOwnerUserIds,
            defaultUserId: telegramOwnerUserIds[0],
          });
        }}
        onBlur={() => {
          const latest = useMessengerStore
            .getState()
            .connections.find((c) => c.type === 'telegram');
          if (!(latest?.telegramOwnerUserIds ?? []).length) return;
          persist();
        }}
        placeholder={t('settings.integrations.telegram.advanced.ownerUserIds.placeholder')}
        className={cn(inputClass, 'min-h-16 resize-y')}
      />
    </div>
  );
}

function TelegramGroupsList({ conn }: { conn: MessengerConnection }) {
  const { t } = useI18n();
  const inbound = useMessengerStore((s) => s.telegramInbound);
  const chats = listTelegramManagedChats(conn, inbound);

  return (
    <div data-settings-item="integrations.telegram.groups" className="space-y-3">
      {chats.length === 0 ? (
        <p className="text-xs text-muted-foreground leading-snug">
          {t('settings.integrations.telegram.advanced.syncLog.empty')}
        </p>
      ) : (
        <div className="space-y-2">
          {chats.map((chat) => (
            <TelegramChatRow key={chat.id} conn={conn} chat={chat} />
          ))}
        </div>
      )}
    </div>
  );
}

function TelegramLastSyncResults({ conn }: { conn: MessengerConnection }) {
  const restrictions = conn.lastSyncTelegramRestrictions ?? [];
  const results = conn.lastSyncTelegramProjects ?? [];
  if (restrictions.length === 0 && results.length === 0) return null;

  return (
    <div data-settings-item="integrations.telegram.sync-results" className="space-y-1.5">
      {restrictions.map((r) => (
        <p key={r} className="text-[11px] leading-snug text-muted-foreground">
          {r}
        </p>
      ))}
      {results.map((row) => (
        <div
          key={`${row.chatId ?? ''}:${row.projectId}`}
          className="text-[11px] leading-snug text-foreground"
        >
          {row.projectLabel}
          {row.error
            ? ` — ${row.error}`
            : row.messageId
              ? ` — ✓${row.topicCreated ? ' topic' : ''}`
              : ''}
          {row.topicSkippedReason ? ` (${row.topicSkippedReason})` : ''}
        </div>
      ))}
    </div>
  );
}

/** Main Telegram card content: the chat list is no longer a nested accordion. */
function TelegramOwnersAndGroupsPanel({ conn }: { conn: MessengerConnection }) {
  const { t } = useI18n();

  return (
    <div className="space-y-3">
      <div>
        <div className="text-base font-semibold text-foreground">
          {t('settings.integrations.telegram.controls.title')}
        </div>
        <p className="mt-1 text-xs text-muted-foreground leading-snug">
          {t('settings.integrations.telegram.controls.description')}
        </p>
      </div>
      <TelegramGroupsList conn={conn} />
    </div>
  );
}

function TelegramAdvancedSettings({ conn }: { conn: MessengerConnection }) {
  const { t } = useI18n();
  const updateConnection = useMessengerStore((s) => s.updateConnection);
  const saveTelegramConfig = useMessengerStore((s) => s.saveTelegramConfig);
  const refreshBridgeStatus = useMessengerStore((s) => s.refreshBridgeStatus);
  const bridgeStatus = useMessengerStore((s) => s.bridgeStatus);

  const [chatInput, setChatInput] = useState('');
  const [sectionOpen, setSectionOpen] = useState({
    behavior: true,
    diagnostics: false,
    accessControl: false,
    bindings: false,
    commands: false,
    syncLog: false,
  });
  const [accessOpen, setAccessOpen] = useState<TelegramAccessControlKey | null>(null);
  const setOpen = (key: keyof typeof sectionOpen) => (open: boolean) =>
    setSectionOpen((current) => ({ ...current, [key]: open }));

  useEffect(() => {
    void refreshBridgeStatus('telegram');
    const id = setInterval(() => void refreshBridgeStatus('telegram'), 8000);
    return () => clearInterval(id);
  }, [refreshBridgeStatus]);

  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring';

  const seen = conn.telegramListenerTotalRawMessages ?? 0;
  const forwarded = conn.telegramListenerTotalReceived ?? 0;
  const replied = conn.telegramListenerTotalReplied ?? 0;
  const bindingsCount = bridgeStatus.bindings.filter((b) => b.type === 'telegram').length;
  const hasSyncResults =
    (conn.lastSyncTelegramRestrictions ?? []).length > 0 ||
    (conn.lastSyncTelegramProjects ?? []).length > 0;

  const persist = () => setTimeout(() => saveTelegramConfig(), 0);
  const toggleAccess = (key: TelegramAccessControlKey) => {
    setAccessOpen((prev) => (prev === key ? null : key));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1 px-0.5">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">
          {t('settings.integrations.telegram.actions.advancedSettings')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t('settings.integrations.telegram.advanced.description')}
        </p>
      </div>

      <div className="space-y-3">
        <AdvancedSectionCard
          icon="settings-3"
          title={t('settings.integrations.telegram.advanced.behavior.title')}
          open={sectionOpen.behavior}
          onOpenChange={setOpen('behavior')}
        >
          <div className="space-y-4">
            <BehaviorPanel
              type="telegram"
              bridgeStatus={bridgeStatus}
            />
            <div
              data-settings-item="integrations.telegram.reply-mode"
              className="space-y-2 border-t border-border/60 pt-3"
            >
              <div className="text-sm font-medium text-foreground">
                {t('settings.integrations.telegram.advanced.replyMode.title')}
              </div>
              <MessengerSegmentedControl
                value={conn.telegramDefaultReplyMode ?? 'always'}
                ariaLabel={t('settings.integrations.telegram.advanced.replyMode.title')}
                onChange={(mode) => {
                  updateConnection('telegram', { telegramDefaultReplyMode: mode });
                  persist();
                }}
                options={[
                  {
                    id: 'always' as const,
                    label: t('settings.integrations.telegram.advanced.replyMode.always'),
                  },
                  {
                    id: 'mention' as const,
                    label: t('settings.integrations.telegram.advanced.replyMode.mention'),
                  },
                ]}
              />
              <div className="text-xs text-muted-foreground leading-snug">
                {conn.telegramDefaultReplyMode === 'mention'
                  ? t('settings.integrations.telegram.advanced.replyMode.mentionDesc')
                  : t('settings.integrations.telegram.advanced.replyMode.alwaysDesc')}
              </div>
            </div>
          </div>
        </AdvancedSectionCard>

        <AdvancedSectionCard
          icon="pulse"
          title={t('settings.integrations.telegram.advanced.diagnostics.title')}
          badge={<MessengerListenerBadge type="telegram" conn={conn} />}
          meta={t('settings.integrations.telegram.advanced.diagnostics.stats', {
            seen,
            forwarded,
            replied,
          })}
          open={sectionOpen.diagnostics}
          onOpenChange={setOpen('diagnostics')}
        >
          <MessengerListenerPanel type="telegram" conn={conn} />
        </AdvancedSectionCard>

        <AdvancedSectionCard
          icon="shield-user"
          title={t('settings.integrations.telegram.advanced.dangerZone.title')}
          open={sectionOpen.accessControl}
          onOpenChange={setOpen('accessControl')}
        >
          <div className="-mx-4 -my-3 divide-y divide-border/60">
            <AccessControlRow
              label={t('settings.integrations.telegram.advanced.ownerUserIds.title')}
              open={accessOpen === 'owners'}
              onToggle={() => toggleAccess('owners')}
            >
              <TelegramOwnerUserIdsEditor conn={conn} />
            </AccessControlRow>
            <AccessControlRow
              label={t('settings.integrations.telegram.advanced.fallbackChat.title')}
              open={accessOpen === 'fallback'}
              onToggle={() => toggleAccess('fallback')}
            >
              <div data-settings-item="integrations.telegram.fallback-chat" className="space-y-2">
                <div className="text-xs text-muted-foreground leading-snug">
                  {t('settings.integrations.telegram.advanced.fallbackChat.description')}
                </div>
                {conn.defaultChatId ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                      {conn.defaultChatId}
                    </code>
                    <Icon name="check" className="size-3 text-[var(--status-success)]" />
                    <button
                      type="button"
                      onClick={() => {
                        updateConnection('telegram', { defaultChatId: undefined });
                        persist();
                      }}
                      className="text-primary text-[10px] hover:underline"
                    >
                      {t('settings.integrations.telegram.advanced.fallbackChat.change')}
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder={t(
                        'settings.integrations.telegram.advanced.fallbackChat.placeholder',
                      )}
                      className={inputClass}
                    />
                    <Button
                      type="button"
                      variant="default"
                      size="xs"
                      className="!font-normal normal-case shrink-0"
                      disabled={!chatInput.trim()}
                      onClick={() => {
                        updateConnection('telegram', { defaultChatId: chatInput.trim() });
                        setChatInput('');
                        persist();
                      }}
                    >
                      {t('settings.integrations.telegram.actions.saveToken')}
                    </Button>
                  </div>
                )}
              </div>
            </AccessControlRow>
            <AccessControlRow
              label={t('settings.integrations.telegram.advanced.allowedChats.title')}
              open={accessOpen === 'allowed'}
              onToggle={() => toggleAccess('allowed')}
            >
              <div data-settings-item="integrations.telegram.allowed-chats" className="space-y-2">
                <div className="text-xs text-muted-foreground leading-snug">
                  {t('settings.integrations.telegram.advanced.allowedChats.description')}
                </div>
                <textarea
                  value={(conn.telegramAllowedChatIds ?? []).join('\n')}
                  onChange={(e) => {
                    const telegramAllowedChatIds = parseMessengerIdList(e.target.value);
                    updateConnection('telegram', { telegramAllowedChatIds });
                  }}
                  onBlur={persist}
                  placeholder={t(
                    'settings.integrations.telegram.advanced.allowedChats.placeholder',
                  )}
                  className={cn(inputClass, 'min-h-16 resize-y')}
                />
              </div>
            </AccessControlRow>
          </div>
        </AdvancedSectionCard>

        <AdvancedSectionCard
          icon="apps"
          title={t('settings.integrations.telegram.advanced.sessionBindings.title')}
          meta={
            bindingsCount === 1
              ? t('settings.integrations.telegram.advanced.sessionBindings.countOne')
              : t('settings.integrations.telegram.advanced.sessionBindings.count', {
                  count: bindingsCount,
                })
          }
          open={sectionOpen.bindings}
          onOpenChange={setOpen('bindings')}
        >
          <SessionBindingsPanel
            type="telegram"
            bridgeStatus={bridgeStatus}
            emptyText={t('settings.integrations.telegram.advanced.sessionBindings.empty')}
          />
        </AdvancedSectionCard>

        <AdvancedSectionCard
          icon="command"
          title={t('settings.integrations.telegram.commands.title')}
          meta={t('settings.integrations.telegram.commands.description')}
          open={sectionOpen.commands}
          onOpenChange={setOpen('commands')}
        >
          <div data-settings-item="integrations.telegram.commands">
            <MessengerCommandsButton platform="telegram" />
          </div>
        </AdvancedSectionCard>

        <AdvancedSectionCard
          icon="refresh"
          title={t('settings.integrations.telegram.advanced.syncLog.title')}
          open={sectionOpen.syncLog}
          onOpenChange={setOpen('syncLog')}
        >
          {hasSyncResults ? (
            <TelegramLastSyncResults conn={conn} />
          ) : (
            <div className="text-xs text-muted-foreground">
              {t('settings.integrations.telegram.advanced.syncLog.empty')}
            </div>
          )}
        </AdvancedSectionCard>
      </div>
    </div>
  );
}

export function TelegramSectionCard({
  conn,
  view,
}: {
  conn: MessengerConnection;
  view: TelegramViewState;
}) {
  const { t } = useI18n();
  const updateConnection = useMessengerStore((s) => s.updateConnection);
  const testConnection = useMessengerStore((s) => s.testConnection);
  const disconnectTelegram = useMessengerStore((s) => s.disconnectTelegram);
  const saveTelegramConfig = useMessengerStore((s) => s.saveTelegramConfig);
  const startTelegramListener = useMessengerStore((s) => s.startTelegramListener);
  const stopTelegramListener = useMessengerStore((s) => s.stopTelegramListener);
  const [cardOpen, setCardOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);

  const displayStatus = deriveTelegramDisplayStatus(conn);
  const hasToken = Boolean(conn.botToken);
  const configured = hasToken || Boolean(conn.telegramServerConfigured);
  const showWizard = view === 'wizard';

  useEffect(() => {
    if (showWizard) setCardOpen(true);
  }, [showWizard]);

  // Reconcile badge + listener with the live server when this card opens.
  useEffect(() => {
    void useMessengerStore.getState().resyncTelegramStatus();
  }, [conn.botToken]);

  const handleSaveToken = () => {
    if (!tokenInput.trim()) return;
    updateConnection('telegram', { botToken: tokenInput.trim(), enabled: true });
    setTimeout(() => saveTelegramConfig(), 0);
    // Re-verify so a bad replacement token flips the badge to error instead
    // of coasting on the previous token's connected status.
    setTimeout(() => void testConnection('telegram'), 0);
    setTokenInput('');
    setShowToken(false);
  };

  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring';

  const integrationEnabled = isMessengerIntegrationEnabled(conn);
  const toggleIntegration = (enabled: boolean) => {
    void (enabled ? startTelegramListener() : stopTelegramListener());
  };

  return (
    <Collapsible open={cardOpen} onOpenChange={setCardOpen}>
      <div className="overflow-hidden rounded-xl border border-[var(--interactive-border)] bg-[var(--surface-elevated)] shadow-sm">
        <div className="flex items-center gap-2 p-5">
          <CollapsibleTrigger
            className="min-w-0 flex-1 justify-start gap-2 overflow-hidden rounded-md p-0 hover:bg-transparent"
            aria-label={t('settings.integrations.telegram.controls.title')}
          >
            <Icon name="telegram-fill" className={cn('size-5 shrink-0', TELEGRAM_BRAND_CLASS)} />
            <span className="shrink-0 text-sm font-semibold text-foreground">Telegram</span>
            <StatusBadge type="telegram" status={displayStatus} />
            {conn.telegramBotUsername && (
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                @{conn.telegramBotUsername}
              </span>
            )}
            <Icon
              name={cardOpen ? 'arrow-up-s' : 'arrow-down-s'}
              className="ml-auto size-4 shrink-0 text-muted-foreground"
            />
          </CollapsibleTrigger>
          <div className="flex shrink-0 items-center gap-1.5">
            <Switch
              checked={integrationEnabled}
              onCheckedChange={toggleIntegration}
              aria-label={t('settings.integrations.telegram.listener.title')}
              className="data-[checked]:bg-[var(--status-success)]"
            />
            {!showWizard && configured && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="!font-normal"
                onClick={() => {
                  setCardOpen(true);
                  setShowToken((v) => !v);
                }}
              >
                {showToken
                  ? t('settings.common.actions.cancel')
                  : t('settings.integrations.telegram.actions.changeToken')}
              </Button>
            )}
            {!showWizard && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn(
                  'size-8',
                  advancedOpen &&
                    'border-primary text-primary shadow-[0_0_12px_var(--primary-base)]',
                )}
                aria-expanded={advancedOpen}
                aria-label={t('settings.integrations.telegram.actions.advancedSettings')}
                title={t('settings.integrations.telegram.actions.advancedSettings')}
                onClick={() => {
                  setCardOpen(true);
                  setAdvancedOpen((open) => !open);
                }}
              >
                <Icon name="settings-3" className="size-4" />
              </Button>
            )}
            {configured && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-[var(--status-error)] hover:text-[var(--status-error)]"
                aria-label={t('settings.integrations.telegram.disconnect.button')}
                title={t('settings.integrations.telegram.disconnect.button')}
                onClick={() => setDisconnectConfirmOpen(true)}
              >
                <Icon name="link-unlink-m" className="size-4" />
              </Button>
            )}
          </div>
        </div>

        {!showWizard && showToken && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 px-5 pb-4">
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={t('settings.integrations.telegram.wizard.step1.tokenLabel')}
              className={cn(inputClass, 'min-w-[12rem] flex-1')}
            />
            <Button
              type="button"
              variant="default"
              size="xs"
              className="!font-normal shrink-0"
              onClick={handleSaveToken}
              disabled={!tokenInput.trim()}
            >
              {t('settings.integrations.telegram.actions.updateToken')}
            </Button>
            {displayStatus !== 'connected' && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="!font-normal"
                onClick={() => void testConnection('telegram')}
                disabled={!configured || conn.status === 'connecting'}
              >
                {conn.status === 'connecting'
                  ? t('settings.integrations.telegram.wizard.step1.verifying')
                  : t('settings.integrations.telegram.wizard.step1.verify')}
              </Button>
            )}
          </div>
        )}

      {conn.error && (
        <div className="mx-5 mb-4 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-start gap-2">
          <Icon name="alert" className="size-3.5 shrink-0 mt-0.5" />
          <span>{conn.error}</span>
        </div>
      )}

        <CollapsibleContent className="border-t border-[var(--interactive-border)] px-5 pb-5 pt-5">
      {showWizard ? (
        <TelegramOnboardingWizard conn={conn} />
      ) : (
        <>
          <TelegramOwnersAndGroupsPanel conn={conn} />
          {advancedOpen && (
          <div className="border-t border-[var(--interactive-border)] pt-4">
            <TelegramAdvancedSettings conn={conn} />
          </div>
          )}
        </>
      )}

        </CollapsibleContent>

      <MessengerDisconnectDialog
        type="telegram"
        open={disconnectConfirmOpen}
        onOpenChange={setDisconnectConfirmOpen}
        onDisconnect={disconnectTelegram}
      />
      </div>
    </Collapsible>
  );
}
