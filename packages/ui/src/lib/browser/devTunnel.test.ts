import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let apiBaseUrl = 'https://remote.example.test';

mock.module('@/lib/desktopNative', () => ({
  invokeDesktopCommand: mock(async () => ({ localPort: 52418, reused: false })),
}));
mock.module('@/lib/runtime-auth', () => ({
  getRuntimeBearerTokenSync: () => 'token',
  getRuntimeExtraHeadersSync: () => ({}),
}));
mock.module('@/lib/runtime-switch', () => ({
  getRuntimeApiBaseUrl: () => apiBaseUrl,
  subscribeRuntimeEndpointChanged: () => () => {},
}));

const { resolveBrowsableUrl, shouldTunnelLoopbackUrl, toDisplayUrl } = await import('./devTunnel');

const globalScope = globalThis as unknown as { window?: unknown };

const asDesktop = (value: boolean) => {
  globalScope.window = value
    ? { __OPENCHAMBER_ELECTRON__: true, location: { href: 'http://127.0.0.1:3901/' } }
    : { location: { href: 'http://127.0.0.1:3901/' } };
};

describe('loopback navigations against a remote instance', () => {
  beforeEach(() => {
    apiBaseUrl = 'https://remote.example.test';
    asDesktop(true);
  });

  afterEach(() => {
    delete globalScope.window;
  });

  test('a page reached through a tunnel keeps its other ports on the host', () => {
    expect(shouldTunnelLoopbackUrl('http://localhost:4322/docs/')).toBe(true);
  });

  test('a tunnel port is this machine on purpose and is left alone', async () => {
    const tunneled = await resolveBrowsableUrl('http://localhost:3000/');
    expect(tunneled).toBe('http://127.0.0.1:52418/');
    // Following a link inside the tunnelled page must not tunnel the tunnel.
    expect(shouldTunnelLoopbackUrl(tunneled)).toBe(false);
    // And the address bar still shows what was asked for.
    expect(toDisplayUrl(tunneled)).toBe('http://localhost:3000/');
  });

  test('a public address is not loopback at all', () => {
    expect(shouldTunnelLoopbackUrl('https://openchamber.dev/docs/')).toBe(false);
  });

  test('a local instance resolves its own loopback correctly', () => {
    apiBaseUrl = 'http://127.0.0.1:3901';
    expect(shouldTunnelLoopbackUrl('http://localhost:4322/docs/')).toBe(false);
  });

  test('nothing is tunneled outside the desktop shell', () => {
    asDesktop(false);
    expect(shouldTunnelLoopbackUrl('http://localhost:4322/docs/')).toBe(false);
  });
});
