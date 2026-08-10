import { afterEach, describe, expect, test } from 'bun:test';
import http from 'node:http';
import net from 'node:net';

import { createDevTunnelClient } from './client.js';
import { createDevTunnelRuntime, isDevTunnelPath } from './runtime.js';

/**
 * These exercise the real socket path end to end: a dev server, an OpenChamber
 * host tunnelling to it, and a client binding a local port. Anything less would
 * not prove the thing that matters — that a page loads over the tunnel exactly
 * as it does locally.
 */

const started = [];

const listen = (server, host = '127.0.0.1') => new Promise((resolve) => {
  server.listen(0, host, () => resolve(server.address().port));
});

const trackSockets = (server) => {
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return sockets;
};

const stopServer = (server, sockets) => async () => {
  for (const socket of sockets) {
    socket.destroy();
  }
  await new Promise((resolve) => server.close(resolve));
};

const startDevServer = async (handler) => {
  const server = http.createServer(handler);
  const sockets = trackSockets(server);
  const port = await listen(server);
  started.push(stopServer(server, sockets));
  return port;
};

const startHost = async ({ allowedPorts }) => {
  const server = http.createServer((_req, res) => res.end('host'));
  const sockets = trackSockets(server);
  const port = await listen(server);
  const runtime = createDevTunnelRuntime({
    server,
    discoverDevServers: async () => ({
      ok: true,
      servers: allowedPorts.map((value) => ({ port: value, url: `http://localhost:${value}/`, command: 'node', pid: 1 })),
    }),
    uiAuthController: { enabled: false },
    isRequestOriginAllowed: async () => true,
    rejectWebSocketUpgrade: (socket, status, message) => {
      socket.write(`HTTP/1.1 ${status} ${message}\r\n\r\n`);
      socket.destroy();
    },
    logger: { warn: () => {} },
  });
  started.push(async () => {
    runtime.dispose();
    await stopServer(server, sockets)();
  });
  return { port, baseUrl: `http://127.0.0.1:${port}`, runtime };
};

const httpGet = (port, path = '/') => new Promise((resolve, reject) => {
  const request = http.get({ host: '127.0.0.1', port, path }, (response) => {
    let body = '';
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }));
  });
  request.on('error', reject);
  request.setTimeout(5_000, () => request.destroy(new Error('timeout')));
});

afterEach(async () => {
  while (started.length) {
    const stop = started.pop();
    await stop();
  }
});

describe('dev tunnel path matching', () => {
  test('only claims its own upgrade path', () => {
    expect(isDevTunnelPath('/api/dev-tunnel?port=5173')).toBe(true);
    expect(isDevTunnelPath('/api/terminal/ws')).toBe(false);
    expect(isDevTunnelPath('')).toBe(false);
  });
});

describe('dev tunnel end to end', () => {
  test('serves the dev server through a local port, unmodified', async () => {
    const devPort = await startDevServer((req, res) => {
      res.setHeader('content-type', 'text/html');
      res.setHeader('x-dev-header', 'kept');
      res.end(`<html><body>path:${req.url}</body></html>`);
    });
    const host = await startHost({ allowedPorts: [devPort] });

    const client = createDevTunnelClient({ logger: { warn: () => {} } });
    started.push(() => client.closeAll());
    const { localPort } = await client.open({ baseUrl: host.baseUrl, port: devPort });

    const response = await httpGet(localPort, '/some/page?q=1');
    expect(response.status).toBe(200);
    expect(response.body).toBe('<html><body>path:/some/page?q=1</body></html>');
    expect(response.headers['x-dev-header']).toBe('kept');
  });

  test('reuses one listener for repeat opens of the same target', async () => {
    const devPort = await startDevServer((_req, res) => res.end('ok'));
    const host = await startHost({ allowedPorts: [devPort] });
    const client = createDevTunnelClient({ logger: { warn: () => {} } });
    started.push(() => client.closeAll());

    const first = await client.open({ baseUrl: host.baseUrl, port: devPort });
    const second = await client.open({ baseUrl: host.baseUrl, port: devPort });

    expect(second.localPort).toBe(first.localPort);
    expect(second.reused).toBe(true);
  });

  test('refuses a port discovery does not report, so it is not a loopback proxy', async () => {
    const secret = await startDevServer((_req, res) => res.end('secret service'));
    const host = await startHost({ allowedPorts: [] });
    const client = createDevTunnelClient({ logger: { warn: () => {} } });
    started.push(() => client.closeAll());

    const { localPort } = await client.open({ baseUrl: host.baseUrl, port: secret });
    await expect(httpGet(localPort, '/')).rejects.toThrow();
  });

  test('closing a tunnel frees its local port', async () => {
    const devPort = await startDevServer((_req, res) => res.end('ok'));
    const host = await startHost({ allowedPorts: [devPort] });
    const client = createDevTunnelClient({ logger: { warn: () => {} } });

    const { localPort } = await client.open({ baseUrl: host.baseUrl, port: devPort });
    expect(client.close({ baseUrl: host.baseUrl, port: devPort })).toBe(true);
    expect(client.list()).toEqual([]);

    // The port is free again: binding it back succeeds.
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(localPort, '127.0.0.1', resolve);
    });
    await new Promise((resolve) => probe.close(resolve));
  });

  test('rejects an invalid remote port before binding anything', async () => {
    const client = createDevTunnelClient({ logger: { warn: () => {} } });
    await expect(client.open({ baseUrl: 'http://127.0.0.1:1', port: 0 })).rejects.toThrow('valid remote port');
    await expect(client.open({ baseUrl: '', port: 5173 })).rejects.toThrow('base URL');
    expect(client.list()).toEqual([]);
  });

  // Not covered here: recovery after a request the dev server kills mid-flight.
  // The behaviour is real (each connection tears down independently), but the
  // abandoned socket makes this harness's teardown unreliable, and a flaky test
  // is worse than a documented gap. Verify it by hand against a restarting dev
  // server.
});
