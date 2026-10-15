/* ============================================================
   THE LIVING BREAD MCP, the agent.

   One McpAgent (a Durable Object per session, per the Cloudflare Agents SDK)
   wrapping one McpServer. The public tools, resources and prompts are
   registered for every session; the signed-in tools only when the Worker
   verified a token and handed the believer over as props; the shepherd
   tools only when the app recognises that believer as a pastor.
   ============================================================ */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';

import { registerActs } from './acts';
import { type Believer } from './auth';
import { INSTRUCTIONS, LEAN_INSTRUCTIONS, SERVER_NAME, SERVER_VERSION } from './instructions';
import { capturing, registerLean } from './lean';
import { registerLeader } from './leader';
import { registerMyDay } from './myday';
import { APP_DENY, registerAppYours, registerNamedPublic, withoutTools } from './named';
import { registerPersonal } from './personal';
import { pastorOf, registerShepherd } from './shepherd';
import { registerPresence } from './presence';
import { asYours, bindServer } from './shared';
import { instrument } from './telemetry';
import { registerOpenChairYours } from './openChair';
import { registerWatchYours } from './watch';

/** Props arrive from the Worker (src/index.ts) only on the signed-in path, after the token was verified. */
export class LivingBreadMCP extends McpAgent<Env, Record<string, never>, Partial<Believer>> {
  server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

  async init(): Promise<void> {
    const props = this.props;
    const me: Believer | null = props && typeof props.userId === 'string' && typeof props.token === 'string' ? (props as Believer) : null;
    /* The ChatGPT app profile (/app) is read-only and leaves out care matching and crisis
       services, which OpenAI's app review declines; everything else is the same server. */
    const app = me?.profile === 'app';
    /* The public endpoint (/mcp, /sse) lists the lean set: 13 tools, a mode each, over the SAME named
       implementations, which are registered into a capturing server rather than listed (src/lean.ts).
       /me and /app list the named tools exactly as before. */
    const lean = !me;
    if (lean) this.server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: LEAN_INSTRUCTIONS });
    const capture = lean ? capturing(this.server) : null;
    const server = app ? withoutTools(this.server, APP_DENY) : capture ? capture.proxy : this.server;
    /* Every answer leaves through shared.ts `finish`; it needs to know the endpoint and, for the
       idempotency of writes, this session's own storage. */
    bindServer(this.server, { env: this.env, profile: app ? 'app' : me ? 'me' : 'public', userId: me?.userId, storage: this.ctx.storage });
    registerNamedPublic(server, this.env, me, app);
    if (capture) registerLean(this.server, capture.captured);
    /* /app: the believer's own reads only (the same function the /app lock test runs, src/named.ts) */
    if (me && app) registerAppYours(server, this.env, me);
    if (me && !app) {
      const yours = asYours(server);
      registerPersonal(yours, this.env, me);
      registerMyDay(yours, this.env, me);
      registerLeader(yours, this.env, me);
      registerActs(yours, this.env, me);
      registerPresence(yours, this.env, me);
      registerWatchYours(yours, this.env, me);
      registerOpenChairYours(yours, this.env, me);
      /* Shepherd tools exist only for a believer the app recognises as a pastor; checked once, here. */
      const pastor = await pastorOf(this.env, me);
      if (pastor) registerShepherd(yours, this.env, me, pastor);
    }
    /* Every tools/call on this session, counted after it is answered (src/telemetry.ts, migration 1009). */
    instrument(this.server, { env: this.env, profile: app ? 'app' : me ? 'me' : 'public' });
  }
}
