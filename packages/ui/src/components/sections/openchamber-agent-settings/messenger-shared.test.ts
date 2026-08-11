import { describe, expect, test } from 'bun:test';
import { isMessengerIntegrationEnabled } from './messenger-shared';

describe('isMessengerIntegrationEnabled', () => {
  test('uses each messenger’s authoritative listener-enabled flag and preserves the default-on contract', () => {
    expect(isMessengerIntegrationEnabled({ type: 'discord' })).toBe(true);
    expect(isMessengerIntegrationEnabled({ type: 'telegram' })).toBe(true);
    expect(isMessengerIntegrationEnabled({ type: 'discord', discordListenerEnabled: false })).toBe(false);
    expect(isMessengerIntegrationEnabled({ type: 'telegram', telegramListenerEnabled: false })).toBe(false);
    expect(isMessengerIntegrationEnabled({
      type: 'discord',
      discordListenerEnabled: true,
      telegramListenerEnabled: false,
    })).toBe(true);
    expect(isMessengerIntegrationEnabled({
      type: 'telegram',
      discordListenerEnabled: false,
      telegramListenerEnabled: true,
    })).toBe(true);
  });

  test('lets authoritative live listener state override a stale legacy enabled flag', () => {
    expect(
      isMessengerIntegrationEnabled({
        type: 'discord',
        enabled: false,
        discordListenerEnabled: true,
      }),
    ).toBe(true);
  });
});
