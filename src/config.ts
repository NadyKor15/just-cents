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
export const PAID_EXAMPLE: { net: Net; txid: string } = { net: 'mainnet', txid: '7c0d6eee018e53aa15c02b3111a26fe979dba7537a3b76abbce3b1382c8d0877' };

/** BLAZE banner links. Empty until they exist; the banner then shows the link as not ready yet. */
export const BANNER = {
  slides: '', // Widget Factory slides
  repo: '', // public repo, after the owner's go-ahead
  readme: '',
};

/** Public keys that sign each specialist's offers. */
export const OFFER_PUBKEY: Record<'cover' | 'sam' | 'lena' | 'logo', string> = {
  cover: '039fbd87348d91f9e0689e1e011ddf406dccbf832238df7b514ae711ae53f6826b',
  sam: '0214ffd7211c47baeafbfd82f7f4c7da11c7e9931d8c95fceb97ebd0d9a5dff6ef',
  lena: '02240616b674e5f2b06907420914d21907493ea4ef31845beb74f4040d1a7b13a2',
  logo: '026798be40e18f30a32c9394a49da576d3aa939df88b24ffd647b286eed710c5f5',
};
