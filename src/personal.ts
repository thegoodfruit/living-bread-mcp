/* ============================================================
   THE LIVING BREAD MCP, the tools that act as the signed-in believer.

   Registered only when the request carried a verified token (src/auth.ts).
   Every call goes to the database AS that believer: the same functions the
   app calls, under the same row-level security. Nothing here reads another
   person's private prayer, and nothing here writes without the believer
   asking for exactly that write. Every answer ends in the door in the app
   where the believer can do the fuller thing: hear the voice, pray back,
   sit with their family.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type Believer, rpcAs, selectAs } from './auth';
import { DOORS, SITE } from './doors';
import { list, paragraph } from './render';
import { fail, ok, out, tool } from './shared';
import { widgetMeta } from './widgets';

/* The shapes the database functions return (mirrors lib/prayerVoice.ts,
   lib/kingdomWork.ts, lib/prayerNames.ts, lib/eventsGroup.ts). */
interface PrayerForMe {
  id: string; seconds: number; words: string | null; words_are_spoken: boolean; heard_at: string | null;
  delivered_at: string; from_id: string | null; from_name: string | null; about: string | null; anonymous: boolean;
  amen_at: string | null; thanked_at: string | null; kind: string;
}
interface PrayerIOffered {
  id: string; seconds: number; words: string | null; deliver_at: string; delivered_at: string | null; heard_at: string | null;
  revoked_at: string | null; for_id: string | null; for_name: string | null; amen_at: string | null; thanked_at: string | null; kind: string;
}
interface WalkEntry { id: string; words: string; verse_ref: string | null; state: string; created_at: string; lived_at: string | null; reflection: string | null }
interface Family { id: string; name: string; member_count: number; i_lead: boolean }
interface Gathering {
  id: string; community_id: string; community_name: string | null; title: string; starts_at: string; timezone: string | null;
  status: string; scripture_ref: string | null; intention: string | null; host_name: string; going_count: number; i_rsvped: boolean;
}
interface Profile { name: string | null; city: string | null; country: string | null; church_name: string | null }

const ACT: Record<string, string> = {
  prayer: 'prayed for you', encouragement: 'sent you encouragement', forgiveness: 'spoke forgiveness over you',
  blessing: 'blessed you', thanks: 'gave thanks for you',
};
function sinceWord(iso: string | null): string {
  if (!iso) return '';
  const h = Math.max(0, (Date.now() - new Date(iso).getTime()) / 36e5);
  if (h < 1) return 'just now';
  if (h < 24) return `${Math.round(h)} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
function offeredState(p: PrayerIOffered): string {
  if (p.revoked_at) return 'taken back';
  if (!p.delivered_at) return 'waiting for their morning';
  if (p.thanked_at) return 'they said thank you';
  if (p.amen_at) return 'they said Amen';
  if (p.heard_at) return 'heard';
  return 'delivered, not yet heard';
}
function whenLocal(iso: string, tz: string | null): string {
  try {
    return new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz ?? 'UTC', timeZoneName: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export const PERSONAL_TOOL_SUMMARY: ReadonlyArray<[string, string]> = [
  ['who_am_i', 'the believer the assistant is acting for: name, where they are, what waits for them'],
  ['prayers_waiting_for_me', 'the prayers real people have prayed over them, with the door to hear each voice'],
  ['prayers_i_offered', 'the prayers they gave, and the honest state of each one'],
  ['say_amen', 'answer a prayer prayed over them with Amen, and thank you'],
  ['my_walk', 'what they have said yes to Christ about, in their own words'],
  ['my_family', 'their circles and the next gatherings, with the room to join'],
];

export function registerPersonal(server: McpServer, env: Env, me: Believer): void {
  const CONSENT = 'Runs as the signed-in believer under their own access rules: it sees only what they see in the app.';

  tool(server, 'who_am_i', {
    title: 'Who am I on The Living Bread',
    description: `Identify the signed-in believer this connection acts for: user id, name, city and country from their profile, the church they named, and how many prayers over them are not yet heard. Use when you need their name or place, or to confirm whose account this is. For today's full picture use my_day; for their circles and gatherings use my_family; to read the prayers themselves use prayers_waiting_for_me. Read-only; profile fields are null when not filled in. ${CONSENT}`,
    inputSchema: {},
    outputSchema: out({
      user_id: z.string().describe('The believer\'s user id.'),
      name: z.string().nullable().describe('Their name as on their profile.'),
      city: z.string().nullable().describe('Profile city, or null.'),
      country: z.string().nullable().describe('Profile country, or null.'),
      church_name: z.string().nullable().describe('The church they named, or null.'),
      prayers_waiting: z.number().describe('Prayers over them not yet heard (among the latest 40).'),
      doors: z.record(z.string(), z.string()).describe('Links: prayers_for_me, pray_for_someone, today, my_family.'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const rows = await selectAs<Profile>(env, me, 'users', `id=eq.${me.userId}&select=name,city,country,church_name&limit=1`);
    const p = rows?.[0] ?? { name: null, city: null, country: null, church_name: null };
    const waiting = await rpcAs(env, me, 'prayers_for_me', { p_limit: 40, p_before: null, p_kind: null });
    const unheard = Array.isArray(waiting.data) ? (waiting.data as PrayerForMe[]).filter((r) => !r.heard_at).length : 0;
    const where = [p.city, p.country].filter(Boolean).join(', ');
    const doors = { prayers_for_me: `${SITE}/prayers-for-me`, pray_for_someone: DOORS.prayVoice, today: `${SITE}/today`, my_family: `${SITE}/communities` };
    return ok(paragraph([
      `You are acting for ${p.name ?? 'a believer'}${where ? ` in ${where}` : ''}${p.church_name ? `, of ${p.church_name}` : ''}`,
      unheard ? `${unheard} ${unheard === 1 ? 'prayer waits' : 'prayers wait'} for them to hear at ${doors.prayers_for_me}` : `Nothing is waiting unheard right now`,
      `Everything you read here is what they could see themselves in the app`,
    ]), { user_id: me.userId, ...p, prayers_waiting: unheard, doors });
  });

  tool(server, 'prayers_waiting_for_me', {
    title: 'Prayers prayed over me',
    description: `List prayers, encouragement and blessings other people sent to the signed-in believer, newest first: sender (or "someone in the family" if anonymous), kind, voice length, written words if any, and whether heard or answered with Amen. Use for "has anyone prayed for me". Audio cannot be played here; each item has a hear_url for the app. Reading marks nothing as heard. For prayers the believer sent to others use prayers_i_offered; to answer one use say_amen with its id. count 0 when none. ${CONSENT}`,
    inputSchema: {
      limit: z.number().int().min(1).max(40).default(12).describe('Maximum prayers, 1 to 40 (default 12).'),
      only_unheard: z.boolean().default(false).describe('true: only prayers not yet heard. Default false.'),
    },
    outputSchema: out({
      count: z.number().describe('Prayers returned.'),
      prayers: z.array(z.looseObject({ id: z.string(), from: z.string(), kind: z.string(), seconds: z.number(), words: z.string().nullable(), heard: z.boolean(), amen: z.boolean(), when: z.string(), hear_url: z.string() })).describe('Each: id (for say_amen), sender, kind (prayer, encouragement, forgiveness, blessing, thanks), voice seconds (0 if written), written words, heard, Amen said, delivered time, link to hear it.'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: widgetMeta('prayer-card', 'Looking at the prayers over you', 'The prayers waiting for you'),
  }, async ({ limit, only_unheard }) => {
    const r = await rpcAs(env, me, 'prayers_for_me', { p_limit: limit, p_before: null, p_kind: null });
    if (r.error) return fail(`We could not read the prayers just now (${r.error}). The door is open at ${SITE}/prayers-for-me.`);
    let rows = (r.data as PrayerForMe[] | null) ?? [];
    if (only_unheard) rows = rows.filter((p) => !p.heard_at);
    const prayers = rows.map((p) => ({
      id: p.id, from: p.anonymous || !p.from_name ? 'someone in the family' : p.from_name, kind: p.kind, seconds: p.seconds, words: p.words,
      heard: Boolean(p.heard_at), amen: Boolean(p.amen_at), when: p.delivered_at, hear_url: `${SITE}/prayers-for-me?hear=${p.id}`,
    }));
    if (!prayers.length) return ok(paragraph([`No prayer is waiting for them right now`, `They can pray for someone by name at ${DOORS.prayVoice}, and the family prays back`]), { count: 0, prayers: [] });
    const lines = prayers.slice(0, 8).map((p) => `${p.from} ${ACT[p.kind] ?? 'prayed for you'} ${sinceWord(p.when)} (${p.seconds}s${p.heard ? ', heard' : ', not yet heard'}${p.amen ? ', Amen said' : ''}): ${p.hear_url}`);
    return ok(paragraph([`${prayers.length} ${prayers.length === 1 ? 'prayer' : 'prayers'} over ${'them'}, newest first: ${list(lines, 8)}`, `Open the link to hear the voice; say Amen there or with say_amen`]), { count: prayers.length, prayers });
  });

  tool(server, 'prayers_i_offered', {
    title: 'Prayers I gave',
    description: `List the prayers and blessings the signed-in believer sent to others, newest first, each with its delivery state: waiting for the recipient's morning, delivered, heard, Amen, thank you, or taken back. Use for "did my prayer for Maria arrive". No totals or scores are computed. For prayers others sent to the believer use prayers_waiting_for_me; to send a new one use pray_for_someone. count 0 when none. ${CONSENT}`,
    inputSchema: { limit: z.number().int().min(1).max(40).default(12).describe('Maximum prayers, 1 to 40 (default 12).') },
    outputSchema: out({
      count: z.number().describe('Prayers returned.'),
      prayers: z.array(z.looseObject({ id: z.string(), for: z.string(), kind: z.string(), seconds: z.number(), words: z.string().nullable(), state: z.string(), when: z.string() })).describe('Each: id, recipient name, kind, voice seconds (0 if written), written words, state in plain words, scheduled delivery time.'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ limit }) => {
    const r = await rpcAs(env, me, 'prayers_i_offered', { p_limit: limit });
    if (r.error) return fail(`We could not read the prayers just now (${r.error}). The door is open at ${SITE}/prayers-for-me.`);
    const rows = (r.data as PrayerIOffered[] | null) ?? [];
    const prayers = rows.map((p) => ({ id: p.id, for: p.for_name ?? 'someone', kind: p.kind, seconds: p.seconds, words: p.words, state: offeredState(p), when: p.deliver_at }));
    if (!prayers.length) return ok(paragraph([`They have not prayed for anyone here yet`, `The first voice in a family is always somebody's: ${DOORS.prayVoice}`]), { count: 0, prayers: [] });
    return ok(paragraph([`${prayers.length} ${prayers.length === 1 ? 'prayer' : 'prayers'} they gave: ${list(prayers.slice(0, 8).map((p) => `for ${p.for}, ${sinceWord(p.when)}, ${p.state}`), 8)}`, `Pray for someone else by name at ${DOORS.prayVoice}`]), { count: prayers.length, prayers });
  });

  tool(server, 'say_amen', {
    title: 'Say Amen to a prayer over me',
    description: `Answer one prayer someone sent to the signed-in believer with Amen, and optionally thank you; the sender sees it. Use only when the believer asks to answer a specific prayer, with its id from prayers_waiting_for_me. Repeating it is harmless (idempotent). To send a new prayer use pray_for_someone instead. Two-step consent: without confirmed it writes nothing and returns the act in \`would\`; call again with confirmed true after the believer says yes. An idempotency_key is accepted. ${CONSENT}`,
    inputSchema: {
      prayer_id: z.string().uuid().describe('Prayer UUID from prayers_waiting_for_me.'),
      thank_them: z.boolean().default(false).describe('true: also say thank you to the sender. Default false.'),
      confirmed: z.boolean().default(false).describe('false (default): write nothing, return the restatement. true: only after the believer confirmed this Amen.'),
    },
    outputSchema: out({
      prayer_id: z.string().describe('The prayer answered.'),
      said: z.boolean().describe('true when Amen was recorded.'),
      thanked: z.boolean().describe('true when thank you was recorded too.'),
      needs_confirmation: z.boolean().optional().describe('true when nothing was written yet.'),
      would: z.string().optional().describe('The exact act that will happen on confirmation.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ prayer_id, thank_them, confirmed }) => {
    if (!confirmed) {
      const would = `Say Amen${thank_them ? ', and thank you,' : ''} to the prayer ${prayer_id} prayed over you; the one who prayed will see it`;
      return ok(paragraph([`Nothing has been said yet`, `${would}`, `Ask the believer to confirm, then call say_amen again with confirmed true`]), { prayer_id, said: false, thanked: false, needs_confirmation: true, would });
    }
    const r = await rpcAs(env, me, 'say_amen', { p_id: prayer_id, p_thanks: thank_them });
    if (r.error || r.data !== true) return fail(`That Amen did not go through${r.error ? ` (${r.error})` : ''}. It can be said in the app at ${SITE}/prayers-for-me?hear=${prayer_id}.`);
    return ok(paragraph([`Amen${thank_them ? ', and thank you,' : ''} said to that prayer`, `The one who prayed will see it`]), { prayer_id, said: true, thanked: thank_them });
  });

  tool(server, 'my_walk', {
    title: 'My walk: what I said yes to',
    description: `List the signed-in believer's own yeses (commitments written with say_yes or in the app), newest first: their words, the verse reference they held, state, when it was lived, and their reflection. Use for "what did I say yes to". No streaks or scores. To write a new one use say_yes; for yeses others shared use family_saying_yes. count 0 when none. ${CONSENT}`,
    inputSchema: { limit: z.number().int().min(1).max(40).default(10).describe('Maximum entries, 1 to 40 (default 10).') },
    outputSchema: out({
      count: z.number().describe('Entries returned.'),
      entries: z.array(z.looseObject({ id: z.string(), words: z.string(), verse_ref: z.string().nullable(), state: z.string(), when: z.string(), lived_at: z.string().nullable(), reflection: z.string().nullable() })).describe('Each yes: id, words, verse reference, state, created time, lived time or null, the believer\'s reflection or null.'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ limit }) => {
    const r = await rpcAs(env, me, 'my_walk', { p_limit: limit });
    if (r.error) return fail(`We could not read their walk just now (${r.error}). The door is open at ${SITE}/today.`);
    const rows = (r.data as WalkEntry[] | null) ?? [];
    const entries = rows.map((w) => ({ id: w.id, words: w.words, verse_ref: w.verse_ref, state: w.state, when: w.created_at, lived_at: w.lived_at, reflection: w.reflection }));
    if (!entries.length) return ok(paragraph([`They have not written a yes yet`, `Today's walk begins at ${SITE}/today`]), { count: 0, entries: [] });
    return ok(paragraph([`${entries.length} ${entries.length === 1 ? 'yes' : 'yeses'} in their walk: ${list(entries.slice(0, 6).map((e) => `"${e.words}"${e.verse_ref ? ` (${e.verse_ref})` : ''}, ${e.lived_at ? 'lived' : e.state}`), 6)}`, `Continue at ${SITE}/today`]), { count: entries.length, entries });
  });

  tool(server, 'my_family', {
    title: 'My family in Christ',
    description: `List the circles and prayer groups the signed-in believer belongs to, and the next non-cancelled gatherings of those groups (time in the group's own time zone, host, how many are going, whether the believer RSVPed). Use for "what groups am I in" or "when is my next prayer night"; gathering ids work with going_to_gathering. For groups they could join use communities_to_join; for their church's events use my_church. Both lists empty when they are in no circle. ${CONSENT}`,
    inputSchema: { gatherings: z.number().int().min(0).max(20).default(6).describe('How many upcoming gatherings to include, 0 to 20 (default 6; 0 skips them).') },
    outputSchema: out({
      families: z.array(z.looseObject({ id: z.string(), name: z.string(), members: z.number(), i_lead: z.boolean(), url: z.string() })).describe('Their circles: id, name, member count, whether they lead it, link.'),
      gatherings: z.array(z.looseObject({ id: z.string(), title: z.string(), community: z.string().nullable(), when: z.string(), when_local: z.string(), host: z.string(), going: z.number(), i_am_going: z.boolean(), scripture_ref: z.string().nullable(), url: z.string() })).describe('Upcoming gatherings: id, title, circle, start (ISO UTC and local), host, going count, their RSVP, verse reference, link.'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ gatherings }) => {
    const [f, g] = await Promise.all([rpcAs(env, me, 'my_families'), gatherings ? rpcAs(env, me, 'my_group_gatherings', { p_limit: gatherings }) : Promise.resolve({ data: [], error: null })]);
    const families = ((f.data as Family[] | null) ?? []).map((x) => ({ id: x.id, name: x.name, members: x.member_count, i_lead: x.i_lead, url: `${SITE}/community/${x.id}` }));
    const raw = Array.isArray(g.data) ? (g.data as Gathering[]) : [];
    const next = raw.filter((x) => x.status !== 'cancelled').map((x) => ({
      id: x.id, title: x.title, community: x.community_name, when: x.starts_at, when_local: whenLocal(x.starts_at, x.timezone), host: x.host_name,
      going: x.going_count, i_am_going: x.i_rsvped, scripture_ref: x.scripture_ref, url: `${SITE}/community/${x.community_id}`,
    }));
    if (!families.length && !next.length) return ok(paragraph([`They are not in a circle yet`, `Communities to join are at ${DOORS.communities}`]), { families: [], gatherings: [] });
    return ok(paragraph([
      families.length ? `Their circles: ${list(families.map((x) => `${x.name} (${x.members}${x.i_lead ? ', they lead it' : ''})`), 8)}` : null,
      next.length ? `Next gatherings: ${list(next.map((x) => `${x.title}${x.community ? ` with ${x.community}` : ''}, ${x.when_local}${x.i_am_going ? ', they are going' : ''}`), 6)}` : `No gathering is on their calendar yet`,
      `Open any room at ${DOORS.communities}`,
    ]), { families, gatherings: next });
  });
}
