import type { LinearAPI } from '@/lib/api/types';
import { isElectronShell } from '@/lib/desktop';
import { getLocalDesktopOrigin } from '@/lib/desktopCurrentHost';

function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Origin Linear comments should open. Packaged desktop UI lives on
 * `openchamber-ui://`, which is not a URL a browser can load from Linear, so
 * prefer the loopback origin the local server actually listens on.
 */
export function resolveLinearSessionOrigin(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  if (isElectronShell()) {
    const localOrigin = getLocalDesktopOrigin().trim();
    if (localOrigin && isHttpOrigin(localOrigin)) {
      return new URL(localOrigin).origin;
    }
    return 'openchamber:';
  }
  const origin = window.location.origin.trim();
  return origin || undefined;
}

export function postLinearSessionStarted(
  linear: LinearAPI | undefined,
  args: { sessionId: string; issueIdentifier: string; sessionTitle?: string },
): void {
  if (!linear?.sessionStatusPost) return;
  void linear.sessionStatusPost({
    kind: 'started',
    sessionId: args.sessionId,
    issueIdentifier: args.issueIdentifier,
    sessionOrigin: resolveLinearSessionOrigin(),
    sessionTitle: args.sessionTitle,
  }).catch(() => undefined);
}
