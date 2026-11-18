// Measurements done in the browser, with no server and no model: pixels of an image, a drawing at a fixed size,
// a file's fingerprint. The rules in core/ decide on these numbers.
import { toGray, type Gray } from '../core/image';

export async function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}

/** All pixels of an image at its own size (RGBA bytes). */
export async function pixels(src: string | Blob): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const img = await loadImage(src);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0);
  return { rgba: x.getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height };
}

/** A drawing (a sketch photo or an SVG) on white, at size×size, in grey: what the logo likeness compares. */
export async function drawing(src: string | Blob, size = 256): Promise<Gray> {
  const img = await loadImage(src);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.fillStyle = '#fff';
  x.fillRect(0, 0, size, size);
  const s = Math.min(size / (img.naturalWidth || size), size / (img.naturalHeight || size));
  const w = (img.naturalWidth || size) * s, h = (img.naturalHeight || size) * s;
  x.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return toGray(x.getImageData(0, 0, size, size).data, size, size);
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
