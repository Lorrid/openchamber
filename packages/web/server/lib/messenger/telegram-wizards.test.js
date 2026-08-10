import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTelegramModelWizard } from './telegram-model-wizard.js';
import { createTelegramCommandWizards } from './telegram-command-wizards.js';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

describe('telegram model wizard', () => {
  let originalFetch;
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    originalFetch = undefined;
    vi.restoreAllMocks();
  });

  it('posts an inline-keyboard provider menu for bare /model and never calls the agent', async () => {
    originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const method = String(url).split('/').pop();
      const body = init?.body ? JSON.parse(init.body) : {};
      calls.push({ method, body });
      if (method === 'sendMessage') {
        return jsonResponse({ ok: true, result: { message_id: 55 } });
      }
      return jsonResponse({ ok: true, result: true });
    });

    const routeInbound = vi.fn();
    const bridge = {
      routeInbound,
      fetchProviders: async () => ({
        all: [
          {
            id: 'anthropic',
            name: 'Anthropic',
            models: [{ id: 'claude-sonnet-4', name: 'Claude Sonnet 4', limit: { context: 200000 } }],
          },
        ],
        connected: ['anthropic'],
      }),
      getFavoriteModels: async () => [],
      getHiddenModels: async () => [],
      getSurfaceModelInfo: async () => ({ model: null }),
    };

    const wizard = createTelegramModelWizard({ bridge });
    const state = { token: 'tok' };
    await wizard.start(state, { chatId: '-1001', threadId: 9, from: { id: '42' } });

    expect(routeInbound).not.toHaveBeenCalled();
    const sent = calls.find((c) => c.method === 'sendMessage');
    expect(sent.body.text).toContain('Set model');
    expect(sent.body.message_thread_id).toBe(9);
    const keyboard = sent.body.reply_markup?.inline_keyboard;
    expect(Array.isArray(keyboard)).toBe(true);
    expect(keyboard[0][0].callback_data).toMatch(/^oc-mp:/);
    expect(keyboard[0][0].text).toContain('Anthropic');
  });

  it('owns provider/model/scope callback prefixes', () => {
    const wizard = createTelegramModelWizard({ bridge: {} });
    expect(wizard.ownsCallback('oc-mp:abcdef:0')).toBe(true);
    expect(wizard.ownsCallback('oc-mm:abcdef:1')).toBe(true);
    expect(wizard.ownsCallback('openchamber-agent-approve:x')).toBe(false);
  });
});

describe('telegram command wizards', () => {
  let originalFetch;
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    originalFetch = undefined;
    vi.restoreAllMocks();
  });

  it('posts a verbosity menu without routing to the agent', async () => {
    originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const method = String(url).split('/').pop();
      const body = init?.body ? JSON.parse(init.body) : {};
      calls.push({ method, body });
      return jsonResponse({ ok: true, result: { message_id: 1 } });
    });

    const wizards = createTelegramCommandWizards({
      bridge: { routeInbound: vi.fn(), store: {} },
    });
    await wizards.startVerbosity({ token: 'tok' }, { chatId: '42' });
    const sent = calls.find((c) => c.method === 'sendMessage');
    expect(sent.body.text).toContain('verbosity');
    expect(sent.body.reply_markup.inline_keyboard.some((row) =>
      row.some((btn) => String(btn.callback_data).startsWith('oc-vl:')),
    )).toBe(true);
  });
});
