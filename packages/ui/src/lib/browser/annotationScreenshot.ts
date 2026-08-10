/**
 * Turns a native page capture plus an annotation payload into the image the
 * agent receives.
 *
 * The capture arrives in device pixels while every rectangle in the payload is
 * in CSS pixels, so everything is scaled by the ratio between the two rather
 * than by `devicePixelRatio` — the page may be zoomed, and the measured ratio
 * stays correct when it is.
 */
import type { BrowserAnnotationPayload, BrowserRect } from './contract';

const MAX_OUTPUT_WIDTH = 1400;
/** Breathing room around the marked area so the crop keeps its context. */
const CROP_PADDING_CSS = 24;

const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Failed to decode browser page capture'));
  image.src = src;
});

const clampRect = (rect: BrowserRect, width: number, height: number): BrowserRect => {
  const x = Math.max(0, Math.min(rect.x, width - 1));
  const y = Math.max(0, Math.min(rect.y, height - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(rect.width, width - x)),
    height: Math.max(1, Math.min(rect.height, height - y)),
  };
};

export const renderAnnotationScreenshot = async ({
  base64,
  mime,
  captureWidth,
  captureHeight,
  cssWidth,
  cssHeight,
  payload,
  accentColor,
}: {
  base64: string;
  mime: string;
  captureWidth: number;
  captureHeight: number;
  cssWidth: number;
  cssHeight: number;
  payload: BrowserAnnotationPayload;
  accentColor: string;
}): Promise<File | null> => {
  if (!base64) return null;

  try {
    const image = await loadImage(`data:${mime};base64,${base64}`);
    const pixelWidth = Math.max(1, image.naturalWidth || captureWidth);
    const pixelHeight = Math.max(1, image.naturalHeight || captureHeight);
    const scaleX = pixelWidth / Math.max(1, cssWidth || pixelWidth);
    const scaleY = pixelHeight / Math.max(1, cssHeight || pixelHeight);

    const cropCss = payload.captureRect
      ? {
        x: payload.captureRect.x - CROP_PADDING_CSS,
        y: payload.captureRect.y - CROP_PADDING_CSS,
        width: payload.captureRect.width + CROP_PADDING_CSS * 2,
        height: payload.captureRect.height + CROP_PADDING_CSS * 2,
      }
      : { x: 0, y: 0, width: cssWidth, height: cssHeight };

    const crop = clampRect(
      { x: cropCss.x * scaleX, y: cropCss.y * scaleY, width: cropCss.width * scaleX, height: cropCss.height * scaleY },
      pixelWidth,
      pixelHeight,
    );

    const outputScale = Math.min(1, MAX_OUTPUT_WIDTH / crop.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(crop.width * outputScale));
    canvas.height = Math.max(1, Math.floor(crop.height * outputScale));
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.scale(outputScale, outputScale);
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);

    // Marker geometry is relative to the crop origin, still in device pixels.
    const toCanvas = (rect: BrowserRect): BrowserRect => ({
      x: rect.x * scaleX - crop.x,
      y: rect.y * scaleY - crop.y,
      width: rect.width * scaleX,
      height: rect.height * scaleY,
    });

    context.lineWidth = Math.max(2, 2 * scaleX);
    context.strokeStyle = accentColor;
    context.fillStyle = `${accentColor}24`;

    for (const entry of payload.elements) {
      const rect = toCanvas(entry.element.bounds);
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
    for (const region of payload.regions) {
      const rect = toCanvas(region.rect);
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
    for (const stroke of payload.strokes) {
      if (stroke.points.length < 2) continue;
      context.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * scaleX - crop.x;
        const y = point.y * scaleY - crop.y;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.lineWidth = Math.max(3, 3 * scaleX);
      context.stroke();
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return null;
    return new File([blob], `browser-annotation-${Date.now()}.jpg`, { type: 'image/jpeg' });
  } catch {
    return null;
  }
};
