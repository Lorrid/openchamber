/**
 * Viewport sizing for the browser panel.
 *
 * The page is rendered at a chosen size and scaled down to fit the panel when
 * it does not. Scaling is visual only: the view still lays out at the chosen
 * width, which is the whole point — a 390px layout has to be measured at 390px,
 * not at whatever the panel happens to be.
 */

export type BrowserViewport =
  | { readonly kind: 'fill' }
  | { readonly kind: 'preset'; readonly id: string; readonly width: number; readonly height: number }
  | { readonly kind: 'custom'; readonly width: number; readonly height: number };

export const FILL_VIEWPORT: BrowserViewport = { kind: 'fill' };

export const MIN_VIEWPORT_SIZE = 240;
export const MAX_VIEWPORT_SIZE = 3840;

export type ViewportPreset = {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
};

/**
 * Sizes worth having, not every device ever made. A long list is harder to pick
 * from than it is useful, and anything missing can be typed in directly.
 */
export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667 },
  { id: 'iphone-14', label: 'iPhone 14', width: 390, height: 844 },
  { id: 'iphone-14-pro-max', label: 'iPhone 14 Pro Max', width: 430, height: 932 },
  { id: 'pixel-7', label: 'Pixel 7', width: 412, height: 915 },
  { id: 'ipad-mini', label: 'iPad mini', width: 768, height: 1024 },
  { id: 'ipad-pro', label: 'iPad Pro', width: 1024, height: 1366 },
  { id: 'laptop', label: 'Laptop', width: 1280, height: 800 },
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900 },
];

export const clampViewportSize = (value: number): number => {
  if (!Number.isFinite(value)) return MIN_VIEWPORT_SIZE;
  return Math.round(Math.min(MAX_VIEWPORT_SIZE, Math.max(MIN_VIEWPORT_SIZE, value)));
};

export const viewportSize = (
  viewport: BrowserViewport,
): { width: number; height: number } | null => (
  viewport.kind === 'fill' ? null : { width: viewport.width, height: viewport.height }
);

/** Turns a preset id into a viewport, or null when the id is unknown. */
export const presetViewport = (id: string): BrowserViewport | null => {
  const preset = VIEWPORT_PRESETS.find((entry) => entry.id === id);
  if (!preset) return null;
  return { kind: 'preset', id: preset.id, width: preset.width, height: preset.height };
};

export const rotateViewport = (viewport: BrowserViewport): BrowserViewport => {
  if (viewport.kind === 'fill') return viewport;
  // Rotating a preset stops it being that preset: an iPhone on its side is no
  // longer the entry in the list, and pretending otherwise makes the picker lie.
  return { kind: 'custom', width: viewport.height, height: viewport.width };
};

export type ViewportLayout = {
  /** Size to lay the page out at, in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Visual scale, ≤ 1. Applied with a transform; the page never learns of it. */
  readonly scale: number;
};

/**
 * Fits a chosen viewport into the space available.
 *
 * Only ever scales down. Enlarging a small viewport to fill a big panel would
 * misrepresent the very thing the user asked to see.
 */
export const fitViewport = (
  viewport: BrowserViewport,
  available: { width: number; height: number },
): ViewportLayout | null => {
  const size = viewportSize(viewport);
  if (!size) return null;

  const usableWidth = Math.max(1, available.width);
  const usableHeight = Math.max(1, available.height);
  const scale = Math.min(1, usableWidth / size.width, usableHeight / size.height);
  return { width: size.width, height: size.height, scale };
};

/** Label for the current viewport, for the size control. */
export const describeViewport = (viewport: BrowserViewport): string => {
  if (viewport.kind === 'fill') return '';
  if (viewport.kind === 'preset') {
    return VIEWPORT_PRESETS.find((entry) => entry.id === viewport.id)?.label ?? '';
  }
  return '';
};
