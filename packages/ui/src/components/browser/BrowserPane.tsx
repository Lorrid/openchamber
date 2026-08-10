import React from 'react';

import { toast } from '@/components/ui';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { invokeDesktopCommand } from '@/lib/desktopNative';
import { useI18n } from '@/lib/i18n';
import { openExternalUrl } from '@/lib/url';
import { useUIStore } from '@/stores/useUIStore';
import { BLANK_URL, normalizeBrowserUrl } from '@/lib/browser/url';
import {
  cancelAnnotationSession,
  runAnnotationSession,
  type AnnotationHost,
  type PageCapture,
} from '@/lib/browser/annotationSession';
import { resolveAnnotationOverlayTheme } from '@/lib/browser/overlayTheme';
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

const WebviewBrowser: React.FC<BrowserPaneProps> = ({ initialUrl, directory, tabID }) => {
  const { t } = useI18n();
  const { currentTheme } = useThemeSystem();
  const webviewRef = React.useRef<WebviewElement | null>(null);
  const setContextPanelTabTargetPath = useUIStore((state) => state.setContextPanelTabTargetPath);

  // The webview keeps its own history; `src` is only the starting point and must
  // not be re-driven by React, or every state update would reload the page.
  const initialSrcRef = React.useRef(normalizeBrowserUrl(initialUrl));
  const startUrl = initialSrcRef.current !== BLANK_URL ? initialSrcRef.current : '';

  const [address, setAddress] = React.useState(startUrl);
  const [isAnnotating, setIsAnnotating] = React.useState(false);

  const persistUrl = React.useCallback((url: string) => {
    if (!url || url === BLANK_URL || !directory || !tabID) return;
    setContextPanelTabTargetPath(directory, tabID, url);
  }, [directory, tabID, setContextPanelTabTargetPath]);

  const navigation = useWebviewNavigation(webviewRef, {
    initialUrl: startUrl,
    onUrlChange: React.useCallback((url: string) => {
      setAddress(url);
      persistUrl(url);
    }, [persistUrl]),
  });

  const attachAnnotation = useAnnotationAttach(directory);
  const overlayLabels = useAnnotationOverlayLabels();
  const isLoading = navigation.status.kind === 'loading';

  const loadUrl = React.useCallback((value: string) => {
    const next = normalizeBrowserUrl(value);
    if (next === BLANK_URL) return;
    setAddress(next);
    try {
      webviewRef.current?.loadURL(next);
    } catch {
      // Not attached yet; the src attribute already points at the start URL.
    }
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
      accentColor: theme.primary,
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

  // Leaving the tab must not strand an overlay or live style overrides on the page.
  React.useEffect(() => {
    const host = annotationHost;
    return () => { void cancelAnnotationSession(host); };
  }, [annotationHost]);

  // Popups open in place; a detached window would escape the panel entirely.
  React.useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    const onNewWindow = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string }>).detail;
      event.preventDefault();
      if (detail?.url) loadUrl(detail.url);
    };
    webview.addEventListener('new-window', onNewWindow);
    return () => webview.removeEventListener('new-window', onNewWindow);
  }, [loadUrl]);

  const handleReload = React.useCallback(() => {
    try {
      if (isLoading) webviewRef.current?.stop();
      else webviewRef.current?.reload();
    } catch {
      // Not attached yet.
    }
  }, [isLoading]);

  const failed = navigation.status.kind === 'failed' ? navigation.status : null;

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
        <webview
          ref={webviewRef}
          src={initialSrcRef.current}
          partition="persist:openchamber-browser"
          allowpopups
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
        {!navigation.url && !isLoading ? (
          <BrowserEmptyState onOpen={loadUrl} />
        ) : null}
        {failed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background p-6 text-center">
            <span className="typography-ui-header text-foreground">{t('contextPanel.browser.loadFailed')}</span>
            <span className="typography-micro text-muted-foreground">
              {failed.description || String(failed.code)}
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
