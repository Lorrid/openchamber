import { describe, expect, test } from 'bun:test';
import {
  deriveTelegramDisplayStatus,
  deriveTelegramViewState,
  isTelegramChatProjectSyncable,
  telegramChatOpenUrl,
} from './useMessengerStore';

describe('deriveTelegramDisplayStatus', () => {
  test('prefers a live listener over persisted disconnected verify status', () => {
    expect(
      deriveTelegramDisplayStatus({
        status: 'disconnected',
        botToken: 'tok',
        telegramListenerRunning: true,
        telegramListenerConnected: true,
      }),
    ).toBe('connected');
  });

  test('shows connecting while the listener is running but not yet polling', () => {
    expect(
      deriveTelegramDisplayStatus({
        status: 'disconnected',
        botToken: 'tok',
        telegramListenerRunning: true,
        telegramListenerConnected: false,
      }),
    ).toBe('connecting');
  });

  test('shows connecting when a token exists but live state is not reconciled yet', () => {
    expect(
      deriveTelegramDisplayStatus({
        status: 'disconnected',
        botToken: 'tok',
        telegramListenerRunning: false,
        telegramListenerConnected: false,
      }),
    ).toBe('connecting');
  });

  test('falls back to the last token-verify result when the listener is off', () => {
    expect(
      deriveTelegramDisplayStatus({
        status: 'connected',
        botToken: 'tok',
        telegramListenerRunning: false,
        telegramListenerConnected: false,
      }),
    ).toBe('connected');
    expect(
      deriveTelegramDisplayStatus({
        status: 'error',
        botToken: 'tok',
        telegramListenerRunning: false,
        telegramListenerConnected: false,
      }),
    ).toBe('error');
    expect(
      deriveTelegramDisplayStatus({
        status: 'disconnected',
        botToken: undefined,
        telegramServerConfigured: false,
        telegramListenerRunning: false,
        telegramListenerConnected: false,
      }),
    ).toBe('disconnected');
  });

  test('server-configured without a local token shows connecting (not disconnected)', () => {
    expect(
      deriveTelegramDisplayStatus({
        status: 'disconnected',
        botToken: undefined,
        telegramServerConfigured: true,
        telegramListenerRunning: false,
        telegramListenerConnected: false,
      }),
    ).toBe('connecting');
  });
});

describe('deriveTelegramViewState', () => {
  test('fresh state (no token, no wizard) shows the square connect card', () => {
    expect(
      deriveTelegramViewState({ hasToken: false, serverConfigured: false, wizardActive: false }),
    ).toBe('connect-card');
  });

  test('active onboarding shows the wizard, with or without a token', () => {
    expect(
      deriveTelegramViewState({ hasToken: false, serverConfigured: false, wizardActive: true }),
    ).toBe('wizard');
    expect(
      deriveTelegramViewState({ hasToken: true, serverConfigured: false, wizardActive: true }),
    ).toBe('wizard');
  });

  test('a saved token without active onboarding shows the configured view', () => {
    expect(
      deriveTelegramViewState({ hasToken: true, serverConfigured: false, wizardActive: false }),
    ).toBe('configured');
  });

  test('server-configured without a local token shows the configured view', () => {
    expect(
      deriveTelegramViewState({ hasToken: false, serverConfigured: true, wizardActive: false }),
    ).toBe('configured');
  });
});

describe('isTelegramChatProjectSyncable', () => {
  test('allows groups and forums, blocks private user chats', () => {
    expect(isTelegramChatProjectSyncable({ id: '-1001', chatType: 'supergroup' })).toBe(true);
    expect(isTelegramChatProjectSyncable({ id: '-1001', chatType: 'group' })).toBe(true);
    expect(isTelegramChatProjectSyncable({ id: '42', chatType: 'dm' })).toBe(false);
    expect(isTelegramChatProjectSyncable({ id: '42', chatType: 'private' })).toBe(false);
  });

  test('falls back to id sign when chat type is unknown', () => {
    expect(isTelegramChatProjectSyncable({ id: '-1001', chatType: null })).toBe(true);
    expect(isTelegramChatProjectSyncable({ id: '42', chatType: null })).toBe(false);
  });
});

describe('telegramChatOpenUrl', () => {
  test('builds private-supergroup and dm deep links', () => {
    expect(telegramChatOpenUrl('-1001234567890')).toBe('https://t.me/c/1234567890');
    expect(telegramChatOpenUrl('-1001234567890', { threadId: 55 })).toBe(
      'https://t.me/c/1234567890/55',
    );
    expect(telegramChatOpenUrl('42')).toBe('tg://user?id=42');
    expect(telegramChatOpenUrl('42', { username: 'ada' })).toBe('https://t.me/ada');
  });
});
