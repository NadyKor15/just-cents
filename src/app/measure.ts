// Measurements done in the browser, with no server and no model: image size, letters on an image (OCR),
// audio length. The rules in core/rules.ts decide on these numbers.
import type { Worker as OcrWorker } from 'tesseract.js';

let ocr: Promise<OcrWorker> | null = null;

/** Tesseract runs locally from /vendor (no CDN). Loaded once, on first use. */
function ocrWorker(): Promise<OcrWorker> {
  if (!ocr) {
    ocr = (async () => {
      const { createWorker } = await import('tesseract.js');
      const w = await createWorker('eng', 1, {
        workerPath: '/vendor/tesseract/worker.min.js',
        corePath: '/vendor/tesseract/',
        langPath: '/vendor/tesseract/lang',
        gzip: true,
        logger: () => {},
      });
      return w;
    })();
    ocr.catch(() => (ocr = null));
  }
  return ocr;
}

/** Warm up OCR early (it downloads ~7 MB once), so the check itself is quick. */
export function preloadOcr(): void {
  void ocrWorker().catch(() => {});
}

export async function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}

export type OcrWord = { text: string; confidence: number };

/** Draws the image at OCR-friendly size; mode picks plain, black-on-white threshold, or inverted threshold. */
type Mode = 'plain' | 'bin' | 'inv' | 'local' | 'localInv';

/** Local (adaptive) threshold: a pixel is "ink" if it is much lighter than its neighbourhood (or darker, when inverted). */
function localThreshold(lum: Uint8Array, w: number, h: number, invert: boolean): Uint8Array {
  const r = Math.max(8, Math.round(Math.min(w, h) / 40));
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += lum[y * w + x]!;
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1]! + row;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const area = (y1 - y0) * (x1 - x0);
      const s = I[y1 * (w + 1) + x1]! - I[y0 * (w + 1) + x1]! - I[y1 * (w + 1) + x0]! + I[y0 * (w + 1) + x0]!;
      const m = s / area, v = lum[y * w + x]!;
      const ink = invert ? v < m - 18 : v > m + 18;
      out[y * w + x] = ink ? 0 : 255;
    }
  }
  return out;
}

function prepared(img: HTMLImageElement, mode: Mode): HTMLCanvasElement {
  const target = 1024;
  const scale = target / Math.max(img.naturalWidth, img.naturalHeight);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.imageSmoothingQuality = 'high';
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, 0, 0, c.width, c.height);
  if (mode === 'plain') return c;
  const d = x.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  // Otsu threshold on luminance
  const hist = new Array(256).fill(0);
  const lum = new Uint8Array(p.length / 4);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) {
    const l = Math.round(0.299 * p[i]! + 0.587 * p[i + 1]! + 0.114 * p[i + 2]!);
    lum[j] = l;
    hist[l]++;
  }
  if (mode === 'local' || mode === 'localInv') {
    const t = localThreshold(lum, c.width, c.height, mode === 'localInv');
    for (let i = 0, j = 0; i < p.length; i += 4, j++) p[i] = p[i + 1] = p[i + 2] = t[j]!;
    x.putImageData(d, 0, 0);
    return c;
  }
  const total = lum.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  for (let i = 0, j = 0; i < p.length; i += 4, j++) {
    let v = lum[j]! > thr ? 255 : 0;
    if (mode === 'inv') v = 255 - v;
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  x.putImageData(d, 0, 0);
  return c;
}

/**
 * Words that OCR finds on the image, over three passes (plain, thresholded, inverted), so light letters
 * on a busy picture are found too. Only words with letters are returned, with their own confidence.
 */
export async function readWords(img: HTMLImageElement): Promise<OcrWord[]> {
  const w = await ocrWorker();
  const out: OcrWord[] = [];
  for (const mode of ['plain', 'bin', 'inv', 'local', 'localInv'] as const) {
    const r = await w.recognize(prepared(img, mode), {}, { blocks: true, text: false });
    for (const b of r.data.blocks ?? []) for (const para of b.paragraphs) for (const line of para.lines) for (const word of line.words) {
      if (/\p{L}/u.test(word.text)) out.push({ text: word.text, confidence: word.confidence });
    }
  }
  return out;
}

/** Back-compat: all words joined, with the best word confidence. */
export async function readText(img: HTMLImageElement): Promise<{ text: string; confidence: number; words: OcrWord[] }> {
  const words = await readWords(img);
  return { text: words.map((x) => x.text).join(' '), confidence: words.reduce((m, x) => Math.max(m, x.confidence), 0), words };
}

export async function audioSeconds(bytes: ArrayBuffer): Promise<number> {
  const Ctx = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new Ctx(1, 44100, 44100);
  const buf = await ctx.decodeAudioData(bytes.slice(0));
  return buf.duration;
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
