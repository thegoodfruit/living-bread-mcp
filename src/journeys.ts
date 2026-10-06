/* ============================================================
   THE LIVING BREAD MCP, the six journeys, end to end.

   One tool, journey_next_steps, runs the whole chain for the six things
   people most often come to an assistant for, and answers with at most
   five well-matched results, each with a `why`, its freshness and its
   door, and ONE next step: a deep link into The Living Bread carrying
   ?via=<token>, so the house can learn (share_opens, migration 0760) which
   assistant-born journeys were actually walked. Six prompts of the same
   names hand an assistant the whole conversation.

     community_near_me              communities, churches, a gathering
     someone_to_pray_with_tonight   prayer gatherings tonight, prayer
                                    groups, the Kingdom praying, and (signed
                                    in) who said they are available
     serve_this_weekend             public needs asking for people
     new_to_christianity            the gospel, a first reading, a first
                                    plan, a church, a family
     prayer_group_in_my_language    prayer gatherings and groups in a language
     understand_and_live_a_passage  the passage, its context, the passages
                                    readers link to it, and one way to live it

   Empty is honest: it says nothing is held, never that nothing exists, and
   always offers a real alternative that does exist.

   The via token is "mcp" plus five letters (the 0760 contract requires
   eight characters); migration 0840 records one share row per journey
   (kind mcp_journey, no sharer) so share_opens can count arrivals.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { guessLanguage } from './asks';
import PLANS from './data/plans.json';
import { type Believer, rpcAs } from './auth';
import { DOORS, SITE } from './doors';
import { layers } from './evidence';
import { openWindow, record, scheduled, type Freshness } from './freshness';
import { GOSPEL_STEPS } from './gospel';
import { kjvByRef, kjvPassage, loadXrefs } from './kjv';
import { communities, findChurches, findGatherings, geocode, nearby, rpc as anonRpc } from './knowledge';
import { count } from './metrics';
import { km, list, paragraph, placeOf } from './render';
import { parseReference } from './scripture';
import { ATTRIBUTION, fail, ok, out, READS_WORLD, tool } from './shared';

export const JOURNEYS = {
  community_near_me: { token: 'mcpCommu', title: 'Find a Christian community near me', door: DOORS.communities },
  someone_to_pray_with_tonight: { token: 'mcpPrayT', title: 'Someone to pray with tonight', door: DOORS.prayer },
  serve_this_weekend: { token: 'mcpServe', title: 'Where can I serve this weekend', door: DOORS.serve },
  new_to_christianity: { token: 'mcpNewFa', title: 'I am new to Christianity: where do I start', door: `${SITE}/plans` },
  prayer_group_in_my_language: { token: 'mcpLangG', title: 'A prayer group in my language', door: DOORS.communities },
  understand_and_live_a_passage: { token: 'mcpWordL', title: 'Help me understand this passage and live it', door: DOORS.bible },
} as const;
export type JourneyName = keyof typeof JOURNEYS;
export const JOURNEY_NAMES = Object.keys(JOURNEYS) as JourneyName[];

/** The url with ?via=<token>, any via already there replaced, the #hash kept (lib/shareVia.ts withVia, copied: this Worker is built alone). */
export function withVia(url: string, token: string): string {
  if (!/^[A-Za-z0-9]{8}$/.test(token)) return url;
  const hashAt = url.indexOf('#');
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const qAt = base.indexOf('?');
  const path = qAt >= 0 ? base.slice(0, qAt) : base;
  const query = qAt >= 0 ? base.slice(qAt + 1) : '';
  const kept = query.split('&').filter((p) => p && p.split('=')[0] !== 'via' && p.split('=')[0] !== 'vo');
  kept.push(`via=${token}`);
  return `${path}?${kept.join('&')}${hash}`;
}

const LANGS: Record<string, string> = {
  english: 'en', spanish: 'es', espanol: 'es', 'español': 'es', portuguese: 'pt', 'português': 'pt', french: 'fr', 'français': 'fr', german: 'de', deutsch: 'de',
  italian: 'it', italiano: 'it', korean: 'ko', japanese: 'ja', chinese: 'zh', mandarin: 'zh', cantonese: 'zh', arabic: 'ar', hebrew: 'he', russian: 'ru',
  ukrainian: 'uk', polish: 'pl', dutch: 'nl', swahili: 'sw', kiswahili: 'sw', yoruba: 'yo', igbo: 'ig', hausa: 'ha', amharic: 'am', hindi: 'hi',
  tagalog: 'tl', filipino: 'tl', indonesian: 'id', vietnamese: 'vi', thai: 'th', turkish: 'tr', greek: 'el', romanian: 'ro', kinyarwanda: 'rw', farsi: 'fa', persian: 'fa',
};
/* The first English name wins: es is "Spanish", never "Espanol". */
const LANG_NAMES: Record<string, string> = {};
for (const [n, c] of Object.entries(LANGS)) if (/^[a-z]+$/.test(n) && !LANG_NAMES[c]) LANG_NAMES[c] = n[0].toUpperCase() + n.slice(1);

export function languageCode(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (/^[a-z]{2}(-[a-z]{2})?$/.test(s)) return s.slice(0, 2);
  return LANGS[s] ?? null;
}

interface Item {
  id: string;
  kind: string;
  title: string;
  why: string;
  freshness: Freshness;
  visibility: 'public' | 'yours';
  source_url: string;
  next_step: { label: string; url: string };
  scripture?: { ref: string; text: string };
}

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export function registerJourneys(server: McpServer, env: Env, me: Believer | null): void {
  tool(server, 'journey_next_steps', {
    title: 'Next steps for a faith journey (six journeys, end to end)',
    description: `Run one of six common multi-step requests in a single call and return at most five ranked results across sources (churches, communities, gatherings, people available, Serve needs, plans, Scripture), each with why it fits and a freshness label, plus one next-step link. Journeys and their key input: community_near_me (place), someone_to_pray_with_tonight (place optional), serve_this_weekend (place), new_to_christianity (place optional), prayer_group_in_my_language (language), understand_and_live_a_passage (passage). Use when the request matches a journey and the person wants a short curated answer; for full lists use the single-purpose tools (find_churches_near, find_gatherings_near, needs_near, scripture_context). Empty journeys return empty true with alternatives. Reads live data and steps_taken lists every source consulted.`,
    inputSchema: {
      journey: z.enum(JOURNEY_NAMES as [JourneyName, ...JourneyName[]]).describe('Which journey to run: community_near_me, someone_to_pray_with_tonight, serve_this_weekend, new_to_christianity, prayer_group_in_my_language, understand_and_live_a_passage.'),
      place: z.string().max(120).optional().describe('City, region or country as the person says it ("Leeds", "Kenya"); never a street address. Used by the place-based journeys.'),
      language: z.string().max(40).optional().describe('For prayer_group_in_my_language: language name or ISO 639-1 code ("Spanish", "es", "Korean").'),
      passage: z.string().max(80).optional().describe('For understand_and_live_a_passage: a Bible reference ("Romans 12:1-2").'),
    },
    outputSchema: out({
      journey: z.string().describe('The journey run.'),
      title: z.string().describe('Human title of the journey.'),
      count: z.number().describe('Results returned, at most 5.'),
      empty: z.boolean().describe('True when nothing fitting was found.'),
      results: z.array(z.looseObject({ id: z.string(), kind: z.string(), title: z.string(), why: z.string(), source_url: z.string() })).describe('Ranked results: id, kind (church, community, gathering, people, need, reading_plan, scripture, page, door, act), title, why it fits, and source URL; each also carries freshness.'),
      honest: z.string().nullable().describe('When empty or thin, a plain statement of what is missing; else null.'),
      alternatives: z.array(z.looseObject({ label: z.string(), url: z.string() })).describe('Other links to try when results are thin.'),
      next_step: z.looseObject({ label: z.string(), url: z.string() }).describe('The single recommended next link; give it exactly as returned.'),
      steps_taken: z.array(z.string()).describe('The sources consulted, in order.'),
    }),
    annotations: READS_WORLD,
  }, async ({ journey, place, language, passage }) => {
    const j = JOURNEYS[journey as JourneyName];
    const via = (url: string) => withVia(url, j.token);
    const steps: string[] = [];
    const items: Item[] = [];
    const alternatives: { label: string; url: string }[] = [];
    let honest: string | null = null;
    let nextStep: { label: string; url: string } = { label: j.title, url: via(j.door) };
    const geo = place ? await geocode(env, place) : null;
    if (place) steps.push('geocode');
    try { count(env, server.server.getClientVersion()?.name, 'journey', journey); } catch { /* counting never costs an answer */ }

    // ------------------------------------------------------------- community_near_me
    if (journey === 'community_near_me') {
      if (!place) return fail('Tell me the place (a city, region or country) and I will look for real communities, churches and gatherings there.', { reason: 'needs_place', try_instead: ['journey_next_steps with place "Atlanta"', DOORS.communities] });
      if (!geo) return fail(`"${place}" could not be found on the map. Try a city and country, like "Leeds, UK".`, { reason: 'place_not_found', try_instead: [DOORS.findAChurch] });
      steps.push('communities_overview', 'ai_find_churches', 'nearby', 'ai_find_gatherings');
      const words = place.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 2);
      const [cs, ours, open, gs] = await Promise.all([
        communities(env),
        findChurches(env, { lat: geo.lat, lon: geo.lon, place: null, limit: 6 }),
        geo.countrySlug ? nearby(env, geo.countrySlug, geo.lat, geo.lon, 6) : Promise.resolve(null),
        findGatherings(env, { lat: geo.lat, lon: geo.lon, place: null, online: null, limit: 25 }),
      ]);
      for (const c of (cs ?? []).filter((c) => !c.is_global && words.some((w) => `${c.city ?? ''} ${c.country ?? ''}`.toLowerCase().includes(w))).slice(0, 2)) {
        items.push({ id: `community:${c.id}`, kind: 'community', title: c.name, why: `A community on The Living Bread in ${placeOf(c)}, ${c.join_policy === 'open' ? 'open to anyone' : 'joined by request'}, ${c.member_count} ${c.member_count === 1 ? 'person' : 'people'}`, freshness: c.next_gathering_at ? scheduled(c.next_gathering_at, 'Its next posted gathering.') : record(null), visibility: 'public', source_url: `${SITE}/community/${c.id}`, next_step: { label: 'Open the community', url: via(`${SITE}/community/${c.id}`) } });
      }
      const churches: { id: string; name: string; d: number | null; den: string | null }[] = [];
      for (const c of ours ?? []) if (c.distance_km !== null && c.distance_km <= 60) churches.push({ id: c.id, name: c.name, d: c.distance_km, den: null });
      for (const c of open?.results ?? []) if (c.distance_km <= 60 && !churches.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) churches.push({ id: c.id, name: c.name, d: c.distance_km, den: c.denomination });
      churches.sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9));
      for (const c of churches.slice(0, items.length ? 2 : 3)) {
        items.push({ id: c.id, kind: 'church', title: c.name, why: `A real church ${km(c.d) ?? 'nearby'} from ${geo.label}${c.den ? `, ${c.den}` : ''}; walking in on a Sunday is the simplest first step`, freshness: record(null, 'A church in a directory; service times are not confirmed here. Check with the church before going.'), visibility: 'public', source_url: DOORS.findAChurch, next_step: { label: 'Find it on the live map', url: DOORS.findAChurch } });
      }
      const g = (gs ?? []).filter((x) => !x.is_online && x.distance_km !== null && x.distance_km <= 60 && Date.parse(x.starts_at) < Date.now() + 7 * 86_400_000).sort((a, b) => Number(Boolean(b.beginner_friendly)) - Number(Boolean(a.beginner_friendly)))[0];
      if (g) items.push({ id: `gathering:${g.id}`, kind: 'gathering', title: g.title, why: `A gathering this week in ${placeOf(g)}${g.beginner_friendly ? ', marked good for a first visit' : ''}`, freshness: scheduled(g.starts_at), visibility: 'public', source_url: DOORS.events, next_step: { label: 'See the gathering', url: DOORS.events } });
      if (!items.length) {
        honest = `The Living Bread does not hold a community, church or gathering within 60 km of ${geo.label} yet. That means we do not have one, not that there is none.`;
        alternatives.push({ label: 'Online communities anyone may join', url: via(DOORS.communities) }, { label: 'The live church map (searches the whole world)', url: DOORS.findAChurch }, { label: 'Ask the family to pray for a church home', url: via(DOORS.prayer) });
      }
    }

    // ------------------------------------------------------------- someone_to_pray_with_tonight
    if (journey === 'someone_to_pray_with_tonight') {
      steps.push('protocol_gatherings(prayer)', 'ai_find_gatherings(online)', 'communities_overview');
      const until = Date.now() + 12 * 3600_000;
      const [local, online, cs] = await Promise.all([
        geo ? anonRpc<Row>(env, 'protocol_gatherings', { p_city: place?.split(',')[0]?.trim() ?? null, p_country: null, p_kind: 'prayer', p_days: 2, p_limit: 20 }) : Promise.resolve(null),
        findGatherings(env, { lat: null, lon: null, place: null, online: true, limit: 25 }),
        communities(env),
      ]);
      if (me) {
        steps.push('who_is_available_now');
        const r = await rpcAs(env, me, 'who_is_available_now');
        const rows = Array.isArray(r.data) ? (r.data as { status: string; label: string; people: number; near: number; first_names: string[] | null }[]) : [];
        const pray = rows.find((x) => /pray/.test(x.status) && !/looking/.test(x.status) && Number(x.people) > 0);
        if (pray) items.push({ id: 'presence:pray', kind: 'people', title: `${pray.people} ${Number(pray.people) === 1 ? 'person has' : 'people have'} said they are available to pray`, why: `In a window they opened themselves that has not expired${pray.near ? `; ${pray.near} in your city` : ''}${pray.first_names?.length ? ` (${list(pray.first_names, 3)})` : ''}. Not a promise they will answer this minute`, freshness: openWindow('A window they opened; checked open at the moment of reading.'), visibility: 'yours', source_url: `${SITE}/need-someone`, next_step: { label: 'Ask for prayer now', url: `${SITE}/need-someone` } });
      }
      for (const g of (local ?? []).filter((x) => x.status !== 'cancelled' && Date.parse(String(x.starts_at)) <= until).slice(0, 2)) {
        items.push({ id: `gathering:${g.id}`, kind: 'gathering', title: String(g.title), why: `A public prayer gathering in ${str(g.city) ?? place} starting ${new Date(String(g.starts_at)).toUTCString().replace(' GMT', ' UTC')}${g.language ? `, in ${String(g.language)}` : ''}`, freshness: scheduled(String(g.starts_at), undefined, str(g.updated_at)), visibility: 'public', source_url: DOORS.events, next_step: { label: 'See the gathering', url: DOORS.events } });
      }
      for (const g of (online ?? []).filter((x) => Date.parse(x.starts_at) <= until && /pray/i.test(`${x.title} ${x.category ?? ''}`)).slice(0, 2)) {
        items.push({ id: `gathering:${g.id}`, kind: 'gathering', title: g.title, why: `An online prayer gathering anyone can join, starting ${new Date(g.starts_at).toUTCString().replace(' GMT', ' UTC')}`, freshness: scheduled(g.starts_at), visibility: 'public', source_url: DOORS.events, next_step: { label: 'See the gathering', url: DOORS.events } });
      }
      const groups = (cs ?? []).filter((c) => c.kind === 'prayer' && c.join_policy === 'open').slice(0, Math.max(0, 4 - items.length));
      for (const c of groups) items.push({ id: `community:${c.id}`, kind: 'community', title: c.name, why: `A prayer group open to anyone (${c.member_count} ${c.member_count === 1 ? 'person' : 'people'}); members pray for each other's requests`, freshness: record(null, 'A group on record; it does not mean anyone in it is awake right now.'), visibility: 'public', source_url: `${SITE}/community/${c.id}`, next_step: { label: 'Join the prayer group', url: via(`${SITE}/community/${c.id}`) } });
      items.push({ id: 'door:kingdom-praying', kind: 'door', title: 'Hear the Kingdom pray', why: 'Recorded prayers from believers of many nations over the whole family, there at any hour; you can add your own voice', freshness: record(null, 'Recorded prayers; listening is possible at any hour.'), visibility: 'public', source_url: DOORS.kingdomPraying, next_step: { label: 'Listen now', url: via(DOORS.kingdomPraying) } });
      if (!items.some((i) => i.kind === 'gathering' || i.kind === 'people')) {
        honest = `No prayer gathering is listed${place ? ` in ${place}` : ''} in the next twelve hours${me ? ', and nobody has an availability window open right now' : ''}. That is this moment, not the family.`;
        alternatives.push({ label: 'Bring a request: real believers pray over it by name', url: via(DOORS.prayer) }, { label: 'Hear believers praying over the family', url: via(DOORS.kingdomPraying) });
        if (!me) alternatives.push({ label: 'Signed in, see who said they are available (connect /me)', url: 'https://mcp.living-bread.org/me' });
      }
      nextStep = { label: 'Bring a prayer request to the family tonight', url: via(DOORS.prayer) };
    }

    // ------------------------------------------------------------- serve_this_weekend
    if (journey === 'serve_this_weekend') {
      steps.push('protocol_needs');
      const country = geo?.countrySlug ? geo.countrySlug.replace(/-/g, ' ') : null;
      const city = place?.split(',')[0]?.trim() ?? null;
      const isCountry = Boolean(country && city && country.toLowerCase() === city.toLowerCase());
      const [nearRows, wide] = await Promise.all([
        place ? anonRpc<Row>(env, 'protocol_needs', { p_country: country, p_city: isCountry ? null : city, p_people_only: true, p_limit: 10 }) : Promise.resolve(null),
        anonRpc<Row>(env, 'protocol_needs', { p_country: null, p_city: null, p_people_only: true, p_limit: 30 }),
      ]);
      const shape = (n: Row, why: string): Item => {
        const m = n.ministry as Row | null;
        return { id: `need:${n.id}`, kind: 'need', title: String(n.title ?? ''), why, freshness: record(str(n.created_at) ?? str(n.updated_at), 'Open when read; the ministry coordinates the day and time.'), visibility: 'public', source_url: `https://discover.living-bread.org/api/need/${n.id}`, next_step: { label: m && str(m.name) ? `Offer to help ${String(m.name)}` : 'Offer to help', url: via(DOORS.serve) } };
      };
      for (const n of (nearRows ?? []).slice(0, 3)) items.push(shape(n, `${[str(n.city), str(n.country)].filter(Boolean).join(', ') || 'Near you'}: a verified ministry asks for people${n.local === true ? ' in person' : ''}${n.remote === true ? ', or remotely' : ''}`));
      const remote = (wide ?? []).filter((n) => n.remote === true && !items.some((i) => i.id === `need:${n.id}`)).slice(0, Math.max(0, 5 - items.length) > 2 ? 2 : Math.max(0, 5 - items.length));
      for (const n of remote) items.push(shape(n, `Can be met remotely, from anywhere: ${[str(n.city), str(n.country)].filter(Boolean).join(', ') || 'a verified ministry'}`));
      if (!(nearRows ?? []).length) {
        honest = `No public need asking for people is listed${place ? ` for ${place}` : ''} yet. That means none is listed, not that nobody is in need.${remote.length ? ' Needs that can be met from anywhere are below.' : ''}`;
        alternatives.push({ label: 'Every open need on Serve', url: via(DOORS.serve) }, { label: 'Gatherings this week (many welcome help)', url: DOORS.events });
      }
      nextStep = { label: 'Open Serve and offer one act this weekend', url: via(DOORS.serve) };
    }

    // ------------------------------------------------------------- new_to_christianity
    if (journey === 'new_to_christianity') {
      steps.push('the_gospel', 'scripture_passage', 'reading_plans');
      const first = GOSPEL_STEPS[0];
      const v = await kjvByRef(env, first.ref);
      if (v) items.push({ id: `verse:${v.ref}`, kind: 'scripture', title: `${first.heading} (${v.ref})`, why: 'Where the good news begins, in the house\'s words, with the verse read from the stored text', freshness: record(null, 'The stored King James text.'), visibility: 'public', source_url: DOORS.gospel, next_step: { label: 'Read the gospel simply', url: DOORS.gospel }, scripture: { ref: v.ref, text: v.text } });
      const plan = (PLANS as { id: string; title: string; subtitle: string; forWhom: string; days: { title: string; ref: string }[] }[]).find((x) => x.id === 'meet-jesus');
      if (plan) {
        const day1 = plan.days[0];
        const read = day1 && !day1.ref.startsWith(first.ref) ? await kjvByRef(env, day1.ref) : null;
        items.push({ id: `plan:${plan.id}`, kind: 'reading_plan', title: plan.title, why: `${plan.subtitle.replace(/[.]$/, '')}. A reading plan in the app (${plan.days.length} days, ${plan.forWhom.toLowerCase()}); day one is ${day1?.ref ?? 'the first reading'}`, freshness: record(null), visibility: 'public', source_url: `${SITE}/plans`, next_step: { label: 'Begin the plan', url: via(`${SITE}/plans`) }, ...(read ? { scripture: { ref: read.ref, text: read.text } } : {}) });
      }
      items.push({ id: 'door:who-is-jesus', kind: 'page', title: 'Who is Jesus?', why: 'The house\'s plain answer: who He was in history, and who Christians confess Him to be', freshness: record(null), visibility: 'public', source_url: DOORS.whoIsJesus, next_step: { label: 'Read it', url: DOORS.whoIsJesus } });
      if (geo) {
        steps.push('ai_find_gatherings');
        const gs = await findGatherings(env, { lat: geo.lat, lon: geo.lon, place: null, online: null, limit: 25 });
        const g = (gs ?? []).find((x) => x.beginner_friendly && (x.is_online || (x.distance_km !== null && x.distance_km <= 60)) && Date.parse(x.starts_at) < Date.now() + 14 * 86_400_000);
        if (g) items.push({ id: `gathering:${g.id}`, kind: 'gathering', title: g.title, why: `Marked good for a first visit, ${g.is_online ? 'online' : placeOf(g)}`, freshness: scheduled(g.starts_at), visibility: 'public', source_url: DOORS.events, next_step: { label: 'See the gathering', url: DOORS.events } });
      }
      const fam = (await communities(env))?.find((c) => c.kind === 'prayer' && c.join_policy === 'open');
      if (fam && items.length < 5) items.push({ id: `community:${fam.id}`, kind: 'community', title: fam.name, why: 'You do not have to start alone: an open prayer group where the family prays for each other', freshness: record(null), visibility: 'public', source_url: `${SITE}/community/${fam.id}`, next_step: { label: 'Join', url: via(`${SITE}/community/${fam.id}`) } });
      nextStep = { label: 'Begin Meet Jesus, a few minutes a day', url: via(`${SITE}/plans`) };
    }

    // ------------------------------------------------------------- prayer_group_in_my_language
    if (journey === 'prayer_group_in_my_language') {
      const code = language ? languageCode(language) : null;
      if (!language) return fail('Tell me the language (for example "Spanish" or "es").', { reason: 'needs_language', try_instead: ['journey_next_steps with language "Spanish"'] });
      if (!code) return fail(`"${language}" is not a language we can recognise with certainty. Use its English name or a two-letter code.`, { reason: 'unknown_language', try_instead: ['language "Spanish"', 'language "ko"'] });
      const name = LANG_NAMES[code] ?? code;
      steps.push('protocol_gatherings(prayer)', 'communities_overview');
      const [gs, cs] = await Promise.all([anonRpc<Row>(env, 'protocol_gatherings', { p_city: null, p_country: null, p_kind: 'prayer', p_days: 30, p_limit: 200 }), communities(env)]);
      for (const g of (gs ?? []).filter((x) => x.status !== 'cancelled' && String(x.language ?? '').toLowerCase().slice(0, 2) === code).slice(0, 3)) {
        items.push({ id: `gathering:${g.id}`, kind: 'gathering', title: String(g.title), why: `A public prayer gathering held in ${name}${g.is_online === true ? ', online' : str(g.city) ? `, in ${String(g.city)}` : ''}`, freshness: scheduled(String(g.starts_at), undefined, str(g.updated_at)), visibility: 'public', source_url: DOORS.events, next_step: { label: 'See the gathering', url: DOORS.events } });
      }
      for (const c of (cs ?? []).filter((c) => ['prayer', 'support', 'church'].includes(c.kind) && guessLanguage(`${c.name} ${c.description ?? ''}`) === code).slice(0, 5 - items.length)) {
        items.push({ id: `community:${c.id}`, kind: 'community', title: c.name, why: `A group whose own words are in ${name} (detected from its name and description; groups do not declare a language yet)`, freshness: record(null), visibility: 'public', source_url: `${SITE}/community/${c.id}`, next_step: { label: 'Open the group', url: via(`${SITE}/community/${c.id}`) } });
      }
      if (!items.length) {
        honest = `No prayer gathering or group in ${name} is listed on The Living Bread yet. That means none is listed, not that none prays in ${name}.`;
        alternatives.push({ label: `Start a prayer group in ${name}: anyone may`, url: via(DOORS.communities) }, { label: 'Hear believers of many nations pray', url: via(DOORS.kingdomPraying) }, { label: 'Bring a request in your own language', url: via(DOORS.prayer) });
      }
    }

    // ------------------------------------------------------------- understand_and_live_a_passage
    if (journey === 'understand_and_live_a_passage') {
      const p = passage ? parseReference(passage) : null;
      if (!p) return fail(passage ? `"${passage}" is not a reference we can read with certainty, like "Romans 12:1-2".` : 'Tell me the passage, like "Romans 12:1-2".', { reason: passage ? 'unparsed_reference' : 'needs_passage', try_instead: ['journey_next_steps with passage "Romans 12:1-2"'] });
      steps.push('scripture_passage', 'scripture_context', 'cross_references');
      const main = await kjvPassage(env, p);
      if (!main) return fail('The stored Bible text could not be read just now. Please try again in a moment.', { reason: 'unavailable' });
      const verse = p.from ?? 1;
      const open = via(`${SITE}/bible?open=${p.bookId}.${p.chapter}.${verse}`);
      items.push({ id: `verse:${main.ref}`, kind: 'scripture', title: main.ref, why: 'The passage itself, read verbatim from the stored King James text', freshness: record(null, 'The stored King James text.'), visibility: 'public', source_url: open, next_step: { label: 'Read the chapter', url: open }, scripture: { ref: main.ref, text: main.text } });
      if (verse > 1) {
        const before = await kjvPassage(env, { ...p, from: Math.max(1, verse - 2), to: verse - 1, ref: `${p.book} ${p.chapter}:${Math.max(1, verse - 2)}${verse - 1 > Math.max(1, verse - 2) ? `-${verse - 1}` : ''}` });
        if (before) items.push({ id: `verse:${before.ref}`, kind: 'scripture', title: `Just before: ${before.ref}`, why: 'The verses right before it, so it is read in its place (scripture_context reads more)', freshness: record(null), visibility: 'public', source_url: open, next_step: { label: 'Read the chapter', url: open }, scripture: { ref: before.ref, text: before.text } });
      }
      const xr = await loadXrefs(env, p.bookId);
      for (const [fromId, , votes] of (xr?.[`${p.chapter}.${verse}`] ?? []).slice(0, 2)) {
        const m = fromId.match(/^([a-z0-9]+)\.(\d+)\.(\d+)$/);
        const pr = m ? parseReference(`${m[1]} ${m[2]}:${m[3]}`) ?? null : null;
        const t = pr ? await kjvPassage(env, pr) : null;
        if (t && pr) items.push({ id: `verse:${t.ref}`, kind: 'scripture', title: `Linked by readers: ${t.ref}`, why: `A passage readers most often link to this one (OpenBible.info, ${votes} votes): Scripture read alongside Scripture`, freshness: record(null), visibility: 'public', source_url: `${SITE}/bible?open=${pr.bookId}.${pr.chapter}.${pr.from}`, next_step: { label: 'Read it', url: `${SITE}/bible?open=${pr.bookId}.${pr.chapter}.${pr.from}` }, scripture: { ref: t.ref, text: t.text } });
      }
      items.push({ id: 'door:my-yes', kind: 'act', title: 'Live it: write one yes', why: 'One concrete thing you will do with this word, in your own words, kept privately or shared with the family who will stand with you. Never a streak or a score', freshness: record(null), visibility: 'public', source_url: `${SITE}/my-yes`, next_step: { label: 'Write a yes', url: via(`${SITE}/my-yes`) } });
      nextStep = { label: `Read ${main.ref} in the Bible`, url: open };
    }

    const results = items.slice(0, 5);
    const empty = !results.length || Boolean(honest && !results.some((r) => r.kind !== 'door'));
    const text = paragraph([
      `${j.title}${place ? ` (${place})` : ''}${language ? ` (${language})` : ''}${passage ? ` (${passage})` : ''}`,
      honest,
      results.length ? list(results.map((r) => `${r.title}: ${r.why}${r.scripture ? `. "${r.scripture.text}" (${r.scripture.ref}, KJV)` : ''}`), 5) : null,
      alternatives.length ? `What does exist: ${list(alternatives.map((a) => `${a.label}, ${a.url}`), 3)}` : null,
      `One next step: ${nextStep.label}, ${nextStep.url}`,
      'Scheduled times are times hosts posted, not confirmations; nobody here is said to be reachable this minute unless their freshness says so',
    ]);
    return ok(text, {
      journey, title: j.title, count: results.length, empty, results, honest, alternatives: alternatives.slice(0, 3), next_step: nextStep, steps_taken: steps,
      attribution_token: j.token, ...ATTRIBUTION,
      content_layers: layers({ scripture: ['results[].scripture.text'], navigation: ['results[].why', 'results[].next_step', 'next_step'] }),
    });
  });
}

/* ---- the six journeys as prompts ---------------------------------------------------------------- */
const LAW = 'Use only what the tools return. Quote Scripture only as returned, with its reference. Say plainly when something is scheduled rather than live, and never say anyone is available now unless the freshness says so. Give at most five options, each with why it fits, then the one next step link exactly as returned. If nothing is held, say so and offer the alternative the tool gives. Never title a human "Father". If anyone is in danger, call crisis_resources with their country first';

export function registerJourneyPrompts(server: McpServer): void {
  const p = (name: string, title: string, description: string, args: Record<string, z.ZodTypeAny>, lines: (a: Record<string, string | undefined>) => (string | null | undefined | false)[]) =>
    server.registerPrompt(name, { title, description, argsSchema: args }, (a) => ({ messages: [{ role: 'user', content: { type: 'text', text: paragraph(lines(a as Record<string, string | undefined>)) } }] }));

  p('find_community_near_me', 'Find a Christian community near me', 'Real communities, churches and a gathering near a place, with why each fits and one next step.', { place: z.string().describe('City, region or country.') }, (a) => [
    `Help me find a Christian community near ${a.place}`,
    `Call journey_next_steps with journey community_near_me and place "${a.place}". If I want more churches, call find_churches_near; for this week, events_this_week`,
    LAW,
  ]);
  p('someone_to_pray_with_tonight', 'Someone to pray with tonight', 'Prayer gatherings tonight, open prayer groups, the Kingdom praying, and (signed in) who said they are available, honestly labelled.', { place: z.string().optional().describe('City, if they want something in person.') }, (a) => [
    `I want someone to pray with tonight${a.place ? ` near ${a.place}` : ''}`,
    `Call journey_next_steps with journey someone_to_pray_with_tonight${a.place ? ` and place "${a.place}"` : ''}. If I am connected as myself, also call who_is_available_now, and find_help_for_my_need with need prayer`,
    'Then offer to pray with me briefly in your own words, addressed to God, saying they are your words',
    LAW,
  ]);
  p('serve_this_weekend', 'Where can I serve this weekend', 'Public needs asking for people near a place, and ones that can be met from anywhere, with one next step.', { place: z.string().optional().describe('City or country.') }, (a) => [
    `Where can I serve this weekend${a.place ? ` near ${a.place}` : ''}?`,
    `Call journey_next_steps with journey serve_this_weekend${a.place ? ` and place "${a.place}"` : ''}. For more, where_can_i_serve_publicly or needs_near`,
    'Remind me the ministry coordinates the day and time, and that a need met is love made visible',
    LAW,
  ]);
  p('new_to_christianity_where_do_i_start', 'I am new to Christianity: where do I start', 'The gospel in the house\'s words, a first passage, a first plan, a church and a family, gently, one step at a time.', { place: z.string().optional().describe('City, if they want a church nearby.') }, (a) => [
    'I am new to Christianity. Where do I start?',
    `Call journey_next_steps with journey new_to_christianity${a.place ? ` and place "${a.place}"` : ''}. If I want more, the_gospel tells the good news in the house's words`,
    'Do not rush me and do not pressure me. One small step is enough',
    LAW,
  ]);
  p('prayer_group_in_my_language', 'A prayer group in my language', 'Public prayer gatherings and groups in a language, honestly matched, with a real alternative when none is held.', { language: z.string().describe('Language name or code.') }, (a) => [
    `Is there a prayer group in ${a.language}?`,
    `Call journey_next_steps with journey prayer_group_in_my_language and language "${a.language}"`,
    'Answer me in that language if you can, and keep the Scripture exactly as the tool returns it, saying which translation it is',
    LAW,
  ]);
  p('understand_and_live_a_passage', 'Help me understand this passage and live it', 'The passage, its context, the passages readers link to it, and one concrete way to live it, with text, interpretation and reflection kept apart.', { passage: z.string().describe('A Bible reference.') }, (a) => [
    `Help me understand ${a.passage} and live it`,
    `Call journey_next_steps with journey understand_and_live_a_passage and passage "${a.passage}". For more context, scripture_context; for related passages, cross_references`,
    'Keep three things apart and say which is which: the Scripture (exactly as returned), any interpretation (say whose: a tradition, the house, or yours), and your own brief reflection, clearly labelled as yours. Never present interpretation as Scripture',
    LAW,
  ]);
}
