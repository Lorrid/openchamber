import { describe, expect, test } from 'bun:test';

import { cancelAnnotationSession, runAnnotationSession, type AnnotationHost, type PageCapture } from './annotationSession';
import { ANNOTATION_REVERT_HOOK } from './annotationOverlay';
import type { BrowserAnnotationOverlayLabels, BrowserAnnotationOverlayTheme } from './annotationOverlay';

const theme: BrowserAnnotationOverlayTheme = {
  colorScheme: 'dark',
  primary: 'rgb(1, 2, 3)',
  primarySoft: 'rgba(1, 2, 3, 0.16)',
  primaryFaint: 'rgba(1, 2, 3, 0.1)',
  primaryContrast: 'rgb(255, 255, 255)',
  surface: 'rgb(10, 10, 10)',
  surfaceElevated: 'rgb(20, 20, 20)',
  border: 'rgb(30, 30, 30)',
  text: 'rgb(240, 240, 240)',
  mutedText: 'rgb(160, 160, 160)',
};

const labels = {
  select: 'Select', marquee: 'Region', draw: 'Draw', styles: 'Styles',
  commentPlaceholder: 'Describe', submit: 'Attach', cancel: 'Cancel', clear: 'Clear',
  text: 'Text', colors: 'Colors', borders: 'Borders', sizing: 'Size',
  fontSize: 'Size', fontWeight: 'Weight', textColor: 'Color', background: 'Background',
  borderColor: 'Color', borderWidth: 'Width', borderRadius: 'Radius',
  width: 'Width', height: 'Height', opacity: 'Opacity',
} satisfies BrowserAnnotationOverlayLabels;

const validPayload = {
  id: 'annotation-1',
  pageUrl: 'http://localhost:5173/',
  pageTitle: 'App',
  viewport: { width: 1000, height: 700 },
  devicePixelRatio: 1,
  comment: 'tighten this',
  elements: [{
    id: 'element-1',
    element: {
      tag: 'div',
      text: 'Hi',
      selector: '#hero',
      path: 'main > div#hero',
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      center: { x: 50, y: 25 },
      attributes: {},
      computedStyle: {},
      ancestry: [],
    },
  }],
  regions: [],
  strokes: [],
  styleChanges: [{ targetId: 'element-1', property: 'color', previousValue: '', value: '#fff' }],
  captureRect: { x: 0, y: 0, width: 100, height: 50 },
};

const capture: PageCapture = { mime: 'image/jpeg', base64: 'AAAA', width: 1000, height: 700 };

type Call = { code: string; gesture?: boolean };

const createHost = (options: {
  overlayResult: unknown;
  capturePage?: () => Promise<PageCapture | null>;
}): { host: AnnotationHost; calls: Call[] } => {
  const calls: Call[] = [];
  const host: AnnotationHost = {
    executeJavaScript: async (code: string, gesture?: boolean) => {
      calls.push({ code, gesture });
      if (code.includes('new Promise')) return options.overlayResult;
      if (code.includes('window.innerWidth')) return { width: 1000, height: 700 };
      return undefined;
    },
    capturePage: options.capturePage ?? (async () => capture),
  };
  return { host, calls };
};

const revertCalls = (calls: Call[]): number => (
  calls.filter((call) => call.code.includes(ANNOTATION_REVERT_HOOK) && !call.code.includes('new Promise')).length
);

describe('annotation session', () => {
  test('returns null when the user cancels inside the page', async () => {
    const { host } = createHost({ overlayResult: null });
    expect(await runAnnotationSession({ host, theme, labels, accentColor: 'rgb(1,2,3)' })).toBeNull();
  });

  test('does not re-run the revert hook when the overlay cancelled itself', async () => {
    const { host, calls } = createHost({ overlayResult: null });
    await runAnnotationSession({ host, theme, labels, accentColor: 'rgb(1,2,3)' });
    expect(revertCalls(calls)).toBe(0);
  });

  test('discards a malformed payload and tears the overlay down', async () => {
    const { host, calls } = createHost({ overlayResult: { id: 'x', elements: 'not-an-array' } });
    const result = await runAnnotationSession({ host, theme, labels, accentColor: 'rgb(1,2,3)' });
    expect(result).toBeNull();
    expect(calls.some((call) => call.code.includes('data-openchamber-annotation'))).toBe(true);
  });

  test('reverts live style edits after a successful capture', async () => {
    const { host, calls } = createHost({ overlayResult: validPayload });
    const result = await runAnnotationSession({ host, theme, labels, accentColor: 'rgb(1,2,3)' });

    expect(result?.payload.id).toBe('annotation-1');
    expect(revertCalls(calls)).toBe(1);
  });

  test('still reverts when the capture fails, so the page is never left overridden', async () => {
    const { host, calls } = createHost({
      overlayResult: validPayload,
      capturePage: async () => { throw new Error('capture failed'); },
    });

    const result = await runAnnotationSession({ host, theme, labels, accentColor: 'rgb(1,2,3)' });

    expect(result?.payload.id).toBe('annotation-1');
    expect(result?.screenshot).toBeNull();
    expect(revertCalls(calls)).toBe(1);
  });

  test('keeps the annotation when capture returns nothing', async () => {
    const { host } = createHost({ overlayResult: validPayload, capturePage: async () => null });
    const result = await runAnnotationSession({ host, theme, labels, accentColor: 'rgb(1,2,3)' });
    expect(result?.payload.comment).toBe('tighten this');
    expect(result?.screenshot).toBeNull();
  });

  test('runs the overlay with a user gesture so the page treats it as interactive', async () => {
    const { host, calls } = createHost({ overlayResult: null });
    await runAnnotationSession({ host, theme, labels, accentColor: 'rgb(1,2,3)' });
    expect(calls[0]?.gesture).toBe(true);
  });

  test('cancelling a stale session tolerates a destroyed page', async () => {
    const host: AnnotationHost = {
      executeJavaScript: async () => { throw new Error('webview destroyed'); },
      capturePage: async () => null,
    };
    // Resolving at all is the contract: a destroyed page must not throw.
    expect(await cancelAnnotationSession(host)).toBeFalsy();
  });
});
