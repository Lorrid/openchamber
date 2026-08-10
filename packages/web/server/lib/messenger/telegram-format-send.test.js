import { describe, expect, it, vi, afterEach } from 'vitest';
import { sendTelegramMessage, editTelegramMessageText } from './telegram-api.js';

describe('sendTelegramMessage HTML formatting', () => {
  let originalFetch;
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    originalFetch = undefined;
  });

  it('sends Discord markdown as Telegram HTML with parse_mode', async () => {
    const calls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 42 } }),
      };
    });

    const result = await sendTelegramMessage({
      token: 'tok',
      chatId: 1,
      text: '⬦ **bash** `ls`',
    });

    expect(result).toEqual({ ok: true, messageId: 42 });
    expect(calls).toHaveLength(1);
    expect(calls[0].body.parse_mode).toBe('HTML');
    expect(calls[0].body.text).toBe('⬦ <b>bash</b> <code>ls</code>');
  });

  it('falls back to plain text when Telegram rejects HTML entities', async () => {
    const calls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url, init = {}) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      if (body.parse_mode === 'HTML') {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            ok: false,
            error_code: 400,
            description: "Bad Request: can't parse entities: unsupported start tag",
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 7 } }),
      };
    });

    const result = await sendTelegramMessage({
      token: 'tok',
      chatId: 1,
      text: '**hello**',
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].parse_mode).toBe('HTML');
    expect(calls[1].parse_mode).toBeUndefined();
    expect(calls[1].text).toBe('**hello**');
  });

  it('skips conversion when parseMode is false', async () => {
    const calls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url, init = {}) => {
      calls.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 1 } }),
      };
    });

    await sendTelegramMessage({
      token: 'tok',
      chatId: 1,
      text: '**raw**',
      parseMode: false,
    });

    expect(calls[0].parse_mode).toBeUndefined();
    expect(calls[0].text).toBe('**raw**');
  });
});

describe('editTelegramMessageText HTML formatting', () => {
  let originalFetch;
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    originalFetch = undefined;
  });

  it('edits with HTML parse_mode', async () => {
    const calls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url, init = {}) => {
      calls.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: {} }),
      };
    });

    await editTelegramMessageText({
      token: 'tok',
      chatId: 1,
      messageId: 9,
      text: '**Done**',
    });

    expect(calls[0].parse_mode).toBe('HTML');
    expect(calls[0].text).toBe('<b>Done</b>');
  });
});
