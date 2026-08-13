import { describe, expect, it, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createMessengerSyncRouter } from './messenger-sync.js';

// Covers project ↔ messenger surface parity: auto-create on project add (not
// only "Sync now"), rename, and remove — for both Discord channels and
// Telegram forum topics — plus the mute contract (a disabled integration or
// a muted server/chat must not create, rename, or delete anything).

const DISCORD_TOKEN = 'discord-bot-token';
const TELEGRAM_TOKEN = 'telegram-bot-token';
const GUILD = '111111111111111111';
const CHANNEL = '222222222222222222';
const CHAT = '-1009876543210';
const PROJECT = { id: 'proj-1', path: '/home/user/proj', label: 'My Project' };

function createApp({ readSettings, persistSettings } = {}) {
  const app = express();
  const { router } = createMessengerSyncRouter({ readSettings, persistSettings });
  app.use('/api/messenger', router);
  return app;
}

function jsonResponse(data, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  };
}

let fetchCalls = [];
let originalFetch;
function stubFetch(handler) {
  fetchCalls = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });
    return handler(String(url), init);
  });
}

afterEach(() => {
  if (originalFetch) globalThis.fetch = originalFetch;
  originalFetch = undefined;
  vi.restoreAllMocks();
});

/** Standard fetch handler covering the Discord + Telegram calls these flows make. */
function standardHandler({
  discordChannels = [],
  telegramChat = { type: 'supergroup', is_forum: true },
  canManageTopics = true,
} = {}) {
  return (url, init) => {
    if (url.includes(`/guilds/${GUILD}/channels`) && (!init.method || init.method === 'GET')) {
      return jsonResponse(discordChannels);
    }
    if (url.includes(`/guilds/${GUILD}/channels`) && init.method === 'POST') {
      const body = JSON.parse(init.body);
      return jsonResponse({ id: CHANNEL, name: body.name });
    }
    if (url.includes(`/channels/${CHANNEL}`) && init.method === 'PATCH') {
      const body = JSON.parse(init.body);
      return jsonResponse({ id: CHANNEL, name: body.name });
    }
    if (url.includes(`/channels/${CHANNEL}`) && init.method === 'DELETE') {
      return jsonResponse({});
    }
    if (url.includes(`/channels/${CHANNEL}`) && (!init.method || init.method === 'GET')) {
      return jsonResponse({ id: CHANNEL, name: 'old-name', guild_id: GUILD });
    }
    if (url.includes(`api.telegram.org/bot${TELEGRAM_TOKEN}/getMe`)) {
      return jsonResponse({ ok: true, result: { id: 999, username: 'bot' } });
    }
    // Check the more specific `getChatMember` before `getChat` — the latter
    // is a substring of the former.
    if (url.includes(`api.telegram.org/bot${TELEGRAM_TOKEN}/getChatMember`)) {
      return jsonResponse({
        ok: true,
        result: { status: 'administrator', can_manage_topics: canManageTopics },
      });
    }
    if (url.includes(`api.telegram.org/bot${TELEGRAM_TOKEN}/getChat`)) {
      return jsonResponse({ ok: true, result: telegramChat });
    }
    if (url.includes(`api.telegram.org/bot${TELEGRAM_TOKEN}/createForumTopic`)) {
      return jsonResponse({ ok: true, result: { message_thread_id: 42, name: 'My Project' } });
    }
    if (url.includes(`api.telegram.org/bot${TELEGRAM_TOKEN}/editForumTopic`)) {
      return jsonResponse({ ok: true, result: true });
    }
    if (url.includes(`api.telegram.org/bot${TELEGRAM_TOKEN}/deleteForumTopic`)) {
      return jsonResponse({ ok: true, result: true });
    }
    throw new Error(`unexpected url ${url}`);
  };
}

describe('POST /bridge/project-added — auto-create on project creation', () => {
  it('creates a Discord channel AND a Telegram forum topic when both platforms opt into sync', async () => {
    const persistSettings = vi.fn(async () => {});
    const readSettings = vi.fn(async () => ({
      discord: {
        botToken: DISCORD_TOKEN,
        guildPolicies: { [GUILD]: { enabled: true, syncProjects: true } },
      },
      telegram: {
        botToken: TELEGRAM_TOKEN,
        chatPolicies: { [CHAT]: { enabled: true, syncProjects: true } },
      },
    }));
    stubFetch(standardHandler());

    const res = await request(createApp({ readSettings, persistSettings }))
      .post('/api/messenger/bridge/project-added')
      .send({ project: PROJECT });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const discordResult = res.body.results.find((r) => r.type === 'discord');
    const telegramResult = res.body.results.find((r) => r.type === 'telegram');
    expect(discordResult).toMatchObject({ ok: true, channelId: CHANNEL, created: true });
    expect(telegramResult).toMatchObject({ ok: true, chatId: CHAT, messageThreadId: '42', created: true });

    const discordSave = persistSettings.mock.calls.find((c) => c[0].discord)?.[0].discord;
    expect(discordSave.projectBindings).toEqual([
      { channelId: CHANNEL, projectPath: PROJECT.path, projectLabel: PROJECT.label },
    ]);
    const telegramSave = persistSettings.mock.calls.find((c) => c[0].telegram)?.[0].telegram;
    expect(telegramSave.projectBindings).toEqual([
      { chatId: CHAT, projectPath: PROJECT.path, projectLabel: PROJECT.label, messageThreadId: '42' },
    ]);
  });

  it('skips a Discord server muted via guildPolicies[*].enabled === false', async () => {
    const persistSettings = vi.fn(async () => {});
    const readSettings = vi.fn(async () => ({
      discord: {
        botToken: DISCORD_TOKEN,
        guildPolicies: { [GUILD]: { enabled: false, syncProjects: true } },
      },
    }));
    stubFetch(standardHandler());

    const res = await request(createApp({ readSettings, persistSettings }))
      .post('/api/messenger/bridge/project-added')
      .send({ project: PROJECT });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(fetchCalls.length).toBe(0);
  });

  it('skips Telegram entirely while the integration is stopped (listenerEnabled: false)', async () => {
    const readSettings = vi.fn(async () => ({
      telegram: {
        botToken: TELEGRAM_TOKEN,
        listenerEnabled: false,
        chatPolicies: { [CHAT]: { enabled: true, syncProjects: true } },
      },
    }));
    stubFetch(standardHandler());

    const res = await request(createApp({ readSettings }))
      .post('/api/messenger/bridge/project-added')
      .send({ project: PROJECT });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it('falls back to the legacy single guildId pointer when no server opted in explicitly', async () => {
    const persistSettings = vi.fn(async () => {});
    const readSettings = vi.fn(async () => ({
      discord: { botToken: DISCORD_TOKEN, guildId: GUILD },
    }));
    stubFetch(standardHandler());

    const res = await request(createApp({ readSettings, persistSettings }))
      .post('/api/messenger/bridge/project-added')
      .send({ project: PROJECT });

    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ type: 'discord', ok: true, channelId: CHANNEL });
  });
});

describe('POST /bridge/project-renamed', () => {
  it('renames both the Discord channel and the Telegram forum topic for an existing binding', async () => {
    const persistSettings = vi.fn(async () => {});
    const readSettings = vi.fn(async () => ({
      discord: {
        botToken: DISCORD_TOKEN,
        guildPolicies: { [GUILD]: { enabled: true } },
        projectBindings: [{ channelId: CHANNEL, projectPath: PROJECT.path, projectLabel: 'Old Name' }],
      },
      telegram: {
        botToken: TELEGRAM_TOKEN,
        chatPolicies: { [CHAT]: { enabled: true } },
        projectBindings: [
          { chatId: CHAT, projectPath: PROJECT.path, projectLabel: 'Old Name', messageThreadId: '42' },
        ],
      },
    }));
    stubFetch(standardHandler());

    const res = await request(createApp({ readSettings, persistSettings }))
      .post('/api/messenger/bridge/project-renamed')
      .send({ project: PROJECT, discord: { token: DISCORD_TOKEN } });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const discordResult = res.body.results.find((r) => r.type === 'discord');
    const telegramResult = res.body.results.find((r) => r.type === 'telegram');
    expect(discordResult).toMatchObject({ ok: true, renamed: true });
    expect(telegramResult).toMatchObject({ ok: true, renamed: true });

    const telegramSave = persistSettings.mock.calls.find((c) => c[0].telegram)?.[0].telegram;
    expect(telegramSave.projectBindings[0].projectLabel).toBe(PROJECT.label);
  });

  it('does not touch a muted chat but still relabels the local binding', async () => {
    const persistSettings = vi.fn(async () => {});
    const readSettings = vi.fn(async () => ({
      telegram: {
        botToken: TELEGRAM_TOKEN,
        chatPolicies: { [CHAT]: { enabled: false } },
        projectBindings: [
          { chatId: CHAT, projectPath: PROJECT.path, projectLabel: 'Old Name', messageThreadId: '42' },
        ],
      },
    }));
    stubFetch(standardHandler());

    const res = await request(createApp({ readSettings, persistSettings }))
      .post('/api/messenger/bridge/project-renamed')
      .send({ project: PROJECT });

    expect(res.status).toBe(200);
    const telegramResult = res.body.results.find((r) => r.type === 'telegram');
    expect(telegramResult).toMatchObject({ ok: true, skipped: 'muted' });
    expect(fetchCalls.some((c) => c.url.includes('editForumTopic'))).toBe(false);
    const telegramSave = persistSettings.mock.calls.find((c) => c[0].telegram)?.[0].telegram;
    expect(telegramSave.projectBindings[0].projectLabel).toBe(PROJECT.label);
  });

  it('creates surfaces when the project has no binding yet', async () => {
    const persistSettings = vi.fn(async () => {});
    const readSettings = vi.fn(async () => ({
      discord: { botToken: DISCORD_TOKEN, guildPolicies: { [GUILD]: { enabled: true, syncProjects: true } } },
    }));
    stubFetch(standardHandler());

    const res = await request(createApp({ readSettings, persistSettings }))
      .post('/api/messenger/bridge/project-renamed')
      .send({ project: PROJECT, discord: { token: DISCORD_TOKEN } });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
    expect(res.body.channelId).toBe(CHANNEL);
  });
});

describe('POST /bridge/project-removed', () => {
  it('deletes both the Discord channel and the Telegram forum topic and drops both bindings', async () => {
    const persistSettings = vi.fn(async () => {});
    const readSettings = vi.fn(async () => ({
      discord: {
        botToken: DISCORD_TOKEN,
        guildPolicies: { [GUILD]: { enabled: true } },
        projectBindings: [{ channelId: CHANNEL, projectPath: PROJECT.path, projectLabel: PROJECT.label }],
      },
      telegram: {
        botToken: TELEGRAM_TOKEN,
        chatPolicies: { [CHAT]: { enabled: true } },
        projectBindings: [
          { chatId: CHAT, projectPath: PROJECT.path, projectLabel: PROJECT.label, messageThreadId: '42' },
        ],
      },
    }));
    stubFetch(standardHandler());

    const res = await request(createApp({ readSettings, persistSettings }))
      .post('/api/messenger/bridge/project-removed')
      .send({ project: { path: PROJECT.path }, discord: { token: DISCORD_TOKEN } });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const discordResult = res.body.results.find((r) => r.type === 'discord');
    const telegramResult = res.body.results.find((r) => r.type === 'telegram');
    expect(discordResult).toMatchObject({ ok: true, deleted: true });
    expect(telegramResult).toMatchObject({ ok: true, deleted: true });

    const discordSave = persistSettings.mock.calls.find((c) => c[0].discord)?.[0].discord;
    expect(discordSave.projectBindings).toBeUndefined();
    const telegramSave = persistSettings.mock.calls.find((c) => c[0].telegram)?.[0].telegram;
    expect(telegramSave.projectBindings).toEqual([]);
  });

  it('leaves a muted chat/server untouched but still drops the local binding', async () => {
    const persistSettings = vi.fn(async () => {});
    const readSettings = vi.fn(async () => ({
      discord: {
        botToken: DISCORD_TOKEN,
        guildPolicies: { [GUILD]: { enabled: false } },
        projectBindings: [{ channelId: CHANNEL, projectPath: PROJECT.path, projectLabel: PROJECT.label }],
      },
    }));
    stubFetch(standardHandler());

    const res = await request(createApp({ readSettings, persistSettings }))
      .post('/api/messenger/bridge/project-removed')
      .send({ project: { path: PROJECT.path }, discord: { token: DISCORD_TOKEN } });

    expect(res.status).toBe(200);
    const discordResult = res.body.results.find((r) => r.type === 'discord');
    expect(discordResult).toMatchObject({ ok: true, deleted: false, skipped: 'muted' });
    expect(fetchCalls.some((c) => c.init.method === 'DELETE')).toBe(false);
    const discordSave = persistSettings.mock.calls.find((c) => c[0].discord)?.[0].discord;
    expect(discordSave.projectBindings).toBeUndefined();
  });
});
