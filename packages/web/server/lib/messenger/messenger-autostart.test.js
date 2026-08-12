import { describe, expect, it, vi } from 'vitest';

import { createMessengerAutostart } from './messenger-autostart.js';

const SETTINGS_TOKEN = 'bot-token-123';

const createListenerFake = () => ({
  start: vi.fn(() => ({ running: true, connected: true })),
  stop: vi.fn(),
  status: vi.fn(() => ({ running: true, connected: true })),
});

const flush = async () => {
  // Let chained promises inside autoStartWithRetries settle.
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

describe('messenger autostart', () => {
  it('skips auto-start when no bot token is saved', async () => {
    const discordListener = createListenerFake();
    const telegramListener = createListenerFake();
    const log = { log: vi.fn(), warn: vi.fn() };

    const autostart = createMessengerAutostart({
      readSettings: vi.fn(async () => ({})),
      persistSettings: vi.fn(),
      discordListener,
      telegramListener,
      log,
    });
    autostart.start();
    await flush();
    autostart.stop();

    expect(discordListener.start).not.toHaveBeenCalled();
    expect(telegramListener.start).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('respects listenerEnabled:false (sticky stop) and never starts the listener', async () => {
    const discordListener = createListenerFake();
    const telegramListener = createListenerFake();
    const readSettings = vi.fn(async () => ({
      discord: { botToken: SETTINGS_TOKEN, listenerEnabled: false },
      telegram: { botToken: SETTINGS_TOKEN, listenerEnabled: false },
    }));

    const autostart = createMessengerAutostart({
      readSettings,
      persistSettings: vi.fn(),
      discordListener,
      telegramListener,
      log: { log: vi.fn(), warn: vi.fn() },
    });
    autostart.start();
    await flush();
    autostart.stop();

    expect(discordListener.start).not.toHaveBeenCalled();
    expect(telegramListener.start).not.toHaveBeenCalled();
  });

  it('starts both listeners from saved config and arms health checks', async () => {
    const discordListener = createListenerFake();
    const telegramListener = createListenerFake();
    const ensureEventStream = vi.fn();
    const readSettings = vi.fn(async () => ({
      discord: {
        botToken: SETTINGS_TOKEN,
        projectBindings: [
          { channelId: 'chan-1', projectPath: '/proj/a', projectLabel: 'A' },
        ],
      },
      telegram: {
        botToken: SETTINGS_TOKEN,
        ownerUserIds: ['111'],
        allowedChatIds: ['-100'],
      },
    }));

    const autostart = createMessengerAutostart({
      readSettings,
      persistSettings: vi.fn(),
      discordListener,
      telegramListener,
      ensureEventStream,
      log: { log: vi.fn(), warn: vi.fn() },
    });
    autostart.start();
    await flush();
    autostart.stop();

    expect(discordListener.start).toHaveBeenCalledTimes(1);
    const [discordToken, discordOptions] = discordListener.start.mock.calls[0];
    expect(discordToken).toBe(SETTINGS_TOKEN);
    expect(discordOptions.bridgeEnabled).toBe(true);
    // Boot auto-start must restore project bindings, not fall back to the
    // first project (the drift this module exists to prevent).
    expect(discordOptions.resolveProject({ channelId: 'chan-1' })).toEqual({
      path: '/proj/a',
      label: 'A',
    });

    expect(telegramListener.start).toHaveBeenCalledTimes(1);
    const [telegramToken, telegramOptions] = telegramListener.start.mock.calls[0];
    expect(telegramToken).toBe(SETTINGS_TOKEN);
    expect(telegramOptions.ownerUserIds).toEqual(['111']);
    expect(telegramOptions.defaultUserId).toBe('111');
    expect(telegramOptions.allowedChatIds).toEqual(['-100']);

    expect(ensureEventStream).toHaveBeenCalled();
  });

  it('heals a stale bridgeEnabled:false in settings after start', async () => {
    const discordListener = createListenerFake();
    const persistSettings = vi.fn();
    const readSettings = vi.fn(async () => ({
      discord: { botToken: SETTINGS_TOKEN, bridgeEnabled: false },
    }));

    const autostart = createMessengerAutostart({
      readSettings,
      persistSettings,
      discordListener,
      telegramListener: createListenerFake(),
      log: { log: vi.fn(), warn: vi.fn() },
    });
    autostart.start();
    await flush();
    autostart.stop();

    expect(persistSettings).toHaveBeenCalledWith({
      discord: expect.objectContaining({ bridgeEnabled: true }),
    });
  });

  it('retries when the first start attempt throws', async () => {
    vi.useFakeTimers();
    try {
      const discordListener = createListenerFake();
      discordListener.start
        .mockImplementationOnce(() => {
          throw new Error('transient');
        })
        .mockImplementationOnce(() => ({ running: true, connected: true }));
      const readSettings = vi.fn(async () => ({
        discord: { botToken: SETTINGS_TOKEN },
      }));

      const autostart = createMessengerAutostart({
        readSettings,
        persistSettings: vi.fn(),
        discordListener,
        telegramListener: createListenerFake(),
        log: { log: vi.fn(), warn: vi.fn() },
      });
      autostart.start();
      // Advance past the retry backoff so the second attempt fires.
      await vi.advanceTimersByTimeAsync(10_000);
      autostart.stop();

      expect(discordListener.start.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
