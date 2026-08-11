import React from 'react';

import { toast } from '@/components/ui';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { invokeDesktopCommand } from '@/lib/desktopNative';
import { useI18n } from '@/lib/i18n';
import { openExternalUrl } from '@/lib/url';
import { useUIStore } from '@/stores/useUIStore';
import { BLANK_URL, isStartingServerFailure, normalizeBrowserUrl } from '@/lib/browser/url';
import {
  cancelAnnotationSession,
  runAnnotationSession,
  type AnnotationHost,
  type PageCapture,
} from '@/lib/browser/annotationSession';
import { resolveAnnotationOverlayTheme } from '@/lib/browser/overlayTheme';
import { registerBrowserController } from '@/lib/browser/controlClient';
import { resolveBrowsableUrl, toDisplayUrl } from '@/lib/browser/devTunnel';
import {
  buildClickScript,
  buildScrollScript,
  buildSnapshotScript,
  buildTypeScript,
} from '@/lib/browser/pageActions';
import { BrowserToolbar } from './BrowserToolbar';
import { BrowserEmptyState } from './BrowserEmptyState';
import { useAnnotationAttach, useAnnotationOverlayLabels } from './useAnnotationAttach';
import { useWebviewNavigation } from './useWebviewNavigation';

export type BrowserPaneProps = {
  initialUrl: string;
  directory: string;
  tabID: string;
};

/**
 * Chromium is the only host that can give us a real page: cookies, service
 * workers, HMR sockets, DevTools, and same-document access for annotation. When
 * it is unavailable the surface degrades to a plain iframe that can display a
 * page but cannot inspect one, rather than pretending otherwise.
 */
const isChromiumHost = (): boolean => (
  typeof window !== 'undefined' && Boolean(window.__OPENCHAMBER_ELECTRON__)
);

/** How long to keep waiting for a dev server that is still coming up. */
const DEV_SERVER_WAIT_MS = 40_000;
const DEV_SERVER_RETRY_DELAY_MS = 600;

const WebviewBrowser: React.FC<BrowserPaneProps> = ({ initialUrl, directory, tabID }) => {
  const { t } = useI18n();
  const { currentTheme } = useThemeSystem();
  const webviewRef = React.useRef<WebviewElement | null>(null);
  // Tracked in state as well as a ref: effects that attach listeners must re-run
  // when the view appears, which a stable ref cannot tell them.
  const [webviewElement, setWebviewElement] = React.useState<WebviewElement | null>(null);
  const attachWebview = React.useCallback((node: WebviewElement | null) => {
    webviewRef.current = node;
    setWebviewElement(node);
  }, []);
  const setContextPanelTabTargetPath = useUIStore((state) => state.setContextPanelTabTargetPath);

  // Captured once: the webview owns its history from here on, and re-deriving
  // this from props would drag the view back to where the tab started.
  const initialUrlRef = React.useRef(normalizeBrowserUrl(initialUrl));
  const startUrl = initialUrlRef.current !== BLANK_URL ? initialUrlRef.current : '';

  // The view is created with its final URL already in `src`, never navigated
  // into place afterwards. A tab opened in the background renders hidden, where
  // an imperative navigation is lost, and mutating `src` after the element
  // exists is not reliably honoured either — both leave a panel that never
  // loads. `null` means "still resolving", and the view is not rendered yet.
  const [initialSrc, setInitialSrc] = React.useState<string | null>(startUrl ? null : BLANK_URL);

  const [address, setAddress] = React.useState(startUrl);
  const [isAnnotating, setIsAnnotating] = React.useState(false);
  const [isWaitingForServer, setIsWaitingForServer] = React.useState(false);
  /** When the current run of retries began, per URL. */
  const retryRef = React.useRef<{ url: string; startedAt: number } | null>(null);

  const persistUrl = React.useCallback((url: string) => {
    if (!url || url === BLANK_URL || !directory || !tabID) return;
    setContextPanelTabTargetPath(directory, tabID, url);
  }, [directory, tabID, setContextPanelTabTargetPath]);

  const navigation = useWebviewNavigation(webviewElement, {
    initialUrl: startUrl,
    onUrlChange: React.useCallback((url: string) => {
      const display = toDisplayUrl(url);
      setAddress(display);
      persistUrl(display);
    }, [persistUrl]),
  });

  const attachAnnotation = useAnnotationAttach(directory);
  const overlayLabels = useAnnotationOverlayLabels();
  const isLoading = navigation.status.kind === 'loading';

  const loadUrl = React.useCallback((value: string) => {
    const next = normalizeBrowserUrl(value);
    if (next === BLANK_URL) return;
    // The address bar shows what the user asked for; a tunnel only changes
    // where the bytes come from, and surfacing 127.0.0.1:<random> would be
    // confusing and useless to copy.
    setAddress(next);
    void resolveBrowsableUrl(next).then((target) => {
      const webview = webviewRef.current;
      if (!webview) {
        setInitialSrc(target);
        return;
      }
      try {
        webview.loadURL(target);
      } catch {
        // Not attached yet: hand the navigation to the attribute, which
        // Chromium applies once the view attaches.
        setInitialSrc(target);
      }
    });
  }, []);

  // Resolving through the tunnel is what lets a persisted loopback URL reach a
  // dev server on a remote host; locally it returns the URL unchanged.
  React.useEffect(() => {
    if (!startUrl) return;
    let active = true;
    void resolveBrowsableUrl(startUrl)
      .then((target) => { if (active) setInitialSrc(target); })
      // Never leave the view unrendered: without a src the panel would stay
      // permanently blank, which is worse than loading the untunneled URL.
      .catch(() => { if (active) setInitialSrc(startUrl); });
    return () => { active = false; };
    // Only ever the initial navigation; later changes come from the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const annotationHost = React.useMemo<AnnotationHost>(() => ({
    executeJavaScript: async (code: string, userGesture?: boolean) => {
      const webview = webviewRef.current;
      if (!webview) throw new Error('Browser view is not available');
      return webview.executeJavaScript(code, userGesture);
    },
    capturePage: async (): Promise<PageCapture | null> => {
      const webview = webviewRef.current;
      if (!webview) return null;
      const webContentsId = webview.getWebContentsId();
      if (!Number.isFinite(webContentsId)) return null;
      return await invokeDesktopCommand<PageCapture>('desktop_browser_capture_page', { webContentsId });
    },
  }), []);

  const handleAnnotate = React.useCallback(() => {
    if (isAnnotating) {
      setIsAnnotating(false);
      void cancelAnnotationSession(annotationHost);
      return;
    }
    if (!navigation.url) {
      toast.error(t('contextPanel.browser.annotate.noPage'));
      return;
    }

    const theme = resolveAnnotationOverlayTheme(
      currentTheme.metadata.variant === 'light' ? 'light' : 'dark',
    );

    setIsAnnotating(true);
    void runAnnotationSession({
      host: annotationHost,
      theme,
      labels: overlayLabels,
    })
      .then(async (result) => {
        setIsAnnotating(false);
        if (!result) return;
        await attachAnnotation(result);
      })
      .catch(() => {
        setIsAnnotating(false);
        toast.error(t('contextPanel.browser.annotate.failed'));
      });
  }, [annotationHost, attachAnnotation, currentTheme, isAnnotating, navigation.url, overlayLabels, t]);

  // Escape leaves annotation mode from the app side too: the overlay owns the
  // in-page Escape, but the panel can be focused instead.
  React.useEffect(() => {
    if (!isAnnotating) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setIsAnnotating(false);
      void cancelAnnotationSession(annotationHost);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [annotationHost, isAnnotating]);

  // Agent-driven actions. Waiting for the page to settle after a navigation is
  // deliberate: a snapshot taken mid-load describes a page that no longer
  // exists by the time the agent reads it.
  const waitForIdle = React.useCallback(async (timeoutMs = 8_000): Promise<boolean> => {
    const startedAt = Date.now();
    for (;;) {
      const webview = webviewRef.current;
      if (!webview) return false;
      let busy = false;
      try {
        busy = webview.isLoading();
      } catch {
        return false;
      }
      if (!busy) return true;
      // A page with a looping video or a long-lived stream can report loading
      // indefinitely. Give up waiting and act on it anyway rather than letting
      // the whole action expire.
      if (Date.now() - startedAt > timeoutMs) return false;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }, []);

  const runControlAction = React.useCallback(async (
    action: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown> => {
    const webview = webviewRef.current;
    if (!webview) throw new Error('The browser panel is not ready');

    if (action === 'browser.open') {
      const url = typeof parameters.url === 'string' ? parameters.url : '';
      if (!url) throw new Error('url is required');
      loadUrl(url);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const settled = await waitForIdle(25_000);
      let title = '';
      try {
        title = webview.getTitle() || '';
      } catch {
        title = '';
      }
      // `settled: false` means the page is still fetching, not that opening
      // failed — the agent can snapshot it and decide for itself.
      return { url: normalizeBrowserUrl(url), title, opened: true, settled };
    }

    await waitForIdle();

    const script = action === 'browser.snapshot'
      ? buildSnapshotScript()
      : action === 'browser.click'
        ? buildClickScript({
          selector: typeof parameters.selector === 'string' ? parameters.selector : undefined,
          text: typeof parameters.text === 'string' ? parameters.text : undefined,
        })
        : action === 'browser.type'
          ? buildTypeScript({
            selector: String(parameters.selector ?? ''),
            value: String(parameters.value ?? ''),
            submit: parameters.submit === true,
          })
          : action === 'browser.scroll'
            ? buildScrollScript({
              selector: typeof parameters.selector === 'string' ? parameters.selector : undefined,
              direction: typeof parameters.direction === 'string' ? parameters.direction : undefined,
            })
            : null;

    if (!script) throw new Error(`Unsupported browser action: ${action}`);

    const result = await webview.executeJavaScript(script, true);
    if (!result || typeof result !== 'object') {
      throw new Error('The page returned no result');
    }
    const record = result as Record<string, unknown>;
    if (record.ok !== true) {
      throw new Error(typeof record.error === 'string' && record.error ? record.error : 'Browser action failed');
    }
    // A click or a submit commonly starts a navigation; let it land so the
    // agent's next snapshot sees the page the action produced.
    if (action === 'browser.click' || (action === 'browser.type' && parameters.submit === true)) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await waitForIdle();
    }
    return result;
  }, [loadUrl, waitForIdle]);

  React.useEffect(
    () => registerBrowserController({ run: runControlAction }),
    [runControlAction],
  );

  // Leaving the tab must not strand an overlay or live style overrides on the page.
  React.useEffect(() => {
    const host = annotationHost;
    return () => { void cancelAnnotationSession(host); };
  }, [annotationHost]);

  // Popups open in place; a detached window would escape the panel entirely.
  React.useEffect(() => {
    if (!webviewElement) return;
    const onNewWindow = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string }>).detail;
      event.preventDefault();
      if (detail?.url) loadUrl(detail.url);
    };
    webviewElement.addEventListener('new-window', onNewWindow);
    return () => webviewElement.removeEventListener('new-window', onNewWindow);
  }, [loadUrl, webviewElement]);

  const handleReload = React.useCallback(() => {
    try {
      if (isLoading) webviewRef.current?.stop();
      else webviewRef.current?.reload();
    } catch {
      // Not attached yet.
    }
  }, [isLoading]);

  // A page opened the moment its dev server was launched will fail its first
  // load; the server is simply not listening yet. Retry quietly for a while
  // instead of showing an error the user can only answer by pressing reload.
  const status = navigation.status;
  React.useEffect(() => {
    if (status.kind !== 'failed') {
      retryRef.current = null;
      setIsWaitingForServer(false);
      return;
    }
    if (!isStartingServerFailure(status.code, status.url)) {
      setIsWaitingForServer(false);
      return;
    }

    const now = Date.now();
    const run = retryRef.current?.url === status.url
      ? retryRef.current
      : { url: status.url, startedAt: now };
    retryRef.current = run;

    if (now - run.startedAt > DEV_SERVER_WAIT_MS) {
      setIsWaitingForServer(false);
      return;
    }

    setIsWaitingForServer(true);
    const timer = setTimeout(() => {
      try {
        webviewRef.current?.reload();
      } catch {
        // View went away; the next mount starts over.
      }
    }, DEV_SERVER_RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const failed = navigation.status.kind === 'failed' && !isWaitingForServer ? navigation.status : null;

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      <BrowserToolbar
        address={address}
        onAddressChange={setAddress}
        onSubmit={loadUrl}
        onBack={() => { try { webviewRef.current?.goBack(); } catch { /* not attached */ } }}
        onForward={() => { try { webviewRef.current?.goForward(); } catch { /* not attached */ } }}
        onReload={handleReload}
        onOpenExternal={() => void openExternalUrl(navigation.url || address)}
        canGoBack={navigation.canGoBack}
        canGoForward={navigation.canGoForward}
        isLoading={isLoading}
        onAnnotate={handleAnnotate}
        isAnnotating={isAnnotating}
        onOpenDevTools={() => { try { webviewRef.current?.openDevTools(); } catch { /* not attached */ } }}
      />
      <div className="relative min-h-0 flex-1 bg-background">
        {initialSrc !== null ? (
          <webview
            ref={attachWebview}
            src={initialSrc}
            partition="persist:openchamber-browser"
            allowpopups
            style={{ width: '100%', height: '100%', border: 'none' }}
          />
        ) : null}
        {initialSrc !== null && !startUrl && !navigation.url && !isLoading ? (
          <BrowserEmptyState onOpen={loadUrl} />
        ) : null}
        {isWaitingForServer ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background p-6 text-center">
            <span className="typography-ui-header text-foreground">{t('contextPanel.browser.waitingForServer')}</span>
            <span className="typography-micro text-muted-foreground">{t('contextPanel.browser.waitingForServerHint')}</span>
          </div>
        ) : null}
        {failed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background p-6 text-center">
            <span className="typography-ui-header text-foreground">{t('contextPanel.browser.loadFailed')}</span>
            <span className="typography-micro text-muted-foreground">
              {failed.description || t('contextPanel.browser.loadFailedUnknown')}
            </span>
          </div>
        ) : null}
        {isLoading ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden">
            <div className="h-full w-1/3 animate-[browser-progress_1.1s_ease-in-out_infinite] bg-[var(--primary)]" />
          </div>
        ) : null}
      </div>
    </div>
  );
};

/**
 * Non-Chromium runtimes get a plain iframe. Same-origin policy makes the page
 * opaque to us here: no navigation events, no annotation, no console. The
 * toolbar reflects that instead of offering controls that would silently fail.
 */
const IframeBrowser: React.FC<BrowserPaneProps> = ({ initialUrl, directory, tabID }) => {
  const { t } = useI18n();
  const setContextPanelTabTargetPath = useUIStore((state) => state.setContextPanelTabTargetPath);
  const normalized = normalizeBrowserUrl(initialUrl);
  const startUrl = normalized !== BLANK_URL ? normalized : '';

  const [address, setAddress] = React.useState(startUrl);
  const [loadedUrl, setLoadedUrl] = React.useState(startUrl);
  const [history, setHistory] = React.useState<string[]>(startUrl ? [startUrl] : []);
  const [historyIndex, setHistoryIndex] = React.useState(startUrl ? 0 : -1);
  const [reloadNonce, bumpReload] = React.useReducer((value: number) => value + 1, 0);

  const persistUrl = React.useCallback((url: string) => {
    if (!url || url === BLANK_URL || !directory || !tabID) return;
    setContextPanelTabTargetPath(directory, tabID, url);
  }, [directory, tabID, setContextPanelTabTargetPath]);

  const navigate = React.useCallback((value: string) => {
    const next = normalizeBrowserUrl(value);
    if (next === BLANK_URL) return;
    setAddress(next);
    setLoadedUrl(next);
    persistUrl(next);
    setHistory((current) => {
      const kept = historyIndex >= 0 ? current.slice(0, historyIndex + 1) : [];
      if (kept[kept.length - 1] === next) {
        setHistoryIndex(kept.length - 1);
        return kept;
      }
      setHistoryIndex(kept.length);
      return [...kept, next];
    });
  }, [historyIndex, persistUrl]);

  const goTo = React.useCallback((index: number) => {
    const next = history[index];
    if (!next) return;
    setHistoryIndex(index);
    setAddress(next);
    setLoadedUrl(next);
    persistUrl(next);
  }, [history, persistUrl]);

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      <BrowserToolbar
        address={address}
        onAddressChange={setAddress}
        onSubmit={navigate}
        onBack={() => goTo(historyIndex - 1)}
        onForward={() => goTo(historyIndex + 1)}
        onReload={bumpReload}
        onOpenExternal={() => void openExternalUrl(loadedUrl || address)}
        canGoBack={historyIndex > 0}
        canGoForward={historyIndex >= 0 && historyIndex < history.length - 1}
        isLoading={false}
      />
      <div className="relative min-h-0 flex-1 bg-background">
        {loadedUrl ? (
          <iframe
            key={`${loadedUrl}|${reloadNonce}`}
            src={loadedUrl}
            title={t('contextPanel.browser.frameTitle')}
            className="h-full w-full border-none bg-white"
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          />
        ) : (
          <BrowserEmptyState onOpen={navigate} />
        )}
      </div>
    </div>
  );
};

export const BrowserPane: React.FC<BrowserPaneProps> = (props) => {
  const [chromium] = React.useState(isChromiumHost);
  return chromium ? <WebviewBrowser {...props} /> : <IframeBrowser {...props} />;
};
