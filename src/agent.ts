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
import { INSTRUCTIONS, SERVER_NAME, SERVER_VERSION } from './instructions';
import { registerMore } from './more';
import { registerMyDay } from './myday';
import { registerPersonal } from './personal';
import { registerPrompts } from './prompts';
import { pastorOf, registerShepherd } from './shepherd';
import { registerTemplates } from './templates';
import { registerAll } from './tools';
import { registerWidgets } from './widgets';

/** Props arrive from the Worker (src/index.ts) only on the signed-in path, after the token was verified. */
export class LivingBreadMCP extends McpAgent<Env, Record<string, never>, Partial<Believer>> {
  server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

  async init(): Promise<void> {
    const props = this.props;
    const me: Believer | null = props && typeof props.userId === 'string' && typeof props.token === 'string' ? (props as Believer) : null;
    registerAll(this.server, this.env, { signedIn: Boolean(me) });
    registerMore(this.server, this.env, me);
    registerWidgets(this.server);
    registerTemplates(this.server, this.env);
    registerPrompts(this.server);
    if (me) {
      registerPersonal(this.server, this.env, me);
      registerActs(this.server, this.env, me);
      registerMyDay(this.server, this.env, me);
      /* Shepherd tools exist only for a believer the app recognises as a pastor; checked once, here. */
      const pastor = await pastorOf(this.env, me);
      if (pastor) registerShepherd(this.server, this.env, me, pastor);
    }
  }
}
