/* ============================================================
   THE LIVING BREAD MCP, the lean public set (docs/MCP_LEAN_PUBLIC.md).

   The public directory endpoint /mcp lists 13 tools under one naming
   pattern. Each one takes a `mode` and dispatches to the SAME registered
   implementation the named tool uses on /me and /app: the named tools are
   registered as always, but through a capturing server that keeps their
   (already wrapped) callbacks instead of listing them. A lean call then
   validates its arguments against the named tool's own input schema and
   calls that callback. No logic is duplicated; one implementation per
   capability.

   The mode table lives in src/data/lean-map.json so the tests and the
   evaluation read the same map the server dispatches by.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import leanMap from './data/lean-map.json';
import { fail, out, type Hints, type Structured } from './shared';

/* ---- the map -------------------------------------------------------------------------------------- */
export interface ModeSpec { tool: string; rename?: Record<string, string>; fixed?: Record<string, unknown>; alias?: boolean }
export interface LeanEntry { mode_param?: boolean; default_mode?: string; modes: Record<string, ModeSpec> }
export const LEAN_TOOLS = (leanMap as { tools: Record<string, LeanEntry> }).tools;
export const LEAN_NAMES: string[] = Object.keys(LEAN_TOOLS);

/** Every named public tool, to the lean tool and mode that answers for it (aliases excluded). */
export const NAMED_TO_LEAN: Record<string, { tool: string; mode: string | null }> = (() => {
  const m: Record<string, { tool: string; mode: string | null }> = {};
  for (const [lean, e] of Object.entries(LEAN_TOOLS)) {
    for (const [mode, s] of Object.entries(e.modes)) {
      if (s.alias) continue;
      m[s.tool] = { tool: lean, mode: e.mode_param === false ? null : mode };
    }
  }
  return m;
})();

/** How a named tool is spoken of on /mcp: "read_scripture (mode passage)". */
export function leanName(named: string): string | null {
  const hit = NAMED_TO_LEAN[named];
  if (!hit) return null;
  const e = LEAN_TOOLS[hit.tool];
  return hit.mode === null || hit.mode === e.default_mode ? hit.tool : `${hit.tool} (mode ${hit.mode})`;
}

/* Named tool names that contain an underscore are unambiguous identifiers; single words (church,
   begin, hymn, search) are ordinary English and are never rewritten. Nothing inside a URL is touched,
   and Scripture never contains an underscore, so the stored text is never altered. */
const REWRITE = Object.keys(NAMED_TO_LEAN).filter((n) => n.includes('_') && leanName(n) !== n).sort((a, b) => b.length - a.length);
const REWRITE_RE = REWRITE.length ? new RegExp(`(?<![\\w/=?&#.:-])(${REWRITE.join('|')})(?![\\w-])`, 'g') : null;

/** Rewrite references to named public tools into their lean form, outside URLs. */
export function leanText(s: string): string {
  if (!REWRITE_RE || !s.includes('_')) return s;
  return s.split(/(https?:\/\/[^\s"'<>)]+)/g).map((part, i) => (i % 2 === 1 ? part : part.replace(REWRITE_RE, (n) => leanName(n) ?? n))).join('');
}

function leanDeep(v: unknown, depth = 0): unknown {
  if (depth > 8) return v;
  if (typeof v === 'string') return leanText(v);
  if (Array.isArray(v)) return v.map((x) => leanDeep(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Structured).map(([k, x]) => [k, leanDeep(x, depth + 1)]));
  return v;
}

/* ---- capturing the named tools ------------------------------------------------------------------- */
type Callback = (...args: unknown[]) => Promise<AnyResult> | AnyResult;
type AnyResult = { content?: { type: string; text?: string }[]; structuredContent?: Structured; isError?: boolean; _meta?: Record<string, unknown> };
export interface Captured { name: string; config: { title?: string; description?: string; inputSchema?: unknown; annotations?: Record<string, unknown> }; cb: Callback }

const STUB = { enabled: true, enable() {}, disable() {}, remove() {}, update() {} };

/**
 * A server that keeps every tool registered through it (the named public set, each already wrapped by
 * `tool()`) instead of listing it, and passes prompts and resources through with their text in lean form.
 */
export function capturing(server: McpServer): { proxy: McpServer; captured: Map<string, Captured> } {
  const captured = new Map<string, Captured>();
  const proxy = new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === 'registerTool') {
        return (name: string, config: Captured['config'], cb: Callback) => {
          captured.set(name, { name, config, cb });
          return STUB;
        };
      }
      if (prop === 'registerPrompt') {
        return (name: string, config: { description?: string }, cb: (...a: unknown[]) => unknown) => {
          const cfg = { ...config, description: config.description ? leanText(config.description) : config.description };
          const wrapped = async (...a: unknown[]) => leanDeep(await cb(...a));
          return (target.registerPrompt as unknown as (...r: unknown[]) => unknown).call(target, name, cfg, wrapped);
        };
      }
      if (prop === 'registerResource') {
        return (name: string, uri: unknown, meta: { description?: string }, ...rest: unknown[]) => {
          const m = meta && typeof meta === 'object' ? { ...meta, description: meta.description ? leanText(meta.description) : meta.description } : meta;
          return (target.registerResource as unknown as (...r: unknown[]) => unknown).call(target, name, uri, m, ...rest);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as McpServer;
  return { proxy, captured };
}

/* ---- the lean definitions ------------------------------------------------------------------------- */
const ACCESS = 'Access: no sign-in; shared limit of 300 requests a minute per IP.';
const IGNORED = 'Parameters a mode does not use are ignored and named in ignored_params.';

const lat = z.number().min(-90).max(90).optional().describe('Latitude in decimal degrees, only if the person shared their location; pair with lng. Coordinates win over city.');
const lng = z.number().min(-180).max(180).optional().describe('Longitude in decimal degrees, paired with lat.');
const translation = z.string().min(2).max(24).optional().describe('A stored translation id from read_scripture mode translations, e.g. "bsb", "web", "dra", "rv1909", "cuv". Default: the King James Version, or the best stored Bible for language.');
const language = z.string().min(2).max(16).optional().describe('The person\'s BCP-47 language, e.g. "es", "pt-BR", "sw". Picks the best stored public domain or freely licensed Bible for it; translation wins over it.');
const cursor = z.string().max(200).optional().describe('Opaque paging token: next_cursor from the previous answer of the same call. Omit for the first page.');

export interface LeanDef { title: string; description: string; params: z.ZodRawShape; output: z.ZodRawShape }

export const LEAN_DEFS: Record<string, LeanDef> = {
  get_crisis_help: {
    title: 'Get crisis help: the real emergency number and crisis line for a country',
    description: [
      'PURPOSE: Give the real emergency number and crisis hotlines (suicide or crisis line, text line, domestic violence, child help) for one country, from the verified dataset The Living Bread ships for 53 countries, with its source and the date it was checked.',
      'WHEN TO USE: FIRST, before any other tool, whenever a person speaks of harming themselves or someone else, or is in danger ("I want to die", "my friend is suicidal", "he hits me").',
      'WHEN NOT: for loneliness or a wish to talk with no danger, use find_people_to_pray_with (mode a_person_now); for comfort from the Word afterwards, find_scripture_for. Never give a verse in place of a phone number.',
      'PARAMETERS: country is the person\'s country as a name or ISO 3166-1 alpha-2 code ("Nigeria", "GB", "USA"). If you do not know it, ask; this tool never defaults to one country\'s number. Omit it only to get the list of countries held.',
      'OUTPUT: country {code, name} or null; emergency numbers; crisis_line, text_line, domestic_violence and child_help (each name and number, or null); source, verified_at, confidence; rule (how to use the answer); door (the app\'s crisis page); countries_held when no country matched.',
      'BEHAVIOR: read only; a static dataset, no network call. Matching is strict (ISO code, exact name, known alias, or an unambiguous name start of four letters or more) because a wrong line is worse than none. An unheld country returns country null with the general emergency rule (112, 911, 999) and the countries held, never a guessed number.',
    ].join(' '),
    params: { country: z.string().max(60).optional().describe('The person\'s country: name or ISO 3166-1 alpha-2 code ("Nigeria", "GB", "Brazil", "USA"). Omit only to list the countries held.') },
    output: {},
  },

  read_scripture: {
    title: 'Read Scripture word for word from a stored text',
    description: [
      'PURPOSE: Read the Bible word for word from a stored text, never from memory: a passage by reference, a verse in its context, every verse containing given words, one verse side by side in several translations, the Hebrew or Greek words behind a verse, the passages readers link to it, a check of whether quoted words are real Scripture, or the list of stored translations. The default text is the King James Version the app ships; about sixty stored public domain or freely licensed Bibles, with the Hebrew and Greek, are read by translation or language.',
      'WHEN TO USE: whenever you will quote or examine Scripture and know the reference or the words, or need to check a quotation before repeating it.',
      'WHEN NOT: verses for a feeling or need, a topic, the words of Jesus on a theme, or the verse of the day: find_scripture_for. A parable, doctrine or the gospel explained: learn_the_faith.',
      'MODES (required parameters in brackets): passage [reference] one verse, a range inside one chapter, or a whole chapter. context [reference] the passage with the verses around it (around, default 2). search [query] verses containing all the words, or an exact phrase in double quotes, a page at a time (book, testament, whole_words, limit, cursor, parallel). compare [reference] one verse in up to six translations side by side (translations, include_original). original_words [reference] each Hebrew or Greek word with its Strong\'s number, lexicon entry, parsing and the KJV words it became (strong keeps one number, e.g. "G25"). cross_references [reference] linked passages from OpenBible.info with votes (limit, include_text). verify [quote] checks the words against every held translation (reference optional). translations [none] every stored translation with language, canon and license (language filters; include_license_text).',
      'PARAMETERS: translation and language apply to passage, context, search and cross_references; compare takes a list in translations. Ranges across chapters are not supported.',
      'OUTPUT: mode, answered_by (the implementation used) and that mode\'s fields: passage gives ref, text, verses [{verse, text}], translation, translation_name, source, read_more; context gives passage, before and after; search gives total_matches, results and next_cursor; compare gives rows per translation; original_words gives verses[].words with strong, lemma, definition and morph; cross_references gives references with votes; verify gives verdict (verbatim, close_but_differs with a word diff, or not_found), best_match with SHA-256 hashes; translations gives the list. Every Scripture answer carries evidence (translation, license, corpus version, SHA-256 per passage) and content_layers.',
      `BEHAVIOR: read only and deterministic; the texts are bundled, no network call. An unparseable reference, an unknown translation, or a book a translation does not hold returns an error with try_instead; a search with no match returns count 0 and result_state empty. ${IGNORED}`,
    ].join(' '),
    params: {
      reference: z.string().min(2).max(80).optional().describe('Book, chapter and optional verse or range as a reader writes it: "John 3:16", "Psalm 23", "1 Cor 13:4-7". Required for passage, context, compare, original_words and cross_references; optional for verify (the reference the words are attributed to).'),
      query: z.string().min(2).max(80).optional().describe('For search: words that must all appear ("mercy truth"), or an exact phrase in double quotes. Case-insensitive.'),
      quote: z.string().min(3).max(2000).optional().describe('For verify: the exact words to check, as they would be quoted.'),
      translation,
      language,
      translations: z.array(z.string().min(2).max(24)).min(1).max(6).optional().describe('For compare: up to six translation ids, e.g. ["kjv","bsb","dra","rv1909"].'),
      around: z.number().int().min(0).max(10).optional().describe('For context: verses to read on each side (default 2).'),
      book: z.string().max(40).optional().describe('For search: one book to search, e.g. "Psalms", "1 Cor".'),
      testament: z.enum(['old', 'new']).optional().describe('For search: "old" or "new" to search one testament.'),
      whole_words: z.boolean().optional().describe('For search: true (default) matches whole words only; false matches inside words.'),
      parallel: z.string().min(2).max(24).optional().describe('For search: a translation id read beside each verse found, e.g. "kjv".'),
      limit: z.number().int().min(1).max(20).optional().describe('For search (page size, default 10, max 20) and cross_references (default 6, max 12).'),
      cursor,
      include_text: z.boolean().optional().describe('For cross_references: true (default) reads each linked passage; false returns references and votes only.'),
      include_original: z.boolean().optional().describe('For compare: true (default) adds the Hebrew or Greek line.'),
      strong: z.string().max(8).optional().describe('For original_words: keep only the words with this Strong\'s number, e.g. "G25" or "H1254".'),
      include_license_text: z.boolean().optional().describe('For translations: true returns each license statement in full.'),
    },
    output: {},
  },

  find_scripture_for: {
    title: 'Find Scripture for a need, a topic, the words of Jesus, or today',
    description: [
      'PURPOSE: Find the verses that speak to something, read verbatim from the stored text: the hand-picked set for a need or feeling, the house\'s page on what the Bible says about a topic, what Jesus Himself said about a theme, or the Daily Bread verse every member receives on a date.',
      'WHEN TO USE: the person names a feeling, a situation or a topic, or asks for today\'s verse, without a reference.',
      'WHEN NOT: a known reference, exact wording, translations side by side, or checking a quote: read_scripture. A ready-written prayer, a parable, a doctrine or a hard season page: learn_the_faith. Danger to life: get_crisis_help first.',
      'MODES (required parameters in brackets): need [subject] matches the person\'s own words to one of 99 needs ("I am scared about surgery" finds fear) and returns up to limit verses (default 5, max 12), each with a one-line why in the house\'s words; translation or language read them from another stored Bible. topic [subject] the house\'s page on one of about 300 topics (shame, money, anger) with its key verses. words_of_jesus [subject] the page on what Jesus said about one theme (love, forgiveness, worry). daily_bread [none] the one verse of a date (date YYYY-MM-DD in the person\'s own time zone, default today in UTC); translation or language apply.',
      'OUTPUT: mode, answered_by, and: need gives need, label, matched, verses [{ref, text, why}], page, pray_with_the_family; topic and words_of_jesus give matched (page path or null), title, url, body (the house\'s words), verses [{ref, text}], related, and suggestions when nothing matched; daily_bread gives date, ref, text, translation, page. evidence and content_layers keep Scripture apart from the house\'s words.',
      `BEHAVIOR: read only. need and daily_bread read bundled data; topic and words_of_jesus fetch the page from living-bread.org at call time and re-read its verses from the stored KJV. No matching need returns an error listing the needs held; no matching page returns matched null with suggestions. The need text (never a user id) is logged anonymously. ${IGNORED}`,
    ].join(' '),
    params: {
      subject: z.string().min(1).max(200).optional().describe('The need, feeling or topic in the person\'s own words: "I am anxious", "my mother died", "shame", "forgiveness". Required for need, topic and words_of_jesus.'),
      limit: z.number().int().min(1).max(12).optional().describe('For need: maximum verses, 1 to 12 (default 5).'),
      date: z.string().optional().describe('For daily_bread: the calendar day as YYYY-MM-DD in the person\'s own time zone. Omit for today (UTC).'),
      translation,
      language,
    },
    output: {},
  },

  learn_the_faith: {
    title: 'Learn the faith from the house\'s own pages',
    description: [
      'PURPOSE: Read what The Living Bread wrote about the Christian faith, quoted not rewritten: the gospel in four steps, a doctrine, a parable or miracle of Jesus, a hymn and its story, a biblical name\'s meaning, a sourced saint, denomination, sacred site, biblical figure or Bible place, the saints of a date, two traditions side by side, a respectful page for someone from another faith or none, a page for a hard season of life, or a ready-written prayer.',
      'WHEN TO USE: "what is the gospel", "what is grace", "explain the prodigal son", "the story of Amazing Grace", "what does Elijah mean", "who was Augustine", "who is remembered on October 4", "Baptists and Methodists", "I grew up Muslim", "I just lost my dad", "a prayer before surgery".',
      'WHEN NOT: verses for a need or topic: find_scripture_for. The Bible text itself: read_scripture. A free question that fits no mode: search (mode answer). A real church or group: find_churches or find_communities.',
      'MODES (required parameters in brackets): gospel [none]. belief [subject, a doctrine such as "grace" or "the Trinity"]. parable [subject, "prodigal son"]. miracle [subject, "raising Lazarus"]. hymn [subject, a title or a line]. name_meaning [subject, one name]. saint [subject, a saint\'s name] the sourced record. saint_of_the_day [none] the saints remembered on date ("October 4" or YYYY-MM-DD; default today in UTC). heritage [kind, subject] one denomination, saint, sacred-site, biblical-figure or bible-place. compare_traditions [subject, compare_with] two denominations. other_faiths [subject, the person\'s background in their words: "Muslim", "grew up Hindu", "nothing really"]. hard_season [subject, the moment: "grief", "church hurt"]. a_prayer_for [subject, the situation].',
      'OUTPUT: mode, answered_by, and: the page modes (belief, parable, miracle, hymn, name_meaning, hard_season, a_prayer_for, other_faiths, saint_of_the_day) give matched (page path or null), title, url, body in the house\'s words, verses [{ref, text}] read verbatim from the stored KJV, related, suggestions when unmatched, hub and door; gospel gives confession, steps [{heading, words, ref, text}], who_is_jesus and doors; heritage and saint give id (an lb: URN), name, url, sameAs and provenance; compare_traditions gives a, b, shared_root and posture.',
      `BEHAVIOR: read only. Page modes fetch living-bread.org at call time; heritage, saint and compare_traditions read the Christian Knowledge API live; gospel is fixed text with its verses read from the stored KJV. Matching is by slug, then by words; a weak match sets exact false; nothing held returns matched null with suggestions, or a not_found error for heritage and saint. content_layers marks the house\'s words as interpretation, never Scripture. ${IGNORED}`,
    ].join(' '),
    params: {
      subject: z.string().min(1).max(120).optional().describe('The one thing asked about, in plain words: a doctrine, parable, miracle, hymn, name, saint, denomination, background, life moment or situation. Required for every mode except gospel and saint_of_the_day.'),
      kind: z.enum(['denomination', 'saint', 'sacred-site', 'biblical-figure', 'bible-place']).optional().describe('For heritage: which kind of entity subject names.'),
      compare_with: z.string().min(2).max(80).optional().describe('For compare_traditions: the second denomination, e.g. "Eastern Orthodox Church".'),
      date: z.string().optional().describe('For saint_of_the_day: "October 4", "4 Oct" or YYYY-MM-DD; the year is ignored. Omit for today (UTC).'),
    },
    output: {},
  },

  find_churches: {
    title: 'Find real churches near a place, or one church by id',
    description: [
      'PURPOSE: Find real churches near a place, nearest first, merged live from churches on The Living Bread and an open worldwide directory of about 120,000 churches; or read one directory church\'s open data record by its id.',
      'WHEN TO USE: "a Baptist church in Dallas", "a parish near Manchester", or after another answer returned an lb:church id.',
      'WHEN NOT: services or events at a time: find_gatherings. Groups to join or student communities: find_communities. What a tradition is: learn_the_faith (mode heritage).',
      'MODES (required parameters in brackets): near [lat and lng, or city] churches within 250 km (denomination filters by one lowercase word such as "baptist" or "catholic"; limit 1 to 20, default 8). by_id [id, or country and slug] one church: pass the whole lb:church:<country>/<slug> as id, or its two parts.',
      'OUTPUT: mode, answered_by, and: near gives searched, count, churches [{id, name, where, distance_km, denomination, on_living_bread, url}], find_a_church and gatherings links, plus honest and nearest_we_hold when count is 0; by_id gives id, name, url, denomination, country, website, verified and provenance.',
      `BEHAVIOR: read only; reads the live directory and geocodes the city. City level by design: names, city and distance, never street addresses or contacts. No church within 250 km returns count 0 with an honest sentence and the nearest one held, if any. An unknown id returns a not_found error. The search words (never a user id) are logged anonymously. ${IGNORED}`,
    ].join(' '),
    params: {
      city: z.string().max(120).optional().describe('For near: a city, region or country, used when there are no coordinates: "Dallas", "Lagos". Geocoded to its centre.'),
      lat, lng,
      denomination: z.string().max(60).optional().describe('For near: one lowercase tradition word: "baptist", "catholic", "methodist", "pentecostal", "orthodox", "anglican".'),
      limit: z.number().int().min(1).max(20).optional().describe('For near: maximum churches, 1 to 20 (default 8).'),
      id: z.string().min(3).max(240).optional().describe('For by_id: the full id, e.g. "lb:church:colombia/iglesia-la-capuchina".'),
      country: z.string().min(2).max(80).optional().describe('For by_id without id: the country slug, e.g. "colombia".'),
      slug: z.string().min(1).max(160).optional().describe('For by_id without id: the church slug, e.g. "iglesia-la-capuchina".'),
    },
    output: {},
  },

  find_gatherings: {
    title: 'Find upcoming gatherings: tonight, this week, or any window',
    description: [
      'PURPOSE: Find upcoming Christian gatherings posted on The Living Bread (services, prayer nights, Bible studies, worship nights, meals, recovery groups), soonest first.',
      'WHEN TO USE: "something on tonight in Atlanta", "church events this week near Austin", "an online service I can join".',
      'WHEN NOT: church buildings: find_churches. Ongoing groups: find_communities. A person to pray with now, or Tables open now: find_people_to_pray_with.',
      'MODES (required parameters in brackets): tonight [city] the next hours in one city, matched as text (hours 1 to 36, default 12; country disambiguates). this_week [none] the next seven days within 250 km of lat and lng or city, online gatherings included (limit up to 20, default 10). any [none] a custom window (days 1 to 60, default 14) near a place or anywhere; online true lists only online gatherings; paged with limit and cursor.',
      'OUTPUT: mode, answered_by, and count, gatherings [{id, title, when_utc, where, distance_km, kind, online, good_for_a_first_visit, freshness}], the door to every gathering, next_cursor for any, and honest when nothing is held.',
      `BEHAVIOR: read only; reads live data. Times are UTC and are what hosts posted: freshness is scheduled with available_now false, never a confirmation it is happening; convert to the person\'s time before telling them. None returns count 0 and suggests online gatherings. The place words (never a user id) are logged anonymously. ${IGNORED}`,
    ].join(' '),
    params: {
      city: z.string().max(120).optional().describe('A city: matched as text for tonight, geocoded for this_week and any. Required for tonight.'),
      country: z.string().max(80).optional().describe('For tonight: country name or ISO code to disambiguate the city.'),
      lat, lng,
      hours: z.number().int().min(1).max(36).optional().describe('For tonight: hours ahead, 1 to 36 (default 12).'),
      days: z.number().int().min(1).max(60).optional().describe('For any: days ahead, 1 to 60 (default 14).'),
      online: z.boolean().optional().describe('For any: true lists only gatherings joinable online from anywhere.'),
      limit: z.number().int().min(1).max(20).optional().describe('For this_week and any: maximum gatherings, 1 to 20.'),
      cursor,
    },
    output: {},
  },

  find_people_to_pray_with: {
    title: 'Find real people to pray with, now or by name',
    description: [
      'PURPOSE: Connect a person with real people who pray, honestly: how many believers keep the prayer watch right now and the page where a human answers, which hours of the watch are kept or uncovered, the door where believers pray for them by name, Tables open now, prayers left at places near them, the room where believers pray aloud over the family, and the door to pray for someone by name.',
      'WHEN TO USE: the person needs a human rather than information: "can someone pray with me", "is anyone there tonight", "I want someone to pray for my mother", "has anyone prayed near this hospital", "how can I keep a night hour".',
      'WHEN NOT: anyone in danger: get_crisis_help first, then this. Scripture: find_scripture_for or read_scripture. Scheduled public events: find_gatherings.',
      'MODES (required parameters in brackets): a_person_now [none] the live count keeping watch, the median time to a person, and the door (want: prayer, talk, know_jesus or hard_season picks the door; language says whether someone on watch uses it). the_watch [none] which of the next hours are kept and which are gaps (time_zone, hours 24 or 168). real_people_will_pray [none] the door where believers pray by name and how many prayed in 24 hours. live_tables [none] Tables open now; this public endpoint lists none and says so. prayers_near [lat and lng, or city] public prayers left within radius_km (default 5, max 50), nearest first. hear_the_kingdom_pray [none] the room of recorded prayers from many nations. pray_for_someone [none] the link and steps to pray for a person by name (name personalises it). ask_the_family [none] the door where a person with no account asks the family to pray for them once, and is asked how they are on day 3 and day 7; offer the link, never submit for them (language is echoed).',
      'OUTPUT: mode, answered_by, and: a_person_now gives keeping_watch_now, keeping_this_hour, said_available_now, languages, this_hour (kept or gap), time_to_a_person, door, doors and crisis_rule; the_watch gives kept, gaps, wheel [{utc, local, keepers}], gap_ranges, invitation and door; prayers_near gives count, prayers [{id, approx, place, kind, voice, words, scripture_ref, from, prayed_with, when, distance_km}] and totals; the door modes give the link, what happens there, and a scripture_ref (a reference only; read it with read_scripture).',
      `BEHAVIOR: read only. This tool never sends a request, contacts anyone or prays; asking is the person\'s own act at the door it returns. Counts only, never who keeps watch. Places are the centre of an approximate cell, never the exact spot. Never tell a person someone is available now unless freshness.available_now is true. Empty results say so plainly. ${IGNORED}`,
    ].join(' '),
    params: {
      want: z.enum(['prayer', 'talk', 'know_jesus', 'hard_season']).optional().describe('For a_person_now: what they want a person for; picks the door handed over.'),
      language: z.string().min(2).max(8).optional().describe('For a_person_now: an ISO language code, e.g. "es".'),
      time_zone: z.string().max(64).optional().describe('For the_watch: IANA time zone for local labels, e.g. "America/Los_Angeles". UTC when omitted.'),
      hours: z.number().int().optional().describe('For the_watch: 24 (the next day, default) or 168 (the week).'),
      city: z.string().max(120).optional().describe('For prayers_near: a city or region, geocoded to its centre.'),
      lat, lng,
      radius_km: z.number().min(0.1).max(50).optional().describe('For prayers_near: radius in km, 0.1 to 50 (default 5).'),
      limit: z.number().int().min(1).max(30).optional().describe('For prayers_near: maximum prayers, 1 to 30 (default 8).'),
      name: z.string().max(80).optional().describe('For pray_for_someone: the first name of the person to be prayed for; only personalises the answer.'),
    },
    output: {},
  },

  find_ways_to_serve: {
    title: 'Find ways to serve: open needs from verified partners',
    description: [
      'PURPOSE: Find open needs on The Living Bread Serve network, posted by verified partner ministries and Christian nonprofits: what is needed, urgency, approximate place, the partner, estimated cost, and whether it can be met in person, remotely or by funding.',
      'WHEN TO USE: "how can I help near Kigali", "a need I can fund", "volunteer from home".',
      'WHEN NOT: someone who needs prayer or a person to talk to: find_people_to_pray_with. Gatherings to attend: find_gatherings. Committing to a need is a signed-in act on /me (offer_to_serve).',
      'MODES (required parameters in brackets): near [none] nearest first within 250 km of lat and lng or city, or by country, or the whole network when no place is given (limit 1 to 20, default 8). public_needs [none] needs that ask for people, filtered by city or country name, remote_only true for needs met from anywhere.',
      'OUTPUT: mode, answered_by, and searched, count, needs [{id, title, description, category, urgency, where, distance_km, partner, ways, estimated_cost, pilot, door}], honest when empty, and the door to Serve.',
      `BEHAVIOR: read only; reads live data. Places are approximate (city, region, country), never a home address. When none is near, near returns count 0 with up to 5 remote or fundable needs instead. ${IGNORED}`,
    ].join(' '),
    params: {
      city: z.string().max(120).optional().describe('A city: geocoded for near, matched by name for public_needs.'),
      country: z.string().max(80).optional().describe('A country name (or ISO code for public_needs): "Rwanda", "Kenya".'),
      lat, lng,
      remote_only: z.boolean().optional().describe('For public_needs: true lists only needs that can be met remotely.'),
      limit: z.number().int().min(1).max(20).optional().describe('For near: maximum needs, 1 to 20 (default 8).'),
    },
    output: {},
  },

  find_communities: {
    title: 'Find a community to belong to, or Christian life at a university',
    description: [
      'PURPOSE: Find ongoing Christian community to belong to: discoverable groups on The Living Bread (prayer groups, study groups, city and interest communities) with member counts, how to join and the next posted gathering; or the house\'s University Network page for a country, US state or city.',
      'WHEN TO USE: "is there a prayer group", "a Bible study community in Atlanta", "Christian community at universities in Kenya".',
      'WHEN NOT: church buildings: find_churches. One-off events: find_gatherings. A person to pray with now: find_people_to_pray_with.',
      'MODES (required parameters in brackets): to_join [none] communities, filtered by query words matched against name, description, kind, city and country (any word matches, so more words widen), paged with limit (1 to 20, default 10) and cursor. university [place] one country, US state or city.',
      'OUTPUT: mode, answered_by, and: to_join gives count, total, communities [{id, name, kind, description, where, people, join, next_gathering, rhythm, verified, freshness, handoff}], join_here and next_cursor; university gives matched (null when not held), title, url, summary, entries (up to 14 campus or region pages), suggestions and door.',
      `BEHAVIOR: read only. to_join reads live data and never lists private family rooms; university fetches living-bread.org at call time and returns page links, not a structured list of student groups. No match returns count 0, or matched null with the places held. ${IGNORED}`,
    ].join(' '),
    params: {
      query: z.string().max(120).optional().describe('For to_join: filter words, e.g. "prayer", "study", "Atlanta". Omit to list all.'),
      limit: z.number().int().min(1).max(20).optional().describe('For to_join: page size, 1 to 20 (default 10).'),
      cursor,
      place: z.string().min(2).max(80).optional().describe('For university: one country, US state or city by name: "Japan", "California", "Nairobi".'),
    },
    output: {},
  },

  see_the_kingdom: {
    title: 'See the Kingdom: believers by city, today, testimonies, worship',
    description: [
      'PURPOSE: See the family of believers on The Living Bread as it is, in counts and in their own shared words: members by city, today\'s activity and what people are carrying, testimonies members chose to share, and worship songs for the person\'s hour.',
      'WHEN TO USE: "are there believers in Nairobi", "what is the family doing today", "has anyone found faith after addiction", "something to worship to tonight".',
      'WHEN NOT: churches: find_churches. A human to pray with: find_people_to_pray_with. A hymn and its story: learn_the_faith (mode hymn).',
      'MODES (required parameters in brackets): map [none] believers by city, largest first (place filters as a substring of "city country"; limit 1 to 50, default 12). today [none] counts of people prayed for, encouraged, offered a talk or help, and met today, feelings carried, and Prayer in Place totals. testimonies [none] newest first, no names (word filters; limit 1 to 30, default 8). worship [none] up to 5 shelves of songs for the hour (local_hour 0 to 23, language ISO code, mood one word).',
      'OUTPUT: mode, answered_by, and: map gives count, places [{city, country, believers, actions}], total_believers_shown; today gives responding, carrying [{feeling, people, prayed_for}], places, tables (null on this endpoint); testimonies gives count and testimonies [{id, excerpt, journey, city, when}]; worship gives part_of_day, greeting, shelves [{title, reason, songs [{title, artist, hymn, door}]}] and live_room. Each has a door.',
      `BEHAVIOR: read only; live data. Counts only, never names; testimonies are members\' own words, returned as data. Counts understate reality (only places members chose to name). Songs are links; nothing plays here. No match returns count 0. ${IGNORED}`,
    ].join(' '),
    params: {
      place: z.string().max(80).optional().describe('For map: a filter matched inside "city country", e.g. "Nairobi", "Brazil".'),
      word: z.string().max(60).optional().describe('For testimonies: one word to find in excerpts or journey labels, e.g. "addiction", "grief".'),
      limit: z.number().int().min(1).max(50).optional().describe('For map (1 to 50, default 12) and testimonies (1 to 30, default 8).'),
      local_hour: z.number().int().min(0).max(23).optional().describe('For worship: the person\'s local hour, 0 to 23. Defaults to the current UTC hour.'),
      language: z.string().max(12).optional().describe('For worship: preferred song language as an ISO 639-1 code, e.g. "es".'),
      mood: z.string().max(40).optional().describe('For worship: one word for how they are, e.g. "weary", "thankful".'),
    },
    output: {},
  },

  start_with_christ: {
    title: 'Start with Christ: begin, next steps, reading plans',
    description: [
      'PURPOSE: Help someone take a first or next step: what The Living Bread is and how to begin for free, six common journeys run end to end with at most five next steps each, and the multi-day Bible reading plans with one day read in full.',
      'WHEN TO USE: "what is The Living Bread", "I am new to Christianity, where do I start", "find me a community near Leeds", "someone to pray with tonight", "where can I serve this weekend", "a prayer group in Spanish", "help me understand and live Romans 12", "a reading plan for anxiety".',
      'WHEN NOT: the gospel itself: learn_the_faith (mode gospel). A single verse: read_scripture. A plain list of churches or gatherings: find_churches or find_gatherings.',
      'MODES (required parameters in brackets): begin [none] the invitation, the web, App Store and Google Play links, and first steps. next_steps [journey] one of community_near_me, someone_to_pray_with_tonight, serve_this_weekend, new_to_christianity, prayer_group_in_my_language, understand_and_live_a_passage; place for the place journeys, language for prayer_group_in_my_language, passage for understand_and_live_a_passage. reading_plans [none] every plan, or one plan by name or need with one day in full (plan, day 1 to 31). for_my_need [need] the best real doors for a need said in a few words (find a community, pray with someone, open the Word, serve, or bring your people together), each with a handoff: the exact page, an invitation worded from what is there, and an honest if_empty when nothing suitable exists (place and language optional; online true prefers online options).',
      'OUTPUT: mode, answered_by, and: begin gives invitation, web, app_store, play_store, first_steps, who_is_jesus; next_steps gives results (at most 5, each with why and freshness), next_step {label, url}, and alternatives when nothing is held; for_my_need gives intent, experiences [{title, why, freshness, handoff}], handoff, if_empty, notes and next_tools; reading_plans gives plans and plan with its days and reading {ref, text read verbatim from the stored KJV, word, step}, or plan null.',
      `BEHAVIOR: read only; creates no account and tracks no progress. next_steps reads live data; begin and reading_plans are bundled. Give links exactly as returned. An unknown language returns an error with try_instead; nothing held returns honest alternatives. ${IGNORED}`,
    ].join(' '),
    params: {
      journey: z.enum(['community_near_me', 'someone_to_pray_with_tonight', 'serve_this_weekend', 'new_to_christianity', 'prayer_group_in_my_language', 'understand_and_live_a_passage']).optional().describe('For next_steps: which journey to run.'),
      place: z.string().max(120).optional().describe('For next_steps: city, region or country as the person says it ("Leeds", "Kenya"); never a street address.'),
      language: z.string().max(40).optional().describe('For next_steps prayer_group_in_my_language: a language name or ISO 639-1 code ("Spanish", "es").'),
      passage: z.string().max(80).optional().describe('For next_steps understand_and_live_a_passage: a reference, e.g. "Romans 12:1-2".'),
      plan: z.string().max(80).optional().describe('For reading_plans: a plan name or a need it serves ("Learn to Pray", "anxious", "grief"). Omit to list every plan.'),
      day: z.number().int().min(1).max(31).optional().describe('For reading_plans: which day to read in full (default 1).'),
      need: z.string().min(3).max(300).optional().describe('For for_my_need: what the person is looking for, in their words, 3 to 300 characters. Used only to choose and filter; never logged, never placed in a link.'),
      online: z.boolean().optional().describe('For for_my_need: true to prefer online options.'),
    },
    output: {},
  },

  search: {
    title: 'Search The Living Bread',
    description: [
      'PURPOSE: Search everything The Living Bread holds with one free-text query: a flat list of results with ids for search then fetch (mode results, the default, the ChatGPT connector contract), one grounded answer with sourced entities and up to 3 verses (mode answer), or one lb: URN resolved to its public object and JSON Schema (mode protocol).',
      'WHEN TO USE: a question no other tool fits, deep research that wants ids to fetch, or an lb: URN to resolve.',
      'WHEN NOT: a known reference or exact words: read_scripture. A feeling: find_scripture_for. Churches by place: find_churches. One named denomination or saint: learn_the_faith (mode heritage).',
      'MODES (required parameters in brackets): results [query] tried in order as a Bible reference, a need, an entity question, a place, and community words. answer [query, one question per call]. protocol [query, an lb: URN such as lb:ministry:hope-for-a-good-life].',
      'OUTPUT: mode, answered_by, and: results gives results [{id, title, text, url}], never empty (no match returns one result linking home); answer gives question, answer (null when nothing sourced), entities [{id, type, name, url, source}], scripture {topic, url, verses} or null, road_to_christ, next_steps and grounding; protocol gives found, protocol_kind, object, schema and source.',
      'BEHAVIOR: read only; queries the Christian Knowledge API live. answer stays null and entities empty rather than a guess. The query text (never a user id) is logged anonymously.',
    ].join(' '),
    params: {
      query: z.string().min(1).max(300).describe('Free text, 1 to 300 characters: a reference ("Psalm 23"), a need ("anxiety"), a name ("Augustine"), a place ("Lagos"), a question, or an lb: URN for mode protocol.'),
    },
    output: {},
  },

  fetch: {
    title: 'Fetch one search result in full',
    description: [
      'PURPOSE: Read one item in full by an id that search (or another tool) returned: a verse (KJV text), a need\'s verse set, a church, a gathering (with whether it has passed), a community, or an lb: denomination, saint, sacred site, biblical figure, Bible place or directory church.',
      'WHEN TO USE: right after search, with an id exactly as returned (the ChatGPT connector contract).',
      'WHEN NOT: other lb: URNs (gatherings, ministries, needs, testimonies, profiles): search (mode protocol). A reference you already know: read_scripture.',
      'PARAMETERS: id, passed unchanged: verse:<ref>, need:<slug>, church:<uuid>, gathering:<uuid>, community:<uuid>, or lb:<kind>:<slug>. The prefix before the first colon picks the source.',
      'OUTPUT: id, title, text (Scripture verbatim), url, and metadata (kind-specific facts plus attribution; unresolved holds the id when it was not found).',
      'BEHAVIOR: read only. An id that cannot be resolved returns a normal result with metadata.unresolved, not an error.',
    ].join(' '),
    params: { id: z.string().min(1).max(200).describe('An id exactly as returned: verse:<ref>, need:<slug>, church:<uuid>, gathering:<uuid>, community:<uuid>, or lb:<kind>:<slug> (e.g. lb:denomination:methodism).') },
    output: {
      id: z.string().describe('The id requested.'),
      title: z.string().describe('Item title.'),
      text: z.string().describe('The item in full as plain text (Scripture verbatim).'),
      url: z.string().describe('Web page for the item.'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Kind-specific facts plus attribution; unresolved when the id was not found.'),
    },
  },
};

/** Every lean tool, its title and one line, for the hub, llms.txt and /health. */
export const LEAN_SUMMARY: ReadonlyArray<[string, string]> = LEAN_NAMES.map((n) => [n, `${Object.keys(LEAN_TOOLS[n].modes).filter((m) => LEAN_TOOLS[n].mode_param !== false).join(', ') || 'one purpose'}`]);

/* ---- dispatch ------------------------------------------------------------------------------------- */
function shapeOf(schema: unknown): z.ZodType | null {
  if (!schema) return z.object({});
  if (typeof schema === 'object' && ('_zod' in (schema as object) || typeof (schema as { safeParse?: unknown }).safeParse === 'function')) return schema as z.ZodType;
  return z.object(schema as z.ZodRawShape);
}

/** Arguments a mode does not hand to its implementation: what the person sent minus what the named schema takes. */
function prepare(lean: string, mode: string, spec: ModeSpec, args: Structured, namedKeys: Set<string>): { named: Structured; ignored: string[] } {
  const named: Structured = {};
  const ignored: string[] = [];
  const a = { ...args };
  /* find_churches by_id: the whole lb:church:<country>/<slug> id is split into the named tool's two parts */
  if (lean === 'find_churches' && mode === 'by_id' && typeof a.id === 'string') {
    const m = a.id.match(/^(?:lb:church:)?([^/]+)\/(.+)$/);
    if (m) { a.country ??= m[1]; a.slug ??= m[2]; }
    delete a.id;
  }
  for (const [k, v] of Object.entries(a)) {
    if (k === 'mode' || v === undefined) continue;
    const target = spec.rename?.[k] ?? k;
    if (namedKeys.has(target)) named[target] = v;
    else ignored.push(k);
  }
  for (const [k, v] of Object.entries(spec.fixed ?? {})) named[k] = v;
  return { named, ignored };
}

function modeHelp(lean: string, mode: string, issues: string): string {
  return `${lean} mode ${mode} could not use these arguments: ${issues}. The description of ${lean} lists the parameters each mode needs.`;
}

function finishLean(r: AnyResult, lean: string, mode: string | null, named: string, ignored: string[]): AnyResult {
  const out: AnyResult = { ...r };
  if (Array.isArray(out.content)) {
    out.content = out.content.map((c, i) => (c.type === 'text' && typeof c.text === 'string' ? { ...c, text: i === 0 && ignored.length && !r.isError ? `${leanText(c.text)} (Ignored for mode ${mode}: ${ignored.join(', ')}.)` : leanText(c.text) } : c));
  }
  if (out._meta) out._meta = leanDeep(out._meta) as Record<string, unknown>;
  if (out.structuredContent && !out.isError) {
    out.structuredContent = { ...(leanDeep(out.structuredContent) as Structured), ...(mode ? { mode } : {}), answered_by: named, ...(ignored.length ? { ignored_params: ignored } : {}) };
  }
  return out;
}

/** Register the 13 lean tools on the real server, each dispatching to the captured named implementations. */
export function registerLean(server: McpServer, captured: Map<string, Captured>): void {
  for (const lean of LEAN_NAMES) {
    const entry = LEAN_TOOLS[lean];
    const def = LEAN_DEFS[lean];
    if (!def) throw new Error(`lean tool ${lean} has no definition`);
    const modes = Object.keys(entry.modes);
    const hasMode = entry.mode_param !== false;
    const caps = modes.map((m) => captured.get(entry.modes[m].tool)).filter((c): c is Captured => Boolean(c));
    const openWorld = caps.some((c) => c.config.annotations?.openWorldHint === true);
    const hints: Hints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: openWorld };
    const modeInput = hasMode
      ? (entry.default_mode
        ? z.enum(modes as [string, ...string[]]).default(entry.default_mode).describe(`Which kind of answer: ${modes.join(', ')}. Default ${entry.default_mode}. Each mode is explained in the description.`)
        : z.enum(modes as [string, ...string[]]).describe(`Which kind of answer: ${modes.join(', ')}. Each mode, and the parameters it needs, is explained in the description.`))
      : null;
    const inputSchema: z.ZodRawShape = modeInput ? { mode: modeInput, ...def.params } : { ...def.params };
    const outputSchema = out({
      ...(hasMode ? { mode: z.string().describe('The mode that answered.') } : {}),
      answered_by: z.string().describe('The implementation that answered (the same tool name the signed-in endpoint lists).'),
      ignored_params: z.array(z.string()).optional().describe('Parameters given that this mode does not use.'),
      ...def.output,
    });
    const config = {
      title: def.title,
      description: `${def.description} ${ACCESS}`,
      inputSchema,
      outputSchema,
      annotations: { title: def.title, ...hints },
      _meta: { 'living-bread/lean': true, 'living-bread/modes': Object.fromEntries(modes.map((m) => [m, entry.modes[m].tool])) },
    };
    const cb = async (args: Structured, extra: unknown) => {
      const mode = hasMode ? String(args.mode ?? entry.default_mode ?? modes[0]) : modes[0];
      const spec = entry.modes[mode];
      if (!spec) return fail(`${lean} has no mode "${mode}". Modes: ${modes.join(', ')}.`, { reason: 'unknown_mode', try_instead: modes.map((m) => `${lean} with mode ${m}`) });
      const cap = captured.get(spec.tool);
      if (!cap) return fail(`${lean} mode ${mode} is not available on this endpoint.`, { reason: 'not_available', try_instead: ['https://living-bread.org'] });
      const schema = shapeOf(cap.config.inputSchema);
      const namedKeys = new Set(Object.keys((cap.config.inputSchema as Record<string, unknown> | undefined) ?? {}));
      const { named, ignored } = prepare(lean, mode, spec, args, namedKeys);
      const parsed = schema ? await schema.safeParseAsync(named) : { success: true as const, data: named };
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.map((p) => Object.entries(spec.rename ?? {}).find(([, t]) => t === p)?.[0] ?? String(p)).join('.') || 'arguments'} (${i.message})`).join('; ');
        return fail(modeHelp(lean, mode, issues), { reason: 'invalid_arguments', try_instead: [`${lean} with mode ${mode} and the parameters its description names`] });
      }
      const r = (await cap.cb(parsed.data, extra)) as AnyResult;
      return finishLean(r, lean, hasMode ? mode : null, spec.tool, ignored);
    };
    (server.registerTool as unknown as (n: string, c: unknown, f: unknown) => unknown).call(server, lean, config, cb);
  }
}
