/* ============================================================
   THE LIVING BREAD MCP, acting for the signed-in believer, when they say so.

   Every write here reuses a database function the app itself calls, AS the
   believer (RLS from their token), and only after the believer asked for
   exactly that act: see src/consent.ts. The words of a prayer, a yes or a
   blessing are the believer's own; an assistant never prays in a person's
   name, so the restatement quotes the words back before anything is sent.
   Every result ends with the door in the app.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { type Believer, restAs, rpcAs, selectAs } from './auth';
import { consent, declined, notYet } from './consent';
import { DOORS, SITE } from './doors';
import { list, paragraph } from './render';
import { fail, firstName, isUuid, ok, out, tool, WRITES, WRITES_ONCE, READS } from './shared';

const CONSENT_LAW = 'Two-step consent: without confirmed it writes nothing and returns the exact act in `would` (or asks the person directly when the client supports elicitation); call again with confirmed true only after they say yes. Acts as the signed-in believer; an idempotency_key or an identical confirmed retry within ten minutes never acts twice.';

/* The confirmation flag and the act-result fields every writing tool shares. */
const confirmedInput = z.boolean().default(false).describe('false (default): write nothing, return the restatement in `would`. true: only after the person confirmed that exact act in their own words.');
const ACT_FIELDS = {
  done: z.boolean().describe('true when the act was written (or was already in that state).'),
  needs_confirmation: z.boolean().describe('true when nothing was written yet: read `would` back and ask.'),
  would: z.string().optional().describe('The exact act that will happen on confirmation.'),
  door: z.string().optional().describe('Link where the believer sees the result in the app.'),
};

export const FEELINGS = ['anxious', 'afraid', 'grieving', 'weary', 'tempted', 'lonely', 'guilty', 'discouraged', 'seeking', 'thankful', 'joyful', 'waiting', 'angry', 'doubting', 'hurting', 'newseason', 'forgiving', 'provision', 'unnamed'] as const;

/* ---- who a first name means, among the believer's own people ---------------------------------- */
export interface Person { id: string; name: string; relation: string }

interface CircleRow { member_id: string; user: { id: string; name: string | null } | { id: string; name: string | null }[] | null }
interface PartnerRow { requester_id: string; partner_id: string; requester: { id: string; name: string | null } | null; partner: { id: string; name: string | null } | null }
interface OfferedRow { for_id: string | null; for_name: string | null }

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** The believer's family, the way the composer gathers it: their Two or Three (inner circle), prayer partners, and people they prayed for before. */
export async function familyPeople(env: Env, me: Believer): Promise<Person[]> {
  const [circle, partners, offered] = await Promise.all([
    selectAs<CircleRow>(env, me, 'inner_circle', `owner_id=eq.${me.userId}&select=member_id,user:users!member_id(id,name)`),
    selectAs<PartnerRow>(env, me, 'prayer_partnerships', `status=eq.active&or=(requester_id.eq.${me.userId},partner_id.eq.${me.userId})&select=requester_id,partner_id,requester:users!requester_id(id,name),partner:users!partner_id(id,name)`),
    rpcAs(env, me, 'prayers_i_offered', { p_limit: 40 }),
  ]);
  const map = new Map<string, Person>();
  const add = (id: string | null | undefined, name: string | null | undefined, relation: string) => {
    if (!id || id === me.userId || map.has(id)) return;
    map.set(id, { id, name: (name ?? '').trim() || 'A believer', relation });
  };
  for (const r of circle ?? []) { const u = one(r.user); add(r.member_id, u?.name, 'your Two or Three'); }
  for (const r of partners ?? []) {
    const other = r.requester_id === me.userId ? r.partner : r.requester;
    add(other?.id ?? (r.requester_id === me.userId ? r.partner_id : r.requester_id), other?.name, 'prayer partner');
  }
  for (const r of (Array.isArray(offered.data) ? (offered.data as OfferedRow[]) : [])) add(r.for_id, r.for_name, 'you prayed for them before');
  return [...map.values()];
}

export type Resolved = { kind: 'one'; person: Person } | { kind: 'many'; candidates: Person[] } | { kind: 'none' };

/** A user id is taken as given (and checked to exist); a name is matched among the family; anything ambiguous is handed back, never guessed. */
export async function resolvePerson(env: Env, me: Believer, person: string): Promise<Resolved> {
  const q = person.trim();
  if (isUuid(q)) {
    const rows = await selectAs<{ id: string; name: string | null }>(env, me, 'users', `id=eq.${q}&select=id,name&limit=1`);
    const u = rows?.[0];
    return u ? { kind: 'one', person: { id: u.id, name: (u.name ?? '').trim() || 'A believer', relation: 'by id' } } : { kind: 'none' };
  }
  const family = await familyPeople(env, me);
  const lower = q.toLowerCase();
  const exact = family.filter((p) => p.name.toLowerCase() === lower || firstName(p.name).toLowerCase() === lower);
  if (exact.length === 1) return { kind: 'one', person: exact[0] };
  if (exact.length > 1) return { kind: 'many', candidates: exact };
  const loose = family.filter((p) => p.name.toLowerCase().includes(lower));
  if (loose.length === 1) return { kind: 'one', person: loose[0] };
  if (loose.length > 1) return { kind: 'many', candidates: loose };
  /* the composer's own last resort: a name search among believers; the assistant must ask before using one of these */
  const needle = q.replace(/[%_,()*]/g, ' ').replace(/\s+/g, ' ').trim();
  if (needle.length < 2) return { kind: 'none' };
  const found = await selectAs<{ id: string; name: string | null }>(env, me, 'users', `onboarded=eq.true&id=neq.${me.userId}&name=ilike.*${encodeURIComponent(needle)}*&select=id,name&limit=8`);
  const candidates = (found ?? []).map((u) => ({ id: u.id, name: (u.name ?? '').trim() || 'A believer', relation: 'found by name search, not in their family' }));
  return candidates.length ? { kind: 'many', candidates } : { kind: 'none' };
}

function ambiguous(toolName: string, person: string, r: Resolved) {
  if (r.kind === 'many') {
    return ok(paragraph([`"${person}" could mean more than one person, so nothing was sent`, `Candidates: ${list(r.candidates.map((c) => `${c.name} (${c.relation}, id ${c.id})`), 8)}`, `Ask the believer which one they mean, then call ${toolName} again with that person's id`]), { done: false, needs_confirmation: true, ambiguous: true, candidates: r.candidates });
  }
  return ok(paragraph([`Nobody called "${person}" is among their family on The Living Bread, and nothing was sent`, `They can pray for ${person} anyway at ${DOORS.prayVoice}: the same page makes a private link for someone who has not joined, and they hear the prayer without an account`]), { done: false, needs_confirmation: false, not_found: true, person, door: DOORS.prayVoice });
}

interface VoiceRow { id: string; recipient_id: string | null; kind: string; delivered_at: string | null }

export const ACT_TOOL_SUMMARY: ReadonlyArray<[string, string]> = [
  ['pray_for_someone', 'send a WRITTEN prayer, in their own words, to someone in their family (lands under that person\'s Prayers for me)'],
  ['speak_a_blessing', 'send a written blessing to someone in their family, in their own words'],
  ['bring_what_i_carry', 'name what they are carrying today, in a word or a feeling, privately or with the Body'],
  ['say_yes', 'write a yes to Christ into their walk, with the verse they held, private or shared'],
  ['going_to_gathering', 'say they are going (or not) to a gathering of one of their circles'],
  ['set_a_table', 'set a Living Bread Table: a real time and place to gather, with seats'],
  ['someone_to_talk_to', 'ask for a real person to talk to now (the app\'s care match), or the wider family when nobody is on call'],
  ['offer_to_serve', 'promise to meet one open Serve need'],
  ['say_amen', 'answer a prayer prayed over them with Amen, and thank you'],
];

export const SIGNED_IN_READ_SUMMARY: ReadonlyArray<[string, string]> = [
  ['my_day', 'today in one paragraph: the bread, prayers waiting, who in their family is carrying something, the next gathering, a need near them, the open yes'],
  ['invite_someone', 'their own invitation link, so they can bring someone'],
  ['my_church', 'their church: this week\'s events and the prayer requests the church shares with its members'],
  ['my_invitations', 'what is waiting for them: offers to walk a yes with them, seats saved at a Table'],
  ['family_saying_yes', 'the yeses the family has opened to the Body, the heavy ones first'],
  ['who_is_available_now', 'how many said they are available to pray, listen, talk or serve, in a window still open; counts and first names only'],
  ['find_help_for_my_need', 'the nearest safe doors for a need, in order: family, groups, people available, church, a gathering, the Word, crisis first when there is danger'],
];

export function registerActs(server: McpServer, env: Env, me: Believer): void {
  // ---- pray_for_someone and speak_a_blessing: the written path the app uses (lib/prayerWords.ts) ----
  const sendWords = async (kind: 'prayer' | 'blessing', toolName: string, person: string, words: string, confirmed: boolean) => {
    const text = words.trim();
    if (!text) return fail('A prayer needs words. The words must be the believer\'s own; an assistant does not write a prayer in a person\'s name.');
    const r = await resolvePerson(env, me, person);
    if (r.kind !== 'one') return ambiguous(toolName, person, r);
    const to = r.person;
    const verb = kind === 'prayer' ? 'prayed for you' : 'blessed you';
    const would = `Send this written ${kind} to ${to.name} (${to.relation}) as the believer, in the believer's own name: "${text}". ${firstName(to.name)} will be told "<their name> ${verb}", with these words, and will find it under Prayers for me`;
    const c = await consent(server, confirmed, would);
    if (c === 'ask') return notYet(would, toolName, { to });
    if (c === 'no') return declined(`The ${kind} for ${to.name}`, { to });
    const w = await rpcAs(env, me, 'offer_voice_prayer', {
      p_voice_path: null, p_seconds: 0, p_recipient: to.id, p_subject_kind: null, p_subject_id: null, p_words: text,
      p_words_are_spoken: false, p_audience: 'recipient', p_deliver_at: null, p_share: false, p_for_name: null,
      p_anonymous: false, p_kind: kind, p_welcome: false,
    });
    const row = (Array.isArray(w.data) ? w.data[0] : w.data) as VoiceRow | null;
    if (w.error || !row?.id) return fail(paragraph([`The ${kind} did not go through${w.error ? ` (${w.error})` : ''}`, `Nothing was sent. It can be prayed in the app at ${DOORS.prayVoice}`]));
    return ok(paragraph([
      `Sent: the believer's written ${kind} for ${to.name} is on its way`,
      `${firstName(to.name)} has been told, and will read it under Prayers for me; they can say Amen or pray one back`,
      `The believer sees it, and its honest state, with prayers_i_offered or at ${DOORS.prayersForMe}`,
    ]), { done: true, needs_confirmation: false, prayer_id: row.id, to, kind, delivered: Boolean(row.delivered_at), door: DOORS.prayersForMe, pray_again: DOORS.prayVoice });
  };

  const personInput = {
    person: z.string().min(1).max(120).describe('Recipient: a user id (UUID) from my_family, prayers_i_offered or an earlier candidates list, or a name matched among the believer\'s family (Two or Three, prayer partners, people prayed for before). Ambiguous or unknown names send nothing and return candidates.'),
    words: z.string().min(1).max(2000).describe('The prayer exactly as the believer said or typed it, 1 to 2000 characters. Never composed or edited by the assistant.'),
    confirmed: confirmedInput,
  };
  const actOut = out({
    ...ACT_FIELDS,
    prayer_id: z.string().optional().describe('Id of the sent prayer or blessing.'),
    to: z.looseObject({ id: z.string(), name: z.string(), relation: z.string() }).optional().describe('The resolved recipient: id, name, and relation to the believer.'),
    candidates: z.array(z.looseObject({ id: z.string(), name: z.string(), relation: z.string() })).optional().describe('When the name was ambiguous: possible recipients to ask about; call again with the chosen id.'),
  });

  tool(server, 'pray_for_someone', {
    title: 'Pray for someone, in writing, as the believer',
    description: `Send a written prayer, in the signed-in believer's own words and under their name, to one person in their Living Bread family; the recipient is notified once ("<name> prayed for you") and finds it under Prayers for me. Use when the believer dictates a prayer for a named person. For words of blessing rather than prayer use speak_a_blessing; to answer a prayer someone prayed over them use say_amen; for a voice prayer or someone not on the app, give the link ${DOORS.prayVoice}. The assistant never writes the prayer itself. ${CONSENT_LAW}`,
    inputSchema: personInput,
    outputSchema: actOut,
    annotations: WRITES,
  }, ({ person, words, confirmed }) => sendWords('prayer', 'pray_for_someone', person, words, confirmed));

  tool(server, 'speak_a_blessing', {
    title: 'Speak a blessing over someone, in writing',
    description: `Send a written blessing, in the signed-in believer's own words, to one person in their Living Bread family (same delivery as a prayer, kind "blessing"; the recipient is told "<name> blessed you"). Use for "bless my daughter with these words" or "send Daniel a blessing for his new job". For a prayer use pray_for_someone; for what the believer themself carries use bring_what_i_carry. Unknown or ambiguous names send nothing and return candidates. ${CONSENT_LAW}`,
    inputSchema: { ...personInput, words: z.string().min(1).max(2000).describe('The blessing exactly as the believer said or typed it, 1 to 2000 characters. Never composed by the assistant.') },
    outputSchema: actOut,
    annotations: WRITES,
  }, ({ person, words, confirmed }) => sendWords('blessing', 'speak_a_blessing', person, words, confirmed));

  // ---- bring_what_i_carry: say_what_you_carry (lib/carrying.ts, migration 0464) ----
  tool(server, 'bring_what_i_carry', {
    title: 'Bring what I carry today',
    description: `Record what the signed-in believer is carrying today (a feeling from a fixed list, plus optional words), as the app's "What are you carrying?" does. Shared (default), believers can pray over it and the believer is told when they do; private, nobody else sees it. One entry per feeling per day: saying it again replaces it. Use for "I am anxious today, tell the family". For verses about a feeling use verses_for; to ask a person to talk now use someone_to_talk_to; for a commitment to act use say_yes. ${CONSENT_LAW}`,
    inputSchema: {
      feeling: z.enum(FEELINGS).default('unnamed').describe('Closest feeling from the list; "newseason" means a new season of life, "provision" a material need. Use "unnamed" (default) when only the words say it.'),
      words: z.string().max(600).optional().describe('What they carry, in their own words, up to 600 characters. Required when feeling is "unnamed".'),
      share_with_body: z.boolean().default(true).describe('true (default): visible to believers, who can pray over it. false: private.'),
      anonymous: z.boolean().default(false).describe('When shared, show "someone in the family" instead of their name. Default false.'),
      confirmed: confirmedInput,
    },
    outputSchema: out({
      ...ACT_FIELDS,
      id: z.string().optional().describe('Id of the saved entry.'),
      feeling: z.string().optional().describe('The feeling saved.'),
      audience: z.string().optional().describe('"kingdom" (shared) or "private".'),
      replaced: z.boolean().optional().describe('true when it replaced an entry for the same feeling earlier today.'),
    }),
    annotations: WRITES_ONCE,
  }, async ({ feeling, words, share_with_body, anonymous, confirmed }) => {
    const text = words?.trim() || null;
    if (feeling === 'unnamed' && !text) return fail('Say something, or choose the feeling that is closest. Nothing was saved.');
    const would = `Record that the believer is carrying ${feeling === 'unnamed' ? 'something they put in their own words' : `"${feeling}"`} today${text ? `: "${text}"` : ''}, ${share_with_body ? `shared with the Body${anonymous ? ' without their name' : ' under their name'} so real believers can pray over it` : 'privately, between them and God'}`;
    const c = await consent(server, confirmed, would);
    if (c === 'ask') return notYet(would, 'bring_what_i_carry');
    if (c === 'no') return declined('The carrying');
    const r = await rpcAs(env, me, 'say_what_you_carry', { p_words: text, p_feeling: feeling, p_audience: share_with_body ? 'kingdom' : 'private', p_anonymous: anonymous });
    const d = (r.data ?? {}) as { ok?: boolean; id?: string; feeling?: string; audience?: string; replaced?: boolean; route?: string | null };
    if (r.error || !d.id) return fail(paragraph([`That did not save${r.error ? ` (${r.error})` : ''}`, `Nothing was lost; the door is open at ${DOORS.carrying}`]));
    const door = d.route ? `${SITE}${d.route}` : DOORS.carrying;
    return ok(paragraph([
      `Saved: they are carrying ${d.feeling ?? feeling} today${d.replaced ? ' (it replaced what they had named earlier today)' : ''}`,
      share_with_body ? `The Body can see it and pray; they will be told when someone does, at ${door}` : `It is private, between them and God; the Word for it waits at ${DOORS.carrying}`,
      'Christ carries it with them (Matthew 11:28)',
    ]), { done: true, needs_confirmation: false, id: d.id, feeling: d.feeling ?? feeling, audience: d.audience ?? (share_with_body ? 'kingdom' : 'private'), replaced: Boolean(d.replaced), door });
  });

  // ---- say_yes: say_yes (lib/kingdomWork.ts, migration 0580) ----
  tool(server, 'say_yes', {
    title: 'Say yes: write a yes into my walk',
    description: `Create a new "yes" in the signed-in believer's walk (the app's My Yes): one concrete thing they will do, in their own words, with an optional verse reference, private by default or shared so others can stand with it. Creates a new entry on every confirmed call; there are no streaks or scores. Use for "write down my yes: call my mother tonight". To read their past yeses use my_walk; to see yeses others shared use family_saying_yes; for a feeling rather than a commitment use bring_what_i_carry. ${CONSENT_LAW}`,
    inputSchema: {
      words: z.string().min(1).max(600).describe('The commitment in the believer\'s own words, 1 to 600 characters: "call my mother tonight".'),
      verse_ref: z.string().max(80).optional().describe('Optional Bible reference they are holding, e.g. "Matthew 6:14". A reference, not verse text.'),
      share: z.boolean().default(false).describe('true: shared with other believers (words, verse, progress). false (default): private.'),
      confirmed: confirmedInput,
    },
    outputSchema: out({ ...ACT_FIELDS, yes_id: z.string().optional().describe('Id of the new yes.') }),
    annotations: WRITES,
  }, async ({ words, verse_ref, share, confirmed }) => {
    const text = words.trim();
    const would = `Write this yes into the believer's walk: "${text}"${verse_ref ? ` (holding ${verse_ref})` : ''}, ${share ? 'opened to the Body so the family can stand with it' : 'private, between them and God'}`;
    const c = await consent(server, confirmed, would);
    if (c === 'ask') return notYet(would, 'say_yes');
    if (c === 'no') return declined('The yes');
    const r = await rpcAs(env, me, 'say_yes', { p_words: text, p_verse: verse_ref ?? null, p_timeframe: null, p_share: share, p_inspired_by: null });
    const id = typeof r.data === 'string' ? r.data : null;
    if (r.error || !id) return fail(paragraph([`The yes did not save${r.error ? ` (${r.error})` : ''}`, `Nothing was lost; it can be said at ${DOORS.myYes}`]));
    const door = share ? `${SITE}/yes/${id}` : DOORS.myYes;
    return ok(paragraph([`Written: "${text}" is now a yes in their walk${share ? ', open to the family' : ', private'}`, `They say how it is going at ${DOORS.myYes}${share ? `, and the family stands with it at ${door}` : ''}`, 'A yes said to Christ is walked with Him, never alone']), { done: true, needs_confirmation: false, yes_id: id, door });
  });

  // ---- going_to_gathering: the same table write lib/eventsGroup.ts setGoing makes (church_event_rsvps) ----
  interface GatheringJson { id: string; community_id: string; community_name: string | null; title: string; starts_at: string; timezone: string | null; status: string; host_name: string; going_count: number; i_rsvped: boolean }
  tool(server, 'going_to_gathering', {
    title: 'I am going to this gathering',
    description: `Set or remove the signed-in believer's RSVP ("I'm going") for one gathering of a circle they belong to; the host and members see it. Idempotent: if they are already in the requested state it returns done without writing. Cancelled or unreadable gatherings return an error. Use with a gathering id from my_family or my_day ("tell them I'm coming Thursday"). Not for public gatherings found by find_gatherings_near (those are joined on their own page), and not for hosting (set_a_table). ${CONSENT_LAW}`,
    inputSchema: {
      gathering_id: z.string().uuid().describe('Gathering UUID from my_family or my_day.'),
      going: z.boolean().default(true).describe('true (default): mark as going. false: take the RSVP back.'),
      confirmed: confirmedInput,
    },
    outputSchema: out({
      ...ACT_FIELDS,
      gathering_id: z.string().optional().describe('The gathering acted on.'),
      going: z.boolean().optional().describe('The RSVP state after the call.'),
      title: z.string().optional().describe('Gathering title.'),
    }),
    annotations: WRITES_ONCE,
  }, async ({ gathering_id, going, confirmed }) => {
    const g = await rpcAs(env, me, 'group_gathering', { p_event: gathering_id });
    const row = (Array.isArray(g.data) ? g.data[0] : g.data) as GatheringJson | null;
    if (g.error || !row?.id) return fail(paragraph([`That gathering could not be read${g.error ? ` (${g.error})` : ''}`, `Their gatherings are at ${DOORS.communities}`]));
    if (row.status === 'cancelled') return fail(`"${row.title}" was cancelled, so there is nothing to go to. Their gatherings are at ${DOORS.communities}.`);
    const door = `${SITE}/community/${row.community_id}`;
    if (going && row.i_rsvped) return ok(paragraph([`They are already marked as going to "${row.title}"`, `The room is at ${door}`]), { done: true, needs_confirmation: false, gathering_id, going: true, title: row.title, door });
    if (!going && !row.i_rsvped) return ok(paragraph([`They were not marked as going to "${row.title}", so there is nothing to take back`, `The room is at ${door}`]), { done: true, needs_confirmation: false, gathering_id, going: false, title: row.title, door });
    const would = going ? `Mark the believer as going to "${row.title}"${row.community_name ? ` with ${row.community_name}` : ''} (${row.starts_at}); the host and the circle will see them among those going` : `Take back the believer's "going" for "${row.title}"${row.community_name ? ` with ${row.community_name}` : ''}`;
    const c = await consent(server, confirmed, would);
    if (c === 'ask') return notYet(would, 'going_to_gathering', { gathering_id, title: row.title });
    if (c === 'no') return declined('The RSVP', { gathering_id });
    const w = going
      ? await restAs(env, me, 'POST', 'church_event_rsvps?on_conflict=event_id,user_id&select=event_id,user_id', { event_id: gathering_id, user_id: me.userId }, 'resolution=merge-duplicates,return=representation')
      : await restAs(env, me, 'DELETE', `church_event_rsvps?event_id=eq.${gathering_id}&user_id=eq.${me.userId}&select=event_id`, undefined, 'return=representation');
    if (w.error || !w.rows?.length) return fail(paragraph([`That did not go through${w.error ? ` (${w.error})` : ' (no row changed)'}`, `It can be done in the room at ${door}`]));
    return ok(paragraph([going ? `Done: they are going to "${row.title}"` : `Done: their "going" for "${row.title}" was taken back`, `The room is at ${door}`]), { done: true, needs_confirmation: false, gathering_id, going, title: row.title, door });
  });

  // ---- set_a_table: create_table (lib/tables.ts, migration 0334) ----
  tool(server, 'set_a_table', {
    title: 'Set a Living Bread Table',
    description: `Create a Table hosted by the signed-in believer: a real in-person gathering at a stated place and future time (60 minutes, walk-in), with optional seat limit, audience and purpose. Other believers can then save a seat and the host is told. Use for "set a table at my place Friday at 7 for six people". To RSVP to someone else's circle gathering use going_to_gathering; to see Tables open now use tables_live_now. The place text is shown to those who come, so it may be an address only if the host chooses. Unparseable or past times return an error. ${CONSENT_LAW}`,
    inputSchema: {
      title: z.string().min(2).max(120).describe('Name of the Table, 2 to 120 characters: "Friday supper and John 1".'),
      place: z.string().min(2).max(200).describe('Where, as the host says it (a home, a cafe, a church hall). Shown to those who come.'),
      starts_at: z.string().min(10).max(40).describe('Start time, ISO 8601 with offset, in the future, e.g. 2026-10-10T19:00:00-05:00.'),
      seats: z.number().int().min(1).max(200).optional().describe('Seat limit, 1 to 200. Omit for unlimited.'),
      who: z.string().max(120).optional().describe('Who it is for, e.g. "anyone", "students", "young families".'),
      how: z.string().max(300).optional().describe('What they gather around, e.g. "a meal and one chapter of John".'),
      city: z.string().max(80).optional().describe('City, so believers nearby can find it.'),
      country: z.string().max(80).optional().describe('Country name or ISO code.'),
      confirmed: confirmedInput,
    },
    outputSchema: out({ ...ACT_FIELDS, table_id: z.string().optional().describe('Id of the new Table.') }),
    annotations: WRITES,
  }, async ({ title, place, starts_at, seats, who, how, city, country, confirmed }) => {
    const when = Date.parse(starts_at);
    if (!Number.isFinite(when)) return fail('The start time could not be read. Use ISO 8601 with an offset, like 2026-10-10T19:00:00-05:00.');
    if (when < Date.now() - 60 * 60_000) return fail('That time has already passed. A Table is set for a time still to come.');
    const would = `Set a Table called "${title}" at ${place}${city ? `, ${city}` : ''} on ${new Date(when).toUTCString().replace(' GMT', ' UTC')}${seats ? `, ${seats} seats` : ''}${who ? `, for ${who}` : ''}${how ? `, gathering around ${how}` : ''}, hosted by the believer, visible to the family so they can save a seat`;
    const c = await consent(server, confirmed, would);
    if (c === 'ask') return notYet(would, 'set_a_table');
    if (c === 'no') return declined('The Table');
    const r = await rpcAs(env, me, 'create_table', {
      p_title: title, p_place: place, p_starts_at: new Date(when).toISOString(), p_purpose: how ?? null, p_city: city ?? null, p_country: country ?? null,
      p_duration_min: 60, p_capacity: seats ?? null, p_audience: who ?? null, p_language: null, p_accessibility: null, p_registration: 'walk_in', p_cohost: null, p_boundaries: null,
    });
    const id = typeof r.data === 'string' ? r.data : null;
    if (r.error || !id) return fail(paragraph([`The Table was not set${r.error ? ` (${r.error})` : ''}`, `It can be set in the app at ${DOORS.tables}/new`]));
    const door = `${SITE}/tables/${id}`;
    return ok(paragraph([`Set: "${title}" at ${place}, ${new Date(when).toUTCString().replace(' GMT', ' UTC')}`, `The family can save a seat at ${door}; all Tables are at ${DOORS.tables}`, 'Where two or three gather in His name, He is there (Matthew 18:20)']), { done: true, needs_confirmation: false, table_id: id, door });
  });

  // ---- someone_to_talk_to: the care match (lib/care.ts, migration 0348), with the app's own fallback ----
  tool(server, 'someone_to_talk_to', {
    title: 'Someone to talk to, now',
    description: `Open a live request for a real person (a pastor, a believer, or either) to talk with the signed-in believer now: everyone available is notified and the first to answer meets them in a private room. If nobody is available this minute, it instead posts an "I Need Someone" call to the wider family. Sends notifications to other people. Not a crisis service: when anyone is in danger call crisis_resources first. To only count who is available use who_is_available_now; to see every kind of help in order use find_help_for_my_need. ${CONSENT_LAW}`,
    inputSchema: {
      audience: z.enum(['shepherd', 'family', 'any']).default('any').describe('Who to ask: "shepherd" (pastors), "family" (other believers) or "any" (default).'),
      note: z.string().max(300).optional().describe('Optional one line in their words, up to 300 characters, shown to whoever answers.'),
      confirmed: confirmedInput,
    },
    outputSchema: out({
      ...ACT_FIELDS,
      request_id: z.string().optional().describe('Id of the opened request.'),
      reached: z.number().optional().describe('How many people were notified; 0 means the wider-family call was used instead.'),
      available_now: z.number().optional().describe('How many were available when asked.'),
    }),
    annotations: WRITES,
  }, async ({ audience, note, confirmed }) => {
    const avail = await rpcAs(env, me, 'care_available_now', { p_audience: audience, p_denomination: null });
    const n = typeof avail.data === 'number' ? avail.data : Number(avail.data ?? 0) || 0;
    const would = `Open a request to talk now, as the believer, to ${audience === 'shepherd' ? 'the shepherds' : audience === 'family' ? 'believers from the family' : 'anyone'} who is available (${n} on call this minute)${note ? `, with their note: "${note}"` : ''}; the first to answer meets them in a private room. If nobody answers, the wider family is asked through I Need Someone`;
    const c = await consent(server, confirmed, would);
    if (c === 'ask') return notYet(would, 'someone_to_talk_to', { available_now: n });
    if (c === 'no') return declined('The request to talk', { available_now: n });
    const r = await rpcAs(env, me, 'care_request_open', { p_kind: 'talk', p_audience: audience, p_denomination: null, p_note: note ?? null });
    const row = (Array.isArray(r.data) ? r.data[0] : r.data) as { id?: string; reached?: number } | null;
    if (r.error || !row?.id) return fail(paragraph([`The request did not open${r.error ? ` (${r.error})` : ''}`, `The door is open at ${SITE}/talk, and the prayer wall never closes: ${DOORS.prayer}`]));
    const reached = Number(row.reached ?? 0);
    if (reached === 0) {
      const wide = await rpcAs(env, me, 'call_for_someone', { p_kind: 'talk', p_note: note ?? null });
      const door = `${SITE}/need-someone`;
      return ok(paragraph([
        'No one is on call this very minute, so, as the app does, the wider family was asked for them instead' + (wide.error ? ` (that call did not go through: ${wide.error}; the prayer wall is always open at ${DOORS.prayer})` : ''),
        `They can watch who answers at ${door}`,
        'They are not alone: the Body is awake somewhere, and Christ is near (Psalm 34:18)',
      ]), { done: true, needs_confirmation: false, request_id: row.id, reached: 0, available_now: n, door });
    }
    const door = `${SITE}/talk/${row.id}`;
    return ok(paragraph([`Asked: ${reached} ${reached === 1 ? 'person was' : 'people were'} told that they want to talk now`, `The first to answer meets them in a private room at ${door}`]), { done: true, needs_confirmation: false, request_id: row.id, reached, available_now: n, door });
  });

  // ---- offer_to_serve: commit_to (lib/kingdomWork.ts) over an open Serve need ----
  tool(server, 'offer_to_serve', {
    title: 'Offer to meet a need',
    description: `Record the signed-in believer's commitment ("I will") to meet one open Serve need, as the app does; only the believer can later mark it kept. Use with a need id from needs_near or where_can_i_serve_publicly ("I'll take the groceries need in Bugesera"). To browse needs use those tools; this one only commits. A need that is unknown or no longer open returns an error. ${CONSENT_LAW}`,
    inputSchema: {
      need_id: z.string().uuid().describe('Serve need UUID from needs_near or where_can_i_serve_publicly.'),
      promise: z.string().max(300).optional().describe('Optional: what exactly they will do, in their words, up to 300 characters.'),
      confirmed: confirmedInput,
    },
    outputSchema: out({
      ...ACT_FIELDS,
      commitment_id: z.string().optional().describe('Id of the recorded commitment.'),
      need: z.looseObject({ id: z.string(), title: z.string() }).optional().describe('The need committed to.'),
    }),
    annotations: WRITES,
  }, async ({ need_id, promise, confirmed }) => {
    const rows = await selectAs<{ id: string; title: string; status: string; city: string | null; country: string | null }>(env, me, 'serve_needs', `id=eq.${need_id}&select=id,title,status,city,country&limit=1`);
    const need = rows?.[0];
    if (!need) return fail(`No need with that id is held. Open needs are at ${DOORS.serve}.`);
    if (need.status !== 'open') return fail(`"${need.title}" is no longer open (${need.status}). Open needs are at ${DOORS.serve}.`);
    const would = `Record the believer's promise to meet the need "${need.title}"${need.city || need.country ? ` (${[need.city, need.country].filter(Boolean).join(', ')})` : ''}${promise ? `: "${promise}"` : ''}; only they can later say it was kept`;
    const c = await consent(server, confirmed, would);
    if (c === 'ask') return notYet(would, 'offer_to_serve', { need: { id: need.id, title: need.title } });
    if (c === 'no') return declined('The promise', { need: { id: need.id, title: need.title } });
    const r = await rpcAs(env, me, 'commit_to', { p_kind: 'need', p_subject: need.id, p_promise: promise ?? null, p_due: null });
    const id = typeof r.data === 'string' ? r.data : null;
    if (r.error || !id) return fail(paragraph([`The promise was not recorded${r.error ? ` (${r.error})` : ''}`, `The need is at ${DOORS.serve}`]));
    const door = DOORS.serve; // serve/<id> has no web shell yet (404 on the web, 2026-10-05)
    return ok(paragraph([`Recorded: they will meet "${need.title}"`, `The need, and the partner behind it, are at ${door}; all Serve is at ${DOORS.serve}`, 'Whoever is kind to the poor lends to the LORD (Proverbs 19:17)']), { done: true, needs_confirmation: false, commitment_id: id, need: { id: need.id, title: need.title }, door });
  });

  // ---- signed-in reads ----
  tool(server, 'invite_someone', {
    title: 'My invitation link',
    description: 'Return the signed-in believer\'s personal invitation link and code: anyone who joins through it is connected to them and they are told on arrival. Use for "how do I invite my sister" or "give me my link to share". Read-only; sends nothing (the believer shares the link themselves). For a general description of the app use begin. If they have no code yet, returns the general join link and says so.',
    inputSchema: {},
    outputSchema: out({
      link: z.string().describe('The link to share.'),
      code: z.string().nullable().describe('Their personal invite code, or null if none exists yet.'),
      how: z.string().describe('What happens when someone joins through the link.'),
      door: z.string().describe('The app\'s Invite page, with a QR code.'),
    }),
    annotations: READS,
  }, async () => {
    const rows = await selectAs<{ invite_code: string | null; name: string | null }>(env, me, 'users', `id=eq.${me.userId}&select=invite_code,name&limit=1`);
    const code = rows?.[0]?.invite_code ?? null;
    const link = `${SITE}/i/${code ?? 'join'}`;
    const how = code ? 'Anyone who opens this link and begins is placed beside them in the family, and they are told when that person arrives.' : 'They have no personal code yet; the app makes one the first time they share from Invite. Until then the general door works and the family still welcomes whoever comes.';
    return ok(paragraph([`Their invitation: ${link}`, how, `Invite, with a QR code to show in person, is at ${SITE}/invite`, 'Go and make disciples (Matthew 28:19)']), { link, code, how, door: `${SITE}/invite` });
  });

  interface ChurchEvent { id: string; title: string; kind: string; starts_at: string; location: string | null; going_count: number; i_rsvped: boolean; is_online: boolean; cancelled_at: string | null }
  interface WallRow { id: string; title: string | null; body: string; category: string; is_urgent: boolean; is_anonymous: boolean; author_name: string | null; created_at: string; pray_count: number }
  tool(server, 'my_church', {
    title: 'My church this week',
    description: 'Read the signed-in believer\'s own church on The Living Bread as a member sees it: non-cancelled events in the next N days and up to 12 prayer requests shared with the church\'s members. Use for "what is on at my church this week" or "what is my church praying for". For a pastor\'s care requests use my_congregation; for churches near a place use find_churches_near; for their circles use my_family. Read-only. When they have not joined a church, returns church null with empty lists and a find-a-church link.',
    inputSchema: { days: z.number().int().min(1).max(60).default(7).describe('How many days of upcoming events, 1 to 60 (default 7).') },
    outputSchema: out({
      church: z.looseObject({ id: z.string(), name: z.string().nullable() }).nullable().describe('Their church, or null when none is joined.'),
      events: z.array(z.looseObject({ id: z.string(), title: z.string(), when: z.string(), where: z.string().nullable(), online: z.boolean(), going: z.number(), i_am_going: z.boolean() })).describe('Upcoming events: id, title, start (ISO, UTC), place or "online", how many are going, and whether the believer is.'),
      prayers: z.array(z.looseObject({ id: z.string(), from: z.string(), title: z.string().nullable(), body: z.string(), urgent: z.boolean(), when: z.string() })).describe('Prayer requests shared with members: first name or "someone in the church", title, text, urgency, posted time.'),
      door: z.string().describe('Link to the church room in the app.'),
    }),
    annotations: READS,
  }, async ({ days }) => {
    const rows = await selectAs<{ church_id: string | null; church_name: string | null }>(env, me, 'users', `id=eq.${me.userId}&select=church_id,church_name&limit=1`);
    const u = rows?.[0];
    if (!u?.church_id) return ok(paragraph([`They have not joined a church on The Living Bread yet${u?.church_name ? ` (their profile names ${u.church_name})` : ''}`, `Churches near them: find_churches_near, or ${DOORS.findAChurch}`]), { church: null, events: [], prayers: [], door: DOORS.findAChurch });
    const [ev, wall] = await Promise.all([rpcAs(env, me, 'get_church_events', { p_church_id: u.church_id }), rpcAs(env, me, 'get_prayer_wall', { p_layer: 'church', p_category: null, p_church_id: u.church_id, p_page: 0 })]);
    const horizon = Date.now() + days * 86_400_000;
    const events = (Array.isArray(ev.data) ? (ev.data as ChurchEvent[]) : []).filter((e) => !e.cancelled_at && Date.parse(e.starts_at) >= Date.now() - 3 * 3_600_000 && Date.parse(e.starts_at) <= horizon).map((e) => ({ id: e.id, title: e.title, when: e.starts_at, where: e.is_online ? 'online' : e.location, online: e.is_online, going: e.going_count, i_am_going: e.i_rsvped }));
    const prayers = (Array.isArray(wall.data) ? (wall.data as WallRow[]) : []).slice(0, 12).map((p) => ({ id: p.id, from: p.is_anonymous ? 'someone in the church' : firstName(p.author_name), title: p.title, body: p.body, urgent: p.is_urgent, when: p.created_at }));
    const door = `${SITE}/churches/${u.church_id}`;
    return ok(paragraph([
      `Their church: ${u.church_name ?? 'named on their profile'}`,
      events.length ? `This week: ${list(events.map((e) => `${e.title}, ${new Date(e.when).toUTCString().replace(' GMT', ' UTC')}${e.where ? `, ${e.where}` : ''}${e.i_am_going ? ', they are going' : ''}`), 6)}` : `No event is posted for the next ${days} days`,
      prayers.length ? `The church is praying for: ${list(prayers.slice(0, 5).map((p) => `${p.from}: ${p.title ?? p.body.slice(0, 80)}`), 5)}` : 'No prayer request is shared with the church right now',
      `The church room is at ${door}`,
    ]), { church: { id: u.church_id, name: u.church_name }, events, prayers, door });
  });

  interface YesOffer { yes_id: string; words: string; user_id: string; name: string | null; offered_at: string }
  interface HallRow { id: string; title: string; host_name: string; saved_for_me: boolean; present: number; seats: number; scheduled_at: string | null }
  tool(server, 'my_invitations', {
    title: 'What is waiting for me',
    description: 'List offers waiting for the signed-in believer\'s answer: people offering to walk one of their yeses with them, and seats saved for them at a Table. Use for "did anyone offer to walk with me" or "is a seat saved for me". Read-only: answering happens in the app at the returned links. Prayers prayed over them are in prayers_waiting_for_me, not here. Both lists empty when nothing is waiting.',
    inputSchema: {},
    outputSchema: out({
      walk_offers: z.array(z.looseObject({ yes_id: z.string(), words: z.string(), from: z.string(), when: z.string(), door: z.string() })).describe('Offers to walk a yes: which yes, its words, who offered (first name), when, and the link to answer.'),
      saved_seats: z.array(z.looseObject({ table_id: z.string(), title: z.string(), host: z.string(), present: z.number(), seats: z.number(), door: z.string() })).describe('Tables with a seat saved for them: title, host, people present, seats, link.'),
      door: z.string().describe('Link to their Today page.'),
    }),
    annotations: READS,
  }, async () => {
    const [offers, hall] = await Promise.all([rpcAs(env, me, 'my_yes_offers'), rpcAs(env, me, 'the_hall')]);
    const walk_offers = (Array.isArray(offers.data) ? (offers.data as YesOffer[]) : []).map((o) => ({ yes_id: o.yes_id, words: o.words, from: firstName(o.name), when: o.offered_at, door: DOORS.myYes }));
    const saved_seats = (Array.isArray(hall.data) ? (hall.data as HallRow[]) : []).filter((t) => t.saved_for_me).map((t) => ({ table_id: t.id, title: t.title, host: t.host_name, present: t.present, seats: t.seats, door: `${SITE}/the-table/${t.id}` }));
    if (!walk_offers.length && !saved_seats.length) return ok(paragraph(['Nothing is waiting for their answer right now', `Their yes is at ${DOORS.myYes}; the Tables are at ${DOORS.theTable}`]), { walk_offers: [], saved_seats: [], door: DOORS.today });
    return ok(paragraph([
      walk_offers.length ? `${list(walk_offers.map((o) => `${o.from} offered to walk their yes "${o.words.slice(0, 60)}" with them`), 5)}; they answer at ${DOORS.myYes}` : null,
      saved_seats.length ? `A seat is saved for them at ${list(saved_seats.map((s) => `"${s.title}" (${s.host} hosting, ${s.present} present)`), 5)}; the Tables are at ${DOORS.theTable}` : null,
    ]), { walk_offers, saved_seats, door: DOORS.today });
  });

  interface FamilyYes { id: string; name: string | null; words: string; verse_ref: string | null; state: string; created_at: string; n_with: number; i_am_with: boolean }
  tool(server, 'family_saying_yes', {
    title: 'The family saying yes',
    description: 'List the yeses other believers chose to share (never private ones), those marked "heavier than I thought" first, each with first name, words, verse reference, how many stand with it, and whether the signed-in believer already does. Use for "what is the family saying yes to" or "who needs someone to stand with them". Read-only: standing with one happens at its link. For the believer\'s own yeses use my_walk; to write one use say_yes. count 0 when none are shared.',
    inputSchema: { limit: z.number().int().min(1).max(40).default(10).describe('Maximum yeses, 1 to 40 (default 10).') },
    outputSchema: out({
      count: z.number().describe('Yeses returned.'),
      yeses: z.array(z.looseObject({ id: z.string(), from: z.string(), words: z.string(), verse_ref: z.string().nullable(), state: z.string(), with: z.number(), i_am_with: z.boolean(), when: z.string(), door: z.string() })).describe('Each yes: id, first name, words, verse reference, state ("needs_support" means heavier than expected), people standing with it, whether the believer is, when, link.'),
      door: z.string().describe('Link to all shared yeses.'),
    }),
    annotations: READS,
  }, async ({ limit }) => {
    const r = await rpcAs(env, me, 'family_yeses', { p_limit: limit });
    if (r.error) return fail(`The family's yeses could not be read just now (${r.error}). The room is at ${DOORS.yesFamily}.`);
    const yeses = (Array.isArray(r.data) ? (r.data as FamilyYes[]) : []).map((y) => ({ id: y.id, from: firstName(y.name), words: y.words, verse_ref: y.verse_ref, state: y.state, with: y.n_with, i_am_with: y.i_am_with, when: y.created_at, door: `${SITE}/yes/${y.id}` }));
    if (!yeses.length) return ok(paragraph(['No yes is open to the Body right now', `The believer's own yes is at ${DOORS.myYes}`]), { count: 0, yeses: [], door: DOORS.yesFamily });
    return ok(paragraph([`${yeses.length} ${yeses.length === 1 ? 'yes' : 'yeses'} open to the family${yeses.some((y) => y.state === 'needs_support') ? ', the heavy ones first' : ''}: ${list(yeses.slice(0, 6).map((y) => `${y.from}: "${y.words.slice(0, 70)}"${y.verse_ref ? ` (${y.verse_ref})` : ''}${y.state === 'needs_support' ? ', heavier than they thought' : ''}, ${y.with} with it`), 6)}`, `Stand with one at its door, or see them all at ${DOORS.yesFamily}`]), { count: yeses.length, yeses, door: DOORS.yesFamily });
  });
}
