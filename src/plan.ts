/* ============================================================
   THE LIVING BREAD MCP, plan_my_next_step.

   One read-only tool for the moment a person says what they need in a few
   words ("I just moved and I am lonely", "I want someone to pray with me",
   "our group has gone quiet"). It chooses one of five intents, reads the
   REAL data that fits (communities, churches, online gatherings, the prayer
   door, open Serve needs, the leader tools) and returns up to three
   experiences, each with a handoff (src/handoff.ts): the exact page, an
   invitation worded from what is there, and an honest if_empty when nothing
   suitable exists.

   It is not a broad "do everything" tool: it sends nothing, creates nothing,
   and never claims a group is active. The person's words are used to choose
   and filter in memory and are NOT logged (it is not one of the logged ask
   tools) and never reach a URL.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  churchFinderHandoff, churchKitHandoff, communitiesIfEmpty, communityHandoff, createCommunityHandoff, gatheringHandoff, handoffLine,
  pastorsHandoff, prayerRequestHandoff, prayerRoomHandoff, readingPlanHandoff, scriptureHandoff, serveHandoff, type Handoff, type HandoffIntent,
} from './handoff';
import { findChurches, findGatherings, geocode, communities, type Community } from './knowledge';
import { rhythmOf } from './rhythm';
import { looksLikeDanger, CRISIS_DOOR, chairDoorLive } from './openChair';
import { paragraph, placeOf, whenUTC } from './render';
import { ATTRIBUTION, ok, out, READS_WORLD, tool } from './shared';
import { record, scheduled, type Freshness } from './freshness';

/* ---- the intent ------------------------------------------------------------------------------------ */

/** Ordered: a leader's words first (they change the whole answer), then prayer, the Word, service, and family as the default. */
const INTENT_WORDS: [HandoffIntent, RegExp][] = [
  /* A leader's words change the whole answer, so they come first. A bare "our group" or "my church" does not make someone a leader:
     it must come with leading, starting, creating, welcoming or reconnecting, or a leader's title. */
  ['bring_your_people', /\b(pastor|priest|bishop|deacon|elder|youth leader|small group leader|ministry team|gone quiet|has become quiet|have become quiet|gone silent|reconnect|welcome (new )?members|bring (my|our) (people|church|group|congregation)|(start|starting|create|creating|launch|set up|setting up|lead|leading|run|running) (a|an|my|our|the) (small |bible |study |prayer |home )?(group|community|church|bible study|space|ministry|fellowship|cell)|(my|our) (church|congregation|group|community) (on|onto|to) (living bread|this app|the app)|leader of (a|our|my))\b/i],
  ['share_prayer', /\b(pray|prayer|prayers|intercede|someone to pray|pray with me|pray for me|prayer request|prayer group)\b/i],
  ['open_word', /\b(passage|verse|verses|scripture|scriptures|bible|psalm|romans|john|gospel of|understand (this|the)|what does .* mean|reading plan|devotion)\b/i],
  ['put_faith_into_action', /\b(serve|serving|volunteer|help (others|someone|the poor|my neighbou?r)|mission|donate|give to|support (a|this)|live out my faith|put (my )?faith into action|do something|make a difference|do this week|can (we|our group) do)\b/i],
];

export function classifyIntent(need: string): HandoffIntent {
  for (const [intent, re] of INTENT_WORDS) if (re.test(need)) return intent;
  return 'find_family';
}

const STOP = new Set(['i', 'a', 'an', 'the', 'and', 'or', 'to', 'in', 'of', 'for', 'my', 'me', 'we', 'our', 'is', 'am', 'are', 'want', 'need', 'looking', 'find', 'new', 'just', 'moved', 'speaking', 'speak', 'with', 'at', 'on', 'near', 'some', 'someone', 'christian', 'group', 'church', 'friends', 'community']);
/** Words of the person's own that may filter real rows in memory. Never sent anywhere. */
export function filterWords(need: string, place?: string): string[] {
  const words = `${need} ${place ?? ''}`.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 4 && !STOP.has(w));
  return [...new Set(words)].slice(0, 8);
}

/* ---- the experiences ------------------------------------------------------------------------------- */

export interface Experience {
  title: string;
  why: string;
  freshness: Freshness;
  handoff: Handoff;
}

function communityExperience(c: Community): Experience | null {
  const people = c.member_count ?? 0;
  const h = communityHandoff({
    id: c.id, name: c.name, kind: c.kind,
    join: c.join_policy === 'open' ? 'open: anyone may join' : c.join_policy === 'request' ? 'by request to its leaders' : c.join_policy ?? 'see the community page',
    people, next_gathering: c.next_gathering_title, verified: Boolean(c.is_verified),
  });
  if (!h) return null;
  const rh = rhythmOf(c);
  const where = c.is_global ? 'online, anywhere' : placeOf(c) === 'place not given' ? 'online, anywhere' : placeOf(c);
  return {
    title: c.name,
    why: `A ${c.kind} community on The Living Bread (${where}, ${people} ${people === 1 ? 'person' : 'people'}, ${h.what_you_can_do.includes('join it') ? 'open to join' : 'joined by request'}). ${rh ? `The group lists a weekly ${rh.title} on ${rh.days.join(', ')} at ${rh.at} in its own time (no time zone recorded; ask the group). ` : ''}${c.is_verified ? 'Verified by The Living Bread.' : 'On record; whether it is active is not confirmed.'}`,
    freshness: c.next_gathering_at ? scheduled(c.next_gathering_at, 'The next gathering the community posted; not a statement that anyone is gathered now.') : record(null, 'A community on record; the member count is read live, not who is present now.'),
    handoff: h,
  };
}

async function readNeeds(env: Env): Promise<{ id: string; title: string; urgency: string | null; city: string | null; country: string | null; remote_eligible: boolean | null }[] | null> {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/serve_needs?status=eq.open&verification_status=eq.verified&select=id,title,urgency,city,country,remote_eligible&limit=40`, { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` }, signal: AbortSignal.timeout(6000) });
    return r.ok ? ((await r.json()) as never) : null;
  } catch {
    return null;
  }
}

export interface Plan {
  intent: HandoffIntent;
  experiences: Experience[];
  if_empty?: Handoff['if_empty'];
  notes: string[];
  next_tools: string[];
}

/** Did the geocoder resolve the place the person named, or a lookalike? "Ruritania" must not become "Ruritania Avenue, Cape Town". */
export function placeMatches(said: string, label: string | null | undefined): boolean {
  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const first = (t: string) => norm(t.split(',')[0] ?? '');
  const a = first(said);
  if (!a || !label) return false;
  const segs = label.split(',').map((x) => norm(x));
  return segs[0] === a || segs.includes(a);
}

/** The plan itself, from real data. Pure of the transport so tests can drive it with fakes. */
export async function planFor(env: Env, need: string, place: string | undefined, online: boolean | undefined, intentOverride?: HandoffIntent): Promise<Plan> {
  const intent = intentOverride ?? classifyIntent(need);
  const words = filterWords(need, place);
  const experiences: Experience[] = [];
  const notes: string[] = [];
  let if_empty: Handoff['if_empty'] | undefined;
  let next_tools: string[] = [];

  if (intent === 'find_family') {
    next_tools = ['find_communities (mode to_join)', 'find_churches (mode near)', 'find_gatherings (mode any, online true)'];
    const all = (await communities(env)) ?? [];
    const hay = (c: Community) => [c.name, c.description, c.kind, c.city, c.country].filter(Boolean).join(' ').toLowerCase();
    const placeLow = (place ?? '').toLowerCase().trim();
    const here = placeLow ? all.filter((c) => !c.is_global && hay(c).includes(placeLow)) : [];
    const matched = words.length ? all.filter((c) => words.some((w) => hay(c).includes(w))) : [];
    const pool = [...new Map([...here, ...matched, ...(online || !placeLow ? all.filter((c) => c.is_global) : [])].map((c) => [c.id, c])).values()];
    for (const c of pool.slice(0, 3)) {
      const e = communityExperience(c);
      if (e) experiences.push(e);
    }
    if (placeLow) {
      const geoRaw = await geocode(env, place as string);
      const geo = geoRaw && placeMatches(place as string, geoRaw.label) ? geoRaw : null;
      if (geoRaw && !geo) notes.push(`The place "${String(place).slice(0, 60)}" could not be matched to a known place (the nearest guess was a different name), so no churches or gatherings were searched. Ask where exactly, or offer online options.`);
      const ch = geo ? await findChurches(env, { lat: geo.lat, lon: geo.lon, place: null, limit: 3 }) : null;
      if (ch && ch.length) {
        const h = churchFinderHandoff();
        if (h) experiences.push({ title: `Churches near ${geo?.label ?? place}`, why: `${ch.length} churches held near there (${ch.map((c) => c.name).slice(0, 3).join('; ')}). They are listed from directories: a listing is not a confirmation of service times, language or welcome.`, freshness: record(null, 'A directory record, not a statement about any service.'), handoff: h });
      }
      const g = geo ? await findGatherings(env, { lat: geo.lat, lon: geo.lon, place: null, online: online ?? null, limit: 3 }) : null;
      for (const x of (g ?? []).filter((y) => y.is_online || (y.distance_km !== null && y.distance_km <= 250)).slice(0, 1)) {
        const h = gatheringHandoff(x.id, x.is_online, x.title);
        if (h) experiences.push({ title: x.title, why: `A gathering a host posted for ${whenUTC(x.starts_at)} (${x.is_online ? 'online' : placeOf(x)}). The time is what the host posted, not a confirmation.`, freshness: scheduled(x.starts_at), handoff: h });
      }
    }
    if (!experiences.length) {
      if_empty = communitiesIfEmpty();
      notes.push('Nothing suitable is held. Say so plainly, then offer the online options and the choice to start one. Do not disguise an empty result.');
    }
    if (words.length === 0 && !placeLow) notes.push('Ask only for what changes the answer: roughly where they are, a language, and online or in person.');
    notes.push('Language is not a recorded field on communities or churches. Never say a group or church meets in a language unless its own page says so.');
  } else if (intent === 'share_prayer') {
    next_tools = ['find_people_to_pray_with (mode ask_the_family, a_person_now, the_watch)', 'find_communities (mode to_join, query "prayer")'];
    const open = await chairDoorLive().catch(() => false);
    const pr = prayerRequestHandoff(Boolean(open));
    if (pr) experiences.push({ title: 'Ask the family to pray for you, once', why: 'Believers who chose to pray for a stranger are offered your request; you write your own words, may keep your name from them, and see truthfully whether anyone took the chair. No account.', freshness: record(null, 'A door, not a promise that anyone is praying yet.'), handoff: pr });
    const all = (await communities(env)) ?? [];
    for (const c of all.filter((x) => /prayer/i.test(x.kind) || /prayer/i.test(x.name)).slice(0, 2)) {
      const e = communityExperience(c);
      if (e) experiences.push(e);
    }
    const room = prayerRoomHandoff(false);
    if (room) experiences.push({ title: 'The prayer watch', why: 'Where believers keep the watch and where a person answers. Check find_people_to_pray_with (mode a_person_now) for availability before saying anyone is there.', freshness: record(null, 'A door. Availability is verified only by a_person_now.'), handoff: room });
    notes.push('Preview first: show the person exactly what would be shared and with whom, and let them choose private or named. Never put their words in a link; they write them on the page.');
    notes.push('Never say someone prayed, read or answered unless a tool returned evidence.');
  } else if (intent === 'open_word') {
    next_tools = ['read_scripture (mode passage, context, compare)', 'find_scripture_for', 'start_with_christ (mode reading_plans)'];
    const sc = scriptureHandoff(null);
    if (sc) experiences.push({ title: 'The Bible on The Living Bread', why: 'The whole Bible, readable before any account, with a choice of translation.', freshness: record(null, 'A stored text.'), handoff: sc });
    const rp = readingPlanHandoff();
    if (rp) experiences.push({ title: 'Reading plans', why: 'A plan to read one day at a time, alone or with someone.', freshness: record(null, 'Bundled plans.'), handoff: rp });
    notes.push('Quote Scripture only from read_scripture, with reference and translation. This tool returns doors, not verses.');
  } else if (intent === 'put_faith_into_action') {
    next_tools = ['find_ways_to_serve (mode near, public_needs)', 'find_gatherings'];
    const needs = (await readNeeds(env)) ?? [];
    const placeLow = (place ?? '').toLowerCase().trim();
    const fit = needs.filter((n) => (placeLow ? `${n.city ?? ''} ${n.country ?? ''}`.toLowerCase().includes(placeLow) || n.remote_eligible : true));
    for (const n of fit.slice(0, 3)) {
      const h = serveHandoff(n.id);
      if (h) experiences.push({ title: n.title, why: `An open need from a verified partner ministry${n.urgency === 'urgent' ? ' (marked urgent)' : ''}${n.remote_eligible ? ', can be met remotely' : ''}.`, freshness: record(null, 'Open on the Serve network when read; a partner confirms the rest.'), handoff: h });
    }
    if (!experiences.length) {
      const h = serveHandoff(null);
      if_empty = { message: 'No verified open need matches that place right now. That means the network has none there yet, not that nobody is in need.', alternatives: h ? [{ label: h.invitation, kind: h.kind, url: h.url }] : [] };
      if (h) experiences.push({ title: 'The Serve network', why: 'The place to see every open need from verified ministries.', freshness: record(null, 'A door.'), handoff: h });
    }
  } else {
    next_tools = ['find_communities (mode to_join)', 'start_with_christ (mode begin)'];
    for (const h of [createCommunityHandoff(), churchKitHandoff(), pastorsHandoff()]) {
      if (h) experiences.push({ title: h.invitation, why: h.what_you_can_do, freshness: record(null, 'A page and a setup flow. Nothing is created until the person begins.'), handoff: h });
    }
    notes.push('A leader may create a space, bring their church or group, and share an invitation they choose to send. Never create or invite for them. A group that has gone quiet is helped by a small plan from the signed-in leader tools (my_congregation, who_has_gone_quiet) only inside that leader\'s own permissions.');
  }
  return { intent, experiences: experiences.slice(0, 4), ...(if_empty ? { if_empty } : {}), notes, next_tools };
}

export function registerPlan(server: McpServer, env: Env): void {
  tool(server, 'plan_my_next_step', {
    title: 'Plan my next step: the best real door for a need',
    description: [
      'PURPOSE: Take a need in a few words and return up to four real Living Bread experiences that fit it, each with a handoff (the exact page, an invitation worded from what is there, an app link and a fallback), or an honest if_empty with online options and the choice to start a community.',
      'WHEN TO USE: the person has said what they are looking for ("I just moved and want Christian friends", "I want someone to pray with me", "help me act on my faith", "our group has gone quiet") and would be helped by a specific door on The Living Bread. Offer a handoff once, only if it serves what they said.',
      'WHEN NOT: a verse or passage (read_scripture); a plain list of churches or gatherings (find_churches, find_gatherings); anyone in danger (get_crisis_help first). Not for chatting: do not call it in an unrelated turn.',
      'PARAMETERS: need (required, the need in the person\'s words, 3 to 300 characters; used only to choose and filter, never logged, never put in a link). place (optional city or country as they say it, never an address). language (optional, echoed; language is not a recorded field of groups or churches). online (optional true to prefer online options).',
      'OUTPUT: intent (find_family, share_prayer, open_word, put_faith_into_action or bring_your_people), experiences [{title, why, freshness, handoff}], handoff (the best one), if_empty when nothing suitable exists, notes (rules for this intent) and next_tools (the read tools that go deeper).',
      'BEHAVIOR: read only. It sends nothing, creates nothing, and never says a group is active or that anyone will respond: a result is "on record" unless verified. A link carries only fixed attribution parameters and an intent id, never the person\'s words. A person in danger gets crisis_door and no handoff.',
    ].join(' '),
    inputSchema: {
      need: z.string().min(3).max(300).describe('What the person is looking for, in their words, 3 to 300 characters. Used only to choose and filter in memory; never logged and never placed in a link.'),
      place: z.string().max(120).optional().describe('A city, region or country as they say it ("Prague", "Kenya"); never a street address.'),
      language: z.string().max(40).optional().describe('Their language, echoed in the answer. Groups and churches carry no language field, so this never filters.'),
      online: z.boolean().optional().describe('true to prefer online options (a global community, an online gathering).'),
    },
    outputSchema: out({
      intent: z.string().describe('find_family, share_prayer, open_word, put_faith_into_action or bring_your_people.'),
      experiences: z.array(z.looseObject({ title: z.string(), why: z.string(), freshness: z.looseObject({}), handoff: z.looseObject({ kind: z.string(), id: z.string(), invitation: z.string(), url: z.string() }) })).describe('Up to four real experiences, best first, each with its handoff.'),
      handoff: z.looseObject({}).nullable().describe('The best handoff, or null when the person is in danger.'),
      if_empty: z.looseObject({}).optional().describe('Present when nothing suitable exists: an honest sentence and the alternatives.'),
      notes: z.array(z.string()).describe('Rules for this intent.'),
      next_tools: z.array(z.string()).describe('Read tools that go deeper.'),
      crisis: z.boolean().optional().describe('true when the words spoke of danger: no handoff is given, crisis_door is.'),
    }),
    annotations: READS_WORLD,
  }, async ({ need, place, language, online }) => {
    if (looksLikeDanger(need)) {
      return ok(paragraph(['Their words speak of danger. A person comes before a page', 'Call get_crisis_help with their country first, give the real number, and stay with them. No door is offered until they are safe']), {
        intent: 'crisis', experiences: [], handoff: null, notes: ['Danger first.'], next_tools: ['get_crisis_help'], crisis: true, crisis_door: CRISIS_DOOR, ...ATTRIBUTION,
      });
    }
    const plan = await planFor(env, need, place, online);
    const best = plan.experiences[0]?.handoff ?? null;
    const line = handoffLine(best);
    const text = paragraph([
      plan.experiences.length
        ? `${plan.experiences.length} real ${plan.experiences.length === 1 ? 'door' : 'doors'} for this (${plan.intent.replace(/_/g, ' ')}): ${plan.experiences.map((e) => `${e.title}: ${e.handoff.invitation}`).join('; ')}`
        : plan.if_empty?.message ?? 'Nothing suitable is held.',
      plan.if_empty && plan.experiences.length === 0 ? `Alternatives: ${plan.if_empty.alternatives.map((a) => `${a.label} (${a.url})`).join('; ')}` : null,
      line,
      language ? `Language noted: ${language}. Groups and churches carry no language field, so say what the page says and no more` : null,
      'Offer a door once, only if it fits what they said; never promise a response, an active group or a live gathering',
    ]);
    return ok(text, { intent: plan.intent, experiences: plan.experiences, handoff: best ?? (plan.if_empty ? createCommunityHandoff() : null), ...(plan.if_empty ? { if_empty: plan.if_empty } : {}), notes: plan.notes, next_tools: plan.next_tools, ...ATTRIBUTION });
  });
}
