import { describe, expect, test } from 'bun:test';

import { BrowserControlError, createBrowserControlBroker } from './broker.js';

const createBroker = (options = {}) => {
  const emitted = [];
  let sequence = 0;
  const broker = createBrowserControlBroker({
    emitRequest: (payload) => {
      emitted.push(payload);
      return options.listeners ?? 1;
    },
    createId: () => {
      sequence += 1;
      return `req-${sequence}`;
    },
    ...options.overrides,
  });
  return { broker, emitted };
};

describe('browser control broker', () => {
  test('resolves with the data the client posted back', async () => {
    const { broker, emitted } = createBroker();
    const inflight = broker.request('browser.snapshot', {});
    expect(emitted[0]?.action).toBe('browser.snapshot');

    broker.resolve(emitted[0].requestId, { ok: true, data: { url: 'http://localhost:5173/' } });
    expect(await inflight).toEqual({ url: 'http://localhost:5173/' });
  });

  test('fails fast when no client is connected instead of blocking', async () => {
    const { broker } = createBroker({ listeners: 0 });
    await expect(broker.request('browser.open', { url: 'http://a/' })).rejects.toThrow(BrowserControlError);
  });

  test('says the browser is unreachable rather than that the action failed', async () => {
    const { broker } = createBroker({ listeners: 0 });
    try {
      await broker.request('browser.open', {});
      throw new Error('expected rejection');
    } catch (error) {
      expect(error.status).toBe(503);
      expect(error.message).toContain('client is connected');
    }
  });

  test('surfaces a client-reported failure with its message', async () => {
    const { broker, emitted } = createBroker();
    const inflight = broker.request('browser.click', { selector: '#missing' });
    broker.resolve(emitted[0].requestId, { ok: false, error: 'No element matches #missing' });
    await expect(inflight).rejects.toThrow('No element matches #missing');
  });

  test('times out when the client accepted the request and never answered', async () => {
    let fire = null;
    const { broker } = createBroker({
      overrides: {
        setTimer: (callback) => { fire = callback; return 1; },
        clearTimer: () => {},
      },
    });
    const inflight = broker.request('browser.snapshot', {}, { timeoutMs: 5_000 });
    fire();
    await expect(inflight).rejects.toThrow('did not respond within 5s');
  });

  test('ignores a late response that lost the race with the timeout', async () => {
    let fire = null;
    const { broker, emitted } = createBroker({
      overrides: {
        setTimer: (callback) => { fire = callback; return 1; },
        clearTimer: () => {},
      },
    });
    const inflight = broker.request('browser.snapshot', {});
    fire();
    await expect(inflight).rejects.toThrow();
    expect(broker.resolve(emitted[0].requestId, { ok: true, data: {} })).toBe(false);
  });

  test('rejects an unknown request id without throwing', () => {
    const { broker } = createBroker();
    expect(broker.resolve('nope', { ok: true })).toBe(false);
    expect(broker.resolve('', { ok: true })).toBe(false);
  });

  test('clears pending state once a request settles', async () => {
    const { broker, emitted } = createBroker();
    const inflight = broker.request('browser.snapshot', {});
    expect(broker.pendingCount).toBe(1);
    broker.resolve(emitted[0].requestId, { ok: true, data: null });
    await inflight;
    expect(broker.pendingCount).toBe(0);
  });

  test('fails everything in flight when the owning client disconnects', async () => {
    const { broker } = createBroker();
    const inflight = broker.request('browser.snapshot', {});
    broker.rejectAll('The OpenChamber client disconnected');
    await expect(inflight).rejects.toThrow('disconnected');
    expect(broker.pendingCount).toBe(0);
  });

  test('propagates cancellation from the caller', async () => {
    const { broker } = createBroker();
    const controller = new AbortController();
    const inflight = broker.request('browser.snapshot', {}, { signal: controller.signal });
    controller.abort();
    await expect(inflight).rejects.toThrow('cancelled');
  });

  test('rejects immediately when the caller is already cancelled', async () => {
    const { broker } = createBroker();
    const controller = new AbortController();
    controller.abort();
    await expect(broker.request('browser.snapshot', {}, { signal: controller.signal })).rejects.toThrow('cancelled');
  });
});
