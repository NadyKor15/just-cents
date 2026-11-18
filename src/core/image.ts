// Plain-code image measurements shared by the cover and logo rules. Pixels come in as RGBA bytes
// (canvas getImageData in the browser, synthetic arrays in tests), so the numbers are the same everywhere.

export type Gray = { w: number; h: number; px: Float32Array };

/** Luma 0..255 (BT.601), alpha ignored. */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const px = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) px[i] = 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!;
  return { w, h, px };
}

/** The lowest alpha in the image: 255 means fully opaque. */
export function alphaMin(rgba: Uint8ClampedArray | Uint8Array): number {
  let m = 255;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! < m) m = rgba[i]!;
  return m;
}

/** Ordinary bilinear stretch: what you get by just making a picture bigger, with no new detail. */
export function resizeBilinear(g: Gray, w: number, h: number): Gray {
  const px = new Float32Array(w * h);
  const sx = (g.w - 1) / Math.max(1, w - 1), sy = (g.h - 1) / Math.max(1, h - 1);
  for (let y = 0; y < h; y++) {
    const fy = y * sy, y0 = Math.floor(fy), y1 = Math.min(g.h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = x * sx, x0 = Math.floor(fx), x1 = Math.min(g.w - 1, x0 + 1), tx = fx - x0;
      const a = g.px[y0 * g.w + x0]!, b = g.px[y0 * g.w + x1]!, c = g.px[y1 * g.w + x0]!, d = g.px[y1 * g.w + x1]!;
      px[y * w + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return { w, h, px };
}

/** Sharpness: variance of the 4-neighbour Laplacian. More fine detail and crisper edges give a larger number. */
export function sharpness(g: Gray): number {
  let n = 0, s = 0, s2 = 0;
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      const i = y * g.w + x;
      const l = g.px[i - 1]! + g.px[i + 1]! + g.px[i - g.w]! + g.px[i + g.w]! - 4 * g.px[i]!;
      n++; s += l; s2 += l * l;
    }
  }
  return n ? s2 / n - (s / n) ** 2 : 0;
}

/** Box-average down to size×size (both sides), so a stroke a pixel thicker or a hand line a little off is the same drawing. */
export function boxTo(g: Gray, size: number): Gray {
  const px = new Float32Array(size * size), n = new Float32Array(size * size);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = Math.min(size - 1, Math.floor((y * size) / g.h)) * size + Math.min(size - 1, Math.floor((x * size) / g.w));
    px[i]! += g.px[y * g.w + x]!; n[i]! += 1;
  }
  for (let i = 0; i < px.length; i++) px[i] = n[i] ? px[i]! / n[i]! : 255;
  return { w: size, h: size, px };
}

/**
 * Likeness of a traced logo to its sketch: SSIM on both drawings brought down to 32×32, drawn blocks only.
 * Synthetic 256 px circle, stroke 6: stroke 9 → 0.95, shifted 2 px → 0.88, a square instead → 0.24 (bar 0.85).
 */
export const likeness = (sketch: Gray, traced: Gray, size = 32) => ssim(boxTo(sketch, size), boxTo(traced, size), true);

/**
 * Structural similarity (SSIM) of two same-size grey images, mean over 8×8 blocks; 1 = the same picture.
 * inkOnly: count only blocks where at least one image has something drawn. For line art on a plain background,
 * the empty blocks score 1 in any two drawings and would make a circle "like" a square.
 */
export function ssim(a: Gray, b: Gray, inkOnly = false): number {
  if (a.w !== b.w || a.h !== b.h) throw new Error('ssim: sizes differ');
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2, B = 8;
  let sum = 0, blocks = 0;
  for (let by = 0; by + B <= a.h; by += B) {
    for (let bx = 0; bx + B <= a.w; bx += B) {
      let ma = 0, mb = 0;
      for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) { ma += a.px[y * a.w + x]!; mb += b.px[y * a.w + x]!; }
      ma /= B * B; mb /= B * B;
      let va = 0, vb = 0, cov = 0;
      for (let y = by; y < by + B; y++) {
        for (let x = bx; x < bx + B; x++) {
          const da = a.px[y * a.w + x]! - ma, db = b.px[y * a.w + x]! - mb;
          va += da * da; vb += db * db; cov += da * db;
        }
      }
      va /= B * B - 1; vb /= B * B - 1; cov /= B * B - 1;
      if (inkOnly && va < 1 && vb < 1 && Math.abs(ma - mb) < 1) continue;
      sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      blocks++;
    }
  }
  return blocks ? sum / blocks : 0;
}
