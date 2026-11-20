// Shared by the open-specialist scripts (specialist-keys, seal-files --specialist, sign-offers-v2 --specialist,
// verify-specialist, test-buy): the specialist's folder, its public settings (specialist.json) and its two secret files.
//
//   specialists/<you>/specialist.json   public settings: name, part, price, file, payout addresses, claim URL
//   specialists/<you>/.dev.vars         SECRET, 0600: JC_FILE_KEY_SEED and JC_CLAIM_KEYS — what your claim server holds
//   specialists/<you>/.env.offer        SECRET, 0600: JC_OFFER_KEY — signs your offers; stays on your machine
//   specialists/<you>/public/enc/<net>/<file>.jce   your sealed file (public)
//   specialists/<you>/offers.json       your signed offers (public)
// Both secret files are ignored by git (.gitignore: .dev.vars, .env.*).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { cashAddressToLockingBytecode } from '@bitauth/libauth';
import type { Net } from '../src/core/chain';
import { parseSrt } from '../src/core/subtitles';
import { inspectSvg } from '../src/core/logo';

export type Part = 'cover' | 'subtitles' | 'logo';

export type SpecialistSpec = {
  /** your offer's name in the book and in the claim URL: lowercase letters, digits and dashes */
  key: string;
  /** shown to buyers, e.g. "Ada (subtitles)" */
  specialist: string;
  part: Part;
  priceCents: number;
  /** the price in satoshis, a decimal string: what the buyer locks for you (plus 500 sat for the network) */
  priceSats: string;
  /** your full file, relative to your folder */
  file: string;
  /** where your claims pay you, per network you sell on (at least one) */
  payTo: Partial<Record<Net, string>>;
  /** your offer stops being valid after this moment (ISO time) */
  expires: string;
  /** where your claim endpoint answers, without a trailing slash (e.g. https://ada.workers.dev or http://localhost:8787) */
  claimUrl: string;
  /** what you promise about the full file; left out, it is measured from the file (srt / svg / jpeg-png) */
  facts?: string;
};

const NETS: Net[] = ['mainnet', 'chipnet'];
const PREFIX: Record<Net, string> = { mainnet: 'bitcoincash:', chipnet: 'bchtest:' };

export function readSpec(dir: string): SpecialistSpec {
  const s = JSON.parse(readFileSync(join(dir, 'specialist.json'), 'utf8')) as SpecialistSpec;
  const bad = (why: string) => new Error(`specialist.json: ${why}`);
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(s.key ?? '')) throw bad('"key" must be 2–31 lowercase letters, digits or dashes');
  if (!s.specialist || s.specialist.length > 60) throw bad('"specialist" is the name buyers see, up to 60 characters');
  if (!['cover', 'subtitles', 'logo'].includes(s.part)) throw bad('"part" is cover, subtitles or logo');
  if (!Number.isInteger(s.priceCents) || s.priceCents < 1) throw bad('"priceCents" is a whole number of cents, at least 1');
  if (!/^[1-9][0-9]*$/.test(s.priceSats ?? '') || BigInt(s.priceSats) < 546n) throw bad('"priceSats" is a decimal string, at least 546');
  if (!s.file || !existsSync(join(dir, s.file))) throw bad(`"file" ${s.file} is not in ${dir}`);
  if (!Number.isFinite(Date.parse(s.expires))) throw bad('"expires" is an ISO time, e.g. 2026-12-31T23:59:59Z');
  if (!/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(s.claimUrl ?? '') || s.claimUrl.endsWith('/')) throw bad('"claimUrl" is http(s)://host[/path] without a trailing slash');
  const nets = netsOf(s);
  if (nets.length === 0) throw bad('"payTo" needs an address for mainnet and/or chipnet');
  for (const net of nets) {
    const a = s.payTo[net]!;
    if (!a.startsWith(PREFIX[net]) || typeof cashAddressToLockingBytecode(a) === 'string') throw bad(`"payTo.${net}" is not a ${PREFIX[net]} address`);
  }
  return s;
}

export function netsOf(s: SpecialistSpec): Net[] {
  return NETS.filter((n) => typeof s.payTo?.[n] === 'string' && s.payTo[n] !== '');
}

export const sealedName = (s: SpecialistSpec) => `${basename(s.file)}.jce`;
export const sealedPath = (dir: string, s: SpecialistSpec, net: Net) => join(dir, 'public', 'enc', net, sealedName(s));
export const sealedUrlPath = (s: SpecialistSpec, net: Net) => `/enc/${net}/${sealedName(s)}`;

/** KEY=value lines (the .dev.vars / .env format, values taken as written). Refuses a file others can read. */
export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) throw new Error(`${path} is missing: make your keys first (scripts/specialist-keys.ts)`);
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o077) throw new Error(`${path} can be read by others (mode ${mode.toString(8)}): chmod 600 ${path}`);
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.replace(/^'(.*)'$/, '$1');
  }
  return out;
}

/** Width and height of a PNG or JPEG, from its header. */
export function imageSize(b: Uint8Array): { width: number; height: number } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) throw new Error('not a JPEG file');
      const marker = b[i + 1]!;
      const len = dv.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
      i += 2 + len;
    }
  }
  throw new Error('the cover must be a PNG or JPEG file');
}

/** The facts a v2 offer promises, measured the way sign-offers.ts measures the demo files. */
export function measureFacts(part: Part, bytes: Uint8Array): string {
  if (part === 'subtitles') {
    const p = parseSrt(new TextDecoder().decode(bytes));
    if (!p.ok) throw new Error(`subtitles: ${p.reason}`);
    return `srt;${p.cues.length};${p.cues[0]!.start.toFixed(3)}`;
  }
  if (part === 'logo') {
    const s = inspectSvg(new TextDecoder().decode(bytes));
    if (!s.root) throw new Error('logo: not an SVG file');
    return `svg;${s.colors.length};${s.contours};${s.bytes}`;
  }
  const { width, height } = imageSize(bytes);
  return `${width}x${height};${bytes.length}`;
}

/** --specialist <dir> from the command line, or null. */
export function specialistDir(): string | null {
  const i = process.argv.indexOf('--specialist');
  if (i < 0) return null;
  const d = process.argv[i + 1];
  if (!d) throw new Error('--specialist <your folder, e.g. specialists/ada>');
  return d;
}
