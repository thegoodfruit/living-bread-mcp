/* ============================================================
   THE LIVING BREAD MCP, the named public set: one registration point.

   /me and /app list these names exactly as before. On the public endpoint
   (/mcp, /sse) the same registrations run through a capturing server
   (src/lean.ts) and answer as modes of the 13 lean tools. Kept apart from
   src/agent.ts so tests can enumerate the named public tools without the
   Durable Object runtime.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { Believer } from './auth';
import { registerMyDay } from './myday';
import { registerPersonal } from './personal';
import { asYours } from './shared';
import { registerExcellence } from './excellence';
import { registerJourneyPrompts, registerJourneys } from './journeys';
import { registerMore } from './more';
import { registerPrompts } from './prompts';
import { registerProtocol } from './protocol';
import { registerShelf } from './shelf';
import { registerTemplates } from './templates';
import { registerAll } from './tools';
import { registerOpenChair } from './openChair';
import { registerPlan } from './plan';
import { registerWatch } from './watch';
import { registerWidgets } from './widgets';
import { registerWord } from './word';

/** Every public tool, resource and prompt, as named tools. `me` is the believer on /me (null on /mcp and /app's journeys). */
export function registerNamedPublic(server: McpServer, env: Env, me: Believer | null, app: boolean): void {
  registerAll(server, env, { signedIn: Boolean(me) });
  registerMore(server, env, me);
  registerProtocol(server, env);
  registerWord(server, env);
  registerExcellence(server, env);
  registerShelf(server, env);
  registerJourneys(server, env, app ? null : me);
  registerWidgets(server);
  registerTemplates(server, env);
  registerPrompts(server);
  registerJourneyPrompts(server);
  registerWatch(server, env);
  registerOpenChair(server, env);
  registerPlan(server, env);
}

/** Tools the ChatGPT app profile never registers: care access, crisis services and every write. */
export const APP_DENY = new Set(['crisis_resources', 'someone_to_talk_to', 'who_is_available_now', 'find_help_for_my_need', 'say_amen', 'pray_for_someone', 'speak_a_blessing', 'bring_what_i_carry', 'say_yes', 'going_to_gathering', 'set_a_table', 'offer_to_serve', 'shepherd_doors', 'who_has_gone_quiet', 'my_congregation', 'the_open_chair', 'plan_my_next_step']);

/** The same McpServer, with registerTool refusing a denied name. Everything else passes through untouched. */
export function withoutTools(server: McpServer, deny: Set<string>): McpServer {
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


/** The believer's own read tools on the ChatGPT profile /app (no acts, no presence, no watch, no shepherd tools). */
export function registerAppYours(server: McpServer, env: Env, me: Believer): void {
  const yours = asYours(server);
  registerPersonal(yours, env, me);
  registerMyDay(yours, env, me);
}

/** The whole /app tool set on a server, exactly as src/agent.ts registers it (tests lock it: test/app-profile.lock.json). */
export function registerAppProfile(server: McpServer, env: Env, me: Believer): void {
  const app = withoutTools(server, APP_DENY);
  registerNamedPublic(app, env, me, true);
  registerAppYours(app, env, me);
}
