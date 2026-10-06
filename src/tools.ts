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
import { parseReference, verseSlug } from './scripture';
import { isAny, isPick, languageInput, notesOf, pick, readAny, translationInput } from './shelf';
import { describe, doorFor, parseLoose, type Choice } from './translations';
import { logAsk } from './asks';
import { absolute, ATTRIBUTION, cursorInput, fail, ok, out, page, tool, unavailable, type Structured } from './shared';
import { layers } from './evidence';
import { record, scheduled } from './freshness';
import { widgetMeta } from './widgets';

const NEAR_KM = 250;
const SCRIPTURE_ONLY = layers({ scripture: ['text', 'verses[].text'] });

async function resolveVerses(env: Env, need: Need, max: number, choice: Choice = { kind: 'kjv' }) {
  const found: { ref: string; text: string; why?: string; own_ref?: string }[] = [];
  for (const r of need.refs) {
    if (found.length >= max) break;
    if (choice.kind === 'shelf') {
      const got = await readAny(env, choice, r.ref);
      if (isAny(got)) found.push({ ref: got.ref, text: got.text, ...(got.own_ref && got.own_ref !== got.ref ? { own_ref: got.own_ref } : {}), ...(r.why ? { why: r.why } : {}) });
      continue;
    }
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
        'Read a Bible passage word for word from a stored text: one verse, a verse range, or a whole chapter, by reference. Default is the King James Version; translation (an id from list_translations) or language (BCP-47) reads the same passage from about sixty stored public domain or freely licensed Bibles in that translation\'s own numbering, with its license. Use when the person names or implies a reference ("John 3:16", "Psalm 23", "1 Cor 13:4-7"). Not for finding verses by wording (scripture_search) or by feeling or need (verses_for), for a verse with its surrounding verses (scripture_context), for linked passages (cross_references), for one passage in several Bibles side by side (compare_translations), or for the Hebrew or Greek words (original_words). reference takes one book and chapter with an optional verse or range inside that chapter; ranges across chapters are not supported. Deterministic. An unparseable reference returns an error suggesting scripture_search; an unknown translation or language, or a book a translation does not hold, returns an error naming list_translations and the translations that do hold it.',
      inputSchema: {
        reference: z.string().min(2).max(80).describe('Book, chapter and optional verse or range, as a reader writes it: "John 3:16", "Psalm 23", "Romans 8:38-39", "1 Cor 13:4-7". Common abbreviations are accepted. Deuterocanonical books ("Tobit 1") need a translation that holds them, such as "dra".'),
        translation: translationInput,
        language: languageInput,
      },
      outputSchema: out({
        ref: z.string().describe('Normalised reference, e.g. "John 3:16".'),
        translation: z.string().describe('Code of the translation actually returned, e.g. KJV, WEB, BSB, RV1909.'),
        translation_name: z.string().optional().describe('Full name of the translation, present when translation or language was given.'),
        own_ref: z.string().optional().describe('The reference in that translation\'s own numbering when it differs (Psalm 23 is Psalm 22 in the Douay-Rheims).'),
        text: z.string().describe('The whole passage, verbatim.'),
        book: z.string().describe('Book name.'),
        chapter: z.number().describe('Chapter number.'),
        verses: z.array(z.looseObject({ verse: z.number(), text: z.string() })).describe('Each verse number with its verbatim text.'),
        source: z.string().describe('Translation name and its license, copied from the source.'),
        read_more: z.string().describe('Web page where the passage can be read in full.'),
        note: z.string().optional().describe('Present when numbering differs or verses are missing or joined in the chosen translation.'),
        missing_verses: z.array(z.string()).optional().describe('Verses the chosen translation does not have; never filled from another text.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: widgetMeta('verse-card', 'Reading the stored text', 'Read from the King James Version'),
    },
    async ({ reference, translation, language }) => {
      if (translation || language) {
        const chosen = pick(translation, language);
        if (!isPick(chosen)) return chosen;
        if (chosen.choice.kind === 'shelf' || !parseReference(reference)) {
          const got = await readAny(env, chosen.choice, reference);
          if (!isAny(got)) return fail(got.message, { reason: got.reason, try_instead: got.reason === 'unparsed_reference' ? ['scripture_passage with "John 3:16"'] : ['list_translations', 'compare_translations with the same reference'] });
          const notes = notesOf(got);
          return ok(paragraph([`${got.own_ref ?? got.ref} (${got.translation_name}): "${got.text}"`, ...notes, `Keep reading: ${got.door}`]), {
            ref: got.ref, own_ref: got.own_ref, translation: got.translation, translation_id: got.translation_id, translation_name: got.translation_name, text: got.text, book: got.book, chapter: got.chapter,
            verses: got.verses, source: `${got.translation_name}, ${chosen.t?.license ?? 'Public domain'} (stored text)`, read_more: got.door, door: got.door, chosen_because: chosen.why,
            ...(got.numbering_note ? { numbering_note: got.numbering_note } : {}), ...(got.missing ? { missing_verses: got.missing } : {}), ...(got.joined ? { joined_verses: got.joined } : {}),
            ...(notes.length ? { note: notes.join('. ') } : {}), content_layers: SCRIPTURE_ONLY,
          });
        }
      }
      const p = parseReference(reference);
      if (!p) {
        const loose = parseLoose(reference);
        if (loose) {
          const got = await readAny(env, { kind: 'kjv' }, loose);
          if (!isAny(got)) return fail(got.message, { reason: got.reason, try_instead: ['list_translations', 'compare_translations with the same reference'] });
        }
        return fail(paragraph([`"${reference}" is not a reference we can read with certainty. Try the book, chapter and verse, like "John 3:16" or "Psalm 23"`]), { reason: 'unparsed_reference', try_instead: ['scripture_passage with "John 3:16"', 'scripture_search for a phrase'] });
      }
      const kjv = await kjvPassage(env, p);
      if (!kjv) return unavailable('the stored Bible text', `${DOORS.bible}`);
      const read_more = `${SITE}/${verseSlug(p)}`;
      return ok(passageText(kjv, 'KJV'), { ...kjv, translation: 'KJV', source: 'King James Version, public domain (the text the app ships)', read_more: p.from !== undefined ? read_more : DOORS.bible, door: doorFor('en', p.bookId, p.chapter, p.from), content_layers: SCRIPTURE_ONLY });
    },
  );

  // 2. verses_for ------------------------------------------------------------
  tool(server, 
    'verses_for',
    {
      title: 'Verses for a need or feeling',
      description:
        'Return the short, hand-picked set of verses The Living Bread pairs with one of 99 needs or feelings (anxiety, fear, grief, loneliness, anger, guilt, doubt, money, marriage, healing and more), matched from the person\'s own words: need is scanned for a need name, then a synonym ("scared" finds fear, "my mother died" finds grief), so a whole sentence works. Use for "a verse for anxiety" or "scripture for my friend who lost her dad". Not for a topic explained verse by verse (what_the_bible_says_about), a written prayer (a_prayer_for), a known reference (scripture_passage), or literal wording (scripture_search). Verses are read verbatim from the stored KJV, or from the stored Bible chosen by translation or language (ids from list_translations); each one-line why is the house\'s words, not Scripture. No match returns an error listing the needs held; an unknown translation or language returns an error pointing to list_translations.',
      inputSchema: {
        need: z.string().min(2).max(200).describe('The need or feeling in the person\'s own words: "I\'m scared about surgery", "my mother died", "lonely", "anxiety".'),
        limit: z.number().int().min(1).max(12).default(5).describe('Maximum verses to return, 1 to 12 (default 5).'),
        translation: translationInput,
        language: languageInput,
      },
      outputSchema: out({
        need: z.string().describe('Slug of the matched need, e.g. "anxiety".'),
        label: z.string().describe('Display name of the matched need.'),
        lead: z.string().optional().describe('One sentence introducing the set, in the house\'s words.'),
        matched: z.string().describe('The word from the input that produced the match.'),
        verses: z.array(z.looseObject({ ref: z.string(), text: z.string(), why: z.string().optional() })).describe('Verses in the house\'s order: reference, verbatim KJV text, and an optional one-line why (house words).'),
        translation: z.string().describe('Translation code the verses were read from: KJV by default.'),
        translation_name: z.string().optional().describe('Full name of that translation.'),
        page: z.string().describe('Web page for this need, where believers pray over it.'),
        pray_with_the_family: z.string().describe('Link where the person can ask the family to pray for them.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: widgetMeta('verse-card', 'Finding the verses the house pairs with this', 'Verses read from the stored text'),
    },
    async ({ need, limit, translation, language }) => {
      const chosen = pick(translation, language);
      if (!isPick(chosen)) return chosen;
      const m = findNeed(need);
      learn('verses_for', need, Boolean(m));
      if (!m) {
        const some = allNeeds().map((n) => n.slug).slice(0, 40);
        return fail(
          paragraph([`We do not hold a verse set for "${need}" by that name`, `Needs we do hold include ${list(some.slice(0, 14), 14)}`, `For a specific verse use scripture_passage, and ask_living_bread can answer by meaning`]),
          { reason: 'no_matching_need', try_instead: ['ask_living_bread with the same words', 'scripture_search for a word', 'verses_for with one of: ' + allNeeds().map((n) => n.slug).slice(0, 20).join(', ')] },
        );
      }
      const verses = await resolveVerses(env, m.need, limit, chosen.choice);
      if (!verses.length) return unavailable('the stored Bible text', m.need.page);
      const tr = describe(chosen.choice);
      const text = paragraph([
        m.need.lead || `Scripture for ${m.need.label.toLowerCase()}`,
        ...verses.map((v) => `${v.own_ref ?? v.ref}: "${v.text}"${v.why ? ` (${v.why})` : ''}`),
        `Real believers pray over this need by name at ${m.need.page}`,
      ]);
      return ok(text, {
        need: m.need.slug, label: m.need.label, lead: m.need.lead || undefined, matched: m.matched, verses, translation: tr.code, translation_name: tr.name, page: m.need.page, pray_with_the_family: DOORS.prayer, door: doorFor(tr.language), ...ATTRIBUTION,
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
        'Return the single verse of the day that every Living Bread user receives on a given date (the app delivers it at each person\'s local 8am), verbatim from the stored KJV, or from the stored Bible chosen by translation or language (ids from list_translations). Use for "verse of the day" or "today\'s bread". Not for a verse on a theme (verses_for), a multi-day reading rhythm (reading_plans), or a chosen reference (scripture_passage). date is read as a calendar day only (no time zone math); pass the person\'s local date, since the verse is fixed per date and any past or future date works. An invalid date, an unknown translation or language, or a verse the chosen translation does not hold returns an error.',
      inputSchema: {
        date: z.string().optional().describe('Calendar day as YYYY-MM-DD, ideally in the person\'s own time zone, e.g. "2026-10-06". Omit for today (UTC).'),
        translation: translationInput,
        language: languageInput,
      },
      outputSchema: out({
        date: z.string().describe('The date answered, YYYY-MM-DD.'),
        ref: z.string().describe('Verse reference, in the chosen translation\'s own numbering.'),
        text: z.string().describe('Verse text, verbatim from the chosen translation.'),
        translation: z.string().describe('Translation code returned: KJV by default.'),
        translation_name: z.string().optional().describe('Full name of the translation returned.'),
        page: z.string().describe('Web page with today\'s verse, a reflection and a prayer.'),
        shared: z.string().describe('One sentence explaining that everyone receives this same verse that day.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: widgetMeta('verse-card', 'Finding the bread for this morning', 'The Daily Bread, read from the stored text'),
    },
    async ({ date, translation, language }) => {
      const day = date ?? isoDate();
      if (!isValidIsoDate(day)) return fail(paragraph([`"${day}" is not a calendar day we can read. Use YYYY-MM-DD`]), { error: 'bad_date' });
      const chosen = pick(translation, language);
      if (!isPick(chosen)) return chosen;
      const ref = dailyBreadReference(day);
      const got = await readAny(env, chosen.choice, ref);
      if (!isAny(got)) return chosen.choice.kind === 'kjv' ? unavailable('the stored Bible text', DOORS.daily) : fail(got.message, { reason: got.reason, try_instead: ['daily_bread without translation (the King James Version)'] });
      const p = { ref: got.own_ref ?? got.ref, text: got.text };
      const shared = 'Everyone on The Living Bread receives this same verse on this morning, so a person who reads it is reading with the whole family.';
      return ok(paragraph([`The Daily Bread for ${day} is ${p.ref}: "${p.text}"`, shared, `Today's bread, with a reflection and a prayer, is at ${DOORS.daily}`]), {
        date: day, ref: p.ref, text: p.text, translation: got.translation, translation_name: got.translation_name, page: DOORS.daily, door: got.door, shared, content_layers: layers({ scripture: ['text'], navigation: ['shared', 'page'] }),
      });
    },
  );

  // 4. ask_living_bread ------------------------------------------------------
  tool(server, 
    'ask_living_bread',
    {
      title: 'Ask The Living Bread',
      description:
        'Answer one free-form question about Christianity in a single call by querying the Christian Knowledge API live: a short grounded summary, the sourced entities it matched (denominations, saints, sacred sites, biblical figures, Bible places, churches), a Scripture topic with up to 3 KJV verses, and next-step links. One question per call; split compound questions. Use for open questions with no obvious single tool ("what is a Methodist", "who was Augustine", "how do I forgive my brother"). Prefer a specific tool when one fits: heritage_lookup for one named entity, find_churches_near for churches by place, verses_for for a feeling. Use search instead only when you need a list of ids to fetch. answer is null and entities empty when nothing sourced matches. The question text (no user id) is logged anonymously.',
      inputSchema: { question: z.string().min(2).max(300).describe('The question in the person\'s own words, 2 to 300 characters: "what is a Methodist", "are there churches in Kenya".') },
      outputSchema: out({
        question: z.string().describe('The question as understood.'),
        entities: z.array(z.looseObject({ id: z.string(), type: z.string(), name: z.string(), url: z.string(), source: z.string().nullable().optional() })).describe('Sourced entities matched: lb: id, type, name, page URL, and data source.'),
        answer: z.string().nullable().describe('A short grounded summary from the Knowledge API, or null when it has none.'),
        scripture: z.looseObject({ topic: z.string(), url: z.string(), verses: z.array(z.looseObject({ ref: z.string(), text: z.string() })) }).nullable().describe('The Scripture topic the question matched, with up to 3 verbatim KJV verses; null when none.'),
        road_to_christ: z.array(z.looseObject({ name: z.string(), url: z.string() })).describe('Pages that explain who Jesus is, related to the question.'),
        next_steps: z.array(z.looseObject({ label: z.string(), url: z.string() })).describe('Suggested next links (find a church, prayer, etc.).'),
        grounding: z.string().describe('Statement of what the answer is grounded in.'),
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
    lat: z.number().min(-90).max(90).optional().describe('Latitude in decimal degrees, only if the person shared their location. Must be paired with lng; coordinates win over city.'),
    lng: z.number().min(-180).max(180).optional().describe('Longitude in decimal degrees, paired with lat.'),
    city: z.string().max(120).optional().describe('A city, region or country, used when there are no coordinates: "Dallas", "Lagos", "Greater London". Geocoded to its centre.'),
  };
  tool(server, 
    'find_churches_near',
    {
      title: 'Find churches near a place',
      description:
        'List real church buildings and congregations within 250 km of a place, nearest first, merged live from churches on The Living Bread and an open worldwide directory of about 120,000 churches. Use when someone wants a church to attend ("Baptist churches in Dallas", "a parish near Manchester"). Not for one known church\'s record (church), for events or services at a time (find_gatherings_near, gatherings_tonight), or for small groups to join (communities_to_join). Needs lat+lng or city, else an error. Location precision is city level: names, city and distance only, never street addresses or contacts. Zero results return count 0 with the nearest church held, if any. The search words (no user id) are logged anonymously.',
      inputSchema: {
        ...placeInput,
        denomination: z.string().max(60).optional().describe('Optional tradition filter, one lowercase word: "baptist", "catholic", "methodist", "pentecostal", "orthodox", "anglican".'),
        limit: z.number().int().min(1).max(20).default(8).describe('Maximum churches to return, 1 to 20 (default 8).'),
      },
      outputSchema: out({
        searched: z.string().describe('The place searched, as resolved.'),
        count: z.number().describe('Number of churches returned; 0 when none is held within 250 km.'),
        churches: z.array(z.looseObject({ name: z.string(), where: z.string(), distance_km: z.number().nullable(), denomination: z.string().nullable(), on_living_bread: z.boolean(), url: z.string().nullable(), id: z.string() })).describe('Nearest first: name, city-level place, distance in km, denomination when known, whether the church is on The Living Bread, its open-data page, and an id (lb:church:<country>/<slug> ids work with church and fetch).'),
        honest: z.string().optional().describe('Present when count is 0: what the empty result means.'),
        nearest_we_hold: z.string().nullable().optional().describe('When count is 0, the nearest church held beyond 250 km, if any.'),
        find_a_church: z.string().describe('Link to the live church finder map.'),
        gatherings: z.string().describe('Link to upcoming gatherings.'),
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
        'Read the full open-data record of one directory church you already have an id for (lb:church:<country>/<slug>), live from the Christian Knowledge API: name, denomination, country, website, sameAs links, provenance, and the details the church verified itself when it has. Use after find_churches_near, search or ask_living_bread returned an lb:church id. Not for finding churches by place (find_churches_near); for any other lb: URN use kingdom_protocol_lookup. An unknown country/slug returns a not_found error pointing to find_churches_near.',
      inputSchema: {
        country: z.string().min(2).max(80).describe('Country slug (the part after "lb:church:" and before "/"): "united-states", "colombia". A plain country name is slugified.'),
        slug: z.string().min(1).max(160).describe('Church slug (the part after "/"), e.g. "iglesia-la-capuchina". A full lb:church:<country>/<slug> id is also accepted.'),
      },
      outputSchema: out({
        id: z.string().describe('Stable id, lb:church:<country>/<slug>.'),
        name: z.string().describe('Church name.'),
        url: z.string().describe('Open-data page for the church.'),
        denomination: z.string().nullable().optional().describe('Denomination when known.'),
        country: z.string().nullable().optional().describe('Country name.'),
        website: z.string().nullable().optional().describe('The church\'s own website, when known.'),
        verified: z.unknown().optional().describe('Details the church supplied and verified itself; absent when it has not.'),
        provenance: z.unknown().optional().describe('Where each part of the record came from (e.g. OpenStreetMap, Wikidata).'),
      }),
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
        'Search upcoming Christian gatherings (services, prayer nights, Bible studies, worship nights, meals, recovery groups) posted on The Living Bread, within 250 km of a place or online, over a window of 1 to 60 days, soonest first, with paging. The general gathering search: use it for custom windows, online-only ("an online service I can join") or first-visit friendly events. For the next few hours use gatherings_tonight; for a plain this-week list use events_this_week; for church buildings use find_churches_near. days counts forward from now; online true lists only online gatherings and ignores distance; a cursor is valid only with the same city, online and days. Times are UTC: convert before telling the person. Listed times are what hosts posted, not confirmation it is happening. Empty results return count 0 and suggest online gatherings. The place words (no user id) are logged anonymously.',
      inputSchema: {
        ...placeInput,
        days: z.number().int().min(1).max(60).default(14).describe('How many days ahead to look, 1 to 60 (default 14).'),
        online: z.boolean().optional().describe('true: only gatherings joinable online from anywhere. Omit to include in-person and online.'),
        limit: z.number().int().min(1).max(20).default(8).describe('Page size, 1 to 20 (default 8).'),
        cursor: cursorInput,
      },
      outputSchema: out({
        searched: z.string().describe('The place searched, as resolved, or "online".'),
        count: z.number().describe('Gatherings on this page; 0 when none.'),
        gatherings: z.array(z.looseObject({ id: z.string(), title: z.string(), when_utc: z.string(), where: z.string(), distance_km: z.number().nullable(), kind: z.string().nullable(), online: z.boolean(), good_for_a_first_visit: z.boolean().nullable() })).describe('Soonest first: id (fetch with gathering:<id>), title, start in UTC, city-level place or "online", distance in km, category, online flag, and whether the host marked it good for a first visit.'),
        honest: z.string().optional().describe('Present when count is 0: what the empty result means and what to try.'),
        gatherings_page: z.string().describe('Link to every gathering on the web.'),
        next_cursor: z.string().nullable().optional().describe('Pass back as cursor for the next page; null when there is none.'),
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
        'List the ongoing groups on The Living Bread that anyone can discover and join (prayer groups, study groups, city and interest communities), each with its member count, join policy (open or by request) and next posted gathering, filtered by an optional word and paged. Use when someone wants a group to belong to ("is there a prayer group", "a Bible study community in Atlanta"). Not for one-off events (find_gatherings_near), church buildings (find_churches_near) or live rooms right now (tables_live_now). Private family rooms are never listed. query is split into words and a community matches if ANY word appears in its name, description, kind, city or country, so "prayer Atlanta" widens rather than narrows; no match returns count 0.',
      inputSchema: {
        query: z.string().max(120).optional().describe('Optional filter words matched against name, description, kind, city and country: "prayer", "study", "Atlanta". Omit to list all.'),
        limit: z.number().int().min(1).max(20).default(10).describe('Page size, 1 to 20 (default 10).'),
        cursor: cursorInput,
      },
      outputSchema: out({
        count: z.number().describe('Communities on this page; 0 when none matched.'),
        total: z.number().optional().describe('Total matching communities across all pages.'),
        communities: z.array(z.looseObject({ id: z.string(), name: z.string(), kind: z.string(), description: z.string().nullable(), where: z.string(), people: z.number(), join: z.string(), next_gathering: z.string().nullable(), verified: z.boolean() })).describe('Each community: id (fetch with community:<id>), name, kind, its own description, city or "everywhere", member count, how to join, next posted gathering (UTC) or null, and whether it is verified.'),
        join_here: z.string().describe('Link where communities are joined.'),
        next_cursor: z.string().nullable().optional().describe('Pass back as cursor for the next page; null when there is none.'),
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
        'Look up one named denomination, saint, sacred site, biblical figure or Bible place in the Christian Knowledge API (live) and return its sourced record: stable lb: id, page, sameAs links (Wikidata, Wikipedia), provenance, image, and related ids (a denomination\'s parent and branches; a biblical figure\'s family links where known). Use when the person names one specific entity ("Methodism", "Augustine of Hippo", "Bethlehem"). For two traditions side by side use denomination_compare; for who is remembered on a date use saint_of_the_day; for an open question use ask_living_bread. name is first tried as a slug ("augustine-of-hippo"), then resolved by meaning through the Knowledge API, so spelling variants usually work; kind must match the entity. No match returns a not_found error. The lookup words (no user id) are logged anonymously.',
      inputSchema: {
        kind: z.enum(['denomination', 'saint', 'sacred-site', 'biblical-figure', 'bible-place']).describe('Which kind of entity: denomination, saint, sacred-site, biblical-figure or bible-place.'),
        name: z.string().min(2).max(120).describe('The entity\'s name or slug: "Methodism", "augustine-of-hippo", "Bethlehem".'),
      },
      outputSchema: out({
        id: z.string().describe('Stable id, e.g. lb:denomination:methodism.'),
        type: z.string().describe('Entity type.'),
        name: z.string().describe('Display name.'),
        url: z.string().describe('Sourced web page for the entity.'),
        sameAs: z.array(z.string()).optional().describe('Equivalent pages elsewhere (Wikidata, Wikipedia).'),
        provenance: z.unknown().optional().describe('Where the record came from.'),
        image: z.string().nullable().optional().describe('Image URL when held.'),
        children: z.array(z.string()).optional().describe('Related lb: ids (for a denomination, its branches).'),
        parent: z.unknown().optional().describe('For a denomination, the tradition it grew from.'),
      }),
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
        'Return the link and step-by-step explanation the person needs to pray for someone by name on The Living Bread themselves: recording a voice prayer or writing one in the app, which the other person is notified of and can answer; or, for someone not on the app, a private link they can open without an account. This tool sends nothing and records nothing; the person acts in the app. name only personalises the returned sentences and is not looked up. Use when someone asks how to pray for a friend or send a prayer. For a ready-made prayer text use a_prayer_for; to listen to others praying use hear_the_kingdom_pray. On the signed-in /me endpoint a tool with this same name sends the believer\'s own written prayer instead.',
      inputSchema: { name: z.string().max(80).optional().describe('First name of the person to be prayed for, used only to personalise the explanation. Optional.') },
      outputSchema: out({
        for: z.string().nullable().describe('The name given, or null.'),
        link: z.string().describe('Deep link to the voice prayer screen (opens the app or web).'),
        what_happens: z.string().describe('Plain explanation of what the person does and what the other person receives.'),
        recording: z.string().describe('What recording currently supports, stated honestly.'),
        app_store: z.string().describe('iOS App Store link.'),
        play_store: z.string().describe('Google Play link.'),
        not_on_living_bread_yet: z.string().describe('How to reach someone without an account, by private link.'),
        scripture_ref: z.string().describe('A reference (not text) for the verse this screen opens with; read it with scripture_passage.'),
      }),
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
        'Return the link to the room where recorded voice prayers from believers of many nations play one after another over the whole Living Bread family, with what the person will hear and how a member can add one voice prayer a day there. Use when someone wants to hear others pray or feels alone in prayer. This tool plays and records nothing; the audio is heard by opening the link. For prayers left at a specific place use prayers_left_near; to pray for one named person use pray_for_someone.',
      inputSchema: {},
      outputSchema: out({
        link: z.string().describe('Link to the Kingdom praying room.'),
        what_it_is: z.string().describe('What the person hears there.'),
        how_to_add_your_voice: z.string().describe('How a member adds a voice prayer (one a day) and what recording supports.'),
        scripture_ref: z.string().describe('A reference (not text) for the verse the room opens with.'),
      }),
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
        'Explain what The Living Bread is and how to join it: a short invitation, the web, App Store and Google Play links, and the first steps a newcomer sees. Use when someone asks what The Living Bread is or how to sign up. Not for explaining the Christian faith itself (the_gospel) or a personalised path for someone new to faith (journey_next_steps with new_to_christianity). Static content; creates no account (joining happens at the links, and is free).',
      inputSchema: {},
      outputSchema: out({
        invitation: z.string().describe('A short invitation in the house\'s words.'),
        web: z.string().describe('Web home link.'),
        app_store: z.string().describe('iOS App Store link.'),
        play_store: z.string().describe('Google Play link.'),
        first_steps: z.array(z.string()).describe('What a newcomer meets first, in order.'),
        who_is_jesus: z.string().describe('Link to the page on who Jesus is.'),
        free: z.boolean().describe('Always true: joining costs nothing.'),
      }),
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
      description:
        'Search everything The Living Bread holds with one query and get back a flat list of short results with ids, for the search-then-fetch pattern of connector clients (ChatGPT deep research and similar): a Bible reference, a matching need\'s verse set, sourced entities, churches and gatherings within 250 km when the query is a place, and communities whose name or description contains a query word. query is tried in order as a Bible reference, a need, an entity question, a place (only when it is not a reference or need), and community words. Then call fetch with an id to read it in full. When you want a direct answer rather than a list, use ask_living_bread; for verses by wording use scripture_search. Never empty: with no match it returns one result linking to the home page. The query (no user id) is logged anonymously.',
      inputSchema: { query: z.string().min(1).max(300).describe('Free text, 1 to 300 characters: a reference ("Psalm 23"), a need ("anxiety"), a name ("Augustine"), a place ("Lagos"), or a topic.') },
      outputSchema: out({
        results: z.array(z.looseObject({ id: z.string(), title: z.string(), text: z.string(), url: z.string() })).describe('Matches with id (verse:<ref>, need:<slug>, church:<uuid>, gathering:<uuid>, community:<uuid>, or an lb: id), title, one-line text and a web URL. Pass id to fetch.'),
      }),
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
      description:
        'Read one item in full by an id returned by search: a verse (KJV text), a need (its verse set), a church, a gathering (with whether it has already passed), a community, or an lb: denomination, saint, sacred site, biblical figure, Bible place or directory church. The prefix before the first colon picks the source, so pass ids unchanged. Use only with ids from search or other tools. For lb: URNs of gatherings, ministries, needs, testimonies or profiles use kingdom_protocol_lookup. An id that cannot be resolved returns a normal result whose metadata.unresolved holds the id, not an error.',
      inputSchema: { id: z.string().min(1).max(200).describe('An id exactly as returned: verse:<ref>, need:<slug>, church:<uuid>, gathering:<uuid>, community:<uuid>, or lb:<kind>:<slug> (e.g. lb:denomination:methodism, lb:church:colombia/iglesia-la-capuchina).') },
      outputSchema: out({
        id: z.string().describe('The id requested.'),
        title: z.string().describe('Item title.'),
        text: z.string().describe('The item in full as plain text (Scripture verbatim).'),
        url: z.string().describe('Web page for the item.'),
        metadata: z.record(z.string(), z.unknown()).optional().describe('Kind-specific facts (translation, verses, when_utc, has_passed, join_policy, sameAs) plus attribution; unresolved when the id was not found.'),
      }),
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
