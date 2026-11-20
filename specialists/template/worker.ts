// Your claim server: a Cloudflare Worker that runs the same claim code as the demo specialists (worker/claim.ts), with
// YOUR offers (./offers.json) and YOUR secrets (JC_FILE_KEY_SEED, JC_CLAIM_KEYS — from .dev.vars locally, from
// `wrangler secret put` once deployed). Nothing else of the site runs here.
//   POST /claim/<your key>?net=…&txid=<payment>   sees your contract in the payment, reveals your file key on chain,
//                                                 takes your money (the buyer's page then opens your sealed file)
//   GET  /enc/<net>/<your file>.jce               your sealed file (static, from ./public)
import { claim, claimBook, type ClaimEnv } from '../../worker/claim';
import myOffers from './offers.json';

type Book = Parameters<typeof claimBook>[1];

export default {
  async fetch(request: Request, env: ClaimEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/claim/')) return claim(url, request.method, env, (net) => claimBook(net, myOffers as unknown as Book));
    return new Response('Just Cents specialist: POST /claim/<offer>?net=…&txid=…\n', { status: 404, headers: { 'content-type': 'text/plain' } });
  },
};
