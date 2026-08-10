/**
 * Client for dev-server discovery.
 *
 * The result is a tagged union rather than an array, because "no dev server is
 * running" and "we could not look" lead to different UI and must not collapse
 * into the same empty list.
 */
import { runtimeFetch } from '@/lib/runtime-fetch';

export type DiscoveredDevServer = {
  readonly port: number;
  readonly url: string;
  readonly command: string;
};

export type DevServerDiscovery =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly servers: ReadonlyArray<DiscoveredDevServer> }
  | { readonly kind: 'unavailable' };

const isDiscoveredServer = (value: unknown): value is DiscoveredDevServer => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.port === 'number'
    && Number.isFinite(record.port)
    && typeof record.url === 'string'
    && record.url.length > 0
    && typeof record.command === 'string';
};

export const fetchDevServers = async (signal?: AbortSignal): Promise<DevServerDiscovery> => {
  try {
    const response = await runtimeFetch('/api/dev-servers', { signal });
    if (!response.ok) return { kind: 'unavailable' };

    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return { kind: 'unavailable' };

    const servers = (body as { servers?: unknown }).servers;
    if (!Array.isArray(servers)) return { kind: 'unavailable' };

    return { kind: 'ready', servers: servers.filter(isDiscoveredServer) };
  } catch {
    return { kind: 'unavailable' };
  }
};
