/**
 * Makes a remote dev server browsable from the desktop app.
 *
 * A URL like `http://localhost:5173` means "this machine" to whoever resolves
 * it. When OpenChamber is running on another host, that is the wrong machine:
 * the dev server is on the host, the browser is here. The desktop shell binds
 * an equivalent local port and pipes it to the host, so the same page loads
 * from a real local origin with nothing rewritten.
 *
 * Everywhere else — local runtime, web, mobile — the URL is already correct and
 * is returned untouched.
 */
import { invokeDesktopCommand } from '@/lib/desktopNative';
import { getRuntimeBearerTokenSync, getRuntimeExtraHeadersSync } from '@/lib/runtime-auth';
import { getRuntimeApiBaseUrl, subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';
import { isLoopbackUrl } from './url';

type TunnelResult = { localPort: number; reused: boolean; url: string };

/** Keyed by `${baseUrl}|${port}`; the shell owns the real lifetime. */
const localPortByTarget = new Map<string, number>();
/** Reverse map, so a tunnel port never leaks into the address bar or storage. */
const originByLocalPort = new Map<number, string>();

const isDesktopRuntime = (): boolean => (
  typeof window !== 'undefined' && Boolean(window.__OPENCHAMBER_ELECTRON__)
);

/**
 * True when the app is talking to an OpenChamber on another machine. A local
 * runtime resolves loopback URLs correctly on its own and must not be tunneled,
 * which would only add a hop.
 */
const isRemoteRuntime = (baseUrl: string): boolean => {
  if (!baseUrl) return false;
  try {
    const parsed = new URL(baseUrl, typeof window !== 'undefined' ? window.location.href : undefined);
    const localOrigin = typeof window !== 'undefined' ? window.__OPENCHAMBER_LOCAL_ORIGIN__ : '';
    if (localOrigin && parsed.origin === localOrigin) return false;
    return !isLoopbackUrl(parsed.toString());
  } catch {
    return false;
  }
};

const rewriteToLocalPort = (url: string, localPort: number): string => {
  try {
    const parsed = new URL(url);
    parsed.protocol = 'http:';
    parsed.hostname = '127.0.0.1';
    parsed.port = String(localPort);
    return parsed.toString();
  } catch {
    return url;
  }
};

/**
 * Returns the URL the browser view should actually load.
 *
 * A tunnel failure returns the original URL rather than throwing: the page will
 * simply fail to load, which is the same outcome the user would get without
 * this mechanism, and it keeps a broken tunnel from blocking navigation to
 * URLs that need no tunnel at all.
 */
export const resolveBrowsableUrl = async (url: string): Promise<string> => {
  if (!url || !isDesktopRuntime() || !isLoopbackUrl(url)) return url;

  const baseUrl = getRuntimeApiBaseUrl();
  if (!isRemoteRuntime(baseUrl)) return url;

  let port = 0;
  try {
    const parsed = new URL(url);
    port = Number.parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), 10);
  } catch {
    return url;
  }
  if (!Number.isInteger(port) || port <= 0) return url;

  const key = `${baseUrl}|${port}`;
  const cached = localPortByTarget.get(key);
  if (cached) {
    try {
      originByLocalPort.set(cached, new URL(url).origin);
    } catch {
      // Unparseable input never reaches here; nothing to record.
    }
    return rewriteToLocalPort(url, cached);
  }

  try {
    const result = await invokeDesktopCommand<TunnelResult>('desktop_dev_tunnel_open', {
      baseUrl,
      port,
      clientToken: getRuntimeBearerTokenSync(),
      requestHeaders: getRuntimeExtraHeadersSync(),
    });
    if (!result || !Number.isInteger(result.localPort) || result.localPort <= 0) return url;
    localPortByTarget.set(key, result.localPort);
    try {
      originByLocalPort.set(result.localPort, new URL(url).origin);
    } catch {
      // Unparseable input never reaches here; nothing to record.
    }
    return rewriteToLocalPort(url, result.localPort);
  } catch {
    return url;
  }
};

/**
 * Maps a URL the view actually loaded back to the address the user asked for.
 *
 * Without this the tunnel's random local port would show up in the address bar
 * and, worse, be persisted as the tab's target — a port that means nothing
 * after a restart.
 */
export const toDisplayUrl = (url: string): string => {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1') return url;
    const origin = originByLocalPort.get(Number.parseInt(parsed.port || '0', 10));
    if (!origin) return url;
    return `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
};

/**
 * Forgets cached tunnels. Cache entries are keyed by runtime base URL, so a
 * switch does not make them wrong — but the shell's listeners belong to the
 * previous endpoint, and holding their ports would keep resolving URLs to a
 * host the user has left.
 */
const resetDevTunnelCache = (): void => {
  localPortByTarget.clear();
  originByLocalPort.clear();
};

if (typeof window !== 'undefined') {
  subscribeRuntimeEndpointChanged(resetDevTunnelCache);
}
