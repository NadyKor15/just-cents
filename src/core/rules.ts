// Acceptance rules, published before any work starts and checked by plain code.
// The inputs (image size, recognised text, detected language, audio length) are measured by the caller;
// these functions only decide, so they are easy to test and the same everywhere.
import { franc } from 'franc';

export type Verdict = { ok: true; note: string } | { ok: false; reason: string };

export const RULES = {
  icon: { width: 1024, height: 1024, maxLetters: 0, text: 'Icon: 1024×1024, no letters.' },
  description: { languages: ['es', 'fr', 'de'] as const, minWords: 60, maxWords: 140, text: 'Description: about 100 words, in Spanish, French and German.' },
  voice: { minSec: 10, maxSec: 15, text: 'Voice-over: 10 to 15 seconds.' },
};

export const LANG_NAMES: Record<string, string> = {
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  en: 'English',
};

/** franc answers in ISO 639-3; we speak ISO 639-1. */
const ISO3_TO_1: Record<string, string> = { spa: 'es', fra: 'fr', deu: 'de', por: 'pt', ita: 'it', eng: 'en', cat: 'ca', glg: 'gl', nld: 'nl' };

/** Language of a text, ISO 639-1, or "und" if unsure. Limited to languages a store kit could plausibly contain. */
export function detectLanguage(text: string): string {
  const code = franc(text, { minLength: 10, only: Object.keys(ISO3_TO_1) });
  return ISO3_TO_1[code] ?? 'und';
}

export function checkLanguage(text: string, expected: string): Verdict {
  const got = detectLanguage(text);
  const want = LANG_NAMES[expected] ?? expected;
  if (got === expected) return { ok: true, note: `${want}, as asked` };
  const gotName = LANG_NAMES[got] ?? (got === 'und' ? 'an unknown language' : got);
  return { ok: false, reason: `asked for ${want}, got ${gotName}` };
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** The description is checked per language on the first sentence shown in the preview and, after payment, on the full text. */
export function checkDescription(byLang: Record<string, string>, opts: { full: boolean }): Verdict {
  for (const lang of RULES.description.languages) {
    const t = byLang[lang];
    if (!t) return { ok: false, reason: `missing ${LANG_NAMES[lang]}` };
    const v = checkLanguage(t, lang);
    if (!v.ok) return v;
    if (opts.full) {
      const n = countWords(t);
      if (n < RULES.description.minWords || n > RULES.description.maxWords) {
        return { ok: false, reason: `${LANG_NAMES[lang]} text is ${n} words, asked about 100` };
      }
    }
  }
  return { ok: true, note: 'Spanish, French and German, as asked' };
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
