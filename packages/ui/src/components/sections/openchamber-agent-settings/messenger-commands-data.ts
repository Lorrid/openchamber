export type MessengerCommandPlatform = 'discord' | 'telegram';

export const MESSENGER_COMMAND_CATEGORY_ORDER = [
  'chat',
  'model',
  'shell',
  'git',
  'queue',
  'ops',
  'sharing',
] as const;

type MessengerCommandCategory = (typeof MESSENGER_COMMAND_CATEGORY_ORDER)[number];

type MessengerCommandRow = {
  name: string;
  /** Key suffix under settings.integrations.{platform}.commands.desc.* */
  desc: string;
  category: MessengerCommandCategory;
  suggested?: boolean;
  example?: string;
  discordExample?: string;
  telegramExample?: string;
};

export type MessengerCommandEntry = {
  name: string;
  descriptionKey: string;
  category: MessengerCommandCategory;
  suggested?: boolean;
  example?: string;
};

/** Single source of truth for the Discord and Telegram command references. */
export const MESSENGER_COMMANDS: readonly MessengerCommandRow[] = [
  { name: 'help', desc: 'help', category: 'chat' },
  { name: 'status', desc: 'status', category: 'chat', suggested: true },
  { name: 'abort', desc: 'abort', category: 'chat', suggested: true },
  { name: 'new', desc: 'new', category: 'chat' },
  { name: 'undo', desc: 'undo', category: 'chat' },
  { name: 'redo', desc: 'redo', category: 'chat' },
  { name: 'model', desc: 'model', category: 'model', suggested: true },
  { name: 'agent', desc: 'agent', category: 'model' },
  { name: 'verbosity', desc: 'verbosity', category: 'model' },
  { name: 'yolo', desc: 'yolo', category: 'model', suggested: true },
  { name: 'permissions', desc: 'permissions', category: 'model' },
  { name: 'skill', desc: 'skill', category: 'model' },
  { name: 'login', desc: 'login', category: 'model', suggested: true },
  {
    name: 'session',
    desc: 'session',
    category: 'chat',
    suggested: true,
    discordExample: '/session prompt:Fix the login form validation',
    telegramExample: '/session Fix the login form validation',
  },
  { name: 'resume', desc: 'resume', category: 'chat' },
  { name: 'fork', desc: 'fork', category: 'chat' },
  { name: 'queue', desc: 'queue', category: 'queue' },
  { name: 'clear-queue', desc: 'clearQueue', category: 'queue' },
  { name: 'mention-mode', desc: 'mentionMode', category: 'queue' },
  { name: 'diff', desc: 'diff', category: 'git', suggested: true },
  {
    name: 'critique',
    desc: 'critique',
    category: 'git',
    suggested: true,
    example: '/critique on',
  },
  { name: 'usage', desc: 'usage', category: 'chat', suggested: true },
  { name: 'credits', desc: 'credits', category: 'chat' },
  {
    name: 'shell',
    desc: 'shell',
    category: 'shell',
    discordExample: '/shell command:pwd',
    telegramExample: '/shell pwd',
  },
  { name: 'new-worktree', desc: 'newWorktree', category: 'git' },
  { name: 'merge-worktree', desc: 'mergeWorktree', category: 'git' },
  { name: 'share', desc: 'share', category: 'sharing' },
  {
    name: 'schedule',
    desc: 'schedule',
    category: 'sharing',
    suggested: true,
    example: '/schedule 0 9 * * 1 Weekly standup report',
  },
  { name: 'reload-opencode', desc: 'reloadOpencode', category: 'ops' },
];

export function commandsFor(platform: MessengerCommandPlatform): MessengerCommandEntry[] {
  return MESSENGER_COMMANDS.map(
    ({ desc, discordExample, telegramExample, example, ...command }) => ({
      ...command,
      descriptionKey: `settings.integrations.${platform}.commands.desc.${desc}`,
      example: (platform === 'discord' ? discordExample : telegramExample) ?? example,
    }),
  );
}
