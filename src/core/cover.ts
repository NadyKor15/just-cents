// A store cover made bigger from a frame of the game: rules published before any work starts, checked by plain code.
import type { Verdict } from './rules';
import { alphaMin, resizeBilinear, sharpness, toGray } from './image';

export const COVER_RULES = {
  minWidth: 2560,
  minHeight: 1600,
  aspectTolerance: 0.01, // same proportions as the frame, within 1 %
  maxBytes: 25 * 1024 * 1024,
  sharpnessGain: 1.1, // at least 10 % sharper than the same frame just stretched to the same size
  text: 'Cover: at least 2560×1600, the same proportions as the game frame, no transparency, up to 25 MB, and sharper than the frame simply stretched to that size.',
};

export type CoverMeasure = { width: number; height: number; bytes: number; alphaMin: number; sharpness: number; baselineSharpness: number };
type Img = { rgba: Uint8ClampedArray | Uint8Array; width: number; height: number };

/** Measures a delivered cover against its source frame: the baseline is the frame stretched (bilinear) to the cover's size. */
export function measureCover(cover: Img & { bytes: number }, frame: Img): CoverMeasure {
  const g = toGray(cover.rgba, cover.width, cover.height);
  const base = resizeBilinear(toGray(frame.rgba, frame.width, frame.height), cover.width, cover.height);
  return { width: cover.width, height: cover.height, bytes: cover.bytes, alphaMin: alphaMin(cover.rgba), sharpness: sharpness(g), baselineSharpness: sharpness(base) };
}

export function checkCover(m: CoverMeasure, frame: { width: number; height: number }): Verdict {
  const R = COVER_RULES;
  if (m.width < R.minWidth || m.height < R.minHeight) return { ok: false, reason: `asked for at least ${R.minWidth}×${R.minHeight}, got ${m.width}×${m.height}` };
  const want = frame.width / frame.height, got = m.width / m.height;
  if (Math.abs(got - want) / want > R.aspectTolerance) return { ok: false, reason: `the picture is stretched: ${m.width}×${m.height} does not keep the frame's proportions (${frame.width}×${frame.height})` };
  if (m.alphaMin < 255) return { ok: false, reason: 'the cover has transparent parts' };
  if (m.bytes > R.maxBytes) return { ok: false, reason: `the file is ${Math.round(m.bytes / 1048576)} MB, at most 25 MB` };
  const gain = m.baselineSharpness > 0 ? m.sharpness / m.baselineSharpness : Infinity;
  if (gain < R.sharpnessGain) return { ok: false, reason: 'no sharper than the frame simply stretched' };
  return { ok: true, note: `${m.width}×${m.height}, ${gain === Infinity ? 'sharp' : `${gain.toFixed(1)}× sharper than a plain stretch`}` };
}
