// Rules for music for a clip, checked on the delivered mp3 itself:
//  1. length: 15.0 s ± 0.1 s (measured by decoding the audio, not by trusting a tag);
//  2. licence: from an allowed list, written into the file (ID3 TXXX frames LICENSE, LICENSE_TEXT, SOURCE_URL),
//     with the full licence text present; CC BY also needs the author's name in the file.
// Not checked: whether the source page really says so today. That we check by hand before publishing a piece
// (the pages are saved next to the source files).

export const MUSIC_SECONDS = 15;
export const MUSIC_TOLERANCE = 0.1;

/** Allowed licences and a phrase their full text must contain. */
export const ALLOWED_LICENSES: Record<string, { name: string; textMarker: RegExp; needsAuthor: boolean }> = {
  'CC0-1.0': { name: 'CC0 1.0', textMarker: /CC0 1\.0 Universal/, needsAuthor: false },
  'CC-BY-4.0': { name: 'CC BY 4.0', textMarker: /Attribution 4\.0 International/, needsAuthor: true },
};

export type Id3 = { title?: string; artist?: string; txxx: Record<string, string> };

function syncsafe(b: Uint8Array, o: number): number {
  return ((b[o]! & 0x7f) << 21) | ((b[o + 1]! & 0x7f) << 14) | ((b[o + 2]! & 0x7f) << 7) | (b[o + 3]! & 0x7f);
}

function decodeText(enc: number, b: Uint8Array): string {
  if (enc === 0) return new TextDecoder('latin1').decode(b);
  if (enc === 1) return new TextDecoder('utf-16').decode(b); // with BOM
  if (enc === 2) return new TextDecoder('utf-16be').decode(b);
  return new TextDecoder('utf-8').decode(b);
}

/** Read the ID3v2.3/2.4 tag at the start of an mp3. */
export function readId3(buf: ArrayBuffer): Id3 | null {
  const b = new Uint8Array(buf);
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null; // "ID3"
  const ver = b[3]!;
  const size = syncsafe(b, 6);
  const end = Math.min(b.length, 10 + size);
  const out: Id3 = { txxx: {} };
  let o = 10;
  while (o + 10 <= end) {
    const id = String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
    if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding
    const fsize = ver >= 4 ? syncsafe(b, o + 4) : (b[o + 4]! << 24) | (b[o + 5]! << 16) | (b[o + 6]! << 8) | b[o + 7]!;
    const body = b.subarray(o + 10, o + 10 + fsize);
    o += 10 + fsize;
    if (!body.length) continue;
    const enc = body[0]!;
    const rest = body.subarray(1);
    if (id === 'TIT2') out.title = decodeText(enc, rest).replace(/\0+$/, '');
    else if (id === 'TPE1') out.artist = decodeText(enc, rest).replace(/\0+$/, '');
    else if (id === 'TXXX') {
      const s = decodeText(enc, rest);
      const i = s.indexOf('\0');
      if (i > 0) out.txxx[s.slice(0, i).toUpperCase()] = s.slice(i + 1).replace(/^\0+/, '').replace(/\0+$/, '');
    }
  }
  return out;
}

export type MusicVerdict = { ok: boolean; reason: string; seconds: number; license: string | null; author: string | null; source: string | null };

/** `seconds` is the decoded length (the page measures it with OfflineAudioContext, tests pass it in). */
export function checkMusic(buf: ArrayBuffer, seconds: number): MusicVerdict {
  const tag = readId3(buf);
  const license = tag?.txxx['LICENSE'] ?? null;
  const author = tag?.artist?.trim() || null;
  const source = tag?.txxx['SOURCE_URL'] ?? null;
  const base = { seconds: Math.round(seconds * 100) / 100, license, author, source };
  if (Math.abs(seconds - MUSIC_SECONDS) > MUSIC_TOLERANCE) {
    return { ok: false, reason: `asked for ${MUSIC_SECONDS}.0 s, got ${seconds.toFixed(1)} s`, ...base };
  }
  const rule = license ? ALLOWED_LICENSES[license] : undefined;
  if (!license) return { ok: false, reason: 'no licence in the file', ...base };
  if (!rule) return { ok: false, reason: `licence ${license} is not on the allowed list (CC0 1.0, CC BY 4.0)`, ...base };
  if (!rule.textMarker.test(tag?.txxx['LICENSE_TEXT'] ?? '')) return { ok: false, reason: `the ${rule.name} licence text is missing from the file`, ...base };
  if (!source || !/^https:\/\//.test(source)) return { ok: false, reason: 'no source page in the file', ...base };
  if (rule.needsAuthor && !author) return { ok: false, reason: `${rule.name} needs the author's name in the file`, ...base };
  return { ok: true, reason: `${seconds.toFixed(1)} s, ${rule.name}${author ? ` by ${author}` : ''}`, ...base };
}
