import React from 'react';

import { IDLE_NAV_STATUS, type BrowserNavStatus } from '@/lib/browser/contract';

/**
 * Translates `<webview>` lifecycle events into a single navigation status.
 *
 * Chromium reports failures and successes through separate events that can
 * arrive in either order, and it emits `did-fail-load` for sub-resources as
 * well as for the main frame. Both are handled here so the panel only ever
 * sees one authoritative state:
 *
 * - Sub-frame failures are ignored; only the main frame changes the status.
 * - `ERR_ABORTED` is not a failure. It is what Chromium reports when a
 *   navigation is superseded by the next one, and treating it as an error puts
 *   an error screen over a page that is loading perfectly well.
 *
 * Takes the element rather than a ref so the listeners attach when the view
 * actually appears. A ref is stable, so an effect keyed on it runs once — and
 * silently attaches nothing at all when the view mounts a render later.
 *
 * `<webview>` puts its event payload directly on the event object rather than
 * under `detail`, so reading `detail` yields a failure with no code and no
 * description — an error screen that says nothing. Both shapes are read here.
 */

/** Chromium's code for "this navigation was replaced by another one". */
const ERR_ABORTED = -3;

/**
 * `about:blank` is the view's resting state, not somewhere the user went. It
 * arrives through `did-navigate` like any other address, and taking it at face
 * value puts it in the address bar and makes the panel look like it is showing
 * a page — which hides the empty state that would otherwise offer somewhere to
 * go.
 */
const isRealPageUrl = (url: unknown): url is string => (
  typeof url === 'string' && url.length > 0 && url !== 'about:blank'
);

type FailLoadDetail = {
  errorCode?: number;
  errorDescription?: string;
  validatedURL?: string;
  isMainFrame?: boolean;
};

/** Reads a webview event payload, whichever shape this Electron version uses. */
const readEventPayload = <T extends object>(event: Event): Partial<T> => {
  const record = event as unknown as { detail?: unknown };
  if (record.detail && typeof record.detail === 'object') return record.detail as Partial<T>;
  return event as unknown as Partial<T>;
};

export type WebviewNavigation = {
  readonly status: BrowserNavStatus;
  readonly url: string;
  readonly title: string;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
};

export const useWebviewNavigation = (
  webview: WebviewElement | null,
  { initialUrl, onUrlChange }: { initialUrl: string; onUrlChange: (url: string) => void },
): WebviewNavigation => {
  const [status, setStatus] = React.useState<BrowserNavStatus>(
    initialUrl ? { kind: 'loading', url: initialUrl } : IDLE_NAV_STATUS,
  );
  const [url, setUrl] = React.useState(initialUrl);
  const [title, setTitle] = React.useState('');
  const [canGoBack, setCanGoBack] = React.useState(false);
  const [canGoForward, setCanGoForward] = React.useState(false);

  const urlChangeRef = React.useRef(onUrlChange);
  urlChangeRef.current = onUrlChange;

  React.useEffect(() => {
    if (!webview) return;

    const readCurrentUrl = (): string => {
      try {
        const value = webview.getURL();
        return isRealPageUrl(value) ? value : '';
      } catch {
        return '';
      }
    };

    const syncHistory = () => {
      try {
        setCanGoBack(webview.canGoBack());
        setCanGoForward(webview.canGoForward());
      } catch {
        // Webview not attached yet; the next event resyncs.
      }
    };

    const commitUrl = (next: string) => {
      if (!isRealPageUrl(next)) return;
      setUrl(next);
      urlChangeRef.current(next);
    };

    const onStartLoading = () => {
      const current = readCurrentUrl();
      setStatus({ kind: 'loading', url: current });
    };

    const onStopLoading = () => {
      const current = readCurrentUrl();
      let pageTitle = '';
      try {
        pageTitle = webview.getTitle() || '';
      } catch {
        pageTitle = '';
      }
      setTitle(pageTitle);
      commitUrl(current);
      syncHistory();
      // A failure already produced a terminal status; do not overwrite it with
      // the `did-stop-loading` that always follows.
      setStatus((previous) => (
        previous.kind === 'failed' && previous.url === current
          ? previous
          : { kind: 'ready', url: current, title: pageTitle }
      ));
    };

    const onNavigate = (event: Event) => {
      const detail = readEventPayload<{ url?: string }>(event);
      if (isRealPageUrl(detail.url)) {
        commitUrl(detail.url);
        syncHistory();
      }
    };

    const onTitleUpdated = (event: Event) => {
      const detail = readEventPayload<{ title?: string }>(event);
      if (typeof detail.title === 'string') setTitle(detail.title);
    };

    const onFailLoad = (event: Event) => {
      const detail = readEventPayload<FailLoadDetail>(event);
      if (detail.isMainFrame === false) return;
      const code = typeof detail.errorCode === 'number' ? detail.errorCode : 0;
      if (code === ERR_ABORTED) return;
      setStatus({
        kind: 'failed',
        url: isRealPageUrl(detail.validatedURL) ? detail.validatedURL : readCurrentUrl(),
        code,
        description: typeof detail.errorDescription === 'string' ? detail.errorDescription : '',
      });
    };

    webview.addEventListener('did-start-loading', onStartLoading);
    webview.addEventListener('did-stop-loading', onStopLoading);
    webview.addEventListener('did-navigate', onNavigate);
    webview.addEventListener('did-navigate-in-page', onNavigate);
    webview.addEventListener('page-title-updated', onTitleUpdated);
    webview.addEventListener('did-fail-load', onFailLoad);

    // The webview may already be settled by the time this effect runs. Only
    // treat it as settled when a page is actually loaded: a freshly created
    // view reports "not loading" before its guest attaches, and settling on
    // that would declare an empty page ready and hide the real one behind an
    // empty state.
    try {
      if (!webview.isLoading() && readCurrentUrl()) onStopLoading();
    } catch {
      // Not attached yet.
    }

    return () => {
      webview.removeEventListener('did-start-loading', onStartLoading);
      webview.removeEventListener('did-stop-loading', onStopLoading);
      webview.removeEventListener('did-navigate', onNavigate);
      webview.removeEventListener('did-navigate-in-page', onNavigate);
      webview.removeEventListener('page-title-updated', onTitleUpdated);
      webview.removeEventListener('did-fail-load', onFailLoad);
    };
  }, [webview]);

  return { status, url, title, canGoBack, canGoForward };
};
