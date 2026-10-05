/* ============================================================
   THE LIVING BREAD MCP, who could answer, and where to turn (signed in).

   Two read tools over the Kingdom presence and router functions, AS the
   signed-in believer (both are granted to `authenticated` only, so they
   exist on /me and never on the public endpoint):

     who_is_available_now   who_is_available_now (0781): for each kind of
                            presence (available to pray, listen, talk,
                            serve, welcome; looking for prayer, company),
                            how many people said so in their still-open
                            window, how many in the believer's own city,
                            and up to five first names. Counts and first
                            names only, members only, nobody blocked,
                            no minors (the function's own gate).
     find_help_for_my_need  route_need (0782): the nearest SAFE doors for
                            a need, in the house's escalation order
                            (family, the believer's groups, people who
                            said they are available, their church and
                            verified ministries, a Table or a gathering,
                            the Word, and the crisis door first when the
                            need says danger). Never ranked by popularity.

   Freshness is honest: a presence status is a window the person opened
   themselves (two hours by default) that the database checks at the
   moment of reading. It is "said they are available", never a promise
   that they will answer.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { type Believer, rpcAs } from './auth';
import { DOORS, SITE } from './doors';
import { openWindow, record, scheduled, type Freshness } from './freshness';
import { kjvByRef } from './kjv';
import { list, paragraph } from './render';
import { fail, ok, out, READS, tool } from './shared';

interface AvailRow { status: string; label: string; side: string; people: number; near: number; first_names: string[] | null }
interface Destination { layer: string; kind: string; id: string | null; title: string; subtitle: string | null; route: string | null; action: string | null; people: number | null; names: string[] | null; starts_at?: string; score?: number; pinned?: boolean }

const WINDOW_NOTE = 'They said, within their own window (two hours unless they chose otherwise), that they are available; the database checked the window had not expired at the moment of reading. Not a promise that they will answer.';

/* Web doors that resolve today (verified 2026-10-05). A dynamic route without a web shell falls back to its list. */
function doorFor(route: string | null): string {
  if (!route) return DOORS.home;
  if (/^\/(talk|need-someone|sos|bible|prayer|communities|serve|events|tables|the-table)$/.test(route)) return `${SITE}${route}`;
  if (/^\/community\/[0-9a-f-]{36}$/.test(route)) return `${SITE}${route}`;
  if (route.startsWith('/the-table/')) return DOORS.theTable;
  if (route.startsWith('/church/event/')) return DOORS.events;
  if (route.startsWith('/churches/')) return DOORS.findAChurch;
  if (route.startsWith('/organizations/')) return DOORS.serve;
  return `${SITE}${route}`;
}

function freshnessOf(d: Destination): Freshness {
  switch (d.layer) {
    case 'available': return openWindow(WINDOW_NOTE);
    case 'gathering': return d.kind === 'event' ? scheduled(d.starts_at ?? null) : openWindow('A Table open to everyone with activity in the last fifteen minutes (the router\'s own window).');
    case 'family': return record(null, 'Your family on The Living Bread; asking them sends one notification, it does not mean they are awake now.');
    default: return record(null);
  }
}

export function registerPresence(server: McpServer, env: Env, me: Believer): void {
  tool(server, 'who_is_available_now', {
    title: 'Who is available right now (counts and first names)',
    description: 'For the signed-in believer: how many people on The Living Bread have said, in a window they opened themselves that has not expired, that they are available to pray, listen, talk, serve or welcome (and how many are looking for prayer or company), how many of them are in the believer\'s own city, and up to five first names. Members only; never a place finer than "your city"; nobody blocked, no minors. People ask: "is anyone available to pray with me tonight", "who is around to talk". Use find_help_for_my_need to actually reach them.',
    inputSchema: {},
    outputSchema: out({ count: z.number(), statuses: z.array(z.looseObject({ status: z.string(), label: z.string(), side: z.string(), people: z.number(), in_your_city: z.number(), first_names: z.array(z.string()) })), door: z.string() }),
    annotations: READS,
  }, async () => {
    const r = await rpcAs(env, me, 'who_is_available_now');
    if (r.error) return fail(`Who is available could not be read just now (${r.error}). The door is open at ${SITE}/need-someone.`, { reason: 'unavailable', try_instead: [`${SITE}/need-someone`, DOORS.prayer] });
    const rows = (Array.isArray(r.data) ? (r.data as AvailRow[]) : []).map((x) => ({
      status: x.status, label: x.label, side: x.side, people: Number(x.people ?? 0), in_your_city: Number(x.near ?? 0), first_names: x.first_names ?? [],
      freshness: Number(x.people ?? 0) > 0 ? openWindow(WINDOW_NOTE) : record(null, 'Nobody has this window open at the moment of reading.'),
    }));
    const open = rows.filter((x) => x.people > 0);
    if (!open.length) {
      return ok(paragraph([
        'Nobody has said they are available in an open window at this moment',
        'That is a true picture of this minute, not of the family: asking still reaches people, because the family is told and the wider circle widens until someone answers',
        `Ask at ${SITE}/need-someone, or bring a request to the prayer wall at ${DOORS.prayer}; find_help_for_my_need shows every door in order`,
      ]), { count: 0, statuses: rows, door: `${SITE}/need-someone`, empty: true });
    }
    return ok(paragraph([
      `Said they are available, in windows still open: ${list(open.map((x) => `${x.people} ${x.label.toLowerCase()}${x.in_your_city ? ` (${x.in_your_city} in your city)` : ''}${x.first_names.length ? `, among them ${list(x.first_names, 5)}` : ''}`), 8)}`,
      'Each one opened their own window; none of it is a promise that they will answer this minute',
      `To reach them, find_help_for_my_need, or ${SITE}/need-someone`,
    ]), { count: open.length, statuses: rows, door: `${SITE}/need-someone` });
  });

  tool(server, 'find_help_for_my_need', {
    title: 'Where to turn for what I need',
    description: 'For the signed-in believer: the nearest safe doors for a need, in the house\'s order (their own family, the groups they belong to, people who said they are available for exactly this, their church and verified ministries nearby, a Table or a gathering, the Word, and the crisis door first whenever the need involves danger), each with why it is there, how fresh it is, and the door to open. Ranked by relationship, relevance, safety, availability and nearness; never by popularity. Reads only: nobody is contacted by this tool. People ask: "I need someone to pray with me tonight", "I want to serve this weekend", "I am new and want a church", "I need to talk to a pastor".',
    inputSchema: {
      need: z.enum(['prayer', 'listen', 'talk', 'pastoral', 'help', 'volunteer', 'community', 'newcomer', 'new_believer']).describe('What they need: prayer, someone to listen or talk, a pastor (pastoral), practical help, a way to volunteer, community, a first church (newcomer), or new-believer care.'),
      danger: z.boolean().default(false).describe('True when anyone is in danger: the crisis door comes first.'),
      limit: z.number().int().min(1).max(5).default(5),
    },
    outputSchema: out({ need: z.string(), crisis: z.boolean(), count: z.number(), doors: z.array(z.looseObject({ layer: z.string(), title: z.string(), why: z.string(), door: z.string() })), first_step: z.looseObject({ label: z.string(), url: z.string() }) }),
    annotations: READS,
  }, async ({ need, danger, limit }) => {
    const r = await rpcAs(env, me, 'route_need', { p_kind: need, p_payload: { crisis: Boolean(danger) } });
    if (r.error) return fail(`The doors could not be read just now (${r.error}). The door is open at ${SITE}/need-someone.`, { reason: 'unavailable', try_instead: [`${SITE}/need-someone`, `${SITE}/sos`] });
    const data = (r.data ?? {}) as { kind?: string; crisis?: boolean; destinations?: Destination[] };
    const dest = (data.destinations ?? []).slice(0, limit ?? 5);
    const doors = await Promise.all(dest.map(async (d) => {
      const why = d.layer === 'family' ? `Your own family on The Living Bread${d.names?.length ? ` (${list(d.names, 3)})` : ''}; asking them is the first door`
        : d.layer === 'prayer_network' ? 'A group you already belong to'
        : d.layer === 'available' ? `${d.people ?? 0} ${d.people === 1 ? 'person' : 'people'} said they are available for this, in a window still open${d.names?.length ? ` (${list(d.names, 3)})` : ''}`
        : d.layer === 'ministry' ? (d.subtitle ?? 'A church or verified ministry near you')
        : d.layer === 'gathering' ? (d.kind === 'event' ? `A gathering${d.starts_at ? ` scheduled for ${new Date(d.starts_at).toUTCString().replace(' GMT', ' UTC')}` : ''}, ${d.subtitle ?? ''}` : 'A Table open to everyone, active in the last fifteen minutes')
        : d.layer === 'crisis' ? 'If anyone is in danger: the real crisis line for your country, before anything else'
        : d.layer === 'scripture' ? 'The Word for this need' : (d.subtitle ?? '');
      const verse = d.layer === 'scripture' && d.subtitle ? await kjvByRef(env, d.subtitle) : null;
      const title = String(d.title ?? '').replace(/\s*right now\s*$/i, '').trim();
      return {
        layer: d.layer, kind: d.kind, id: d.id, title, why: why.trim().replace(/,\s*$/, ''), door: doorFor(d.route), action_in_app: d.action, score: d.score ?? null,
        ...(verse ? { scripture: { ref: verse.ref, text: verse.text } } : {}),
        freshness: freshnessOf(d),
      };
    }));
    const first = doors[0] ?? { title: 'Ask the family', door: `${SITE}/need-someone` };
    return ok(paragraph([
      data.crisis ? 'Safety first: the crisis door is at the top. Call crisis_resources with their country for the real number' : null,
      `For ${need.replace('_', ' ')}, in order: ${list(doors.map((d) => `${d.title} (${d.why})`), doors.length)}`,
      doors.some((d) => d.layer === 'available') ? 'Availability means a window they opened and has not expired, never a promise' : 'Nobody has an availability window open for this right now; the family and the wider circle are still reached when they ask',
      `First step: ${first.title}, ${first.door}`,
    ]), { need: data.kind ?? need, crisis: Boolean(data.crisis), count: doors.length, doors, first_step: { label: first.title, url: first.door } });
  });
}
