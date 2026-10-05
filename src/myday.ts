/* ============================================================
   THE LIVING BREAD MCP, my day.

   One call that composes the believer's day from the same functions the
   app's home reads: the bread for their local morning (the 88-reference
   cycle, words from the stored KJV), the prayers waiting unheard, who in
   their own family is carrying something today (first names and feelings
   only, never a note), their next gathering, one open Serve need near them
   when their profile holds a place, and the yes they are walking. Nothing
   is invented; a part that is empty is simply absent from the paragraph.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { familyPeople } from './acts';
import { type Believer, rpcAs, selectAs } from './auth';
import { dailyBreadReference } from './daily';
import { DOORS, SITE } from './doors';
import { kjvByRef } from './kjv';
import { list, paragraph } from './render';
import { firstName, ok, out, READS, tool } from './shared';

interface Profile { name: string | null; city: string | null; country: string | null; lat: number | null; lon: number | null; location_privacy: string | null; tz_offset_min: number | null }
interface PrayerForMe { id: string; heard_at: string | null; from_name: string | null; anonymous: boolean; kind: string }
interface Carrying { id: string; soul_id: string | null; soul_name: string | null; feeling: string; shared_at: string | null }
interface Gathering { id: string; community_id: string; community_name: string | null; title: string; starts_at: string; timezone: string | null; status: string; i_rsvped: boolean }
interface NeedRow { need: { id: string; title: string; city: string | null; country: string | null; category: string; urgency: string }; partner_name: string; km: number }
interface OpenYes { id: string; words: string; verse_ref: string | null; state: string; days_ago: number; companions: number }

const FEELING_WORD: Record<string, string> = {
  anxious: 'anxious', afraid: 'afraid', grieving: 'grieving', weary: 'weary', tempted: 'tempted', lonely: 'lonely', guilty: 'guilty', discouraged: 'discouraged',
  seeking: 'seeking direction', thankful: 'thankful', joyful: 'joyful', waiting: 'waiting on God', angry: 'angry', doubting: 'doubting', hurting: 'sick or in pain',
  newseason: 'in a new season', forgiving: 'learning to forgive', provision: 'in need of provision', unnamed: 'carrying something',
};

function localDay(offsetMin: number | null): string {
  return new Date(Date.now() + (offsetMin ?? 0) * 60_000).toISOString().slice(0, 10);
}
function whenLocal(iso: string, tz: string | null): string {
  try {
    return new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz ?? 'UTC', timeZoneName: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function registerMyDay(server: McpServer, env: Env, me: Believer): void {
  tool(server, 'my_day', {
    title: 'My day on The Living Bread',
    description: 'Today for the signed-in believer, in one paragraph and in parts: the Daily Bread for their morning (read from the stored text), the prayers waiting unheard over them, who in their own family is carrying something today (first names and feelings only), their next gathering, one open Serve need near them when their profile holds a place, and the yes they are walking. Absent parts are simply absent; nothing is invented. People ask: "what is my day", "anything waiting for me", "what should I pray for today". Read only; acts as the signed-in believer.',
    inputSchema: {},
    outputSchema: out({
      date: z.string(), name: z.string().nullable(),
      bread: z.object({ ref: z.string(), text: z.string(), door: z.string() }).nullable(),
      prayers_waiting: z.object({ count: z.number(), from: z.array(z.string()), door: z.string() }),
      family_carrying: z.array(z.object({ name: z.string(), feeling: z.string(), door: z.string() })),
      next_gathering: z.object({ id: z.string(), title: z.string(), community: z.string().nullable(), when: z.string(), when_local: z.string(), i_am_going: z.boolean(), door: z.string() }).nullable(),
      need_near: z.object({ id: z.string(), title: z.string(), where: z.string(), partner: z.string(), km: z.number(), door: z.string() }).nullable(),
      open_yes: z.object({ id: z.string(), words: z.string(), verse_ref: z.string().nullable(), state: z.string(), days_ago: z.number(), door: z.string() }).nullable(),
      doors: z.record(z.string(), z.string()),
    }),
    annotations: READS,
  }, async () => {
    const rows = await selectAs<Profile>(env, me, 'users', `id=eq.${me.userId}&select=name,city,country,lat,lon,location_privacy,tz_offset_min&limit=1`);
    const p = rows?.[0] ?? { name: null, city: null, country: null, lat: null, lon: null, location_privacy: null, tz_offset_min: null };
    const date = localDay(p.tz_offset_min);
    const hasCoords = typeof p.lat === 'number' && typeof p.lon === 'number' && p.location_privacy !== 'hidden';

    const [bread, waiting, carryings, people, gatherings, yes, needs] = await Promise.all([
      kjvByRef(env, dailyBreadReference(date)),
      rpcAs(env, me, 'prayers_for_me', { p_limit: 40, p_before: null, p_kind: null }),
      rpcAs(env, me, 'kingdom_carryings', { p_limit: 100 }),
      familyPeople(env, me),
      rpcAs(env, me, 'my_group_gatherings', { p_limit: 3 }),
      rpcAs(env, me, 'my_open_yes'),
      hasCoords ? rpcAs(env, me, 'serve_needs_near', { p_lat: p.lat, p_lng: p.lon, p_km: 150, p_limit: 1 }) : Promise.resolve({ data: null, error: null }),
    ]);

    const unheard = (Array.isArray(waiting.data) ? (waiting.data as PrayerForMe[]) : []).filter((r) => !r.heard_at);
    const prayers_waiting = { count: unheard.length, from: [...new Set(unheard.map((r) => (r.anonymous || !r.from_name ? 'someone in the family' : firstName(r.from_name))))].slice(0, 6), door: DOORS.prayersForMe };

    /* their family's carryings, shared with the Kingdom today: a first name and a feeling, never the note */
    const familyIds = new Map(people.map((x) => [x.id, x.name]));
    const today = date;
    const family_carrying = (Array.isArray(carryings.data) ? (carryings.data as Carrying[]) : [])
      .filter((c) => c.soul_id && familyIds.has(c.soul_id) && c.shared_at && new Date(new Date(c.shared_at).getTime() + (p.tz_offset_min ?? 0) * 60_000).toISOString().slice(0, 10) === today)
      .map((c) => ({ name: firstName(familyIds.get(c.soul_id as string) ?? c.soul_name), feeling: FEELING_WORD[c.feeling] ?? c.feeling, door: `${SITE}/with/carrying/${c.id}` }))
      .slice(0, 8);

    const g = (Array.isArray(gatherings.data) ? (gatherings.data as Gathering[]) : []).filter((x) => x.status !== 'cancelled')[0];
    const next_gathering = g ? { id: g.id, title: g.title, community: g.community_name, when: g.starts_at, when_local: whenLocal(g.starts_at, g.timezone), i_am_going: g.i_rsvped, door: `${SITE}/community/${g.community_id}` } : null;

    const nrow = (Array.isArray(needs.data) ? (needs.data as NeedRow[]) : [])[0];
    const need_near = nrow?.need ? { id: nrow.need.id, title: nrow.need.title, where: [nrow.need.city, nrow.need.country].filter(Boolean).join(', ') || 'near them', partner: nrow.partner_name, km: Math.round(nrow.km), door: `${SITE}/serve/${nrow.need.id}` } : null;

    const y = (Array.isArray(yes.data) ? (yes.data as OpenYes[]) : [])[0];
    const open_yes = y ? { id: y.id, words: y.words, verse_ref: y.verse_ref, state: y.state, days_ago: y.days_ago, door: DOORS.myYes } : null;

    const first = (p.name ?? '').trim() || 'Friend';
    const text = paragraph([
      bread ? `${first}, the bread for ${date} is ${bread.ref}: "${bread.text}"` : `${first}, today is ${date}`,
      prayers_waiting.count ? `${prayers_waiting.count} ${prayers_waiting.count === 1 ? 'prayer waits' : 'prayers wait'} unheard over them, from ${list(prayers_waiting.from, 4)}: ${DOORS.prayersForMe}` : null,
      family_carrying.length ? `In their family today, ${list(family_carrying.map((c) => `${c.name} is ${c.feeling}`), 5)}; they can pray at ${family_carrying[0].door}` : null,
      next_gathering ? `Next gathering: ${next_gathering.title}${next_gathering.community ? ` with ${next_gathering.community}` : ''}, ${next_gathering.when_local}${next_gathering.i_am_going ? ' (they are going)' : ''}` : null,
      need_near ? `One open need near them: ${need_near.title} (${need_near.partner}, ${need_near.where}, about ${need_near.km} km): ${need_near.door}` : hasCoords ? null : null,
      open_yes ? `The yes they are walking: "${open_yes.words}"${open_yes.verse_ref ? ` (${open_yes.verse_ref})` : ''}, ${open_yes.state}, ${open_yes.days_ago} ${open_yes.days_ago === 1 ? 'day' : 'days'} in: ${DOORS.myYes}` : null,
      !prayers_waiting.count && !family_carrying.length && !next_gathering && !open_yes ? `Nothing is waiting on them today; the day begins with the Word at ${DOORS.today}` : `The whole day is at ${DOORS.today}`,
    ]);
    return ok(text, {
      date, name: p.name, bread: bread ? { ref: bread.ref, text: bread.text, door: DOORS.daily } : null, prayers_waiting, family_carrying, next_gathering, need_near, open_yes,
      doors: { today: DOORS.today, prayers_for_me: DOORS.prayersForMe, carrying: DOORS.carrying, my_yes: DOORS.myYes, serve: DOORS.serve, communities: DOORS.communities },
    });
  });
}
