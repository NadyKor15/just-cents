// Subtitles for a trailer: rules published before any work starts, checked by plain code.
// The yardstick for timing is a list of spoken words with their start and end (measured once on the trailer,
// before any specialist works); each subtitle line is placed on the words it says.
import type { Verdict } from './rules';

export const SUB_RULES = {
  maxChars: 42, // per text line
  maxLines: 2, // per subtitle
  maxCps: 20, // characters per second, spaces included
  toleranceSec: 0.4, // a line starts within this of its first spoken word
  maxTailSec: 2, // the last line ends no later than this after the sound ends
  text: 'Subtitles: an SRT file; up to 42 characters a line, 2 lines a subtitle, 20 characters a second; lines never overlap; each line starts within 0.4 s of its first spoken word; the last one ends within 2 s of the end of the sound.',
};

export type Cue = { n: number; start: number; end: number; lines: string[] };
export type Word = { text: string; start: number; end: number };
export type Speech = { words: Word[]; audioEnd: number };

const TIME = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})$/;
const sec = (t: string): number | null => {
  const m = TIME.exec(t.trim());
  return m ? +m[1]! * 3600 + +m[2]! * 60 + +m[3]! + +m[4]! / 1000 : null;
};

/** SRT → cues, or the first reason it cannot be read. */
export function parseSrt(text: string): { ok: true; cues: Cue[] } | { ok: false; reason: string } {
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  if (!blocks[0]) return { ok: false, reason: 'the file is empty' };
  const cues: Cue[] = [];
  for (const [i, b] of blocks.entries()) {
    const rows = b.split('\n');
    const n = Number(rows[0]?.trim());
    const times = rows[1]?.split('-->');
    const start = times && times.length === 2 ? sec(times[0]!) : null;
    const end = times && times.length === 2 ? sec(times[1]!.trim().split(/\s+/)[0]!) : null;
    if (!Number.isInteger(n) || start == null || end == null) return { ok: false, reason: `subtitle ${i + 1} is not in SRT form` };
    const lines = rows.slice(2).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return { ok: false, reason: `subtitle ${n} has no text` };
    cues.push({ n, start, end, lines });
  }
  return { ok: true, cues };
}

/** Lowercase letters and digits only, so "Friday." and "friday" are the same word. */
export const token = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const tokens = (lines: string[]) => lines.join(' ').split(/\s+/).map(token).filter(Boolean);
const s1 = (x: number) => `${Math.round(Math.abs(x) * 10) / 10} s`;

/**
 * Finds where a subtitle's words are spoken: the first of its first three words that appears in the next
 * `look` spoken words, counted back to where the subtitle's first word would be.
 */
function anchor(cueTokens: string[], words: string[], from: number, look = 40): number | null {
  for (let j = 0; j < Math.min(3, cueTokens.length); j++) {
    for (let r = from; r < Math.min(words.length, from + look); r++) {
      if (words[r] === cueTokens[j]) return Math.max(from, r - j);
    }
  }
  return null;
}

export function checkSubtitles(srt: string, speech: Speech): Verdict {
  const p = parseSrt(srt);
  if (!p.ok) return p;
  const R = SUB_RULES;
  const cues = p.cues;
  for (const c of cues) {
    if (c.end <= c.start) return { ok: false, reason: `subtitle ${c.n} ends before it starts` };
    if (c.lines.length > R.maxLines) return { ok: false, reason: `subtitle ${c.n} has ${c.lines.length} lines, at most ${R.maxLines}` };
    const long = c.lines.find((l) => [...l].length > R.maxChars);
    if (long) return { ok: false, reason: `subtitle ${c.n} has a line of ${[...long].length} characters, at most ${R.maxChars}` };
    const cps = [...c.lines.join(' ')].length / (c.end - c.start);
    if (cps > R.maxCps) return { ok: false, reason: `subtitle ${c.n} is too fast to read: ${Math.round(cps)} characters a second, at most ${R.maxCps}` };
  }
  for (let i = 1; i < cues.length; i++) {
    if (cues[i]!.start < cues[i - 1]!.end) return { ok: false, reason: `subtitles ${cues[i - 1]!.n} and ${cues[i]!.n} overlap` };
  }
  const last = cues[cues.length - 1]!;
  if (last.end > speech.audioEnd + R.maxTailSec) return { ok: false, reason: `the last subtitle ends ${s1(last.end - speech.audioEnd)} after the sound` };

  const spoken = speech.words.map((w) => token(w.text));
  let at = 0;
  for (const c of cues) {
    const t = tokens(c.lines);
    const a = anchor(t, spoken, at);
    if (a == null) return { ok: false, reason: `subtitle ${c.n}: its words are not in the speech` };
    const d = c.start - speech.words[a]!.start;
    if (Math.abs(d) > R.toleranceSec) return { ok: false, reason: `subtitle ${c.n} starts ${s1(d)} ${d > 0 ? 'late' : 'early'}` };
    const lastWord = a + t.length - 1;
    if (spoken[lastWord] === t[t.length - 1] && c.end < speech.words[lastWord]!.end - R.toleranceSec) {
      return { ok: false, reason: `subtitle ${c.n} disappears before its last word is said` };
    }
    at = Math.min(spoken.length, a + Math.max(1, t.length));
  }
  return { ok: true, note: `${cues.length} subtitles, on time` };
}
