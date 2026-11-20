// Public configuration. Addresses only: no keys live in the site.
import type { Net } from './core/chain';

type ByNet = Record<Net, string>;

/**
 * Payout addresses of the demo specialists and the service. The keys stay offline.
 * The cover and logo specialists use the key pairs first made for the icon and voice-over (vault: ICON, VOICE).
 */
export const PAYOUT: Record<'cover' | 'sam' | 'lena' | 'logo' | 'service', ByNet> = {
  cover: { mainnet: 'bitcoincash:qplw5l88wxt2chzufr3rm22pfxkgaeu3vscyy08d82', chipnet: 'bchtest:qplw5l88wxt2chzufr3rm22pfxkgaeu3vsukqg96qk' },
  sam: { mainnet: 'bitcoincash:qpdsappf99xzval2l6ps8x29204y8uyasyjfhv2frv', chipnet: 'bchtest:qpdsappf99xzval2l6ps8x29204y8uyasykmntg7ys' },
  lena: { mainnet: 'bitcoincash:qrzvk9ujc48fylttn48f3tkkjnmetpx6vqf95pw6pd', chipnet: 'bchtest:qrzvk9ujc48fylttn48f3tkkjnmetpx6vqdhsxvdx3' },
  logo: { mainnet: 'bitcoincash:qz7t9gc3y9m89wzmj3x7zderx2e9f72lrcusk940hk', chipnet: 'bchtest:qz7t9gc3y9m89wzmj3x7zderx2e9f72lrcczjzhcs2' },
  service: { mainnet: 'bitcoincash:qqczcf6dcqm62u0prm2qnre4655w5236qy0mrh6734', chipnet: 'bchtest:qqczcf6dcqm62u0prm2qnre4655w5236qytf8scfkf' },
};

/**
 * A real order paid on chain, shown to anyone without a wallet ("See a paid order"). Empty txid = the link is not shown
 * at all. Set only to a payment of the current offers (the page reads it from the network and checks it).
 */
export const PAID_EXAMPLE: { net: Net; txid: string } = { net: 'mainnet', txid: '9896c765fa549d1cade82034efcc8b557f6edbc8d54c9a2fbb7de0f499a03998' }; // version 2: paid into contracts with Selene, 20.11.2026

/**
 * Proof next to "See a paid order" that the money really comes back: a payment into a contract on mainnet whose early
 * refund the network refused (bad-txns-nonfinal), and the refund it then paid back with no signature once its time
 * passed (5 016 sat to the buyer). Read back from two Fulcrum servers 20.11.2026. Empty = the line is not shown.
 */
export const REFUND_PROOF: { net: Net; payment: string; refund: string } = {
  net: 'mainnet',
  payment: '29c9b46fa5e5a67189c6e4bba685da1546d9c532f18f8ead8413f5e4742690dc',
  refund: '2f0af2f2fc6c5d1b127cf78b4749a9249ff339c8787dbee90e84c0d8c26675b2',
};

/** Earlier paid examples (version 1, JC1 note), still opened from old links; their released files may stay at the edge too. */
export const EARLIER_PAID_EXAMPLES: { net: Net; txid: string }[] = [{ net: 'mainnet', txid: '7c0d6eee018e53aa15c02b3111a26fe979dba7537a3b76abbce3b1382c8d0877' }];

/** BLAZE banner links. Empty until they exist; the banner then shows the link as not ready yet. */
export const BANNER = {
  slides: '/just-cents-slides.pdf', // the deck, served by this site
  repo: '', // public repo, after the owner's go-ahead
  readme: '',
};

/**
 * Public keys that sign each specialist's claims (v2: the hash-lock contract's specialist key). Separate from the
 * offer keys below: the server that claims holds these, never the keys that sign offers (vault team-nadya /just-cents).
 */
export const CLAIM_PUBKEY: Record<'cover' | 'sam' | 'lena' | 'logo', string> = {
  cover: '03f34f6a9427d2aab8bbdee6c64bb7c921f10fd64fcd36a8297409f168e720d27e',
  sam: '0342712e30437c5751fc89ed25d505f9c1f6e72010c5f54f73ba434bea003c41b1',
  lena: '0317b60f89a5fb55c2bc6eeae5f0a9115839e4ddeebf9151a5fc121198aa9c089f',
  logo: '038bf2bb59ed64f3d3acd436a8f24c2c2b8a1a5a5cae8fb14890c52a9c7f0c55fd',
};

/** Public keys that sign each specialist's offers. */
export const OFFER_PUBKEY: Record<'cover' | 'sam' | 'lena' | 'logo', string> = {
  cover: '039fbd87348d91f9e0689e1e011ddf406dccbf832238df7b514ae711ae53f6826b',
  sam: '0214ffd7211c47baeafbfd82f7f4c7da11c7e9931d8c95fceb97ebd0d9a5dff6ef',
  lena: '02240616b674e5f2b06907420914d21907493ea4ef31845beb74f4040d1a7b13a2',
  logo: '026798be40e18f30a32c9394a49da576d3aa939df88b24ffd647b286eed710c5f5',
};
