import { describe, expect, test } from 'bun:test';
import {
  MESSENGER_COMMAND_CATEGORY_ORDER,
  MESSENGER_COMMANDS,
  commandsFor,
} from './messenger-commands-data';

describe('messenger-commands-data', () => {
  const discord = commandsFor('discord');
  const telegram = commandsFor('telegram');

  test('preserves command and category order for both platforms', () => {
    const names = MESSENGER_COMMANDS.map((command) => command.name);
    expect(discord.map((command) => command.name)).toEqual(names);
    expect(telegram.map((command) => command.name)).toEqual(names);
    expect(MESSENGER_COMMAND_CATEGORY_ORDER).toEqual([
      'chat',
      'model',
      'shell',
      'git',
      'queue',
      'ops',
      'sharing',
    ]);
  });

  test('derives platform description keys and examples', () => {
    const session = MESSENGER_COMMANDS.find((c) => c.name === 'session');
    expect(session?.desc).toBe('session');
    expect(discord.find((c) => c.name === 'session')?.descriptionKey).toBe(
      'settings.integrations.discord.commands.desc.session',
    );
    expect(telegram.find((c) => c.name === 'session')?.descriptionKey).toBe(
      'settings.integrations.telegram.commands.desc.session',
    );
    expect(discord.find((c) => c.name === 'session')?.example).toContain('prompt:');
    expect(telegram.find((c) => c.name === 'session')?.example).not.toContain('prompt:');
    expect(discord.find((c) => c.name === 'shell')?.example).toBe('/shell command:pwd');
    expect(telegram.find((c) => c.name === 'shell')?.example).toBe('/shell pwd');
  });

  test('keeps critique suggested on both platforms', () => {
    const critique = discord.find((c) => c.name === 'critique');
    expect(critique?.suggested).toBe(true);
    expect(critique?.example).toBe('/critique on');
    expect(telegram.find((c) => c.name === 'critique')?.suggested).toBe(true);
  });
});
