/* ============================================================
   THE LIVING BREAD MCP, every door of the platform.

   Public read tools, each over something REAL that already exists: a
   database function the app calls, a public page family the house wrote,
   a dataset the app ships, or the Knowledge API. Nothing is generated;
   Scripture is read from the stored text; a result that is empty says so;
   and every answer ends with the exact door into The Living Bread.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { type Believer, rpcAs } from './auth';
import crisisData from './data/crisis.json';
import plansData from './data/plans.json';
import { DOORS, KNOWLEDGE_API, SITE } from './doors';
import { CONFESSION, GOSPEL_STEPS, THE_YES, WHO_IS_JESUS } from './gospel';
import { housePage, hubEntries, pickEntry, prose, versesNamedIn, type HouseLink } from './house';
import { HOUSE_TRADITION, layers } from './evidence';
import { liveNow, record, scheduled } from './freshness';
import { kjvByRef } from './kjv';
import { findEntity, findGatherings, geocode } from './knowledge';
import { km, list, paragraph, placeOf, slugify, whenUTC } from './render';
import { ATTRIBUTION, fail, firstName, ok, out, READS, READS_WORLD, tool, unavailable } from './shared';

/* ------------------------------------------------------------------ small helpers */
async function anonSelect<T>(env: Env, table: string, query: string): Promise<T[] | null> {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    return (await r.json()) as T[];
  } catch {
    return null;
  }
}
async function anonRpc(env: Env, fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
/** The centre of a geohash cell (the approximate place a prayer was left; never the exact spot). */
export function geohashCentre(hash: string): { lat: number; lon: number } | null {
  const B = '0123456789bcdefghjkmnpqrstuvwxyz';
  let even = true;
  let lat = [-90, 90];
  let lon = [-180, 180];
  for (const ch of hash.toLowerCase()) {
    const cd = B.indexOf(ch);
    if (cd < 0) return null;
    for (let mask = 16; mask > 0; mask >>= 1) {
      const range = even ? lon : lat;
      const mid = (range[0] + range[1]) / 2;
      if (cd & mask) range[0] = mid; else range[1] = mid;
      even = !even;
    }
  }
  return { lat: Math.round(((lat[0] + lat[1]) / 2) * 1e4) / 1e4, lon: Math.round(((lon[0] + lon[1]) / 2) * 1e4) / 1e4 };
}
const humanize = (slug: string) => slug.replace(/^\/+/, '').split('/').pop()!.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const placeInput = {
  lat: z.number().min(-90).max(90).optional().describe('Latitude, if the person has shared where they are.'),
  lng: z.number().min(-180).max(180).optional().describe('Longitude, paired with lat.'),
  city: z.string().max(120).optional().describe('A city, region or country, when there are no coordinates.'),
};

/* ------------------------------------------------------------------ the house-page family */
interface PageFamily {
  name: string; title: string; description: string; hub: string; accept: (href: string) => boolean;
  arg: string; argDescription: string; door: string; christ: string; labelFromHref?: boolean;
}

function registerPageFamily(server: McpServer, env: Env, f: PageFamily): void {
  tool(server, f.name, {
    title: f.title,
    description: `${f.description} Read at call time from the house's own page (living-bread.org${f.hub}); the words are the house's, the Scripture is re-read from the stored King James text, nothing is generated. Honest when no page matches. ${f.christ}`,
    inputSchema: { [f.arg]: z.string().min(1).max(120).describe(f.argDescription) },
    outputSchema: out({
      matched: z.string().nullable(), exact: z.boolean().optional(), title: z.string().optional(), url: z.string().optional(), summary: z.string().optional(), body: z.string().optional(),
      verses: z.array(z.looseObject({ ref: z.string(), text: z.string() })).optional(), related: z.array(z.looseObject({ title: z.string(), url: z.string() })).optional(),
      suggestions: z.array(z.looseObject({ title: z.string(), url: z.string() })).optional(), hub: z.string(), door: z.string(),
    }),
    annotations: READS_WORLD,
  }, async (args) => {
    const query = String((args as Record<string, string>)[f.arg] ?? '').trim();
    const entries = await hubEntries(f.hub, f.accept);
    if (entries === null) return unavailable(`the house page ${SITE}${f.hub}`, `${SITE}${f.hub}`);
    const labelled: HouseLink[] = f.labelFromHref ? entries.map((e) => ({ href: e.href, label: humanize(e.href) })) : entries;
    const pick = pickEntry(labelled, query);
    if (!pick) {
      const suggestions = labelled.slice(0, 14).map((e) => ({ title: e.label.slice(0, 80), url: `${SITE}${e.href}` }));
      return ok(paragraph([`The house holds no page for "${query}" in this family, and we would rather say so than invent one`, `Pages held include ${list(suggestions.slice(0, 10).map((s) => s.title), 10)}`, `All of them are at ${SITE}${f.hub}`]), { matched: null, suggestions, hub: `${SITE}${f.hub}`, door: f.door, ...ATTRIBUTION });
    }
    const page = await housePage(pick.entry.href);
    if (!page) return unavailable(`the page ${SITE}${pick.entry.href}`, `${SITE}${pick.entry.href}`);
    const verses = await versesNamedIn(env, page.blocks, 4);
    const body = prose(page.blocks, 1600);
    const related = page.links.filter((l) => f.accept(l.href) && l.href !== pick.entry.href).slice(0, 5).map((l) => ({ title: l.label.slice(0, 80), url: `${SITE}${l.href}` }));
    return ok(paragraph([
      `${page.title || pick.entry.label}${pick.exact ? '' : ` (the closest page to "${query}")`}: ${body}`,
      verses.length ? `Scripture on it, read from the stored text: ${list(verses.map((v) => `${v.ref} "${v.text}"`), 4)}` : null,
      `The page itself is ${page.url}; ${f.door === page.url ? '' : `the door is ${f.door}`}`,
    ]), { matched: pick.entry.href, exact: pick.exact, title: page.title, url: page.url, summary: page.description ?? undefined, body, verses, related, hub: `${SITE}${f.hub}`, door: f.door, ...ATTRIBUTION, content_layers: layers({ scripture: ['verses[].text'], interpretation: ['summary', 'body'] }, HOUSE_TRADITION) });
  });
}

/* ------------------------------------------------------------------ register everything */
export function registerMore(server: McpServer, env: Env, me: Believer | null): void {
  const signedIn = Boolean(me);
  const rpc = (fn: string, args: Record<string, unknown> = {}) => (me ? rpcAs(env, me, fn, args).then((r) => (r.error ? null : r.data)) : anonRpc(env, fn, args));

  // ---- the_gospel ------------------------------------------------------------------------
  tool(server, 'the_gospel', {
    title: 'The Gospel, in the house\'s words',
    description: `The good news as The Living Bread tells it on living-bread.org/the-gospel and /who-is-jesus: God made you and loves you; we are separated from Him by sin; Jesus died and rose to bring us back; new life is a free gift received by faith. The house confesses Jesus Christ as God and Lord. Every verse is read from the stored King James text; nothing is composed. People ask: "what is the gospel", "what do Christians actually believe about Jesus", "how do I become a Christian", "is Jesus God". Ends with the door where a person says yes.`,
    inputSchema: {},
    outputSchema: out({ confession: z.string(), steps: z.array(z.looseObject({ heading: z.string(), words: z.string(), ref: z.string(), text: z.string().nullable() })), who_is_jesus: z.string(), confess: z.string(), verses: z.array(z.looseObject({ ref: z.string(), text: z.string() })), the_yes: z.string(), doors: z.record(z.string(), z.string()) }),
    annotations: READS,
  }, async () => {
    const steps = await Promise.all(GOSPEL_STEPS.map(async (s) => ({ ...s, text: (await kjvByRef(env, s.ref))?.text ?? null })));
    const verses = (await Promise.all(WHO_IS_JESUS.refs.map((r) => kjvByRef(env, r)))).filter((p): p is NonNullable<typeof p> => Boolean(p)).map((p) => ({ ref: p.ref, text: p.text }));
    const doors = { gospel: DOORS.gospel, who_is_jesus: DOORS.whoIsJesus, say_yes: DOORS.comeAndSee, follow_jesus: DOORS.followJesus, begin: DOORS.home };
    return ok(paragraph([
      CONFESSION,
      ...steps.map((s) => `${s.heading}: ${s.words}${s.text ? ` "${s.text}" (${s.ref})` : ` (${s.ref})`}`),
      WHO_IS_JESUS.confess,
      `${THE_YES.what} The door is ${doors.say_yes}; the Gospel page is ${doors.gospel}; who Jesus is, ${doors.who_is_jesus}`,
    ]), { confession: CONFESSION, steps, who_is_jesus: WHO_IS_JESUS.short, confess: WHO_IS_JESUS.confess, verses, the_yes: THE_YES.what, doors, ...ATTRIBUTION, content_layers: layers({ scripture: ['steps[].text', 'verses[].text'], interpretation: ['confession', 'steps[].heading', 'steps[].words', 'who_is_jesus', 'confess', 'the_yes'] }, HOUSE_TRADITION) });
  });

  // ---- come_and_see ----------------------------------------------------------------------
  tool(server, 'christianity_and_other_faiths', {
    title: 'Come and See: for a seeker from another faith, or none',
    description: `For a person from another faith or none who is curious about Jesus: the house's Come and See pages (Christianity alongside Islam, Judaism, Buddhism, Hindu traditions, Sikhi, Taoism, Confucianism, the Baha'i Faith, Jainism, Zoroastrianism, Shinto, Stoicism, New Age spirituality, the occult), read at call time: honest, respectful, pointing to Christ and to a real conversation, never an argument. People ask: "I'm Muslim, what do Christians believe about Isa", "I grew up Hindu, how is Jesus different", "I'm Jewish, why do Christians say Jesus is the Messiah", "I'm into astrology, is that a problem". Ends with a door to a real person: a Table, a shepherd, the family.`,
    inputSchema: { background: z.string().min(2).max(80).describe('Their background in their own words: "Muslim", "Hindu", "Jewish", "Buddhist", "Sikh", "Stoic", "new age", "nothing really".') },
    outputSchema: out({ matched: z.string().nullable(), title: z.string().optional(), url: z.string().optional(), body: z.string().optional(), questions: z.array(z.looseObject({ title: z.string(), url: z.string() })).optional(), verses: z.array(z.looseObject({ ref: z.string(), text: z.string() })).optional(), suggestions: z.array(z.looseObject({ title: z.string(), url: z.string() })).optional(), posture: z.string(), doors: z.record(z.string(), z.string()) }),
    annotations: READS_WORLD,
  }, async ({ background }) => {
    const posture = 'Come and see (John 1:46): the house does not argue anyone into the Kingdom. It tells the truth about Jesus with respect for the person in front of it, and offers a real conversation with real people.';
    const doors = { come_and_see: DOORS.comeAndSee, who_is_jesus: DOORS.whoIsJesus, a_table: DOORS.theTable, a_shepherd: DOORS.pastors, talk: `${SITE}/talk` };
    const entries = await hubEntries('/come-and-see', (h) => h.startsWith('/christianity-and-'));
    if (entries === null) return unavailable('the Come and See pages', DOORS.comeAndSee);
    const short = entries.map((e) => ({ href: e.href, label: humanize(e.href).replace(/^Christianity And /, '') }));
    /* the way people name themselves, mapped to the way the pages are named */
    const SAME: [RegExp, string][] = [
      [/muslim|islam|quran|qur'an|isa\b/i, 'islam'], [/jew|judai|hebrew|torah|synagog/i, 'judaism'], [/buddh|dharma|zen/i, 'buddhism'], [/hindu|vedic|krishna|brahman/i, 'hinduism'],
      [/sikh|guru|punjab/i, 'sikhism'], [/tao|dao/i, 'taoism'], [/confuci/i, 'confucianism'], [/baha/i, 'bahai'], [/jain/i, 'jainism'], [/zoroast|parsi|mazda/i, 'zoroastrianism'],
      [/shinto|kami/i, 'shinto'], [/stoic/i, 'stoicism'], [/new age|newage|spiritual but|crystals|manifest/i, 'new-age'], [/occult|astrolog|tarot|witch|wicca|pagan|psychic|horoscope/i, 'the-occult'],
    ];
    const none = /^(none|nothing|no faith|atheist|agnostic|not religious|secular|unsure|spiritual not religious)/i.test(background.trim());
    const mapped = SAME.find(([re]) => re.test(background))?.[1];
    const q = none ? null : (mapped ? (() => { const e = short.find((x) => x.href === `/christianity-and-${mapped}`); return e ? { entry: e, exact: true } : null; })() : null) ?? pickEntry(short, background.replace(/^(i am|i'm|im|raised|grew up|former)\s+/i, ''));
    if (!q) {
      const suggestions = short.map((e) => ({ title: `Christianity and ${e.label}`, url: `${SITE}${e.href}` }));
      return ok(paragraph([
        /^(none|nothing|no faith|atheist|agnostic|not religious|secular|unsure)/i.test(background) ? `For someone with no faith background, the house starts with who Jesus is, not with a comparison: ${DOORS.whoIsJesus}, and the Gospel in plain words at ${DOORS.gospel} (the_gospel tool reads it)` : `The house holds no Come and See page for "${background}" yet, and would rather say so than guess`,
        `Pages held: ${list(suggestions.map((s) => s.title), 14)}`,
        posture,
        `A real conversation: a Table at ${doors.a_table}, a shepherd at ${doors.a_shepherd}, or someone to talk to now at ${doors.talk}`,
      ]), { matched: null, suggestions, posture, doors, ...ATTRIBUTION });
    }
    const page = await housePage(q.entry.href);
    if (!page) return unavailable(`the page ${SITE}${q.entry.href}`, DOORS.comeAndSee);
    const questions = page.links.filter((l) => l.href.startsWith(`${q.entry.href}/`)).slice(0, 8).map((l) => ({ title: l.label.split(/(?<=[a-z’'])\s(?=[A-Z])/)[0].slice(0, 70), url: `${SITE}${l.href}` }));
    const verses = await versesNamedIn(env, page.blocks, 3);
    const body = prose(page.blocks, 1200);
    return ok(paragraph([
      `${page.title}: ${body}`,
      questions.length ? `The questions the page opens, each its own page: ${list(questions.map((x) => `${x.title} (${x.url})`), 8)}` : null,
      verses.length ? `Scripture named there, read from the stored text: ${list(verses.map((v) => `${v.ref} "${v.text}"`), 3)}` : null,
      posture,
      `A real conversation: a Table at ${doors.a_table}, a shepherd at ${doors.a_shepherd}, or someone to talk to now at ${doors.talk}; the page is ${page.url}`,
    ]), { matched: q.entry.href, title: page.title, url: page.url, body, questions, verses, posture, doors, ...ATTRIBUTION });
  });

  // ---- crisis_resources ------------------------------------------------------------------
  interface Crisis { countryCode: string; countryName: string; emergency: string[]; police?: string; ambulance?: string; fire?: string; suicideLine?: { name: string; number: string; hours?: string; url?: string; text?: string }; domesticViolence?: { name: string; number: string; hours?: string; url?: string }; childHelp?: { name: string; number: string; hours?: string; url?: string }; textLine?: { name: string; number: string; text?: string }; source: string; verifiedAt: string; confidence: string }
  const CRISIS = crisisData as Crisis[];
  const CRISIS_ALIASES: Record<string, string> = {
    'usa': 'US', 'united states': 'US', 'united states of america': 'US', 'america': 'US', 'u.s.': 'US', 'u.s.a.': 'US',
    'uk': 'GB', 'united kingdom': 'GB', 'britain': 'GB', 'great britain': 'GB', 'england': 'GB', 'scotland': 'GB', 'wales': 'GB',
    'south korea': 'KR', 'korea': 'KR', 'holland': 'NL', 'the netherlands': 'NL', 'uae': 'AE', 'ivory coast': 'CI', 'czechia': 'CZ',
  };
  function findCrisisCountry(raw: string) {
    const q = raw.trim().toLowerCase().replace(/\.$/, '');
    if (!q) return undefined;
    const code = CRISIS_ALIASES[q] ?? (q.length === 2 ? q.toUpperCase() : null);
    if (code) { const byCode = CRISIS.find((c) => c.countryCode.toUpperCase() === code); if (byCode) return byCode; }
    const exact = CRISIS.find((c) => c.countryName.toLowerCase() === q);
    if (exact) return exact;
    if (q.length >= 4) {
      const starts = CRISIS.filter((c) => c.countryName.toLowerCase().startsWith(q));
      if (starts.length === 1) return starts[0];
    }
    return undefined;
  }
  tool(server, 'crisis_resources', {
    title: 'Crisis lines for a country (first, before anything else)',
    description: 'When a person speaks of harming themselves or someone else, or is in danger, THIS COMES FIRST: the real emergency number and crisis line for THEIR country, from the dataset the app ships for 53 countries (never a United States number by default). Then the Word and the family, never instead. Pass the country (name or ISO code); if it is not known, ask the person before giving any number. Honest when a country is not held: it says so and gives the general rule (local emergency number). People say: "I want to die", "I am going to hurt myself", "my friend is suicidal", "he hits me". Point to Christ only after the line is given.',
    inputSchema: { country: z.string().max(60).optional().describe('Country name or ISO 3166-1 alpha-2 code ("Nigeria", "GB", "Brazil"). Ask the person if unknown.') },
    outputSchema: out({ country: z.looseObject({ code: z.string(), name: z.string() }).nullable(), emergency: z.array(z.string()), crisis_line: z.looseObject({ name: z.string(), number: z.string() }).nullable(), text_line: z.looseObject({ name: z.string(), number: z.string() }).nullable(), domestic_violence: z.looseObject({ name: z.string(), number: z.string() }).nullable(), child_help: z.looseObject({ name: z.string(), number: z.string() }).nullable(), source: z.string().nullable(), verified_at: z.string().nullable(), confidence: z.string().nullable(), countries_held: z.array(z.string()).optional(), rule: z.string(), door: z.string() }),
    annotations: READS,
  }, async ({ country }) => {
    const rule = 'Give the real number first and plainly. Stay with the person. Only then the Word, and the family who will pray for them by name. Never a Scripture in place of a phone number.';
    const door = `${SITE}/sos`;
    const q = (country ?? '').trim().toLowerCase();
    // Strict, in order: the code, the exact name, a known alias, then a name that STARTS with
    // four or more letters. Never a substring ("us" once matched aUStralia; a wrong crisis line
    // is worse than none).
    const hit = q ? findCrisisCountry(q) : undefined;
    if (!hit) {
      const names = CRISIS.map((c) => `${c.countryName} (${c.countryCode})`);
      return ok(paragraph([
        q ? `The app does not hold verified crisis lines for "${country}" yet, and will not guess a number` : 'Ask the person which country they are in before giving any number; the app holds verified lines for 53 countries and never defaults to one country\'s number',
        'Until the country is known: in immediate danger, call the local emergency number (112 reaches emergency services in most of Europe and on most mobile networks worldwide; 911 in North America; 999 in the UK and several other countries), and do not leave the person alone',
        `Countries held: ${list(names, 60)}`,
        rule,
        `The app's own crisis door is ${door}; the family prays at ${DOORS.prayer}`,
      ]), { country: null, emergency: [], crisis_line: null, text_line: null, domestic_violence: null, child_help: null, source: null, verified_at: null, confidence: null, countries_held: names, rule, door });
    }
    const cl = hit.suicideLine ?? null;
    return ok(paragraph([
      `${hit.countryName}: emergency ${list(hit.emergency, 3)}${hit.police ? `, police ${hit.police}` : ''}${hit.ambulance ? `, ambulance ${hit.ambulance}` : ''}`,
      cl ? `Crisis line: ${cl.name}, ${cl.number}${cl.hours ? ` (${cl.hours})` : ''}${cl.text ? `; ${cl.text}` : ''}${cl.url ? `; ${cl.url}` : ''}` : `No national crisis line is held for ${hit.countryName} in the app's dataset; use the emergency number above and stay with the person`,
      hit.textLine ? `Text line: ${hit.textLine.name}, ${hit.textLine.text ?? hit.textLine.number}` : null,
      hit.domesticViolence ? `Domestic violence: ${hit.domesticViolence.name}, ${hit.domesticViolence.number}` : null,
      hit.childHelp ? `Children: ${hit.childHelp.name}, ${hit.childHelp.number}` : null,
      `Source: ${hit.source} (checked ${hit.verifiedAt}, ${hit.confidence.replace('_', ' ')})`,
      rule,
      `When the person is safe: the family will pray for them by name at ${DOORS.prayer}, someone to talk to is at ${SITE}/talk, and the app's crisis door is ${door}. The Lord is near to the broken-hearted (Psalm 34:18, read it with scripture_passage)`,
    ]), { country: { code: hit.countryCode, name: hit.countryName }, emergency: hit.emergency, crisis_line: cl, text_line: hit.textLine ?? null, domestic_violence: hit.domesticViolence ?? null, child_help: hit.childHelp ?? null, source: hit.source, verified_at: hit.verifiedAt, confidence: hit.confidence, rule, door });
  });

  // ---- tables_live_now --------------------------------------------------------------------
  interface HallRow { id: string; host_name: string; title: string; description: string | null; physics: string; seats: number; audience: string; scripture_ref: string | null; scheduled_at: string | null; city: string | null; country: string | null; present: number; family_here: number; saved_for_me: boolean; i_sit: boolean }
  tool(server, 'tables_live_now', {
    title: 'Tables open now',
    description: `The Living Bread Tables open right now: who is hosting (first name), what they gather around, seats and who is present, the Scripture on the table. The hall is seen from inside the family, so on the public endpoint this tool gives the door and says so honestly; connected as yourself (${'/me'}) it reads the live hall as you. People ask: "is anyone gathered right now", "where can I sit with believers tonight", "a table about the Psalms".`,
    inputSchema: {},
    outputSchema: out({ signed_in: z.boolean(), count: z.number(), tables: z.array(z.looseObject({ id: z.string(), title: z.string(), host: z.string(), physics: z.string(), seats: z.number(), present: z.number(), family_here: z.number(), scripture_ref: z.string().nullable(), where: z.string().nullable(), scheduled_at: z.string().nullable(), saved_for_me: z.boolean(), door: z.string() })), take_a_seat: z.string(), door: z.string() }),
    annotations: READS,
  }, async () => {
    const take = 'Take a seat: open the Table and sit; the host and the family see you arrive.';
    if (!me) return ok(paragraph(['The Tables are seen from inside the family, so this public connection cannot list who is sitting right now, and will not pretend to', `The hall is at ${DOORS.theTable}; connect as yourself at https://mcp.living-bread.org/me and tables_live_now reads it for you`, take]), { signed_in: false, count: 0, tables: [], take_a_seat: take, door: DOORS.theTable });
    const r = await rpcAs(env, me, 'the_hall');
    if (r.error) return fail(`The hall could not be read just now (${r.error}). It is at ${DOORS.theTable}.`);
    const tables = (Array.isArray(r.data) ? (r.data as HallRow[]) : []).map((t) => ({ id: t.id, title: t.title, host: firstName(t.host_name), physics: t.physics, seats: t.seats, present: t.present, family_here: t.family_here, scripture_ref: t.scripture_ref, where: [t.city, t.country].filter(Boolean).join(', ') || null, scheduled_at: t.scheduled_at, saved_for_me: t.saved_for_me, door: `${SITE}/the-table/${t.id}`,
      freshness: t.present > 0 ? liveNow('Someone was seen at this Table in the last two minutes (the hall\'s own presence window).') : t.scheduled_at ? scheduled(t.scheduled_at, 'A Table set for this time; nobody is seated yet.') : record(null, 'Open, but nobody was seen seated in the last two minutes.') }));
    if (!tables.length) return ok(paragraph(['No Table is open this minute', `Anyone may set one; the hall is at ${DOORS.theTable}`, take]), { signed_in: true, count: 0, tables: [], take_a_seat: take, door: DOORS.theTable });
    return ok(paragraph([`${tables.length} ${tables.length === 1 ? 'Table is' : 'Tables are'} open: ${list(tables.slice(0, 8).map((t) => `"${t.title}" (${t.host} hosting, ${t.present} of ${t.seats} seats${t.family_here ? `, ${t.family_here} of your family here` : ''}${t.scripture_ref ? `, ${t.scripture_ref}` : ''}${t.saved_for_me ? ', a seat saved for you' : ''})`), 8)}`, take, `The hall is at ${DOORS.theTable}`]), { signed_in: true, count: tables.length, tables, take_a_seat: take, door: DOORS.theTable });
  });

  // ---- prayers_left_near (Prayer in Place, migration 0620) -------------------------------
  interface PlaceRow { id: string; cell7: string; place_kind: string | null; place_name: string | null; anonymous: boolean; kind: string; seconds: number; words: string | null; scripture_ref: string | null; title: string | null; intention: string | null; heard_count: number; prayed_with_count: number; created_at: string; author_name: string | null; distance_m: number }
  tool(server, 'prayers_left_near', {
    title: 'Prayers left near a place (Prayer in Place)',
    description: 'Prayers real believers have left at places (Prayer in Place): a street, a hospital, a school, a church, a town. Public prayers only, with the approximate centre of the cell they were left in (never the exact spot), the kind (voice or written), the words when written, the Scripture named, who left it (first name, or "someone") and how many prayed with it. People ask: "has anyone prayed near this hospital", "prayers left in my town", "pray where others have prayed". Nothing invented; honest when none are near.',
    inputSchema: { ...placeInput, radius_km: z.number().min(0.1).max(50).default(5), limit: z.number().int().min(1).max(30).default(8) },
    outputSchema: out({ searched: z.string(), count: z.number(), prayers: z.array(z.looseObject({ id: z.string(), cell: z.string(), approx: z.looseObject({ lat: z.number(), lon: z.number() }).nullable(), place: z.string().nullable(), kind: z.string(), voice: z.boolean(), words: z.string().nullable(), scripture_ref: z.string().nullable(), from: z.string(), heard: z.number(), prayed_with: z.number(), when: z.string(), distance_km: z.number(), door: z.string() })), totals: z.looseObject({ prayers: z.number(), places: z.number(), places_today: z.number() }).nullable(), door: z.string() }),
    annotations: READS_WORLD,
  }, async ({ lat, lng, city, radius_km, limit }) => {
    let geo = lat !== undefined && lng !== undefined ? { lat, lon: lng, label: city ?? `${lat.toFixed(2)}, ${lng.toFixed(2)}` } : null;
    if (!geo && city) geo = await geocode(env, city);
    if (!geo) return fail(paragraph(['Tell us where to look: coordinates (lat and lng) or a city', `Prayer in Place is at ${DOORS.prayerPlace}`]));
    const [rows, tot] = await Promise.all([rpc('place_prayers_near', { p_lat: geo.lat, p_lon: geo.lon, p_radius_m: Math.round(radius_km * 1000), p_kind: null, p_since: null, p_limit: limit, p_before: null }), rpc('prayer_in_place_totals')]);
    if (rows === null) return unavailable('Prayer in Place', DOORS.prayerPlace);
    const t = (Array.isArray(tot) ? tot[0] : tot) as { prayers?: number; places?: number; places_today?: number } | null;
    const totals = t ? { prayers: Number(t.prayers ?? 0), places: Number(t.places ?? 0), places_today: Number(t.places_today ?? 0) } : null;
    const prayers = (rows as PlaceRow[]).map((p) => ({ id: p.id, cell: p.cell7, approx: geohashCentre(p.cell7), place: p.place_name ? `${p.place_name}${p.place_kind ? ` (${p.place_kind})` : ''}` : p.place_kind, kind: p.kind, voice: p.seconds > 0, words: p.words, scripture_ref: p.scripture_ref, from: p.anonymous || !p.author_name ? 'someone' : firstName(p.author_name), heard: p.heard_count, prayed_with: p.prayed_with_count, when: p.created_at, distance_km: Math.round(p.distance_m / 100) / 10, door: `${SITE}/prayer-place/${p.cell7}` }));
    if (!prayers.length) return ok(paragraph([`No prayer has been left within ${radius_km} km of ${geo.label} yet`, totals ? `Across the earth, ${totals.prayers} prayers rest at ${totals.places} places (${totals.places_today} prayed at today)` : null, `A believer can be the first to pray there, at ${DOORS.prayerPlace} in the app`]), { searched: geo.label, count: 0, prayers: [], totals, door: DOORS.prayerPlace, ...ATTRIBUTION });
    return ok(paragraph([
      `${prayers.length} ${prayers.length === 1 ? 'prayer rests' : 'prayers rest'} near ${geo.label}: ${list(prayers.slice(0, 6).map((p) => `${p.from} left a ${p.voice ? 'voice prayer' : 'written prayer'}${p.place ? ` at ${p.place}` : ''}${p.words ? ` ("${p.words.slice(0, 80)}")` : ''}${p.scripture_ref ? `, ${p.scripture_ref}` : ''}, ${p.prayed_with} prayed with it, about ${p.distance_km} km away`), 6)}`,
      'Places are the approximate centre of the cell each prayer was left in, never the exact spot',
      `Pray where they prayed: open a cell at its door, or ${DOORS.prayerPlace} in the app`,
    ]), { searched: geo.label, count: prayers.length, prayers, totals, door: DOORS.prayerPlace, ...ATTRIBUTION });
  });

  // ---- needs_near (Serve) ------------------------------------------------------------------
  interface NeedRow { id: string; title: string; description: string | null; category: string; urgency: string; country: string | null; region: string | null; city: string | null; approx_lat: number | null; approx_lng: number | null; local_eligible: boolean; remote_eligible: boolean; funding_eligible: boolean; estimated_cost: number | null; currency: string; is_pilot: boolean; partner: { name: string; slug: string; verified_level: string } | null }
  tool(server, 'needs_near', {
    title: 'Open Serve needs near a place',
    description: 'Open, verified needs on The Living Bread Serve network that the app shows publicly: posted by verified partner organisations, with an approximate place only (never a home address), what is needed, whether it can be met locally, remotely or by funding, and the partner behind it. People ask: "how can I help in my city", "is there a need I can meet this week", "who needs groceries near Kigali", "something I can fund". Honest when none is near; remote and fundable needs are offered then. Whoever is kind to the poor lends to the LORD (Proverbs 19:17).',
    inputSchema: { ...placeInput, country: z.string().max(80).optional().describe('A country, to list its needs without coordinates.'), limit: z.number().int().min(1).max(20).default(8) },
    outputSchema: out({ searched: z.string(), count: z.number(), needs: z.array(z.looseObject({ id: z.string(), title: z.string(), description: z.string().nullable(), category: z.string(), urgency: z.string(), where: z.string(), distance_km: z.number().nullable(), partner: z.string().nullable(), ways: z.array(z.string()), estimated_cost: z.string().nullable(), pilot: z.boolean(), door: z.string() })), honest: z.string().optional(), door: z.string() }),
    annotations: READS_WORLD,
  }, async ({ lat, lng, city, country, limit }) => {
    let geo = lat !== undefined && lng !== undefined ? { lat, lon: lng, label: city ?? `${lat.toFixed(2)}, ${lng.toFixed(2)}` } : null;
    if (!geo && city) geo = await geocode(env, city);
    const rows = await anonSelect<NeedRow>(env, 'serve_needs', 'status=eq.open&verification_status=eq.verified&select=id,title,description,category,urgency,country,region,city,approx_lat,approx_lng,local_eligible,remote_eligible,funding_eligible,estimated_cost,currency,is_pilot,partner:serve_partners!inner(name,slug,verified_level)&partner.verified_level=in.(organization_verified,living_bread_partner)&order=urgency.asc,created_at.desc&limit=80');
    if (rows === null) return unavailable('the Serve network', DOORS.serve);
    const shape = (n: NeedRow, distance_km: number | null) => ({ id: n.id, title: n.title, description: n.description, category: n.category, urgency: n.urgency, where: [n.city, n.region, n.country].filter(Boolean).join(', ') || 'place not given', distance_km, partner: n.partner?.name ?? null, ways: [n.local_eligible ? 'in person' : null, n.remote_eligible ? 'remotely' : null, n.funding_eligible ? 'by funding' : null].filter((x): x is string => Boolean(x)), estimated_cost: n.estimated_cost != null ? `${n.estimated_cost} ${n.currency}` : null, pilot: n.is_pilot, door: DOORS.serve, app_link: `${SITE}/serve/${n.id}` });  // serve/<id> opens in the app; its web shell 404s (verified 2026-10-05), so the door is /serve
    let searched = geo?.label ?? country ?? city ?? 'anywhere';
    let picked: ReturnType<typeof shape>[] = [];
    if (geo) {
      picked = rows.filter((n) => n.approx_lat != null && n.approx_lng != null).map((n) => shape(n, Math.round(haversineKm(geo!.lat, geo!.lon, n.approx_lat!, n.approx_lng!)))).filter((n) => (n.distance_km ?? 1e9) <= 250).sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));
    } else if (country) {
      const c = country.toLowerCase();
      picked = rows.filter((n) => (n.country ?? '').toLowerCase().includes(c) || (n.region ?? '').toLowerCase().includes(c)).map((n) => shape(n, null));
    } else {
      picked = rows.map((n) => shape(n, null));
      searched = 'the whole network';
    }
    const shown = picked.slice(0, limit);
    if (!shown.length) {
      const remote = rows.filter((n) => n.remote_eligible || n.funding_eligible).slice(0, Math.min(limit, 5)).map((n) => shape(n, null));
      const honest = `No open need is held near ${searched}. That means the network does not have one there yet, not that nobody is in need.`;
      return ok(paragraph([honest, remote.length ? `Needs that can be met from anywhere: ${list(remote.map((n) => `${n.title} (${n.partner ?? 'a partner'}, ${n.where}, ${n.ways.join(' or ')})`), 5)}` : null, `Serve is at ${DOORS.serve}`]), { searched, count: 0, needs: remote, honest, door: DOORS.serve, ...ATTRIBUTION });
    }
    return ok(paragraph([
      `${shown.length} open ${shown.length === 1 ? 'need' : 'needs'} near ${searched}: ${list(shown.map((n) => `${n.title}${n.urgency === 'urgent' ? ' (urgent)' : ''}, ${n.partner ?? 'a verified partner'}, ${n.where}${n.distance_km !== null ? `, ${km(n.distance_km)}` : ''}, ${n.ways.join(' or ')}${n.estimated_cost ? `, about ${n.estimated_cost}` : ''}${n.pilot ? ', a labelled pilot example' : ''}`), limit)}`,
      'Places are approximate by design; the partner coordinates the rest',
      `Each need has its door; all of Serve is at ${DOORS.serve}`,
    ]), { searched, count: shown.length, needs: shown, door: DOORS.serve, ...ATTRIBUTION });
  });

  // ---- body_today --------------------------------------------------------------------------
  tool(server, 'body_today', {
    title: 'The Body today',
    description: 'What the whole family has done today, as a mirror and never a leaderboard: how many people were prayed for, encouraged, offered a talk or help through the response layer (body_responding_today); what the family is carrying today, by feeling and count only (family_carrying_today); prayers resting at places across the earth (prayer_in_place_totals); and, when connected as yourself, the Tables gathered today. People ask: "what is the family doing today", "is anyone praying right now", "what are people carrying".',
    inputSchema: {},
    outputSchema: out({ responding: z.looseObject({ prayed: z.number(), encouraged: z.number(), talk: z.number(), help: z.number(), met: z.number() }).nullable(), carrying: z.array(z.looseObject({ feeling: z.string(), people: z.number(), prayed_for: z.number() })), places: z.looseObject({ prayers: z.number(), places: z.number(), places_today: z.number(), countries_hint: z.number() }).nullable(), tables: z.looseObject({ gathered_today: z.number(), tables_set: z.number(), gathered_now: z.number() }).nullable(), door: z.string() }),
    annotations: READS,
  }, async () => {
    const [resp, carry, place, tables] = await Promise.all([rpc('body_responding_today'), rpc('family_carrying_today'), rpc('prayer_in_place_totals'), signedIn ? rpc('table_signals_today') : Promise.resolve(null)]);
    const responding = resp && typeof resp === 'object' ? (resp as { prayed?: number; encouraged?: number; talk?: number; help?: number; met?: number }) : null;
    const r = responding ? { prayed: Number(responding.prayed ?? 0), encouraged: Number(responding.encouraged ?? 0), talk: Number(responding.talk ?? 0), help: Number(responding.help ?? 0), met: Number(responding.met ?? 0) } : null;
    const carrying = (Array.isArray(carry) ? (carry as { feeling: string; people: number; prayed_for: number }[]) : []).map((c) => ({ feeling: c.feeling, people: Number(c.people), prayed_for: Number(c.prayed_for) }));
    const p0 = (Array.isArray(place) ? place[0] : place) as { prayers?: number; places?: number; places_today?: number; countries_hint?: number } | null;
    const places = p0 ? { prayers: Number(p0.prayers ?? 0), places: Number(p0.places ?? 0), places_today: Number(p0.places_today ?? 0), countries_hint: Number(p0.countries_hint ?? 0) } : null;
    const t0 = (Array.isArray(tables) ? tables[0] : tables) as { gathered_today?: number; tables_set?: number; gathered_now?: number } | null;
    const tb = t0 ? { gathered_today: Number(t0.gathered_today ?? 0), tables_set: Number(t0.tables_set ?? 0), gathered_now: Number(t0.gathered_now ?? 0) } : null;
    if (!r && !carrying.length && !places) return unavailable('the Body\'s account of today', DOORS.home);
    return ok(paragraph([
      r ? `Today the Body prayed for ${r.prayed} ${r.prayed === 1 ? 'person' : 'people'}, encouraged ${r.encouraged}, offered to talk with ${r.talk} and to help ${r.help}${r.met ? `, and met ${r.met} in person` : ''}` : null,
      carrying.length ? `The family is carrying: ${list(carrying.slice(0, 8).map((c) => `${c.people} ${c.feeling}${c.prayed_for ? ` (${c.prayed_for} prayed over them)` : ''}`), 8)}` : 'Nobody has named what they carry yet today',
      places ? `${places.prayers} prayers rest at ${places.places} places on the earth, ${places.places_today} of them prayed at today` : null,
      tb ? `${tb.gathered_now} are sitting at Tables this minute; ${tb.gathered_today} gathered at ${tb.tables_set} Tables today` : null,
      'A mirror, not a score: each number is a person Christ loves',
      `The family is at ${DOORS.home}; what they carry, at ${DOORS.carrying}`,
    ]), { responding: r, carrying, places, tables: tb, door: DOORS.home, ...ATTRIBUTION });
  });

  // ---- worship_now -------------------------------------------------------------------------
  interface Shelf { key: string; title: string; reason: string; songs: { slug: string; title: string; artist?: string | null; hymn?: boolean }[] }
  tool(server, 'worship_now', {
    title: 'Worship now',
    description: 'The worship room of The Living Bread: what the house offers for this hour (the catalogue\'s shelves for morning, day, evening or night, each with its songs and why it is there), the public-domain hymns a person can sing outright, and the two doors: Worship, and Worship Together (a live room where everyone is on the same song). What a live room is playing travels over Realtime presence and is not readable here; the tool says so rather than guess. People ask: "something to worship to tonight", "a hymn for the morning", "is anyone worshipping together right now".',
    inputSchema: { local_hour: z.number().int().min(0).max(23).optional().describe('The person\'s own hour (0 to 23). Defaults to the UTC hour.'), language: z.string().max(12).optional(), mood: z.string().max(40).optional().describe('A word for how they are: "weary", "thankful", "grieving".') },
    outputSchema: out({ part_of_day: z.string().nullable(), greeting: z.string().nullable(), shelves: z.array(z.looseObject({ title: z.string(), reason: z.string(), songs: z.array(z.looseObject({ title: z.string(), artist: z.string().nullable(), hymn: z.boolean(), door: z.string() })) })), live_room: z.string(), doors: z.record(z.string(), z.string()) }),
    annotations: READS,
  }, async ({ local_hour, language, mood }) => {
    const home = (await rpc('worship_home', { p_local_hour: local_hour ?? new Date().getUTCHours(), p_language: language ?? null, p_mood: mood ?? null })) as { part_of_day?: string; greeting?: string; shelves?: Shelf[] } | null;
    const doors = { worship: DOORS.worship, together: DOORS.worshipTogether, hymns: `${SITE}/hymns` };
    const live = 'What a Worship Together room is playing this minute travels over live presence between the people in it and is not readable from here; the door is open to anyone.';
    if (!home) return unavailable('the worship catalogue', DOORS.worship);
    const shelves = (home.shelves ?? []).slice(0, 5).map((s) => ({ title: s.title, reason: s.reason, songs: (s.songs ?? []).slice(0, 6).map((x) => ({ title: x.title, artist: x.artist ?? null, hymn: Boolean(x.hymn), door: `${SITE}/worship/song/${x.slug}` })) }));
    return ok(paragraph([
      home.greeting ? `${home.greeting}` : null,
      shelves.length ? `For this ${home.part_of_day ?? 'hour'}: ${list(shelves.map((s) => `${s.title} (${s.reason}): ${list(s.songs.map((x) => x.title + (x.artist ? `, ${x.artist}` : '')), 4)}`), 5)}` : 'The catalogue has no shelf for this hour',
      live,
      `Worship: ${doors.worship}. Together, live: ${doors.together}. The great hymns, words and stories: ${doors.hymns}. O sing unto the LORD a new song (Psalm 96:1)`,
    ]), { part_of_day: home.part_of_day ?? null, greeting: home.greeting ?? null, shelves, live_room: live, doors, ...ATTRIBUTION });
  });

  // ---- the house-page families ------------------------------------------------------------
  const families: PageFamily[] = [
    { name: 'a_prayer_for', title: 'A prayer for a situation (the house\'s own prayers)', description: 'A hand-written prayer from the house\'s library "A prayer for": healing, a sick loved one, before surgery, a dying loved one, my children, my marriage, a job, money, anxiety, peace, strength, the morning and over two hundred more; with the Scripture it rests on and how to pray it. People ask: "a prayer for my mother in hospital", "a prayer before my interview", "a morning prayer", "pray for my marriage".', hub: '/a-prayer-for', accept: (h) => h.startsWith('/a-prayer-for/'), arg: 'situation', argDescription: 'The situation in the person\'s words: "my daughter\'s surgery", "a new job", "peace tonight".', door: `${SITE}/a-prayer-for`, christ: 'Every prayer here is addressed to God through Jesus Christ, and the family will pray it with the person by name.' },
    { name: 'what_the_bible_says_about', title: 'What the Bible says about a topic', description: 'What the Bible says about one of about three hundred topics (shame, guilt, regret, insecurity, feeling abandoned, stress, burnout, money, marriage, anger, forgiveness and many more): the verses, each with a plain word on what it means, from the house\'s own pages. People ask: "what does the Bible say about shame", "Bible verses on burnout", "what does scripture say about regret".', hub: '/what-does-the-bible-say-about', accept: (h) => h.startsWith('/what-does-the-bible-say-about/'), arg: 'topic', argDescription: 'The topic: "shame", "feeling worthless", "money", "anger".', door: `${SITE}/what-does-the-bible-say-about`, christ: 'All Scripture testifies of Christ (John 5:39).' },
    { name: 'parable', title: 'A parable of Jesus', description: 'One of the parables of Jesus from the house\'s pages: the story in short, where it is in the Gospels, what it means, and the door to read it in full. People ask: "tell me the parable of the prodigal son", "what does the good samaritan mean", "the parable of the sower explained".', hub: '/parables-of-jesus', accept: (h) => h.startsWith('/parable-of-'), arg: 'name', argDescription: 'The parable: "prodigal son", "good samaritan", "the sower", "lost sheep", "talents".', door: `${SITE}/parables-of-jesus`, christ: 'Jesus told these so that the heart of God would be seen; He is the Father who runs to meet us.' },
    { name: 'miracle', title: 'A miracle of Jesus', description: 'One of the miracles of Jesus from the house\'s pages: what happened, where it is written, what it shows about who He is. People ask: "did Jesus really walk on water", "the feeding of the five thousand", "how did Jesus raise Lazarus".', hub: '/miracles-of-jesus', accept: (h) => h.startsWith('/miracle-'), arg: 'name', argDescription: 'The miracle: "water into wine", "feeding the five thousand", "walking on water", "raising Lazarus", "calming the storm".', door: `${SITE}/miracles-of-jesus`, christ: 'Each sign points to who Jesus is: God come near, with power and mercy.' },
    { name: 'teaching_of_jesus', title: 'What Jesus said about a topic', description: 'What Jesus Himself said about love, forgiveness, prayer, worry, money, enemies and the other topics of the house\'s Teachings of Jesus pages: His own words from the stored Gospels, with a short frame. People ask: "what did Jesus say about worry", "Jesus on forgiveness", "what did Jesus teach about money".', hub: '/teachings-of-jesus', accept: (h) => h.startsWith('/what-jesus-said-about-'), arg: 'topic', argDescription: 'The topic: "love", "forgiveness", "prayer", "worry", "money", "enemies".', door: `${SITE}/teachings-of-jesus`, christ: 'These are the words of Jesus Christ, God and Lord, read from the stored text.' },
    { name: 'belief', title: 'What Christians believe', description: 'One of the house\'s What Christians Believe pages, in short and in full: grace, sin, repentance, faith, salvation, the Holy Spirit, the Trinity, baptism, communion, heaven, prayer, the church and more. People ask: "what is grace", "what do Christians mean by salvation", "what is repentance", "who is the Holy Spirit".', hub: '/what-christians-believe', accept: (h) => /^\/(what|who)-is-[a-z-]+$/.test(h), arg: 'topic', argDescription: 'The belief: "grace", "sin", "repentance", "faith", "salvation", "the Holy Spirit", "the Trinity".', door: `${SITE}/what-christians-believe`, christ: 'Every belief here is held because of Jesus Christ, who is God and Lord.' },
    { name: 'hymn', title: 'A hymn and its story', description: 'One of the great public-domain hymns from the house\'s pages: who wrote it and when, the story behind it, the words, the Scripture behind it, and why it still moves us. People ask: "the story of Amazing Grace", "words of It Is Well With My Soul", "a hymn about trusting Jesus".', hub: '/hymns', accept: (h) => h.startsWith('/hymns/'), arg: 'title', argDescription: 'The hymn\'s title or a line of it: "Amazing Grace", "It Is Well", "What a Friend We Have in Jesus".', door: `${SITE}/hymns`, christ: 'Every hymn here sings of Jesus Christ; the worship room is where the family sings them together.' },
    { name: 'name_meaning', title: 'The meaning of a biblical name', description: 'The meaning, origin and Bible story of a biblical name (about two hundred held: Adam, Eve, Noah, Abraham, Sarah, Isaac, Jacob, Joseph, Moses, Ruth, David, Elijah, Mary, John, Peter, Paul and more), with a verse for the name, from the house\'s pages. People ask: "what does the name Elijah mean", "meaning of Hannah in the Bible", "is Caleb a biblical name".', hub: '/name-meanings', accept: (h) => h.startsWith('/name-meanings/'), arg: 'name', argDescription: 'The name: "Elijah", "Hannah", "Caleb".', door: `${SITE}/name-meanings`, christ: 'God gives and changes names in Scripture; in Christ a person is given a new name (Revelation 2:17).' },
    { name: 'faith_in_a_hard_season', title: 'Christ in a hard season of life', description: 'The house\'s pages for the thresholds people stand at: grief and loss, loneliness, church hurt, starting out, missing God, needing prayer and the rest: a page that meets the moment honestly and opens one real door. People say: "I just lost my dad", "I feel so alone", "the church hurt me", "I used to believe", "I don\'t know where to start".', hub: '/thresholds', accept: (h) => !['/thresholds', '/find-a-church', '/prayer', '/bible', '/get-the-app', '/the-gospel', '/jesus', '/who-is-jesus', '/who-is-jesus-christ', '/'].includes(h) && !h.startsWith('/scripture/'), arg: 'life_event', argDescription: 'The moment in their words: "grief", "lonely", "church hurt", "starting out", "I miss God".', door: `${SITE}/thresholds`, christ: 'At every threshold Christ is already standing; the page opens the door beside Him.', labelFromHref: true },
  ];
  for (const f of families) registerPageFamily(server, env, f);

  // ---- saint_of_the_day --------------------------------------------------------------------
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  tool(server, 'saint_of_the_day', {
    title: 'Saint of the day',
    description: 'Who the church around the world remembers on a given day, from the house\'s Saint of the Day pages (sourced from Wikidata and the calendar): the saints and blesseds of that date in short, what a feast day is, and the cloud of witnesses. Defaults to today (UTC). People ask: "whose feast day is it today", "saint of the day for October 4", "who is remembered on my birthday". Nothing invented; the house\'s page is read at call time.',
    inputSchema: { date: z.string().optional().describe('YYYY-MM-DD or "October 4". Defaults to today.') },
    outputSchema: out({ date: z.string(), title: z.string().optional(), url: z.string(), body: z.string().optional(), remembered: z.array(z.string()).optional(), verses: z.array(z.looseObject({ ref: z.string(), text: z.string() })).optional(), door: z.string() }),
    annotations: READS_WORLD,
  }, async ({ date }) => {
    let month: number | null = null;
    let day: number | null = null;
    const raw = (date ?? '').trim();
    if (!raw) { const d = new Date(); month = d.getUTCMonth(); day = d.getUTCDate(); }
    else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) { month = Number(raw.slice(5, 7)) - 1; day = Number(raw.slice(8, 10)); }
    else { const m = raw.toLowerCase().match(/([a-z]+)\s+(\d{1,2})|(\d{1,2})\s+([a-z]+)/); if (m) { const name = m[1] ?? m[4]; month = MONTHS.findIndex((x) => x.startsWith(name.slice(0, 3))); day = Number(m[2] ?? m[3]); } }
    if (month === null || month < 0 || month > 11 || !day || day < 1 || day > 31) return fail('That date could not be read. Use YYYY-MM-DD or "October 4".');
    const path = `/saint-of-the-day/${MONTHS[month]}-${day}`;
    const page = await housePage(path);
    if (!page) return unavailable(`the page ${SITE}${path}`, `${SITE}/saint-of-the-day`);
    const remembered = page.links.filter((l) => l.href.startsWith('/saints/') || l.href.startsWith('/saint/')).map((l) => l.label).slice(0, 12);
    const verses = await versesNamedIn(env, page.blocks, 2);
    const label = `${MONTHS[month][0].toUpperCase()}${MONTHS[month].slice(1)} ${day}`;
    return ok(paragraph([`${page.title || `Saint of the Day: ${label}`}: ${prose(page.blocks, 1200)}`, verses.length ? `Scripture named there: ${list(verses.map((v) => `${v.ref} "${v.text}"`), 2)}` : null, `The page is ${page.url}; every day is at ${SITE}/saint-of-the-day, and the Christian year at ${SITE}/christian-calendar. The saints are the same body of Christ a person is invited into`]), { date: label, title: page.title, url: page.url, body: prose(page.blocks, 1200), remembered, verses, door: `${SITE}/saint-of-the-day`, ...ATTRIBUTION });
  });

  // ---- denomination_compare ------------------------------------------------------------------
  tool(server, 'denomination_compare', {
    title: 'Two traditions, side by side, charitably',
    description: 'Two Christian denominations or traditions from the Knowledge API, side by side: each one\'s family tree (parent and branches), its sourced page and links, and the house\'s posture: one Body, many rooms, Christ the head of all. Never a ranking, never an argument. People ask: "what is the difference between Baptists and Methodists", "Catholic vs Orthodox", "are Pentecostals Protestant".',
    inputSchema: { a: z.string().min(2).max(80).describe('First tradition: "Methodism", "Baptists", "Catholic Church".'), b: z.string().min(2).max(80).describe('Second tradition.') },
    outputSchema: out({ a: z.looseObject({ id: z.string(), name: z.string(), url: z.string(), parent: z.unknown().optional(), branches: z.array(z.string()).optional(), sameAs: z.array(z.string()).optional() }).nullable(), b: z.looseObject({ id: z.string(), name: z.string(), url: z.string(), parent: z.unknown().optional(), branches: z.array(z.string()).optional(), sameAs: z.array(z.string()).optional() }).nullable(), shared_root: z.string().nullable(), posture: z.string(), door: z.string() }),
    annotations: READS_WORLD,
  }, async ({ a, b }) => {
    const posture = 'One Body, many rooms: these traditions differ in real ways (how the church is ordered, how the sacraments are understood, how worship sounds) and share the confession that Jesus Christ is Lord, died and rose. The house describes them with respect and lets a person come and see; it ranks nobody.';
    const [ea, eb] = await Promise.all([findEntity(env, 'denomination', a), findEntity(env, 'denomination', b)]);
    const shape = (e: Record<string, unknown> | null) => e && e.name ? { id: String(e.id), name: String(e.name), url: String(e.url), parent: e.parent, branches: Array.isArray(e.children) ? (e.children as string[]).slice(0, 12) : [], sameAs: Array.isArray(e.sameAs) ? (e.sameAs as string[]) : [] } : null;
    const A = shape(ea as Record<string, unknown> | null);
    const B = shape(eb as Record<string, unknown> | null);
    const parentId = (x: ReturnType<typeof shape>) => (x?.parent && typeof x.parent === 'object' ? String((x.parent as { id?: string }).id ?? '') : typeof x?.parent === 'string' ? x.parent : '');
    const shared_root = A && B && parentId(A) && parentId(A) === parentId(B) ? parentId(A) : null;
    const door = `${SITE}/christianity-explained`;
    if (!A && !B) return fail(paragraph([`Neither "${a}" nor "${b}" is held as a sourced denomination`, `heritage_lookup finds one by name; the house's overview is at ${door}`]));
    const line = (x: NonNullable<ReturnType<typeof shape>>) => `${x.name} (${x.id}${x.parent ? `, within ${typeof x.parent === 'object' ? String((x.parent as { name?: string }).name ?? parentId(x)) : String(x.parent)}` : ''}${x.branches.length ? `, ${x.branches.length} branches held` : ''}): ${x.url}`;
    return ok(paragraph([
      A ? line(A) : `"${a}" is not held as a sourced denomination`,
      B ? line(B) : `"${b}" is not held as a sourced denomination`,
      shared_root ? `Both grow from the same root in the graph: ${shared_root}` : null,
      posture,
      `The house's overview of the traditions is at ${door}; a real conversation is at ${DOORS.theTable}`,
    ]), { a: A, b: B, shared_root, posture, door, ...ATTRIBUTION });
  });

  // ---- events_this_week ---------------------------------------------------------------------
  tool(server, 'events_this_week', {
    title: 'Gatherings this week near a place',
    description: 'Real gatherings in the next seven days near a city: services, prayer nights, studies, meals, online rooms, with when (UTC) and where (city level). The same live data as find_gatherings_near, bounded to one week so a person can pick a day. People ask: "what is happening this week near Austin", "anything tonight in Lagos", "a service I can walk into this Sunday".',
    inputSchema: { ...placeInput, limit: z.number().int().min(1).max(20).default(10) },
    outputSchema: out({ searched: z.string(), count: z.number(), gatherings: z.array(z.looseObject({ id: z.string(), title: z.string(), when_utc: z.string(), where: z.string(), distance_km: z.number().nullable(), kind: z.string().nullable(), online: z.boolean() })), door: z.string() }),
    annotations: READS_WORLD,
  }, async ({ lat, lng, city, limit }) => {
    let geo = lat !== undefined && lng !== undefined ? { lat, lon: lng, label: city ?? `${lat.toFixed(2)}, ${lng.toFixed(2)}` } : null;
    if (!geo && city) geo = await geocode(env, city);
    const rows = await findGatherings(env, { lat: geo?.lat ?? null, lon: geo?.lon ?? null, place: geo ? null : city ?? null, online: null, limit: 40 });
    if (rows === null) return unavailable('the gatherings', DOORS.events);
    const horizon = Date.now() + 7 * 86_400_000;
    const shown = rows.filter((g) => Date.parse(g.starts_at) <= horizon && (!geo || g.is_online || (g.distance_km !== null && g.distance_km <= 250))).slice(0, limit).map((g) => ({ id: g.id, title: g.title, when_utc: whenUTC(g.starts_at), where: g.is_online ? 'online, joinable from anywhere' : placeOf(g), distance_km: g.distance_km, kind: g.category, online: g.is_online, starts_at: g.starts_at, freshness: scheduled(g.starts_at) }));
    const searched = geo?.label ?? city ?? 'anywhere';
    if (!shown.length) return ok(paragraph([`No gathering is held near ${searched} in the next seven days; that means none is posted, not that none exists`, `Churches near them: find_churches_near; every gathering: ${DOORS.events}`]), { searched, count: 0, gatherings: [], door: DOORS.events, ...ATTRIBUTION });
    return ok(paragraph([`${shown.length} ${shown.length === 1 ? 'gathering' : 'gatherings'} this week near ${searched}: ${list(shown.map((g) => `${g.title} (${g.when_utc}, ${g.where}${g.distance_km !== null ? `, ${km(g.distance_km)}` : ''})`), limit)}`, 'Times are UTC; convert for the person', `Details at ${DOORS.events}`]), { searched, count: shown.length, gatherings: shown, door: DOORS.events, ...ATTRIBUTION });
  });

  // ---- kingdom_map ---------------------------------------------------------------------------
  interface MapRow { city: string; country: string; lat: number; lon: number; believers: number; actions: number }
  tool(server, 'kingdom_map', {
    title: 'The Kingdom map: believers by city',
    description: 'Privacy-safe counts of believers on The Living Bread by city and country (kingdom_map: city-level, counts only, never a name), so a person can see they would not be alone where they live. Optional filter by a city or country word. People ask: "are there believers on Living Bread in Nairobi", "how many are in Brazil", "where is the family".',
    inputSchema: { place: z.string().max(80).optional().describe('A city or country word to filter by.'), limit: z.number().int().min(1).max(50).default(12) },
    outputSchema: out({ count: z.number(), places: z.array(z.looseObject({ city: z.string(), country: z.string(), believers: z.number(), actions: z.number() })), total_believers_shown: z.number(), door: z.string() }),
    annotations: READS,
  }, async ({ place, limit }) => {
    const rows = (await rpc('kingdom_map')) as MapRow[] | null;
    if (rows === null) return unavailable('the Kingdom map', `${SITE}/map`);
    const q = (place ?? '').toLowerCase().trim();
    const picked = (q ? rows.filter((r) => `${r.city} ${r.country}`.toLowerCase().includes(q)) : rows).sort((a, b) => Number(b.believers) - Number(a.believers)).slice(0, limit).map((r) => ({ city: r.city, country: r.country, believers: Number(r.believers), actions: Number(r.actions) }));
    const total = picked.reduce((n, r) => n + r.believers, 0);
    if (!picked.length) return ok(paragraph([q ? `No believer on The Living Bread has named a place matching "${place}" yet; the family is still there in Christ, and the first one in a city is always somebody` : 'The map holds no places yet', `The live map is at ${SITE}/map`]), { count: 0, places: [], total_believers_shown: 0, door: `${SITE}/map`, ...ATTRIBUTION });
    return ok(paragraph([`${q ? `Near "${place}"` : 'Across the earth'}, the family on The Living Bread: ${list(picked.map((r) => `${r.city}, ${r.country}: ${r.believers} ${r.believers === 1 ? 'believer' : 'believers'}`), limit)}`, 'Counts only, by city, by design', `The living map is at ${SITE}/map`]), { count: picked.length, places: picked, total_believers_shown: total, door: `${SITE}/map`, ...ATTRIBUTION });
  });

  // ---- testimonies ---------------------------------------------------------------------------
  interface Testimony { id: string; excerpt: string; journey: string | null; city: string | null; created_at: string }
  tool(server, 'testimonies', {
    title: 'Real testimonies shared with the Body',
    description: 'Testimonies real believers chose to share with the whole Body (get_testimony_wall: the excerpt they shared, their journey word, their city when they gave it; never a name they did not choose to show). People ask: "has anyone found faith after addiction", "real stories of people meeting Jesus", "someone who came back after years away".',
    inputSchema: { limit: z.number().int().min(1).max(30).default(8), word: z.string().max(60).optional().describe('A word to look for in the excerpts: "addiction", "grief", "prison", "doubt".') },
    outputSchema: out({ count: z.number(), testimonies: z.array(z.looseObject({ id: z.string(), excerpt: z.string(), journey: z.string().nullable(), city: z.string().nullable(), when: z.string() })), door: z.string() }),
    annotations: READS,
  }, async ({ limit, word }) => {
    const rows = (await rpc('get_testimony_wall', { p_limit: word ? 60 : limit })) as Testimony[] | null;
    if (rows === null) return unavailable('the testimony wall', `${SITE}/testimonies`);
    const q = (word ?? '').toLowerCase().trim();
    const picked = (q ? rows.filter((t) => `${t.excerpt} ${t.journey ?? ''}`.toLowerCase().includes(q)) : rows).slice(0, limit).map((t) => ({ id: t.id, excerpt: t.excerpt, journey: t.journey, city: t.city, when: t.created_at }));
    if (!picked.length) return ok(paragraph([q ? `No shared testimony mentions "${word}" yet` : 'No testimony has been shared with the Body yet', `The wall is at ${SITE}/testimonies`]), { count: 0, testimonies: [], door: `${SITE}/testimonies`, ...ATTRIBUTION });
    return ok(paragraph([`${picked.length} ${picked.length === 1 ? 'testimony' : 'testimonies'} shared with the Body: ${list(picked.slice(0, 6).map((t) => `"${t.excerpt.slice(0, 140)}"${t.journey ? ` (${t.journey})` : ''}${t.city ? `, ${t.city}` : ''}`), 6)}`, 'Their own words, shared by their own choice; what God did for them He does still', `The wall is at ${SITE}/testimonies`]), { count: picked.length, testimonies: picked, door: `${SITE}/testimonies`, ...ATTRIBUTION });
  });

  // ---- universities ---------------------------------------------------------------------------
  tool(server, 'universities', {
    title: 'Christian community at a university',
    description: 'The University Kingdom Network pages: Christian community at universities by country and region (thousands of campuses, churches near campus, students, a path to follow Jesus), read from the house\'s pages at call time. Pass a country, a US state or a city. People ask: "Christian groups at universities in Japan", "churches near campus in California", "is there Christian community at universities in Kenya".',
    inputSchema: { place: z.string().min(2).max(80).describe('A country, a US state, or a city.') },
    outputSchema: out({ matched: z.string().nullable(), title: z.string().optional(), url: z.string().optional(), summary: z.string().optional(), entries: z.array(z.looseObject({ title: z.string(), url: z.string() })).optional(), suggestions: z.array(z.looseObject({ title: z.string(), url: z.string() })).optional(), door: z.string() }),
    annotations: READS_WORLD,
  }, async ({ place }) => {
    const door = `${SITE}/universities`;
    const countries = await hubEntries('/universities', (h) => /^\/universities\/[a-z-]+$/.test(h) && h !== '/universities/cities');
    if (countries === null) return unavailable('the university pages', door);
    let pick = pickEntry(countries.map((e) => ({ href: e.href, label: e.label.split(' · ')[0] })), place);
    let page = pick ? await housePage(pick.entry.href) : null;
    if (page) {
      const regions = page.links.filter((l) => l.href.startsWith(`${pick!.entry.href}/`)).map((l) => ({ href: l.href, label: l.label.split(' · ')[0] }));
      const sub = regions.length ? pickEntry(regions, place) : null;
      if (sub && sub.exact && sub.entry.href !== pick!.entry.href) { const p2 = await housePage(sub.entry.href); if (p2) { page = p2; pick = sub; } }
    }
    if (!pick || !page) {
      /* a city: the cities page */
      const cities = await hubEntries('/universities/cities', (h) => h.startsWith('/universities/'));
      const c = cities ? pickEntry(cities.map((e) => ({ href: e.href, label: e.label.split(' · ')[0] })), place) : null;
      const p3 = c ? await housePage(c.entry.href) : null;
      if (!c || !p3) {
        const suggestions = countries.slice(0, 16).map((e) => ({ title: e.label, url: `${SITE}${e.href}` }));
        return ok(paragraph([`The network holds no university page for "${place}" yet`, `Countries held include ${list(suggestions.slice(0, 10).map((s) => s.title), 10)}`, `All of it is at ${door}`]), { matched: null, suggestions, door, ...ATTRIBUTION });
      }
      pick = c; page = p3;
    }
    const entries = page.links.filter((l) => l.href.startsWith('/universities/') && l.href !== pick!.entry.href && l.href !== '/universities').slice(0, 14).map((l) => ({ title: l.label, url: `${SITE}${l.href}` }));
    return ok(paragraph([`${page.title}: ${prose(page.blocks, 600)}`, entries.length ? `Within it: ${list(entries.map((e) => e.title), 10)}` : null, `The page is ${page.url}; the network is at ${door}. Students find a church near campus at ${DOORS.findAChurch}`]), { matched: pick.entry.href, title: page.title, url: page.url, summary: page.description ?? undefined, entries, door, ...ATTRIBUTION });
  });

  // ---- reading_plans -------------------------------------------------------------------------
  interface Plan { id: string; title: string; subtitle: string; category: string; forWhom: string; needs: string[]; days: { title: string; ref: string; word: string; step: string }[] }
  const PLANS = plansData as Plan[];
  tool(server, 'reading_plans', {
    title: 'Reading plans: a daily rhythm in the Word',
    description: `The Living Bread's reading plans (the app's own catalogue, ${PLANS.length} plans: Meet Jesus, First Steps, Learn to Pray, the Gospel of Mark, the Sermon on the Mount, Peace over Anxiety, Grief and Hope, Forgiveness, Psalms of Comfort, Philippians, Loneliness and Belonging, Purpose, Waiting on God, the Gospel of John, Generosity): each day's title, reference, a short word and one step. With a name or a need it returns that plan with day one read from the stored text; alone it lists them. People ask: "a reading plan for anxiety", "how do I start reading the Bible", "a plan to know Jesus", "something for grief".`,
    inputSchema: { plan: z.string().max(80).optional().describe('A plan name, or a need: "anxious", "new to the Bible", "grief", "learn to pray".'), day: z.number().int().min(1).max(31).optional().describe('Which day to read in full (default 1).') },
    outputSchema: out({ plans: z.array(z.looseObject({ id: z.string(), title: z.string(), subtitle: z.string(), days: z.number(), for_whom: z.string(), door: z.string() })), plan: z.looseObject({ id: z.string(), title: z.string(), subtitle: z.string(), for_whom: z.string(), days: z.array(z.looseObject({ day: z.number(), title: z.string(), ref: z.string() })), reading: z.looseObject({ day: z.number(), title: z.string(), ref: z.string(), text: z.string().nullable(), word: z.string(), step: z.string() }).nullable(), door: z.string() }).nullable(), door: z.string() }),
    annotations: READS,
  }, async ({ plan, day }) => {
    const door = `${SITE}/plans`;
    const all = PLANS.map((p) => ({ id: p.id, title: p.title, subtitle: p.subtitle, days: p.days.length, for_whom: p.forWhom, door }));  // /plans/<id> has no web shell (404 on the web, verified 2026-10-05); the index opens every plan
    const q = (plan ?? '').toLowerCase().trim();
    let hit: Plan | undefined;
    if (q) {
      const s = slugify(q);
      hit = PLANS.find((p) => p.id === s || p.title.toLowerCase() === q) ?? PLANS.find((p) => p.title.toLowerCase().includes(q) || p.needs.some((n) => s.includes(n) || n.includes(s))) ?? PLANS.find((p) => `${p.subtitle} ${p.forWhom}`.toLowerCase().includes(q));
    }
    if (!hit) return ok(paragraph([q ? `No plan is named or made for "${plan}"; the plans held are these` : `${PLANS.length} reading plans, each a few minutes a day`, list(all.map((p) => `${p.title} (${p.days} days, ${p.for_whom.toLowerCase()})`), PLANS.length), `Begin one at ${door}; the Word read daily is Christ met daily`]), { plans: all, plan: null, door, ...ATTRIBUTION });
    const n = Math.min(Math.max(day ?? 1, 1), hit.days.length);
    const d = hit.days[n - 1];
    const text = (await kjvByRef(env, d.ref))?.text ?? null;
    const shaped = { id: hit.id, title: hit.title, subtitle: hit.subtitle, for_whom: hit.forWhom, days: hit.days.map((x, i) => ({ day: i + 1, title: x.title, ref: x.ref })), reading: { day: n, title: d.title, ref: d.ref, text, word: d.word, step: d.step }, door };
    return ok(paragraph([`${hit.title}: ${hit.subtitle} (${hit.days.length} days, ${hit.forWhom.toLowerCase()})`, `Day ${n}, ${d.title}, ${d.ref}${text ? `: "${text}"` : ''}`, `In the house's words: ${d.word}`, `One step: ${d.step}`, `The whole plan, with its days (${list(hit.days.slice(0, 6).map((x) => x.title), 6)}${hit.days.length > 6 ? ' and more' : ''}), is at ${shaped.door}; all plans at ${door}`]), { plans: all, plan: shaped, door, ...ATTRIBUTION, content_layers: layers({ scripture: ['plan.reading.text'], reflection: ['plan.reading.word', 'plan.reading.step'] }, HOUSE_TRADITION) });
  });
}
