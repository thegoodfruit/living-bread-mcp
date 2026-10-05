/* ============================================================
   THE LIVING BREAD MCP, the tools, resources and prompts.

   Each tool has a description an assistant can route on, a typed input, a
   compact structured output and one paragraph of text. Each one tells the
   truth about what it holds and what it does not. Nothing here types
   Scripture; nothing here invents a church.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { dailyBreadReference, isValidIsoDate, isoDate } from './daily';
import { DOORS, FIRST_STEPS, INVITATION, KNOWLEDGE_API, RECORDING_TRUTH, SITE } from './doors';
import { kjvByRef, kjvPassage, type Passage } from './kjv';
import {
  ask, church as churchApi, communities, findChurches, findEntity, findGatherings, geocode, getChurch, getGathering, getText,
  nearby, type AskResult, type Church, type Community, type Gathering, type HeritageKind,
} from './knowledge';
import { allNeeds, findNeed, needBySlug, type Need } from './needs';
import { km, list, paragraph, placeOf, slugify, whenUTC } from './render';
import { parseReference, verseSlug, webPassage, webPassageCount } from './scripture';
import { logAsk } from './asks';
import { absolute, ATTRIBUTION, cursorInput, fail, ok, out, page, tool, unavailable, type Structured } from './shared';
import { layers } from './evidence';
import { record, scheduled } from './freshness';
import { widgetMeta } from './widgets';

const NEAR_KM = 250;
const SCRIPTURE_ONLY = layers({ scripture: ['text', 'verses[].text'] });

async function resolveVerses(env: Env, need: Need, max: number) {
  const found: { ref: string; text: string; why?: string }[] = [];
  for (const r of need.refs) {
    if (found.length >= max) break;
    const p = await kjvByRef(env, r.ref);
    if (p) found.push({ ref: p.ref, text: p.text, ...(r.why ? { why: r.why } : {}) });
  }
  return found;
}

function passageText(p: Passage, translation: string): string {
  return paragraph([`${p.ref} (${translation}): "${p.text}"`]);
}

// --------------------------------------------------------------------------- tools
export interface RegisterOptions {
  /** On the signed-in endpoint the acting pray_for_someone (src/acts.ts) replaces the public door tool of the same name. */
  signedIn?: boolean;
}

export function registerAll(server: McpServer, env: Env, opts: RegisterOptions = {}): void {
  /* learning from the asks: the six public discovery tools, the text and whether we had an answer; never who */
  const learn = (name: string, text: string, answered: boolean) => logAsk(env, server, name, text, answered);
  // 1. scripture_passage ------------------------------------------------------
  tool(server, 
    'scripture_passage',
    {
      title: 'Scripture passage',
      description:
        'Read a Bible passage verbatim from a stored text: the King James Version the Living Bread app ships, or the World English Bible where held. Use for any verse, verse range or whole chapter ("John 3:16", "Psalm 23", "Romans 8:38-39", "1 Cor 13:4-7"). People ask: "what does John 3:16 say", "read me Psalm 23", "the verse about love being patient", "what is the whole of Romans 8". Never quote Scripture from memory when this tool is available. The Word points to Christ, who is its subject (John 5:39).',
      inputSchema: {
        reference: z.string().min(2).max(80).describe('A Bible reference as a reader says it, e.g. "John 3:16", "Psalm 23", "Romans 8:38-39".'),
        translation: z.enum(['KJV', 'WEB']).default('KJV').describe('KJV (whole Bible) or WEB (World English Bible, held for a limited set of passages; falls back to KJV and says so).'),
      },
      outputSchema: out({
        ref: z.string(), translation: z.string(), text: z.string(), book: z.string(), chapter: z.number(),
        verses: z.array(z.looseObject({ verse: z.number(), text: z.string() })), source: z.string(), read_more: z.string(), note: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: widgetMeta('verse-card', 'Reading the stored text', 'Read from the King James Version'),
    },
    async ({ reference, translation }) => {
      const p = parseReference(reference);
      if (!p) {
        return fail(paragraph([`"${reference}" is not a reference we can read with certainty. Try the book, chapter and verse, like "John 3:16" or "Psalm 23"`]), { reason: 'unparsed_reference', try_instead: ['scripture_passage with "John 3:16"', 'scripture_search for a phrase'] });
      }
      const kjv = await kjvPassage(env, p);
      if (!kjv) return unavailable('the stored Bible text', `${DOORS.bible}`);
      const read_more = `${SITE}/${verseSlug(p)}`;
      if (translation === 'WEB') {
        const web = webPassage(p);
        if (web) {
          return ok(paragraph([`${web.ref} (World English Bible): "${web.text}"`]), {
            ref: web.ref, translation: 'WEB', text: web.text, book: p.book, chapter: p.chapter,
            verses: kjv.verses.length === 1 ? [{ verse: kjv.verses[0].verse, text: web.text }] : kjv.verses, source: 'World English Bible, public domain (stored cache)', read_more: DOORS.bible, content_layers: SCRIPTURE_ONLY,
          });
        }
        const note = `The World English Bible is held here for ${webPassageCount()} passages and this is not one of them, so these are the King James words.`;
        return ok(paragraph([passageText(kjv, 'KJV'), note]), { ...kjv, translation: 'KJV', source: 'King James Version, public domain (the text the app ships)', read_more: DOORS.bible, note, content_layers: SCRIPTURE_ONLY });
      }
      return ok(passageText(kjv, 'KJV'), { ...kjv, translation: 'KJV', source: 'King James Version, public domain (the text the app ships)', read_more: p.from !== undefined ? read_more : DOORS.bible, content_layers: SCRIPTURE_ONLY });
    },
  );

  // 2. verses_for ------------------------------------------------------------
  tool(server, 
    'verses_for',
    {
      title: 'Verses for a need or feeling',
      description:
        'The Scripture The Living Bread pairs with what a person is carrying: anxiety, fear, grief, loneliness, anger, guilt, doubt, money, marriage, healing, purpose, and about a hundred more. Pass the need in the person\'s own words ("I\'m scared about surgery", "my mother died", "lonely"). People ask: "a verse for anxiety", "what does the Bible say when you feel alone", "scripture for my friend who lost her dad", "a verse about forgiving someone". Returns the verses verbatim from the stored KJV with a one-line reflection in our words, and the page where real believers pray over that need by name; every one of them points to Christ, who carries it with us.',
      inputSchema: {
        need: z.string().min(2).max(200).describe('The need or feeling, in the person\'s own words.'),
        limit: z.number().int().min(1).max(12).default(5).describe('How many verses, at most.'),
      },
      outputSchema: out({
        need: z.string(), label: z.string(), lead: z.string().optional(), matched: z.string(),
        verses: z.array(z.looseObject({ ref: z.string(), text: z.string(), why: z.string().optional() })), translation: z.string(), page: z.string(), pray_with_the_family: z.string(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: widgetMeta('verse-card', 'Finding the verses the house pairs with this', 'Verses read from the stored text'),
    },
    async ({ need, limit }) => {
      const m = findNeed(need);
      learn('verses_for', need, Boolean(m));
      if (!m) {
        const some = allNeeds().map((n) => n.slug).slice(0, 40);
        return fail(
          paragraph([`We do not hold a verse set for "${need}" by that name`, `Needs we do hold include ${list(some.slice(0, 14), 14)}`, `For a specific verse use scripture_passage, and ask_living_bread can answer by meaning`]),
          { reason: 'no_matching_need', try_instead: ['ask_living_bread with the same words', 'scripture_search for a word', 'verses_for with one of: ' + allNeeds().map((n) => n.slug).slice(0, 20).join(', ')] },
        );
      }
      const verses = await resolveVerses(env, m.need, limit);
      if (!verses.length) return unavailable('the stored Bible text', m.need.page);
      const text = paragraph([
        m.need.lead || `Scripture for ${m.need.label.toLowerCase()}`,
        ...verses.map((v) => `${v.ref}: "${v.text}"${v.why ? ` (${v.why})` : ''}`),
        `Real believers pray over this need by name at ${m.need.page}`,
      ]);
      return ok(text, {
        need: m.need.slug, label: m.need.label, lead: m.need.lead || undefined, matched: m.matched, verses, translation: 'KJV', page: m.need.page, pray_with_the_family: DOORS.prayer, ...ATTRIBUTION,
        content_layers: layers({ scripture: ['verses[].text'], reflection: ['lead', 'verses[].why'] }, 'The pairing of verses with a need, and each one-line why, are the house\'s own words, not Scripture.'),
      });
    },
  );

  // 3. daily_bread -----------------------------------------------------------
  tool(server, 
    'daily_bread',
    {
      title: 'The Daily Bread',
      description:
        'The one verse the whole Living Bread family receives on a given morning (the same verse the app delivers at each person\'s local 8am). Use for "verse of the day", "today\'s bread", or to pray the same word the family is praying. Words read verbatim from the stored KJV.',
      inputSchema: { date: z.string().optional().describe('A calendar day as YYYY-MM-DD in the person\'s own time zone. Defaults to today (UTC).') },
      outputSchema: out({ date: z.string(), ref: z.string(), text: z.string(), translation: z.string(), page: z.string(), shared: z.string() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: widgetMeta('verse-card', 'Finding the bread for this morning', 'The Daily Bread, read from the stored text'),
    },
    async ({ date }) => {
      const day = date ?? isoDate();
      if (!isValidIsoDate(day)) return fail(paragraph([`"${day}" is not a calendar day we can read. Use YYYY-MM-DD`]), { error: 'bad_date' });
      const ref = dailyBreadReference(day);
      const p = await kjvByRef(env, ref);
      if (!p) return unavailable('the stored Bible text', DOORS.daily);
      const shared = 'Everyone on The Living Bread receives this same verse on this morning, so a person who reads it is reading with the whole family.';
      return ok(paragraph([`The Daily Bread for ${day} is ${p.ref}: "${p.text}"`, shared, `Today's bread, with a reflection and a prayer, is at ${DOORS.daily}`]), {
        date: day, ref: p.ref, text: p.text, translation: 'KJV', page: DOORS.daily, shared, content_layers: layers({ scripture: ['text'], navigation: ['shared', 'page'] }),
      });
    },
  );

  // 4. ask_living_bread ------------------------------------------------------
  tool(server, 
    'ask_living_bread',
    {
      title: 'Ask The Living Bread',
      description:
        'A grounded answer from the Christian Knowledge API: real, sourced entities (denominations, saints, sacred sites, biblical figures, Bible places, churches), the Scripture topic the question resonates with (with verses read from the stored KJV), the road to Christ, and honest next steps. Use for any question about Christianity, a tradition, a person of Scripture, a place, or a feeling with no clean keyword. People ask: "what is a Methodist", "who was Augustine", "where is Bethlehem", "how do I forgive my brother", "are there churches in Kenya". Nothing is invented; when we do not know, the answer says so.',
      inputSchema: { question: z.string().min(2).max(300).describe('The question, in the person\'s own words.') },
      outputSchema: out({
        question: z.string(), entities: z.array(z.looseObject({ id: z.string(), type: z.string(), name: z.string(), url: z.string(), source: z.string().nullable().optional() })),
        answer: z.string().nullable(), scripture: z.looseObject({ topic: z.string(), url: z.string(), verses: z.array(z.looseObject({ ref: z.string(), text: z.string() })) }).nullable(),
        road_to_christ: z.array(z.looseObject({ name: z.string(), url: z.string() })), next_steps: z.array(z.looseObject({ label: z.string(), url: z.string() })), grounding: z.string(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ question }) => {
      const r = await ask(env, question);
      learn('ask_living_bread', question, Boolean(r && ((r.entities?.length ?? 0) > 0 || r.scripture || r.answer)));
      if (!r) return unavailable('the Christian Knowledge API', `${KNOWLEDGE_API}/ask`);
      let scripture: { topic: string; url: string; verses: { ref: string; text: string }[] } | null = null;
      const topicSlug = r.scripture?.urn?.startsWith('lb:topic:') ? r.scripture.urn.slice('lb:topic:'.length) : null;
      const need = (topicSlug && needBySlug(topicSlug)) || findNeed(topicSlug ?? '')?.need || (!r.entities?.length ? findNeed(question)?.need : null) || null;
      if (need) {
        const verses = await resolveVerses(env, need, 3);
        scripture = { topic: need.label, url: r.scripture?.url ? absolute(r.scripture.url) : need.page, verses: verses.map((v) => ({ ref: v.ref, text: v.text })) };
      }
      const entities = (r.entities ?? []).map((e) => ({ id: e.id, type: e.type, name: e.name, url: absolute(e.url), source: e.source ?? null }));
      const road = (r.road_to_christ ?? []).map((x) => ({ name: x.name, url: absolute(x.url) }));
      const steps = (r.next_steps ?? []).map((x) => ({ label: x.label, url: absolute(x.url) }));
      const grounding = r.grounding ?? 'Every result is a real, sourced page in The Living Bread graph or Scripture. Nothing here is invented.';
      const text = paragraph([
        r.answer,
        entities.length ? `Sourced entities: ${list(entities.map((e) => `${e.name} (${e.type}, ${e.url})`), 6)}` : null,
        scripture?.verses.length ? `Scripture on ${scripture.topic.toLowerCase()}: ${list(scripture.verses.map((v) => `${v.ref} "${v.text}"`), 3)}` : null,
        !entities.length && !scripture ? 'The graph holds nothing sourced for this question, and we would rather say so than guess' : null,
        road.length ? `The road to Christ from here: ${list(road.map((x) => `${x.name} (${x.url})`), 4)}` : null,
        steps.length ? `Next steps: ${list(steps.map((s) => `${s.label}: ${s.url}`), 4)}` : null,
      ]);
      return ok(text, {
        question: r.question ?? question, entities, answer: r.answer ?? null, scripture, road_to_christ: road, next_steps: steps, grounding, ...ATTRIBUTION,
        content_layers: layers({ scripture: ['scripture.verses[].text'], interpretation: ['answer (the Christian Knowledge API\'s grounded summary)'], navigation: ['entities', 'road_to_christ', 'next_steps'] }),
      });
    },
  );

  // 5. find_churches_near ----------------------------------------------------
  const placeInput = {
    lat: z.number().min(-90).max(90).optional().describe('Latitude, if the person has shared where they are.'),
    lng: z.number().min(-180).max(180).optional().describe('Longitude, paired with lat.'),
    city: z.string().max(120).optional().describe('A city, region or country, when there are no coordinates: "Dallas", "Lagos", "Greater London".'),
  };
  tool(server, 
    'find_churches_near',
    {
      title: 'Find churches near a place',
      description:
        'Real Christian churches near a person, nearest first, from two live sources: the churches on The Living Bread (some claimed by their own leaders) and a worldwide open directory of about 120,000 churches with stable entity ids. City-level only, with distance in km. Says plainly when nothing is held near the place. People ask: "is there a church near me", "Baptist churches in Dallas", "where can I go to church this Sunday in Lagos", "a Catholic parish near Manchester". Use whenever someone wants a church, congregation or Christian community near them; the Body of Christ is the door, and walking in is the step.',
      inputSchema: {
        ...placeInput,
        denomination: z.string().max(60).optional().describe('Optional: "baptist", "catholic", "methodist", "pentecostal", "orthodox", "anglican"...'),
        limit: z.number().int().min(1).max(20).default(8),
      },
      outputSchema: out({
        searched: z.string(), count: z.number(),
        churches: z.array(z.looseObject({ name: z.string(), where: z.string(), distance_km: z.number().nullable(), denomination: z.string().nullable(), on_living_bread: z.boolean(), url: z.string().nullable(), id: z.string() })),
        honest: z.string().optional(), nearest_we_hold: z.string().nullable().optional(), find_a_church: z.string(), gatherings: z.string(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      _meta: widgetMeta('church-card', 'Looking for real churches near there', 'Real churches, nearest first'),
    },
    async ({ lat, lng, city, denomination, limit }) => {
      let geo = lat !== undefined && lng !== undefined ? { lat, lon: lng, label: city ?? `${lat.toFixed(2)}, ${lng.toFixed(2)}`, countrySlug: null as string | null } : null;
      if (!geo && city) geo = await geocode(env, city);
      if (!geo && !city) return fail(paragraph(['Tell us where to look: coordinates (lat and lng) or a city']), { error: 'no_place' });
      if (geo && !geo.countrySlug && city) {
        const g2 = await geocode(env, city);
        if (g2?.countrySlug) geo = { ...geo, countrySlug: g2.countrySlug };
      }
      const [ours, open] = await Promise.all([
        findChurches(env, { lat: geo?.lat ?? null, lon: geo?.lon ?? null, place: geo ? null : city ?? null, limit: Math.min(25, limit + 4) }),
        geo?.countrySlug ? nearby(env, geo.countrySlug, geo.lat, geo.lon, Math.min(25, limit + 4), denomination) : Promise.resolve(null),
      ]);
      if (ours === null && open === null) return unavailable('the church directory', DOORS.findAChurch);
      const want = denomination ? denomination.toLowerCase() : null;
      type Row = { name: string; where: string; distance_km: number | null; denomination: string | null; on_living_bread: boolean; url: string | null; id: string };
      const rows: Row[] = [];
      for (const c of ours ?? []) {
        if (want && !c.name.toLowerCase().includes(want)) continue;
        rows.push({ name: c.name, where: placeOf(c), distance_km: c.distance_km, denomination: null, on_living_bread: c.claimed, url: null, id: c.id });
      }
      for (const c of open?.results ?? []) {
        if (rows.some((r) => r.name.toLowerCase() === c.name.toLowerCase())) continue;
        rows.push({ name: c.name, where: geo?.label ?? city ?? 'nearby', distance_km: Math.round(c.distance_km * 10) / 10, denomination: c.denomination, on_living_bread: false, url: c.url, id: c.id });
      }
      const near = geo ? rows.filter((r) => r.distance_km !== null && r.distance_km <= NEAR_KM) : rows;
      near.sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9) || Number(b.on_living_bread) - Number(a.on_living_bread));
      const shown = near.slice(0, limit);
      const searched = geo?.label ?? city ?? 'anywhere';
      learn('find_churches_near', [city, denomination].filter(Boolean).join(', ') || 'coordinates', shown.length > 0);
      if (!shown.length) {
        const far = rows.filter((r) => r.distance_km !== null).sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0))[0];
        const honest = 'The Living Bread does not yet hold a church near that place. That does not mean there is none; it means we do not have it, and saying otherwise would be a lie.';
        const nearest = far ? `${far.name}, ${far.where}, ${km(far.distance_km)}` : null;
        return ok(paragraph([`Searched near ${searched}`, honest, nearest ? `The nearest we hold is ${nearest}` : null, `The live finder searches the whole world map at ${DOORS.findAChurch}, and the family can be asked at ${DOORS.prayer}`]), {
          searched, count: 0, churches: [], honest, nearest_we_hold: nearest, find_a_church: DOORS.findAChurch, gatherings: DOORS.events, ...ATTRIBUTION,
        });
      }
      const text = paragraph([
        `${shown.length} real ${shown.length === 1 ? 'church' : 'churches'} near ${searched}, nearest first: ${list(shown.map((r) => `${r.name} (${r.where}${r.distance_km !== null ? `, ${km(r.distance_km)}` : ''}${r.denomination ? `, ${r.denomination}` : ''}${r.on_living_bread ? ', on Living Bread' : ''})`), limit)}`,
        'Precision is city level on purpose: give the person the name and the city, and the live map and finder are at ' + DOORS.findAChurch,
        `Gatherings they could walk into this week: ${DOORS.events}`,
      ]);
      return ok(text, { searched, count: shown.length, churches: shown, find_a_church: DOORS.findAChurch, gatherings: DOORS.events, ...ATTRIBUTION });
    },
  );

  // 6. church ----------------------------------------------------------------
  tool(server, 
    'church',
    {
      title: 'One church, as open data',
      description:
        'One church from the Christian Knowledge API by country and slug (e.g. country "united-states", slug "saint-josephs"; ids look like lb:church:united-states/saint-josephs). Returns its stable id, name, denomination, country, website, sameAs links, verified data when the church itself supplied it, and provenance.',
      inputSchema: {
        country: z.string().min(2).max(80).describe('Country slug or name: "united-states", "colombia", "andorra".'),
        slug: z.string().min(1).max(160).describe('The church slug from a nearby result or id, e.g. "capella-de-casa-rossell".'),
      },
      outputSchema: out({ id: z.string(), name: z.string(), url: z.string(), denomination: z.string().nullable().optional(), country: z.string().nullable().optional(), website: z.string().nullable().optional(), verified: z.unknown().optional(), provenance: z.unknown().optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      _meta: widgetMeta('church-card', 'Opening the church record', 'One church, as open data'),
    },
    async ({ country, slug }) => {
      const c = await churchApi(env, country, slug.replace(/^lb:church:[^/]+\//, ''));
      if (!c || !c.name) return fail(paragraph([`No church is held at ${slugify(country)}/${slugify(slug)}`, `Search near a place with find_churches_near, or open ${DOORS.findAChurch}`]), { error: 'not_found', find_a_church: DOORS.findAChurch });
      const verified = c.verified && typeof c.verified === 'object' ? 'This church has supplied and verified its own details.' : null;
      return ok(paragraph([`${c.name}${c.denomination ? `, ${c.denomination}` : ''}${c.country ? `, ${c.country}` : ''}`, c.website ? `Website: ${c.website}` : null, verified, `Open data page: ${c.url}`]), { ...c, ...ATTRIBUTION });
    },
  );

  // 7. find_gatherings_near --------------------------------------------------
  tool(server, 
    'find_gatherings_near',
    {
      title: 'Find gatherings near a place',
      description:
        'Real upcoming Christian gatherings a person could attend: services, prayer nights, Bible studies, worship nights, meals, care and recovery, online gatherings. Posted by real churches and believers; nothing invented. Times are UTC. People ask: "is there a Bible study near me this week", "any prayer meeting tonight", "an online church service I can join", "something for a first visit that is not Sunday". Use when someone asks what is happening near them, wants a first step that is not a Sunday service, or wants something online.',
      inputSchema: {
        ...placeInput,
        days: z.number().int().min(1).max(60).default(14).describe('How many days ahead to look.'),
        online: z.boolean().optional().describe('True for gatherings joinable from anywhere.'),
        limit: z.number().int().min(1).max(20).default(8),
        cursor: cursorInput,
      },
      outputSchema: out({
        searched: z.string(), count: z.number(),
        gatherings: z.array(z.looseObject({ id: z.string(), title: z.string(), when_utc: z.string(), where: z.string(), distance_km: z.number().nullable(), kind: z.string().nullable(), online: z.boolean(), good_for_a_first_visit: z.boolean().nullable() })),
        honest: z.string().optional(), gatherings_page: z.string(), next_cursor: z.string().nullable().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ lat, lng, city, days, online, limit, cursor }) => {
      let geo = lat !== undefined && lng !== undefined ? { lat, lon: lng, label: city ?? `${lat.toFixed(2)}, ${lng.toFixed(2)}` } : null;
      if (!geo && city) geo = await geocode(env, city);
      const rows = await findGatherings(env, { lat: geo?.lat ?? null, lon: geo?.lon ?? null, place: geo ? null : city ?? null, online: online ?? null, limit: 25 });
      if (rows === null) return unavailable('the gatherings', DOORS.events);
      const horizon = Date.now() + days * 86_400_000;
      const near = rows.filter((g) => Date.parse(g.starts_at) <= horizon && (online === true || !geo || g.is_online || (g.distance_km !== null && g.distance_km <= NEAR_KM)));
      const pg = page(near, cursor, limit, `${city ?? ''}|${online ?? ''}|${days}`);
      const shown = pg.items.map((g) => ({
        id: g.id, title: g.title, when_utc: whenUTC(g.starts_at), starts_at: g.starts_at, where: g.is_online ? 'online, joinable from anywhere' : placeOf(g), distance_km: g.distance_km, kind: g.category, online: g.is_online, good_for_a_first_visit: g.beginner_friendly,
        freshness: scheduled(g.starts_at),
      }));
      const next_cursor = pg.next_cursor;
      const searched = geo?.label ?? city ?? (online ? 'online' : 'anywhere');
      learn('find_gatherings_near', city ?? (online ? 'online' : 'coordinates'), shown.length > 0);
      if (!shown.length) {
        const honest = `No upcoming gathering is held near ${searched} in the next ${days} days. Online gatherings can be joined from anywhere (call again with online true), and a church can be visited any Sunday.`;
        return ok(paragraph([honest, `All gatherings: ${DOORS.events}`, `Churches near them: find_churches_near, or ${DOORS.findAChurch}`]), { searched, count: 0, gatherings: [], honest, gatherings_page: DOORS.events, ...ATTRIBUTION });
      }
      const text = paragraph([
        `${shown.length} real upcoming ${shown.length === 1 ? 'gathering' : 'gatherings'} near ${searched}: ${list(shown.map((g) => `${g.title} (${g.when_utc}, ${g.where}${g.distance_km !== null ? `, ${km(g.distance_km)}` : ''}${g.good_for_a_first_visit ? ', good for a first visit' : ''})`), limit)}`,
        'Times are UTC, so convert to the person\'s local time before telling them',
        `Details and more at ${DOORS.events}`,
      ]);
      return ok(text, { searched, count: shown.length, gatherings: shown, gatherings_page: DOORS.events, next_cursor, freshness: scheduled(null, 'Times the hosts posted; none of these is confirmed as happening now.'), ...ATTRIBUTION });
    },
  );

  // 8. communities_to_join ---------------------------------------------------
  tool(server, 
    'communities_to_join',
    {
      title: 'Communities a person can join',
      description:
        'The discoverable communities on The Living Bread a person can join today: prayer groups, study groups, city and interest communities, with how to join (open or by request) and their next gathering. Family rooms are private and never listed. Use when someone wants people to pray or walk with, or asks "is there a prayer group".',
      inputSchema: { query: z.string().max(120).optional().describe('Optional: a word, a city, or a kind ("prayer", "study", "Atlanta").'), limit: z.number().int().min(1).max(20).default(10), cursor: cursorInput },
      outputSchema: out({
        count: z.number(),
        communities: z.array(z.looseObject({ id: z.string(), name: z.string(), kind: z.string(), description: z.string().nullable(), where: z.string(), people: z.number(), join: z.string(), next_gathering: z.string().nullable(), verified: z.boolean() })),
        join_here: z.string(), next_cursor: z.string().nullable().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit, cursor }) => {
      const rows = await communities(env);
      if (rows === null) return unavailable('the communities', DOORS.communities);
      const q = (query ?? '').toLowerCase().trim();
      const hay = (c: Community) => [c.name, c.description, c.kind, c.city, c.country].filter(Boolean).join(' ').toLowerCase();
      const all = q ? rows.filter((c) => q.split(/\s+/).some((w) => w && hay(c).includes(w))) : rows;
      const pg = page(all, cursor, limit ?? 10, q);
      const picked = pg.items;
      const next_cursor = pg.next_cursor;
      const shown = picked.map((c) => ({
        id: c.id, name: c.name, kind: c.kind, description: c.description, where: c.is_global ? 'everywhere' : placeOf(c) === 'place not given' ? 'everywhere' : placeOf(c),
        people: c.member_count ?? 0, join: c.join_policy === 'open' ? 'open: anyone may join' : c.join_policy === 'request' ? 'by request to its leaders' : c.join_policy ?? 'see the community page',
        next_gathering: c.next_gathering_title ? `${c.next_gathering_title}${c.next_gathering_at ? `, ${whenUTC(c.next_gathering_at)}` : ''}` : null, verified: Boolean(c.is_verified),
        freshness: c.next_gathering_at ? scheduled(c.next_gathering_at, 'The community\'s next posted gathering; not a statement that anyone is gathered now.') : record(null, 'A community on record; membership counts are read live, not who is present now.'),
      }));
      if (!shown.length) {
        return ok(paragraph([q ? `No discoverable community matches "${query}" yet` : 'No discoverable community is listed yet', 'Quiet here for now. Anyone may start one, and the family prays for anyone by name', `Communities: ${DOORS.communities}. Prayer: ${DOORS.prayer}`]), { count: 0, communities: [], join_here: DOORS.communities, ...ATTRIBUTION });
      }
      const text = paragraph([
        `${shown.length} ${shown.length === 1 ? 'community' : 'communities'} a person can join: ${list(shown.map((c) => `${c.name} (${c.kind}, ${c.where}, ${c.people} ${c.people === 1 ? 'person' : 'people'}, ${c.join}${c.next_gathering ? `, next: ${c.next_gathering}` : ''})`), 8)}`,
        `Join at ${DOORS.communities} (free; Begin, then open the community by name)`,
      ]);
      return ok(text, { count: shown.length, total: all.length, communities: shown, join_here: DOORS.communities, next_cursor, ...ATTRIBUTION });
    },
  );

  // 9. heritage_lookup -------------------------------------------------------
  tool(server, 
    'heritage_lookup',
    {
      title: 'Denomination, saint, sacred site, biblical figure or Bible place',
      description:
        'One sourced entity from the Christian Knowledge API: a denomination (with its family tree), a saint, a sacred site, a biblical figure (with genealogy edges where known) or a Bible place. Pass the kind and a name or slug ("Methodism", "Augustine of Hippo", "Bethlehem"). Returns the stable lb: id, the page, sameAs links (Wikidata, Wikipedia), provenance, and related ids. Use instead of memory for facts about these.',
      inputSchema: {
        kind: z.enum(['denomination', 'saint', 'sacred-site', 'biblical-figure', 'bible-place']),
        name: z.string().min(2).max(120).describe('A name or slug.'),
      },
      outputSchema: out({ id: z.string(), type: z.string(), name: z.string(), url: z.string(), sameAs: z.array(z.string()).optional(), provenance: z.unknown().optional(), image: z.string().nullable().optional(), children: z.array(z.string()).optional(), parent: z.unknown().optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ kind, name }) => {
      const e = await findEntity(env, kind as HeritageKind, name);
      learn('heritage_lookup', `${kind}: ${name}`, Boolean(e && e.name));
      if (!e || !e.name) return fail(paragraph([`We hold no sourced ${kind.replace('-', ' ')} called "${name}"`, 'ask_living_bread may find it by meaning, and we would rather say nothing than invent a fact']), { error: 'not_found', kind, name });
      const same = Array.isArray(e.sameAs) ? (e.sameAs as string[]) : [];
      const children = Array.isArray(e.children) ? (e.children as string[]) : [];
      return ok(paragraph([
        `${e.name} (${kind.replace('-', ' ')}, id ${e.id})`,
        same.length ? `Also known at ${list(same, 3)}` : null,
        children.length ? `Related: ${children.length} ${kind === 'denomination' ? 'branches' : 'linked entities'}, for example ${list(children.slice(0, 4), 4)}` : null,
        `Sourced page: ${e.url}`,
      ]), { ...e, ...ATTRIBUTION });
    },
  );

  // 10. pray_for_someone (the door; on the signed-in endpoint src/acts.ts registers the act under this name)
  if (!opts.signedIn) tool(server,
    'pray_for_someone',
    {
      title: 'Pray for someone, by name, in your own voice',
      description:
        'The exact door to pray for a person on The Living Bread: record a prayer in your own voice (or write one) with their name in it; they hear it, and may pray one back. Works for a believer on Living Bread or for anyone, by a private link. Use when someone wants to pray for a friend, a parent, a stranger, or asks how to send a prayer. Returns the deep link and the honest state of recording.',
      inputSchema: { name: z.string().max(80).optional().describe('Who the prayer is for, if known.') },
      outputSchema: out({ for: z.string().nullable(), link: z.string(), what_happens: z.string(), recording: z.string(), app_store: z.string(), play_store: z.string(), not_on_living_bread_yet: z.string(), scripture_ref: z.string() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ name }) => {
      const who = name?.trim() || null;
      const what = `At ${DOORS.prayVoice} you choose ${who ? who : 'the person'} (your family on Living Bread, a search by name, or "let God choose someone"), press record and pray with ${who ? `${who}'s` : 'their'} name in it, or write the prayer instead. ${who ? who : 'They'} will be told "${'someone'} prayed for you, out loud", can listen, and can pray one back.`;
      const notYet = `If ${who ?? 'the person'} is not on Living Bread yet, the same page makes a private link you can send them, and they hear the prayer without an account.`;
      return ok(paragraph([what, RECORDING_TRUTH, `App Store: ${DOORS.appStore}. Google Play: ${DOORS.playStore}`, notYet, 'James 5:16 is the verse this door opens with: use scripture_passage to read it']), {
        for: who, link: DOORS.prayVoice, what_happens: what, recording: RECORDING_TRUTH, app_store: DOORS.appStore, play_store: DOORS.playStore, not_on_living_bread_yet: notYet, scripture_ref: 'James 5:16',
      });
    },
  );

  // 11. hear_the_kingdom_pray ------------------------------------------------
  tool(server, 
    'hear_the_kingdom_pray',
    {
      title: 'Hear the Kingdom pray',
      description:
        'The door where believers from many nations pray out loud over the whole Living Bread family, one voice at a time, and where a person can listen and add their own. Use when someone wants to hear others pray, feels alone, or asks what the family is praying.',
      inputSchema: {},
      outputSchema: out({ link: z.string(), what_it_is: z.string(), how_to_add_your_voice: z.string(), scripture_ref: z.string() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const what = `At ${DOORS.kingdomPraying} you hear real believers praying over the whole family, one voice at a time, each naming their nation, each up to forty seconds. The latest prayer plays when you arrive.`;
      const how = `Any believer on Living Bread may add one voice a day from the same page (the family is told once a day, naming the nations that prayed). ${RECORDING_TRUTH}`;
      return ok(paragraph([what, how, 'Revelation 7:9 is the verse this room opens with: a multitude out of every nation']), { link: DOORS.kingdomPraying, what_it_is: what, how_to_add_your_voice: how, scripture_ref: 'Revelation 7:9' });
    },
  );

  // 12. begin ----------------------------------------------------------------
  tool(server, 
    'begin',
    {
      title: 'Begin on The Living Bread',
      description:
        'The invitation and the doors in: the web home, the App Store and Google Play links, and what a newcomer finds first. Use when someone wants to join, asks what The Living Bread is, or is seeking and does not know where to start.',
      inputSchema: {},
      outputSchema: out({ invitation: z.string(), web: z.string(), app_store: z.string(), play_store: z.string(), first_steps: z.array(z.string()), who_is_jesus: z.string(), free: z.boolean() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () =>
      ok(paragraph([INVITATION, `Begin on the web at ${DOORS.home}, on iPhone at ${DOORS.appStore}, on Android at ${DOORS.playStore}`, `What a newcomer meets first: ${list(FIRST_STEPS, 5)}`, `If they are asking who Jesus is, start there: ${DOORS.whoIsJesus}`]), {
        invitation: INVITATION, web: DOORS.home, app_store: DOORS.appStore, play_store: DOORS.playStore, first_steps: [...FIRST_STEPS], who_is_jesus: DOORS.whoIsJesus, free: true,
      }),
  );

  // 13. search and fetch: the ChatGPT connector contract ----------------------
  tool(server, 
    'search',
    {
      title: 'Search The Living Bread',
      description: 'Search across Scripture for a need, a Bible reference, churches, gatherings, communities and sourced entities. Returns results with ids that fetch reads in full. Provided for connector clients.',
      inputSchema: { query: z.string().min(1).max(300) },
      outputSchema: out({ results: z.array(z.looseObject({ id: z.string(), title: z.string(), text: z.string(), url: z.string() })) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query }) => {
      const results: { id: string; title: string; text: string; url: string }[] = [];
      const p = parseReference(query);
      if (p) results.push({ id: `verse:${p.ref}`, title: p.ref, text: `${p.ref}, read verbatim from the stored King James Version.`, url: `${SITE}/${verseSlug(p)}` });
      const need = findNeed(query);
      if (need) results.push({ id: `need:${need.need.slug}`, title: `Scripture for ${need.need.label.toLowerCase()}`, text: need.need.lead || `Verses the house pairs with ${need.need.label.toLowerCase()}, read from the stored KJV.`, url: need.need.page });
      const [asked, geo] = await Promise.all([ask(env, query), p || need ? Promise.resolve(null) : geocode(env, query)]);
      for (const e of asked?.entities ?? []) results.push({ id: e.id, title: e.name, text: `${e.type}${e.source ? `, source ${e.source}` : ''}`, url: absolute(e.url) });
      if (geo) {
        const [cs, gs] = await Promise.all([
          findChurches(env, { lat: geo.lat, lon: geo.lon, place: null, limit: 5 }),
          findGatherings(env, { lat: geo.lat, lon: geo.lon, place: null, online: null, limit: 5 }),
        ]);
        for (const c of cs ?? []) if (c.distance_km !== null && c.distance_km <= NEAR_KM) results.push({ id: `church:${c.id}`, title: c.name, text: `A church in ${placeOf(c)}, ${km(c.distance_km)} from ${geo.label}.`, url: DOORS.findAChurch });
        for (const g of gs ?? []) if (g.is_online || (g.distance_km !== null && g.distance_km <= NEAR_KM)) results.push({ id: `gathering:${g.id}`, title: g.title, text: `An upcoming gathering, ${whenUTC(g.starts_at)}, ${g.is_online ? 'online' : placeOf(g)}.`, url: DOORS.events });
      }
      const cs = await communities(env);
      for (const c of cs ?? []) if (query.toLowerCase().split(/\s+/).some((w) => w.length > 2 && `${c.name} ${c.description ?? ''} ${c.kind}`.toLowerCase().includes(w))) results.push({ id: `community:${c.id}`, title: c.name, text: `${c.kind} community, ${c.member_count} people, ${c.join_policy ?? ''}`.trim(), url: DOORS.communities });
      learn('search', query, results.length > 0);
      if (!results.length) results.push({ id: 'living-bread', title: 'The Living Bread', text: `Nothing in the directory matched that. ${INVITATION}`, url: SITE });
      return ok(paragraph([`${results.length} ${results.length === 1 ? 'result' : 'results'}: ${list(results.map((r) => `${r.title} [${r.id}]`), 10)}`]), { results });
    },
  );

  tool(server, 
    'fetch',
    {
      title: 'Fetch one search result',
      description: 'Read one search result in full by its id (verse:<ref>, need:<slug>, church:<uuid>, gathering:<uuid>, community:<uuid>, or an lb: entity id). Provided for connector clients.',
      inputSchema: { id: z.string().min(1).max(200) },
      outputSchema: out({ id: z.string(), title: z.string(), text: z.string(), url: z.string(), metadata: z.record(z.string(), z.unknown()).optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      const done = (title: string, text: string, url: string, metadata: Structured = {}) => ok(paragraph([title, text]), { id, title, text, url, metadata: { ...metadata, ...ATTRIBUTION } });
      const [kind, ...rest] = id.split(':');
      const key = rest.join(':');
      if (kind === 'verse') {
        const p = parseReference(key);
        const pass = p ? await kjvPassage(env, p) : null;
        if (p && pass) return done(pass.ref, `"${pass.text}" (King James Version)`, `${SITE}/${verseSlug(p)}`, { translation: 'KJV' });
      }
      if (kind === 'need') {
        const n = needBySlug(key);
        if (n) {
          const verses = await resolveVerses(env, n, 6);
          return done(`Scripture for ${n.label.toLowerCase()}`, paragraph([n.lead, ...verses.map((v) => `${v.ref}: "${v.text}"`)]), n.page, { verses });
        }
      }
      if (kind === 'church') {
        const c = await getChurch(env, key);
        if (c) return done(c.name, `${c.name} is a church in ${placeOf(c)}. ${c.claimed ? 'It is on Living Bread and can be reached there.' : 'Search the name and city, or open the live finder, to reach it.'}`, DOORS.findAChurch, { where: placeOf(c), precision: 'city level by design' });
      }
      if (kind === 'gathering') {
        const g = await getGathering(env, key);
        if (g) return done(g.title, `${g.title}. ${whenUTC(g.starts_at)}. ${g.is_online ? 'Online, joinable from anywhere.' : `In ${placeOf(g)}.`}${g.beginner_friendly ? ' Good for a first visit.' : ''}${g.has_passed ? ' This gathering has already passed; look for the next one.' : ''}`, DOORS.events, { when_utc: g.starts_at, online: g.is_online, has_passed: Boolean(g.has_passed) });
      }
      if (kind === 'community') {
        const c = (await communities(env))?.find((x) => x.id === key);
        if (c) return done(c.name, `${c.name}, a ${c.kind} community${c.is_global ? ' open to everyone everywhere' : placeOf(c) !== 'place not given' ? ` in ${placeOf(c)}` : ''}. ${c.description ?? ''} ${c.member_count} ${c.member_count === 1 ? 'person' : 'people'}; joining is ${c.join_policy ?? 'described on the page'}.`, DOORS.communities, { kind: c.kind, join_policy: c.join_policy });
      }
      if (kind === 'lb') {
        const [type, ...slugParts] = rest;
        const slug = slugParts.join(':');
        if (type === 'church') {
          const [country, s] = slug.split('/');
          const c = country && s ? await churchApi(env, country, s) : null;
          if (c?.name) return done(String(c.name), `${c.name}${c.denomination ? `, ${c.denomination}` : ''}${c.country ? `, ${c.country}` : ''}.${c.website ? ` Website: ${c.website}.` : ''}`, String(c.url), c);
        } else if (['denomination', 'saint', 'sacred-site', 'biblical-figure', 'bible-place'].includes(type)) {
          const e = await findEntity(env, type as HeritageKind, slug);
          if (e?.name) return done(String(e.name), `${e.name}, a ${type.replace('-', ' ')} in The Living Bread graph.${Array.isArray(e.sameAs) && e.sameAs.length ? ` Also at ${(e.sameAs as string[]).join(', ')}.` : ''}`, String(e.url), e);
        }
      }
      return done('The Living Bread', `That id could not be read back. It may have been a gathering that has since passed. ${INVITATION}`, SITE, { unresolved: id });
    },
  );

  // ------------------------------------------------------------------ resources
  server.registerResource('llms.txt', 'living-bread://llms.txt', { title: 'The Living Bread, llms.txt', description: 'The live llms.txt of living-bread.org: what the platform is, what may be quoted, and every machine-readable surface.', mimeType: 'text/plain' }, async (uri) => {
    const text = (await getText(`${SITE}/llms.txt`)) ?? `# The Living Bread\n\nThe live file could not be fetched just now. It lives at ${SITE}/llms.txt`;
    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] };
  });
  server.registerResource('knowledge-llms.txt', 'living-bread://knowledge/llms.txt', { title: 'Christian Knowledge API, llms.txt', description: 'The live llms.txt of discover.living-bread.org, the open Christian reference library and Knowledge API.', mimeType: 'text/plain' }, async (uri) => {
    const text = (await getText(`${KNOWLEDGE_API}/llms.txt`)) ?? `# The Living Bread Knowledge API\n\nThe live file could not be fetched just now. It lives at ${KNOWLEDGE_API}/llms.txt`;
    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] };
  });
  server.registerResource('openapi.json', 'living-bread://openapi.json', { title: 'Christian Knowledge API, OpenAPI 3.1', description: 'The live OpenAPI contract of the Christian Knowledge API these tools read.', mimeType: 'application/json' }, async (uri) => {
    const text = (await getText(`${KNOWLEDGE_API}/openapi.json`)) ?? JSON.stringify({ error: 'unavailable', url: `${KNOWLEDGE_API}/openapi.json` });
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text }] };
  });

  // -------------------------------------------------------------------- prompts
  server.registerPrompt('pray_with_me', {
    title: 'Pray with me',
    description: 'Pray with a person about what they carry: Scripture from the stored text, a prayer in our own words, and the door to real believers who will pray for them by name.',
    argsSchema: { about: z.string().optional().describe('What they are carrying, in their words.'), for_whom: z.string().optional().describe('If the prayer is for someone else, their name.') },
  }, ({ about, for_whom }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: paragraph([
      `Please pray with me${for_whom ? ` for ${for_whom}` : ''}${about ? ` about this: ${about}` : ''}`,
      'First call verses_for with what I said and read me one or two verses exactly as the tool returns them, with the reference',
      'Then pray a short, warm prayer in your own words, addressed to God (never speaking as God), that names what I carry and points me to Jesus Christ',
      for_whom ? `Then call pray_for_someone with the name ${for_whom} and give me the exact link so I can pray for them in my own voice` : 'Then call pray_for_someone and tell me how the family at The Living Bread will pray for me by name',
      'Keep it simple and honest. No pressure',
    ]) } }],
  }));

  server.registerPrompt('find_my_church', {
    title: 'Find my church',
    description: 'Find real churches and gatherings near a place, honestly, and help the person take one step toward walking in.',
    argsSchema: { place: z.string().describe('A city, region or country.'), denomination: z.string().optional().describe('Optional tradition.') },
  }, ({ place, denomination }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: paragraph([
      `Help me find a church near ${place}${denomination ? `, ${denomination} if possible` : ''}`,
      `Call find_churches_near with city "${place}"${denomination ? ` and denomination "${denomination}"` : ''}, then find_gatherings_near for the same place`,
      'Tell me only what the tools return, nearest first, with the city for each. If nothing is held near me, say so plainly and give me the live finder link',
      'Suggest one concrete first step I could take this week, and remind me I do not have to go alone: the family at The Living Bread will pray for me by name',
    ]) } }],
  }));

  server.registerPrompt('a_verse_for_today', {
    title: 'A verse for today',
    description: 'The Daily Bread the whole family receives today, read verbatim, with a brief reflection in our own words and one small act of love to carry it.',
    argsSchema: { date: z.string().optional().describe('YYYY-MM-DD, defaults to today.') },
  }, ({ date }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: paragraph([
      `Give me the verse for today${date ? ` (${date})` : ''}`,
      `Call daily_bread${date ? ` with date ${date}` : ''} and read the verse exactly as returned, with its reference`,
      'Then offer two or three sentences of reflection in your own words, clearly yours and not Scripture, pointing to Jesus Christ',
      'End with one small act of love I could do today for someone near me, and the link where the family reads this same bread',
    ]) } }],
  }));
}

export type { AskResult, Church, Gathering };
