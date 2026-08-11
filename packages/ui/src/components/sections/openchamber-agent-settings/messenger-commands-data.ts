export type MessengerCommandCategory =
  | 'chat'
  | 'model'
  | 'shell'
  | 'git'
  | 'queue'
  | 'ops'
  | 'sharing';

export type MessengerCommandPlatform = 'discord' | 'telegram';

export type MessengerCommandEntry = {
  name: string;
  /** Desc key suffix under settings.integrations.{platform}.commands.desc.* */
  descriptionKey: string;
  category: MessengerCommandCategory;
  /** Platforms that surface this command in Settings. */
  platforms: readonly MessengerCommandPlatform[];
  /** Highlighted near the top of the palette. */
  suggested?: boolean;
  /** True when also registered as a Discord application (slash) command. */
  nativeSlash?: boolean;
  /** Optional copyable example; may be overridden per platform. */
  example?: string;
  discordExample?: string;
  telegramExample?: string;
};

/** Catalog stores shared `settings.integrations.commands.desc.*`; derive remaps per platform. */
function platformDescKey(descriptionKey: string, platform: MessengerCommandPlatform): string {
  return descriptionKey.replace(
    'settings.integrations.commands.desc.',
    `settings.integrations.${platform}.commands.desc.`,
  );
}

/**
 * Single source of truth for messenger command reference in Settings.
 * Keep Discord slash entries in lockstep with `buildSlashCommandDefinitions()` in
 * `packages/web/server/lib/messenger/discord-commands.js`. Telegram surfaces the
 * same text commands via `messenger-commands.js` (no native slash registration).
 */
export const MESSENGER_COMMANDS: MessengerCommandEntry[] = [
  {
    name: 'help',
    descriptionKey: 'settings.integrations.commands.desc.help',
    category: 'chat',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
  {
    name: 'status',
    descriptionKey: 'settings.integrations.commands.desc.status',
    category: 'chat',
    platforms: ['discord', 'telegram'],
    suggested: true,
    nativeSlash: true,
  },
  {
    name: 'abort',
    descriptionKey: 'settings.integrations.commands.desc.abort',
    category: 'chat',
    platforms: ['discord', 'telegram'],
    suggested: true,
    nativeSlash: true,
  },
  {
    name: 'new',
    descriptionKey: 'settings.integrations.commands.desc.new',
    category: 'chat',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
  {
    name: 'undo',
    descriptionKey: 'settings.integrations.commands.desc.undo',
    category: 'chat',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
  {
    name: 'redo',
    descriptionKey: 'settings.integrations.commands.desc.redo',
    category: 'chat',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
  {
    name: 'model',
    descriptionKey: 'settings.integrations.commands.desc.model',
    category: 'model',
    platforms: ['discord', 'telegram'],
    suggested: true,
    nativeSlash: true,
  },
  {
    name: 'agent',
    descriptionKey: 'settings.integrations.commands.desc.agent',
    category: 'model',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
  {
    name: 'verbosity',
    descriptionKey: 'settings.integrations.commands.desc.verbosity',
    category: 'model',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
  {
    name: 'yolo',
    descriptionKey: 'settings.integrations.commands.desc.yolo',
    category: 'model',
    platforms: ['discord', 'telegram'],
    suggested: true,
    nativeSlash: true,
  },
  {
    name: 'permissions',
    descriptionKey: 'settings.integrations.commands.desc.permissions',
    category: 'model',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
  {
    name: 'skill',
    descriptionKey: 'settings.integrations.commands.desc.skill',
    category: 'model',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
  {
    name: 'login',
    descriptionKey: 'settings.integrations.commands.desc.login',
    category: 'model',
    platforms: ['discord', 'telegram'],
    suggested: true,
    nativeSlash: true,
  },
  {
    name: 'session',
    descriptionKey: 'settings.integrations.commands.desc.session',
    category: 'chat',
    platforms: ['discord', 'telegram'],
    suggested: true,
    nativeSlash: true,
    discordExample: '/session prompt:Fix the login form validation',
    telegramExample: '/session Fix the login form validation',
  },
  {
    name: 'resume',
    descriptionKey: 'settings.integrations.commands.desc.resume',
    category: 'chat',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
  {
    name: 'fork',
    descriptionKey: 'settings.integrations.commands.desc.fork',
    category: 'chat',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
  {
    name: 'queue',
    descriptionKey: 'settings.integrations.commands.desc.queue',
    category: 'queue',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
  {
    name: 'clear-queue',
    descriptionKey: 'settings.integrations.commands.desc.clearQueue',
    category: 'queue',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
  {
    name: 'mention-mode',
    descriptionKey: 'settings.integrations.commands.desc.mentionMode',
    category: 'queue',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
  {
    name: 'diff',
    descriptionKey: 'settings.integrations.commands.desc.diff',
    category: 'git',
    platforms: ['discord', 'telegram'],
    suggested: true,
    nativeSlash: true,
  },
  {
    name: 'critique',
    descriptionKey: 'settings.integrations.commands.desc.critique',
    category: 'git',
    platforms: ['discord', 'telegram'],
    suggested: true,
    nativeSlash: true,
    example: '/critique on',
  },
  {
    name: 'usage',
    descriptionKey: 'settings.integrations.commands.desc.usage',
    category: 'chat',
    platforms: ['discord', 'telegram'],
    suggested: true,
    nativeSlash: true,
  },
  {
    name: 'credits',
    descriptionKey: 'settings.integrations.commands.desc.credits',
    category: 'chat',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
  {
    name: 'shell',
    descriptionKey: 'settings.integrations.commands.desc.shell',
    category: 'shell',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
    discordExample: '/shell command:pwd',
    telegramExample: '/shell pwd',
  },
  {
    name: 'new-worktree',
    descriptionKey: 'settings.integrations.commands.desc.newWorktree',
    category: 'git',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
  {
    name: 'merge-worktree',
    descriptionKey: 'settings.integrations.commands.desc.mergeWorktree',
    category: 'git',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
  {
    name: 'share',
    descriptionKey: 'settings.integrations.commands.desc.share',
    category: 'sharing',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
  {
    name: 'schedule',
    descriptionKey: 'settings.integrations.commands.desc.schedule',
    category: 'sharing',
    platforms: ['discord', 'telegram'],
    suggested: true,
    nativeSlash: true,
    example: '/schedule 0 9 * * 1 Weekly standup report',
  },
  {
    name: 'reload-opencode',
    descriptionKey: 'settings.integrations.commands.desc.reloadOpencode',
    category: 'ops',
    platforms: ['discord', 'telegram'],
    nativeSlash: true,
  },
];

export const MESSENGER_COMMAND_CATEGORY_ORDER: MessengerCommandCategory[] = [
  'chat',
  'model',
  'shell',
  'git',
  'queue',
  'ops',
  'sharing',
];

export type DiscordCommandCategory = MessengerCommandCategory;
export type TelegramCommandCategory = MessengerCommandCategory;

export type DiscordCommandEntry = {
  name: string;
  descriptionKey: string;
  category: DiscordCommandCategory;
  suggested?: boolean;
  nativeSlash?: boolean;
  example?: string;
};

export type TelegramCommandEntry = {
  name: string;
  descriptionKey: string;
  category: TelegramCommandCategory;
  suggested?: boolean;
  example?: string;
};

function exampleFor(
  cmd: MessengerCommandEntry,
  platform: MessengerCommandPlatform,
): string | undefined {
  if (platform === 'discord') return cmd.discordExample ?? cmd.example;
  return cmd.telegramExample ?? cmd.example;
}

/** Discord Settings palette list derived from the shared catalog. */
export const DISCORD_COMMANDS: DiscordCommandEntry[] = MESSENGER_COMMANDS.filter((cmd) =>
  cmd.platforms.includes('discord'),
).map((cmd) => ({
  name: cmd.name,
  descriptionKey: platformDescKey(cmd.descriptionKey, 'discord'),
  category: cmd.category,
  suggested: cmd.suggested,
  nativeSlash: cmd.nativeSlash,
  example: exampleFor(cmd, 'discord'),
}));

/** Telegram Settings palette list derived from the shared catalog. */
export const TELEGRAM_COMMANDS: TelegramCommandEntry[] = MESSENGER_COMMANDS.filter((cmd) =>
  cmd.platforms.includes('telegram'),
).map((cmd) => ({
  name: cmd.name,
  descriptionKey: platformDescKey(cmd.descriptionKey, 'telegram'),
  category: cmd.category,
  suggested: cmd.suggested,
  example: exampleFor(cmd, 'telegram'),
}));
