import { describe, expect, test } from 'bun:test';
import {
  DISCORD_COMMANDS,
  MESSENGER_COMMANDS,
  TELEGRAM_COMMANDS,
} from './messenger-commands-data';

describe('messenger-commands-data', () => {
  test('derives Discord and Telegram lists from the shared catalog', () => {
    expect(DISCORD_COMMANDS.length).toBeGreaterThan(0);
    expect(TELEGRAM_COMMANDS.length).toBeGreaterThan(0);
    expect(DISCORD_COMMANDS.map((c) => c.name)).toEqual(
      MESSENGER_COMMANDS.filter((c) => c.platforms.includes('discord')).map((c) => c.name),
    );
    expect(TELEGRAM_COMMANDS.map((c) => c.name)).toEqual(
      MESSENGER_COMMANDS.filter((c) => c.platforms.includes('telegram')).map((c) => c.name),
    );
  });

  test('remaps description keys per platform and keeps platform-specific examples', () => {
    const session = MESSENGER_COMMANDS.find((c) => c.name === 'session');
    expect(session?.descriptionKey).toBe('settings.integrations.commands.desc.session');
    expect(DISCORD_COMMANDS.find((c) => c.name === 'session')?.descriptionKey).toBe(
      'settings.integrations.discord.commands.desc.session',
    );
    expect(TELEGRAM_COMMANDS.find((c) => c.name === 'session')?.descriptionKey).toBe(
      'settings.integrations.telegram.commands.desc.session',
    );
    expect(DISCORD_COMMANDS.find((c) => c.name === 'session')?.example).toContain('prompt:');
    expect(TELEGRAM_COMMANDS.find((c) => c.name === 'session')?.example).not.toContain('prompt:');

    const shell = MESSENGER_COMMANDS.find((c) => c.name === 'shell');
    expect(DISCORD_COMMANDS.find((c) => c.name === 'shell')?.example).toBe('/shell command:pwd');
    expect(TELEGRAM_COMMANDS.find((c) => c.name === 'shell')?.example).toBe('/shell pwd');
    expect(shell?.platforms).toEqual(['discord', 'telegram']);
  });

  test('marks critique and suggested slash commands for Discord', () => {
    const critique = DISCORD_COMMANDS.find((c) => c.name === 'critique');
    expect(critique?.suggested).toBe(true);
    expect(critique?.nativeSlash).toBe(true);
    expect(TELEGRAM_COMMANDS.some((c) => c.name === 'critique')).toBe(true);
  });
});
