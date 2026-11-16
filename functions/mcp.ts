// Pages Function: remote MCP server for assistants (Streamable HTTP).
import { mcp } from '../worker/mcp';
import type { ApiEnv } from '../worker/api';

export const onRequest = (ctx: { request: Request; env: ApiEnv }) => mcp(ctx.request, ctx.env);
