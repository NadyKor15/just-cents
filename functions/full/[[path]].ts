// Pages Function: /full/<offer>?net=…&txid=… — the specialist's full file, only after payment is seen on chain.
import { release, type Env } from '../../worker/index';

export const onRequest = (ctx: { request: Request; env: Env }) => release(new URL(ctx.request.url), ctx.env);
