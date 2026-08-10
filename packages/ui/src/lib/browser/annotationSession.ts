/**
 * Drives one annotation session end to end.
 *
 * The ordering here is the whole point. Style edits made during annotation are
 * left applied when the overlay resolves, precisely so the screenshot shows the
 * state the user is asking for. That means the page is left mutated until we
 * revert it — so the revert is unconditional and runs even when the capture
 * fails or the payload turns out to be malformed. A failed screenshot degrades
 * the annotation; it must never leave `!important` overrides on a page the user
 * keeps browsing.
 */
import {
  ANNOTATION_TEARDOWN_SCRIPT,
  buildAnnotationOverlayScript,
  type BrowserAnnotationOverlayLabels,
  type BrowserAnnotationOverlayTheme,
  ANNOTATION_REVERT_HOOK,
} from './annotationOverlay';
import { isBrowserAnnotationPayload, type BrowserAnnotationPayload } from './contract';
import { renderAnnotationScreenshot } from './annotationScreenshot';

export type PageCapture = {
  readonly mime: string;
  readonly base64: string;
  readonly width: number;
  readonly height: number;
};

/**
 * The capabilities an annotation session needs from its host, named so the
 * session can be exercised without a live `<webview>`.
 */
export type AnnotationHost = {
  readonly executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>;
  readonly capturePage: () => Promise<PageCapture | null>;
};

export type AnnotationSessionResult = {
  readonly payload: BrowserAnnotationPayload;
  readonly screenshot: File | null;
};

const REVERT_SCRIPT = `(() => {
  var revert = window['${ANNOTATION_REVERT_HOOK}'];
  if (typeof revert === 'function') revert();
})();`;

const VIEWPORT_SCRIPT = '({ width: window.innerWidth, height: window.innerHeight })';

const readViewport = async (host: AnnotationHost): Promise<{ width: number; height: number } | null> => {
  try {
    const value = await host.executeJavaScript(VIEWPORT_SCRIPT, true);
    if (!value || typeof value !== 'object') return null;
    const record = value as { width?: unknown; height?: unknown };
    if (typeof record.width !== 'number' || typeof record.height !== 'number') return null;
    if (!Number.isFinite(record.width) || !Number.isFinite(record.height)) return null;
    return { width: record.width, height: record.height };
  } catch {
    return null;
  }
};

/** Best-effort cleanup of an overlay left behind by a previous session. */
export const cancelAnnotationSession = async (host: AnnotationHost): Promise<void> => {
  try {
    await host.executeJavaScript(ANNOTATION_TEARDOWN_SCRIPT, false);
  } catch {
    // The page navigated or was destroyed; the overlay went with it.
  }
};

export const runAnnotationSession = async ({
  host,
  theme,
  labels,
  accentColor,
}: {
  host: AnnotationHost;
  theme: BrowserAnnotationOverlayTheme;
  labels: BrowserAnnotationOverlayLabels;
  accentColor: string;
}): Promise<AnnotationSessionResult | null> => {
  const script = buildAnnotationOverlayScript(theme, labels);
  const raw = await host.executeJavaScript(script, true);

  // Cancelled from inside the page: the overlay already reverted its own edits.
  if (raw === null || raw === undefined) return null;

  if (!isBrowserAnnotationPayload(raw)) {
    await cancelAnnotationSession(host);
    return null;
  }
  const payload = raw;

  try {
    const viewport = await readViewport(host) ?? payload.viewport;
    const capture = await host.capturePage();
    if (!capture || !capture.base64) {
      return { payload, screenshot: null };
    }

    const screenshot = await renderAnnotationScreenshot({
      base64: capture.base64,
      mime: capture.mime || 'image/jpeg',
      captureWidth: capture.width,
      captureHeight: capture.height,
      cssWidth: viewport.width,
      cssHeight: viewport.height,
      payload,
      accentColor,
    });
    return { payload, screenshot };
  } catch {
    return { payload, screenshot: null };
  } finally {
    // Unconditional: the page is not ours to leave overridden.
    try {
      await host.executeJavaScript(REVERT_SCRIPT, false);
    } catch {
      // Page gone; nothing left to revert.
    }
  }
};
