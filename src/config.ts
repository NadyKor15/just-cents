// Public configuration. Addresses only: no keys live in the site.
import type { Net } from './core/chain';

type ByNet = Record<Net, string>;

/** Payout addresses of the demo specialists and the service. The keys stay offline. */
export const PAYOUT: Record<'icon' | 'sam' | 'lena' | 'voice' | 'service', ByNet> = {
  icon: { mainnet: 'bitcoincash:qplw5l88wxt2chzufr3rm22pfxkgaeu3vscyy08d82', chipnet: 'bchtest:qplw5l88wxt2chzufr3rm22pfxkgaeu3vsukqg96qk' },
  sam: { mainnet: 'bitcoincash:qpdsappf99xzval2l6ps8x29204y8uyasyjfhv2frv', chipnet: 'bchtest:qpdsappf99xzval2l6ps8x29204y8uyasykmntg7ys' },
  lena: { mainnet: 'bitcoincash:qrzvk9ujc48fylttn48f3tkkjnmetpx6vqf95pw6pd', chipnet: 'bchtest:qrzvk9ujc48fylttn48f3tkkjnmetpx6vqdhsxvdx3' },
  voice: { mainnet: 'bitcoincash:qz7t9gc3y9m89wzmj3x7zderx2e9f72lrcusk940hk', chipnet: 'bchtest:qz7t9gc3y9m89wzmj3x7zderx2e9f72lrcczjzhcs2' },
  service: { mainnet: 'bitcoincash:qqczcf6dcqm62u0prm2qnre4655w5236qy0mrh6734', chipnet: 'bchtest:qqczcf6dcqm62u0prm2qnre4655w5236qytf8scfkf' },
};

/** BLAZE banner links. Empty until they exist; the banner then shows the link as not ready yet. */
export const BANNER = {
  slides: '', // Widget Factory slides
  repo: '', // public repo, after the owner's go-ahead
  readme: '',
};

/** Public keys that sign each specialist's offers. */
export const OFFER_PUBKEY: Record<'icon' | 'sam' | 'lena' | 'voice', string> = {
  icon: '039fbd87348d91f9e0689e1e011ddf406dccbf832238df7b514ae711ae53f6826b',
  sam: '0214ffd7211c47baeafbfd82f7f4c7da11c7e9931d8c95fceb97ebd0d9a5dff6ef',
  lena: '02240616b674e5f2b06907420914d21907493ea4ef31845beb74f4040d1a7b13a2',
  voice: '026798be40e18f30a32c9394a49da576d3aa939df88b24ffd647b286eed710c5f5',
};
