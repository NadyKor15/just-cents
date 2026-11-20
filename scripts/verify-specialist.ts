// Checks an open specialist's book before it is listed — the same checks a buyer's page makes before paying, plus that
// the claim server answers. Anyone can run it on anyone's book; it needs no secrets.
//   node scripts/run.mjs scripts/verify-specialist.ts --specialist specialists/<you> [--remote]
// --remote takes the sealed files from the claim server (claimUrl + sealed path) instead of the folder, and asks the
// claim server one GET (it must answer 405 "POST /claim/…": alive, and only claims on POST).
// Exit code 0 only if every check passes.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { binToHex, sha256 } from '@bitauth/libauth';
import type { Net } from '../src/core/chain';
import { offerHash2Hex, verifyOffer2 } from '../src/core/offer';
import { lockingFor } from '../src/core/tx';
import type { SpecialistBook, SpecialistRow } from './sign-offers-v2';
import { specialistDir } from './specialist-lib';

export type Check = { ok: boolean; what: string };

export type VerifyIo = {
  /** the sealed file a row names, or null if it cannot be had */
  readSealed: (net: Net, row: SpecialistRow) => Promise<Uint8Array | null>;
  /** GET <url>: status and body; left out, the claim server is not asked */
  get?: (url: string) => Promise<{ status: number; body: string }>;
  nowSec: number;
};

const PREFIX: Record<Net, string> = { mainnet: 'bitcoincash:', chipnet: 'bchtest:' };

export async function verifyBook(book: SpecialistBook, io: VerifyIo): Promise<Check[]> {
  const out: Check[] = [];
  const say = (ok: boolean, what: string) => out.push({ ok, what });
  const nets = (Object.keys(book) as Net[]).filter((n) => n === 'mainnet' || n === 'chipnet');
  if (nets.length === 0 || Object.keys(book).some((n) => n !== 'mainnet' && n !== 'chipnet')) say(false, 'the book has mainnet and/or chipnet, nothing else');
  for (const net of nets) {
    for (const [key, row] of Object.entries(book[net] ?? {})) {
      const at = `${net} ${key}`;
      const o = row?.v2?.signed?.offer;
      if (!o) {
        say(false, `${at}: no version 2 offer`);
        continue;
      }
      const sig = verifyOffer2(row.v2.signed, { orderId: '00'.repeat(16), nowSec: io.nowSec, pubkey: o.pubkey });
      say(sig.ok, `${at}: offer signed by its own key, not expired${sig.ok ? '' : ` — ${sig.reason}`}`);
      say(row.v2.offerHashHex === offerHash2Hex(o), `${at}: the book's offer fingerprint is the offer's`);
      let payOk = false;
      try {
        payOk = o.payTo.startsWith(PREFIX[net]) && row.v2.payToLockingHex === binToHex(lockingFor(o.payTo));
      } catch {
        payOk = false;
      }
      say(payOk, `${at}: pays a ${PREFIX[net]} address, and the book's locking bytecode is that address`);
      say(o.claimPubkey !== o.pubkey, `${at}: the claim key is not the offer key (the server holds only the claim key)`);
      say(row.v2.sealed === `/enc/${net}/${row.file}.jce`, `${at}: sealed file at /enc/${net}/${row.file}.jce`);
      const sealed = await io.readSealed(net, row).catch(() => null);
      say(!!sealed && binToHex(sha256.hash(sealed)) === o.cipherSha256, `${at}: the sealed file's fingerprint is the signed one${sealed ? '' : ' (file not found)'}`);
      const url = row.claimUrl ?? '';
      const goodUrl = /^https:\/\/[^\s/]+(\/\S*)?$/.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url);
      say(goodUrl && !url.endsWith('/'), `${at}: claim URL is https (or localhost while testing), no trailing slash`);
      if (io.get && goodUrl) {
        const r = await io.get(`${url}/claim/${encodeURIComponent(key)}?net=${net}`).catch((e) => ({ status: 0, body: String(e) }));
        say(r.status === 405 && /POST \/claim\//.test(r.body), `${at}: the claim server answers (GET → ${r.status}, wants POST)`);
      }
    }
  }
  return out;
}

if (process.argv[1]?.includes('verify-specialist')) {
  const dir = specialistDir();
  if (!dir) throw new Error('--specialist <folder with offers.json>');
  const remote = process.argv.includes('--remote');
  const bookFile = join(dir, 'offers.json');
  if (!existsSync(bookFile)) throw new Error(`${bookFile} is missing: sign your offers first`);
  const book = JSON.parse(readFileSync(bookFile, 'utf8')) as SpecialistBook;
  const get = async (url: string) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    return { status: r.status, body: await r.text() };
  };
  const checks = await verifyBook(book, {
    nowSec: Math.floor(Date.now() / 1000),
    readSealed: async (_net, row) => {
      if (!remote) return new Uint8Array(readFileSync(join(dir, 'public', row.v2.sealed)));
      const r = await fetch(`${row.claimUrl}${row.v2.sealed}`, { signal: AbortSignal.timeout(60_000) });
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    },
    get: remote ? get : undefined,
  });
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.what}`);
  const bad = checks.filter((c) => !c.ok).length;
  console.log(bad ? `${bad} of ${checks.length} checks failed` : `all ${checks.length} checks passed`);
  process.exitCode = bad ? 1 : 0;
}
