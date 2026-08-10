/**
 * Client half of agent browser control.
 *
 * The server broadcasts a browser request to every connected client, because it
 * cannot know which one is showing the browser panel. Exactly one client should
 * answer, so a request is only handled when this client currently owns a
 * browser view; otherwise it is ignored and another client (or the timeout)
 * decides the outcome.
 *
 * `browser.open` is the exception: it is handled even with no view attached,
 * since opening a tab is precisely what creates one.
 */
import { runtimeFetch } from '@/lib/runtime-fetch';
import { subscribeOpenchamberEvents } from '@/lib/openchamberEvents';

export type BrowserControlRequest = {
  readonly requestId: string;
  readonly action: string;
  readonly parameters: Record<string, unknown>;
};

/** Implemented by the mounted browser pane. */
export type BrowserController = {
  /** Runs one action and resolves with its JSON-serializable result. */
  readonly run: (action: string, parameters: Record<string, unknown>) => Promise<unknown>;
};

/** Opens a URL when no browser view exists yet. */
export type BrowserOpener = (url: string) => void;

let activeController: BrowserController | null = null;
let opener: BrowserOpener | null = null;
let unsubscribe: (() => void) | null = null;

const postResult = async (requestId: string, outcome: { ok: boolean; data?: unknown; error?: string }): Promise<void> => {
  try {
    await runtimeFetch('/api/browser-control/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, ...outcome }),
    });
  } catch {
    // The request will time out on the server; there is nothing better to do
    // from here, and retrying could deliver a result after a later request
    // reused the id.
  }
};

const handleRequest = async (request: BrowserControlRequest): Promise<void> => {
  const isOpen = request.action === 'browser.open';
  const controller = activeController;

  if (!controller && !(isOpen && opener)) return;

  try {
    if (isOpen && !controller) {
      const url = typeof request.parameters.url === 'string' ? request.parameters.url : '';
      if (!url) {
        await postResult(request.requestId, { ok: false, error: 'url is required' });
        return;
      }
      opener?.(url);
      await postResult(request.requestId, { ok: true, data: { url, opened: true } });
      return;
    }

    const data = await controller!.run(request.action, request.parameters);
    await postResult(request.requestId, { ok: true, data });
  } catch (error) {
    await postResult(request.requestId, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const ensureSubscribed = (): void => {
  if (unsubscribe) return;
  unsubscribe = subscribeOpenchamberEvents((event) => {
    if (event.type !== 'browser-control-request') return;
    void handleRequest({
      requestId: event.requestId,
      action: event.action,
      parameters: event.parameters,
    });
  });
};

const releaseIfIdle = (): void => {
  if (activeController || opener || !unsubscribe) return;
  unsubscribe();
  unsubscribe = null;
};

/**
 * Registers the mounted browser view. The most recently mounted view wins;
 * unregistering only clears the registry when it still points at the caller,
 * so a stale unmount cannot detach a newer view.
 */
export const registerBrowserController = (controller: BrowserController): (() => void) => {
  activeController = controller;
  ensureSubscribed();
  return () => {
    if (activeController === controller) activeController = null;
    releaseIfIdle();
  };
};

/** Registers the app-level fallback that can open a browser tab on demand. */
export const registerBrowserOpener = (open: BrowserOpener): (() => void) => {
  opener = open;
  ensureSubscribed();
  return () => {
    if (opener === open) opener = null;
    releaseIfIdle();
  };
};
