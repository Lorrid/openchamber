import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  parseTelegramRetryAfterMs,
  telegramApiWithRetry,
} from './telegram-api.js';

describe('parseTelegramRetryAfterMs', () => {
  it('reads parameters.retry_after seconds', () => {
    expect(parseTelegramRetryAfterMs({ parameters: { retry_after: 34 } }, 429)).toBe(34_000);
  });

  it('parses retry after from description text', () => {
    expect(
      parseTelegramRetryAfterMs(
        { description: 'Too Many Requests: retry after 12' },
        429,
      ),
    ).toBe(12_000);
  });

  it('returns a default when status is 429 without details', () => {
    expect(parseTelegramRetryAfterMs({}, 429)).toBe(5_000);
  });
});

describe('telegramApiWithRetry', () => {
  let originalFetch;
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    originalFetch = undefined;
    vi.restoreAllMocks();
  });

  it('waits for retry_after and retries until success', async () => {
    originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          json: async () => ({
            ok: false,
            error_code: 429,
            description: 'Too Many Requests: retry after 1',
            parameters: { retry_after: 1 },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 9 } }),
      };
    });
    const sleep = vi.fn(async () => {});
    const result = await telegramApiWithRetry('tok', 'sendMessage', { chat_id: 1, text: 'hi' }, {
      sleep,
      maxRetries: 3,
    });
    expect(result.ok).toBe(true);
    expect(result.body.result.message_id).toBe(9);
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });
});
