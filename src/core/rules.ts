// Acceptance rules, published before any work starts and checked by plain code.
// The inputs (image size, recognised text, audio length, licence tags) are measured by the caller;
// these functions only decide, so they are easy to test and the same everywhere.
import { ALLOWED_LICENSES, MUSIC_SECONDS, MUSIC_TOLERANCE, checkMusic } from './music';

export type Verdict = { ok: true; note: string } | { ok: false; reason: string };

export const RULES = {
  icon: { width: 1024, height: 1024, maxLetters: 0, text: 'Icon: 1024×1024, no letters.' },
  music: { seconds: MUSIC_SECONDS, tolerance: MUSIC_TOLERANCE, text: 'Music for the clip: exactly 15 s, CC0 or CC BY, the licence written into the file.' },
  voice: { minSec: 10, maxSec: 15, text: 'Voice-over: 10 to 15 seconds.' },
};

/**
 * Music as the specialist declares it in the signed offer: "<seconds>s;<SPDX licence>;<author>".
 * The page checks the same things again on the file itself (decoded length, licence frames and text).
 */
export function checkMusicDeclared(facts: string): Verdict {
  const [secPart, license = '', author = ''] = facts.split(';');
  const sec = parseFloat(secPart ?? '');
  if (!Number.isFinite(sec)) return { ok: false, reason: 'length unknown' };
  if (Math.abs(sec - MUSIC_SECONDS) > MUSIC_TOLERANCE) return { ok: false, reason: `asked for ${MUSIC_SECONDS}.0 s, got ${sec.toFixed(1)} s` };
  const rule = ALLOWED_LICENSES[license];
  if (!rule) return { ok: false, reason: license ? `licence ${license} is not on the allowed list (CC0 1.0, CC BY 4.0)` : 'no licence' };
  if (rule.needsAuthor && !author) return { ok: false, reason: `${rule.name} needs the author's name` };
  return { ok: true, note: `${sec.toFixed(1)} s, ${rule.name}${author ? ` by ${author}` : ''}` };
}

/** The same rules on the delivered mp3: decoded length plus the licence written into the file. */
export function checkMusicFile(buf: ArrayBuffer, seconds: number): Verdict {
  const v = checkMusic(buf, seconds);
  return v.ok ? { ok: true, note: v.reason } : { ok: false, reason: v.reason };
}

/**
 * Letters found by OCR. Artwork makes OCR "see" stray one- or two-character shapes, so only readable words count:
 * at least 3 letters, read with confidence 70 or more. Measured on the demo icons: the word "PLAY" reads at 77–80,
 * shapes in a clean icon read as 1–2 characters.
 */
export const OCR_MIN_WORD_LETTERS = 3;
export const OCR_MIN_CONFIDENCE = 70;
export function countLetters(words: { text: string; confidence: number }[]): number {
  return words
    .filter((w) => w.confidence >= OCR_MIN_CONFIDENCE)
    .map((w) => (w.text.match(/\p{L}/gu) ?? []).length)
    .filter((n) => n >= OCR_MIN_WORD_LETTERS)
    .reduce((s, n) => s + n, 0);
}

export function checkIcon(m: { width: number; height: number; letters: number; preview: boolean }): Verdict {
  if (!m.preview && (m.width !== RULES.icon.width || m.height !== RULES.icon.height)) {
    return { ok: false, reason: `asked for 1024×1024, got ${m.width}×${m.height}` };
  }
  if (m.letters > RULES.icon.maxLetters) return { ok: false, reason: 'asked for no text, the icon has letters' };
  return { ok: true, note: m.preview ? 'no letters' : '1024×1024, no letters' };
}

export function checkVoice(m: { seconds: number; preview: boolean; declaredSeconds?: number }): Verdict {
  const sec = m.preview ? (m.declaredSeconds ?? NaN) : m.seconds;
  if (!Number.isFinite(sec)) return { ok: false, reason: 'length unknown' };
  const shown = Math.round(sec * 10) / 10;
  if (sec < RULES.voice.minSec) return { ok: false, reason: `asked for 10–15 s, got ${shown} s` };
  if (sec > RULES.voice.maxSec) return { ok: false, reason: `asked for up to 15 s, got ${shown} s` };
  return { ok: true, note: `${shown} s` };
}
