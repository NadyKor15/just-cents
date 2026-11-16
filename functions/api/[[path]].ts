// Pages Function: the order API for assistants (see /llms.txt).
import { api, type ApiEnv } from '../../worker/api';

export const onRequest = (ctx: { request: Request; env: ApiEnv }) => api(ctx.request, ctx.env);
