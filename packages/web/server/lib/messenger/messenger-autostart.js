import { buildDiscordResolveProject, buildTelegramResolveProject } from './messenger-sync.js';
import { normalizeTrustedBotIds } from './discord-access.js';
import { normalizeTelegramAccessSettings } from './telegram-access.js';

const AUTO_START_RETRIES = 5;
const AUTO_START_RETRY_DELAY_MS = 3_000;
const HEALTH_CHECK_INTERVAL_MS = 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Boot-time messenger listener lifecycle: start the Discord/Telegram
 * listeners from saved settings (with retries) and keep them healthy via a
 * periodic check. Extracted from server/index.js so the listener start
 * options can never drift from the route handlers in messenger-sync.js —
 * both call sites go through the same `startFromSettings` below.
 *
 * Health checks re-read settings on every tick, so Disconnect / Stop
 * listening (which persist `listenerEnabled: false`) are always respected
 * and never overridden by a boot-time closed-over config.
 */
export function createMessengerAutostart({
  readSettings,
  persistSettings,
  discordListener,
  telegramListener,
  ensureEventStream = null,
  log = console,
}) {
  const timers = [];

  const startEventStream = (label) => {
    if (typeof ensureEventStream !== 'function') return;
    // The bridge mirrors OpenCode output via the shared global event hub —
    // start it so a headless server doesn't depend on a browser client.
    Promise.resolve()
      .then(() => ensureEventStream())
      .catch((error) =>
        log.warn(`[${label}] Global event watcher startup failed:`, error?.message ?? error),
      );
  };

  const startDiscordFromSettings = async (discord) => {
    const result = discordListener.start(discord.botToken, {
      guildId: discord.guildId || undefined,
      autoReply: discord.autoReply !== false,
      scopeToGuild: Boolean(discord.scopeToGuild),
      // Per-server guildPolicies[*].enabled is the only mute — always bridge.
      bridgeEnabled: true,
      resolveProject: buildDiscordResolveProject(discord.projectBindings),
      trustedBotIds: normalizeTrustedBotIds(discord.trustedBotIds),
      registerDynamicSlashCommands: Boolean(discord.registerDynamicSlashCommands),
      defaultReplyMode: discord.defaultReplyMode,
      guildPolicies: discord.guildPolicies,
    });
    // Heal a stale settings.bridgeEnabled:false (from an old UI localStorage
    // overwrite) so it can never mute Enabled servers after restart.
    if (discord.bridgeEnabled === false && typeof persistSettings === 'function') {
      try {
        await persistSettings({ discord: { ...discord, bridgeEnabled: true } });
      } catch {
        // best-effort — the live listener is already bridged
      }
    }
    return result;
  };

  const startTelegramFromSettings = async (telegram) => {
    const access = normalizeTelegramAccessSettings({
      ownerUserIds: telegram.ownerUserIds,
      defaultUserId: telegram.defaultUserId,
      ownerUserId: telegram.ownerUserId,
    });
    const result = telegramListener.start(telegram.botToken, {
      autoReply: telegram.autoReply !== false,
      defaultUserId: access.ownerUserId || undefined,
      ownerUserIds: access.ownerUserIds.length > 0 ? access.ownerUserIds : undefined,
      allowedChatIds: telegram.allowedChatIds,
      defaultReplyMode: telegram.defaultReplyMode,
      resolveProject: buildTelegramResolveProject(telegram.projectBindings),
    });
    if (telegram.bridgeEnabled === false && typeof persistSettings === 'function') {
      try {
        await persistSettings({ telegram: { ...telegram, bridgeEnabled: true } });
      } catch {
        // best-effort
      }
    }
    return result;
  };

  /**
   * Auto-start one messenger with retries. Returns true when the listener
   * was started (or is already running), false when there is nothing to do
   * or every attempt failed.
   */
  const autoStartWithRetries = async ({ label, readConfig, start }) => {
    for (let attempt = 1; attempt <= AUTO_START_RETRIES; attempt++) {
      try {
        const config = await readConfig();
        if (!config?.botToken) {
          log.log(`[${label}] No bot token in saved config — skipping auto-start`);
          return false;
        }
        if (config.listenerEnabled === false) {
          log.log(`[${label}] Listener disabled in saved config — skipping auto-start`);
          return false;
        }
        const result = await start(config);
        log.log(
          `[${label}] Listener auto-start:`,
          result?.alreadyRunning ? 'already running' : 'started',
          `(connected=${result?.connected})`,
        );
        return true;
      } catch (error) {
        const isLastAttempt = attempt === AUTO_START_RETRIES;
        log.warn(
          `[${label}] Auto-start attempt ${attempt}/${AUTO_START_RETRIES} failed:`,
          error?.message ?? error,
          isLastAttempt ? '— giving up' : `— retrying in ${AUTO_START_RETRY_DELAY_MS}ms`,
        );
        if (isLastAttempt) return false;
        await sleep(AUTO_START_RETRY_DELAY_MS);
      }
    }
    return false;
  };

  /**
   * Keep the listener state in sync with settings: stop when disabled,
   * restart when enabled-but-not-running. Never resurrects a listener the
   * user explicitly disabled.
   */
  const startHealthCheck = ({ label, readConfig, listener, start, isUnhealthy }) => {
    const timer = setInterval(async () => {
      try {
        const config = await readConfig();
        if (!config?.botToken) return;

        if (config.listenerEnabled === false) {
          const status = listener.status(config.botToken);
          if (status.running) {
            log.log(`[${label}] Health check: listener disabled in settings — stopping`);
            listener.stop(config.botToken);
          }
          return;
        }

        const status = listener.status(config.botToken);
        if (isUnhealthy(status)) {
          log.log(
            `[${label}] Health check: listener not healthy (running=${status.running},` +
              ` connected=${status.connected}) — restarting...`,
          );
          listener.stop(config.botToken);
          const result = await start(config);
          log.log(
            `[${label}] Health check: restart result — running=${result.running},` +
              ` connected=${result.connected}`,
          );
        }
      } catch (error) {
        log.warn(`[${label}] Health check error:`, error?.message ?? error);
      }
    }, HEALTH_CHECK_INTERVAL_MS);
    timer.unref();
    timers.push(timer);
  };

  const readDiscordConfig = async () => (await readSettings())?.discord;
  const readTelegramConfig = async () => (await readSettings())?.telegram;

  return {
    /**
     * Start both listeners from saved settings (background — never blocks
     * server startup) and arm their health checks.
     */
    start() {
      void (async () => {
        const discordStarted = await autoStartWithRetries({
          label: 'Discord',
          readConfig: readDiscordConfig,
          start: startDiscordFromSettings,
        });
        if (discordStarted) startEventStream('Discord');
      })();
      startHealthCheck({
        label: 'Discord',
        readConfig: readDiscordConfig,
        listener: discordListener,
        start: startDiscordFromSettings,
        isUnhealthy: (status) => !status.running || !status.connected,
      });

      void (async () => {
        const telegramStarted = await autoStartWithRetries({
          label: 'Telegram',
          readConfig: readTelegramConfig,
          start: startTelegramFromSettings,
        });
        if (telegramStarted) startEventStream('Telegram');
      })();
      startHealthCheck({
        label: 'Telegram',
        readConfig: readTelegramConfig,
        listener: telegramListener,
        start: startTelegramFromSettings,
        // The Telegram listener's own backoff recovers transient poll
        // failures; the health check only revives a fully stopped loop.
        isUnhealthy: (status) => !status.running,
      });
    },

    /** Stop the health-check timers (listener processes keep running). */
    stop() {
      for (const timer of timers.splice(0)) {
        clearInterval(timer);
      }
    },
  };
}
