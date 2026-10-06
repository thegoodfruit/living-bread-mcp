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
import { registerProtocol } from './protocol';
import { registerMyDay } from './myday';
import { registerPersonal } from './personal';
import { registerPrompts } from './prompts';
import { pastorOf, registerShepherd } from './shepherd';
import { registerTemplates } from './templates';
import { registerAll } from './tools';
import { registerJourneyPrompts, registerJourneys } from './journeys';
import { registerPresence } from './presence';
import { asYours, bindServer } from './shared';
import { registerWord } from './word';
import { registerExcellence } from './excellence';
import { registerShelf } from './shelf';

/** Tools the ChatGPT app profile never registers: care access, crisis services and every write. */
const APP_DENY = new Set(['crisis_resources', 'someone_to_talk_to', 'who_is_available_now', 'find_help_for_my_need', 'say_amen', 'pray_for_someone', 'speak_a_blessing', 'bring_what_i_carry', 'say_yes', 'going_to_gathering', 'set_a_table', 'offer_to_serve', 'shepherd_doors', 'who_has_gone_quiet', 'my_congregation']);

/** The same McpServer, with registerTool refusing a denied name. Everything else passes through untouched. */
function withoutTools(server: McpServer, deny: Set<string>): McpServer {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === 'registerTool') {
        return (name: string, ...rest: unknown[]) => {
          if (deny.has(name)) return undefined;
          // OpenAI plugin guidelines: never ask for precise coordinates. The ChatGPT
          // profile keeps only a place the person names (a city), never lat/lng.
          const cfg = rest[0] as { inputSchema?: Record<string, unknown> } | undefined;
          if (cfg?.inputSchema && typeof cfg.inputSchema === 'object' && ('lat' in cfg.inputSchema || 'lng' in cfg.inputSchema)) {
            const { lat: _lat, lng: _lng, ...kept } = cfg.inputSchema as Record<string, unknown>;
            rest[0] = { ...cfg, inputSchema: kept };
          }
          return (target.registerTool as unknown as (n: string, ...r: unknown[]) => unknown).call(target, name, ...rest);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as McpServer;
}
import { registerWidgets } from './widgets';

/** Props arrive from the Worker (src/index.ts) only on the signed-in path, after the token was verified. */
export class LivingBreadMCP extends McpAgent<Env, Record<string, never>, Partial<Believer>> {
  server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

  async init(): Promise<void> {
    const props = this.props;
    const me: Believer | null = props && typeof props.userId === 'string' && typeof props.token === 'string' ? (props as Believer) : null;
    /* The ChatGPT app profile (/app) is read-only and leaves out care matching and crisis
       services, which OpenAI's app review declines; everything else is the same server. */
    const app = me?.profile === 'app';
    const server = app ? withoutTools(this.server, APP_DENY) : this.server;
    /* Every answer leaves through shared.ts `finish`; it needs to know the endpoint and, for the
       idempotency of writes, this session's own storage. */
    bindServer(this.server, { env: this.env, profile: app ? 'app' : me ? 'me' : 'public', userId: me?.userId, storage: this.ctx.storage });
    registerAll(server, this.env, { signedIn: Boolean(me) });
    registerMore(server, this.env, me);
    registerProtocol(server, this.env);
    registerWord(server, this.env);
    registerExcellence(server, this.env);
    registerShelf(server, this.env);
    registerJourneys(server, this.env, app ? null : me);
    registerWidgets(server);
    registerTemplates(server, this.env);
    registerPrompts(server);
    registerJourneyPrompts(server);
    if (me) {
      const yours = asYours(server);
      registerPersonal(yours, this.env, me);
      registerMyDay(yours, this.env, me);
      if (!app) {
        registerActs(yours, this.env, me);
        registerPresence(yours, this.env, me);
        /* Shepherd tools exist only for a believer the app recognises as a pastor; checked once, here. */
        const pastor = await pastorOf(this.env, me);
        if (pastor) registerShepherd(yours, this.env, me, pastor);
      }
    }
  }
}
