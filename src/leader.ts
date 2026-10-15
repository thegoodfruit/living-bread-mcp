/* ============================================================
   THE LIVING BREAD MCP, the communities a person leads.

   A leader who asks "help my group reconnect" needs the assistant to know
   WHICH group is theirs, within their own permissions and nothing more. This
   is the small, leader-scoped read: the believer's own led communities (the
   same database function the app's Launch Kit calls, my_led_communities,
   which returns only the communities they created or lead) with the facts the
   app already shows a leader (communities_overview called as the leader: member
   count, join policy, when anything last happened in the GROUP, join requests
   waiting), and a handoff to open each one.

   It reads no member names, no private prayer and no message. It never reads
   across groups: the database function and the row level rules do the
   scoping, not this file. It writes nothing.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { type Believer, rpcAs } from './auth';
import { makeHandoff, SAFE_ID } from './handoff';
import { paragraph } from './render';
import { ATTRIBUTION, fail, ok, out, READS, tool } from './shared';

interface Led { id: string; name: string }
interface Row { id: string; name: string; kind: string | null; member_count: number | null; join_policy: string | null; discoverable: boolean | null; last_active_at: string | null; pending_requests: number | null; my_role: string | null }

export function registerLeader(server: McpServer, env: Env, me: Believer): void {
  tool(server, 'communities_i_lead', {
    title: 'The communities I lead',
    description: 'List the Living Bread communities the signed-in believer created or leads: name, kind, member count, whether anyone may join or people ask first, whether it is listed publicly, and a handoff to open each one (its page, where the leader invites people and welcomes members). Use when a leader says "help my group reconnect", "welcome new members to our prayer group" or "which of my groups should I start with". Reads only the believer\'s own led communities: no member names, no private prayers, no messages, nothing from any other group. To create a new community use the create_community handoff from plan_my_next_step. For a church\'s pastor tools use my_congregation and who_has_gone_quiet.',
    inputSchema: {},
    outputSchema: out({
      count: z.number().describe('Communities this believer leads; 0 when none.'),
      communities: z.array(z.looseObject({ id: z.string(), name: z.string(), kind: z.string().nullable(), members: z.number().nullable(), join: z.string(), listed_publicly: z.boolean().nullable(), last_group_activity: z.string().nullable(), days_since_group_activity: z.number().nullable(), join_requests_waiting: z.number().nullable() })).describe('Each led community: id, name, kind, member count, join policy, whether it is publicly listed, when anything last happened in the GROUP (a group level fact, never about a person), join requests waiting for the leader, and a handoff to open it.'),
      if_empty: z.string().optional().describe('Present when the believer leads none: what to offer instead.'),
    }),
    annotations: READS,
  }, async () => {
    const led = await rpcAs(env, me, 'my_led_communities');
    if (led.error) return fail(paragraph(['Their communities could not be read just now, and nothing was changed', 'Try again in a moment']), { reason: 'unavailable', try_instead: ['the same call again in a minute'] });
    const ids = ((Array.isArray(led.data) ? led.data : []) as Led[]).map((c) => c.id).filter((id) => SAFE_ID.test(id));
    if (!ids.length) {
      const msg = 'They do not lead a community on The Living Bread yet. A person who wants to bring a church or group together can create a space and choose whom to invite; nothing is created for them.';
      return ok(paragraph([msg, 'Offer plan_my_next_step with their need, which returns the create a space handoff']), { count: 0, communities: [], if_empty: msg, ...ATTRIBUTION });
    }
    /* communities_overview, called AS the leader: its own rules give last_active_at only to a member and pending_requests only to a leader (0538) */
    const ov = await rpcAs(env, me, 'communities_overview');
    const rows = (Array.isArray(ov.data) ? (ov.data as Row[]) : []).filter((r) => ids.includes(r.id));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const shown = ids.map((id) => {
      const r = byId.get(id);
      const base = ((Array.isArray(led.data) ? led.data : []) as Led[]).find((c) => c.id === id);
      const name = r?.name ?? base?.name ?? 'A community';
      const join = r?.join_policy === 'open' ? 'open: anyone may join' : r?.join_policy === 'request' ? 'by request to its leaders' : r?.join_policy ?? 'see the community page';
      const handoff = makeHandoff({
        kind: 'community', id, intent: 'bring_your_people', path: `/community/${encodeURIComponent(id)}`,
        invitation: 'Open this community to welcome members and invite people',
        what_you_can_do: 'Open the community you lead on The Living Bread: see its members, invite people with a link you choose to share, and welcome new members. Nothing is sent until you send it.',
        requires_account: true, verified: true,
      });
      const last = r?.last_active_at ?? null;
      const days = last ? Math.max(0, Math.floor((Date.now() - Date.parse(last)) / 86_400_000)) : null;
      return { id, name, kind: r?.kind ?? null, members: r?.member_count ?? null, join, listed_publicly: r?.discoverable ?? null, last_group_activity: last, days_since_group_activity: days, join_requests_waiting: r?.pending_requests ?? null, ...(handoff ? { handoff } : {}) };
    });
    return ok(paragraph([
      `They lead ${shown.length} ${shown.length === 1 ? 'community' : 'communities'}: ${shown.map((c) => `${c.name} (${c.kind ?? 'community'}, ${c.members ?? 'unknown'} members, ${c.join})`).join('; ')}`,
      'Only their own communities are read, with no member names and no messages. Nothing is sent or created by this tool',
    ]), { count: shown.length, communities: shown, ...ATTRIBUTION });
  });
}
