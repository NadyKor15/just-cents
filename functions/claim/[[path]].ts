// Pages Function: POST /claim/<offer>?net=…&txid=… — a demo specialist reveals its file key on chain and takes its payment.
import { claim, type ClaimEnv } from '../../worker/claim';

export const onRequest = (ctx: { request: Request; env: ClaimEnv }) => claim(new URL(ctx.request.url), ctx.request.method, ctx.env);
