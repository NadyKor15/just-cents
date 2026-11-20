// The first screen (her TG 9507, then TG 9516): headline, one accent line, one line of explanation; next to "See a paid
// order" the mainnet refund proof with its two transactions. Both stages (desktop, phone) carry the same text.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REFUND_PROOF, PAID_EXAMPLE } from '../src/config';
import { explorerTx } from '../src/core/chain';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const stages = html.split('<section class="stage ').slice(1);

describe('first screen', () => {
  it('both stages, top down: headline, one accent line, one line of explanation (her TG 9516)', () => {
    expect(stages).toHaveLength(2);
    for (const s of stages) {
      expect(s).toMatch(/<h1 class="h1">Cents for work you(<br>| )accept\.(<br>| )Nothing else\.<\/h1>\s*<p class="lead">Specialists do the work\. You pay only for what passes\.<\/p>\s*<p class="sub">An AI helper hires AI specialists and checks every piece against rules set before the work starts\.<\/p>/);
    }
  });

  it('the removed lines are gone from the first screen', () => {
    for (const gone of ['Rejected work costs 0¢', 'Press Start to see it work', 'Each piece is checked before you pay a single cent', 'class="proof"', 'class="essence"', 'start-hint']) expect(html).not.toContain(gone);
  });

  it('both stages have the refund proof right after "See a paid order", hidden until the page fills its links', () => {
    for (const s of stages) {
      expect(s).toMatch(/data-paid-example hidden>See a paid order <span>\(no wallet\)<\/span><\/a>\s*<p class="refund-proof" data-refund-proof hidden>/);
      expect(s).toContain('Mainnet refused an early refund, then gave the money back with no signature:');
      expect(s).toMatch(/<a data-tx="payment"[^>]*target="_blank" rel="noopener">payment<\/a> · <a data-tx="refund"[^>]*target="_blank" rel="noopener">refund<\/a>/);
    }
  });

  it('the proof names the two mainnet transactions read back on chain (payment, refund), not the paid example', () => {
    expect(REFUND_PROOF.net).toBe('mainnet');
    expect(REFUND_PROOF.payment).toBe('29c9b46fa5e5a67189c6e4bba685da1546d9c532f18f8ead8413f5e4742690dc');
    expect(REFUND_PROOF.refund).toBe('2f0af2f2fc6c5d1b127cf78b4749a9249ff339c8787dbee90e84c0d8c26675b2');
    expect(REFUND_PROOF.payment).not.toBe(PAID_EXAMPLE.txid);
    expect(explorerTx(REFUND_PROOF.net, REFUND_PROOF.refund)).toBe(`https://explorer.bch.ninja/tx/${REFUND_PROOF.refund}`);
  });

  it('no "kit" or "набор" in the new lines', () => {
    const lines = [...html.matchAll(/<p class="(lead|sub|refund-proof)[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[2]!.replace(/<[^>]+>/g, ''));
    expect(lines).toHaveLength(6);
    for (const l of lines) expect(l).not.toMatch(/\bkits?\b|набор/i);
  });
});
