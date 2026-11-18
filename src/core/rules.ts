// Acceptance rules, published before any work starts and checked by plain code.
// The full rules for each part live in subtitles.ts, cover.ts and logo.ts. Here: the shared verdict type, the rule texts,
// and the checks on what a specialist declares in its signed offer (used before payment, where only previews exist,
// and by the API, which never downloads full files). Every declared fact is measured again on the full file after payment.
import { COVER_RULES } from './cover';
import { LOGO_RULES } from './logo';
import { SUB_RULES, type Speech } from './subtitles';

export type Verdict = { ok: true; note: string } | { ok: false; reason: string };

export const RULES = {
  cover: { text: COVER_RULES.text },
  subtitles: { text: SUB_RULES.text },
  logo: { text: LOGO_RULES.text },
};

const s1 = (x: number) => `${Math.round(Math.abs(x) * 10) / 10} s`;

/** Cover as declared: "<width>x<height>;<bytes>". Sharpness and transparency are measured on the full file after payment. */
export function checkCoverDeclared(facts: string, frame: { width: number; height: number }): Verdict {
  const [size = '', b = ''] = facts.split(';');
  const [w, h] = size.split('x').map(Number) as [number, number];
  const bytes = b === '' ? NaN : Number(b);
  if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(bytes)) return { ok: false, reason: 'size unknown' };
  const R = COVER_RULES;
  if (w < R.minWidth || h < R.minHeight) return { ok: false, reason: `asked for at least ${R.minWidth}×${R.minHeight}, got ${w}×${h}` };
  const want = frame.width / frame.height;
  if (Math.abs(w / h - want) / want > R.aspectTolerance) return { ok: false, reason: `${w}×${h} does not keep the frame's proportions` };
  if (bytes > R.maxBytes) return { ok: false, reason: `the file is ${Math.round(bytes / 1048576)} MB, at most 25 MB` };
  return { ok: true, note: `${w}×${h}` };
}

/** Subtitles as declared: "srt;<count>;<start of the first line, s>". The first line must start on the first spoken word. */
export function checkSubtitlesDeclared(facts: string, speech: Speech): Verdict {
  const [kind, n, first] = facts.split(';');
  const start = Number(first);
  if (kind !== 'srt' || !Number.isFinite(start)) return { ok: false, reason: 'not an SRT file' };
  const word = speech.words[0];
  if (!word) return { ok: false, reason: 'no speech to check against' };
  const d = start - word.start;
  if (Math.abs(d) > SUB_RULES.toleranceSec) return { ok: false, reason: `subtitle 1 starts ${s1(d)} ${d > 0 ? 'late' : 'early'}` };
  return { ok: true, note: `${n} subtitles, the first on time` };
}

/** Logo as declared: "svg;<colours>;<outlines>;<bytes>". Likeness to the sketch is measured on the full file after payment. */
export function checkLogoDeclared(facts: string): Verdict {
  const [kind, c, o, b] = facts.split(';');
  const colours = Number(c), outlines = Number(o), bytes = Number(b);
  const R = LOGO_RULES;
  if (kind !== 'svg') return { ok: false, reason: 'not an SVG file' };
  if (!(colours <= R.maxColors)) return { ok: false, reason: `${colours} colours, at most ${R.maxColors}` };
  if (!(outlines <= R.maxContours)) return { ok: false, reason: `${outlines} outlines, at most ${R.maxContours}` };
  if (!(bytes <= R.maxBytes)) return { ok: false, reason: `the file is ${Math.round(bytes / 1024)} KB, at most 100 KB` };
  return { ok: true, note: `SVG, ${colours} colour${colours === 1 ? '' : 's'}, ${outlines} outlines` };
}
