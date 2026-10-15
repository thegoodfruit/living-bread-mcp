/* ============================================================
   THE LIVING BREAD MCP, the watch: a person, at any hour.

   An assistant can do almost everything except put a person next to a
   person. When somebody tells an assistant at three in the morning that
   they are grieving, asks for prayer, or says they want to know Jesus, it
   has no human to hand them to. These tools are that hand, said honestly.

   In 1727 the believers at Herrnhut divided the day into hours and kept a
   prayer watch, one or two at a time, around the clock, for a hundred
   years. Nobody kept all of it; everybody kept an hour. Living Bread's
   watch is the same shape: believers keep weekly hours in their own time
   zone (0960), and whoever keeps the hour now, or opened a live
   "available to pray, listen, talk, welcome" window, is on watch.

     a_person_now        (public, read only) the watch this minute: how many
                         keep it, their app languages, whether this hour is
                         kept or a gap, the real median time for a person to
                         come over seven days (honest when slow), and the
                         exact door where the person asks to be met.
     the_watch_tonight   (public, read only) the coverage wheel, kept hours
                         and gaps in UTC and in a time zone, and the door to
                         keep an uncovered hour.
     keep_the_watch      (/me only, consented) keep or release a weekly hour.
     living-bread://watch/now   the same live state as a resource.
     i_need_a_person     a prompt: listen, crisis check, then a_person_now.

   THE READ TOOLS NEVER SEND ANYTHING. They read counts from the database
   (watch_now_public, prayer_coverage: anonymous, aggregate, no names, no
   ids, no places) and hand back a door. Asking is the person's own act, on
   the page, in their own words. Nothing here is a crisis service: when
   anyone is in danger, crisis_resources comes first.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { type Believer, rpcAs } from './auth';
import { consent, declined, notYet } from './consent';
import { SITE } from './doors';
import { record } from './freshness';
import { list, paragraph } from './render';
import { fail, ok, out, READS, tool, WRITES_ONCE } from './shared';

export const WANTS = ['prayer', 'talk', 'know_jesus', 'hard_season'] as const;
export type WatchWant = (typeof WANTS)[number];

const WANT_WORDS: Record<WatchWant, string> = {
  prayer: 'someone to pray with them',
  talk: 'someone to talk to',
  know_jesus: 'someone to tell them about Jesus and welcome them',
  hard_season: 'someone to be with them in a hard season',
};

/** The guest door for one kind of ask. No account is needed to use it. */
export function doorFor(want: WatchWant | null | undefined, via = 'assistant'): string {
  const q = new URLSearchParams();
  if (want) q.set('want', want);
  q.set('via', via);
  return `${SITE}/a-person?${q.toString()}`;
}
export const KEEP_DOOR = `${SITE}/watch`;
export const CRISIS_DOOR = `${SITE}/sos`;
export const HERRNHUT = 'In 1727 the believers at Herrnhut kept a prayer watch, hour by hour, day and night, for a hundred years. Nobody kept all of it; everybody kept an hour.';

export interface WatchNow {
  computed_at: string;
  keeping_watch_now: number;
  keeping_this_hour: number;
  said_available_now: number;
  languages: string[];
  this_hour_kept: boolean;
  next_24_hours: { kept: number; gaps: number; first_gap: string | null; next_kept: string | null };
  week: { hours: number; kept: number; keepers: number };
  time_to_a_person_7d: { asked: number; answered: number; median_minutes: number | null; watch_asked: number; watch_answered: number; watch_median_minutes: number | null };
}

async function anon<T>(env: Env, fn: string, args: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/* ---- time, said the way a person says it (pure; held by tests) -------------------------------- */
export function validZone(tz: string | null | undefined): string | null {
  const t = (tz ?? '').trim();
  if (!t) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: t }).format(new Date());
    return t;
  } catch {
    return null;
  }
}

export function localParts(iso: string, tz: string): { dow: number; hour: number; label: string } {
  const at = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', hour: 'numeric' }).formatToParts(at);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  return { dow, hour, label: `${wd} ${hourWord(hour)}` };
}

export function hourWord(h: number): string {
  const x = ((h % 24) + 24) % 24;
  if (x === 0) return 'midnight';
  if (x === 12) return 'noon';
  return x < 12 ? `${x}am` : `${x - 12}pm`;
}

/** "about 17 hours", "6 minutes", or null when there is nothing to measure. Never rounded kind. */
export function minutesWord(m: number | null | undefined): string | null {
  if (m === null || m === undefined || !Number.isFinite(Number(m))) return null;
  const n = Number(m);
  if (n < 1) return 'under a minute';
  if (n < 90) return `${Math.round(n)} ${Math.round(n) === 1 ? 'minute' : 'minutes'}`;
  const h = n / 60;
  if (h < 36) return `about ${Math.round(h)} hours`;
  return `about ${Math.round(h / 24)} days`;
}

/** Consecutive gap hours folded into ranges, in local labels: "Tue 1am to 5am", "Wed noon". */
export function gapRanges(hours: readonly { hour_start: string; watchers: number }[], tz: string, max = 12): string[] {
  const out: string[] = [];
  let start: string | null = null;
  let prev: string | null = null;
  const flush = () => {
    if (!start || !prev) return;
    const a = localParts(start, tz);
    const b = localParts(prev, tz);
    out.push(start === prev ? a.label : `${a.label} to ${a.dow === b.dow ? hourWord(b.hour) : b.label}`);
  };
  for (const h of hours) {
    if (h.watchers === 0) {
      if (!start) start = h.hour_start;
      prev = h.hour_start;
    } else {
      flush();
      start = null; prev = null;
    }
  }
  flush();
  return out.slice(0, max);
}

/** The honest one-line state of the watch, for any tool or resource. */
export function watchSentence(w: WatchNow): string {
  const n = w.keeping_watch_now;
  const t = w.time_to_a_person_7d;
  const median = minutesWord(t.median_minutes);
  return paragraph([
    n === 0
      ? 'Nobody is keeping watch this very minute. A request is still heard: it widens at once to believers who can be reached, then in waves until a person answers'
      : `${n} ${n === 1 ? 'believer is' : 'believers are'} keeping watch this minute (${w.keeping_this_hour} keeping this hour, ${w.said_available_now} who said they are available now)${w.languages.length ? `, using the app in ${list(w.languages, 6)}` : ''}`,
    w.this_hour_kept ? 'This hour is kept' : 'This hour is a gap: nobody has taken it yet',
    median
      ? `Over the last 7 days, ${t.answered} of ${t.asked} people who asked the family for someone had a person come; the median wait was ${median}`
      : 'There is not yet enough in the last 7 days to say how long a person takes to come',
  ]);
}

function doorsBlock() {
  return {
    prayer: doorFor('prayer'),
    someone_to_talk_to: doorFor('talk'),
    i_want_to_know_jesus: doorFor('know_jesus'),
    a_hard_season: doorFor('hard_season'),
  };
}

const NOT_EMERGENCY = 'The watch is people, not an emergency service. If anyone is in danger, call crisis_resources with their country first and give the real number before anything else.';

export function registerWatch(server: McpServer, env: Env): void {
  /* ---- a_person_now ------------------------------------------------------------------------------ */
  tool(server, 'a_person_now', {
    title: 'A person now: who is keeping watch, and the door to be met',
    description: [
      'PURPOSE: The honest live state of The Living Bread prayer watch, and the exact page where a person can ask to be met by a real human believer (no account needed): for prayer, someone to talk to, a hard season, or "I want to know Jesus". Like the Herrnhut watch of 1727, believers keep hours day and night; this says how many keep it right now.',
      'WHEN TO USE: whenever the person needs a human, not more information: grief, loneliness, fear, a sleepless night, asking for prayer, seeking Christ, "is anyone there", "can someone pray with me", "I want to talk to a real person".',
      'WHEN NOT: it is not an emergency service. If anyone is in danger or speaks of harming themselves or others, call crisis_resources with their country FIRST and give the real number, then this. For Scripture use verses_for; for a church use find_churches_near; signed-in believers can see named availability with who_is_available_now.',
      'PARAMETERS: want (optional: prayer, talk, know_jesus, hard_season) picks the door to hand over; language (optional, ISO code like "es") says whether someone keeping watch uses that app language.',
      'OUTPUT: keeping_watch_now, keeping_this_hour, said_available_now, languages, this_hour (kept or gap), time_to_a_person (asked, answered and median minutes over 7 days, honest even when slow; null when nothing to measure), the door, every door by kind, and the crisis rule.',
      'BEHAVIOR: read only. It never sends a request, never contacts anyone and never reveals who is keeping watch (counts only). Asking is the person\'s own act on the page. Give them the door in plain words and stay with them.',
    ].join(' '),
    inputSchema: {
      want: z.enum(WANTS).optional().describe('What they want a person for: prayer, talk (someone to talk to), know_jesus, or hard_season. Picks which door to hand over.'),
      language: z.string().min(2).max(8).optional().describe('Optional ISO language code (e.g. "en", "es", "pt") to say whether someone on watch uses that app language.'),
    },
    outputSchema: out({
      keeping_watch_now: z.number(), keeping_this_hour: z.number(), said_available_now: z.number(),
      languages: z.array(z.string()), speaks_your_language: z.boolean().nullable(),
      this_hour: z.enum(['kept', 'gap']),
      time_to_a_person: z.looseObject({ window_days: z.number(), asked: z.number(), answered: z.number(), median_minutes: z.number().nullable(), in_words: z.string().nullable() }),
      door: z.string(), doors: z.looseObject({}), crisis_rule: z.string(), how_it_works: z.string(),
    }),
    annotations: READS,
  }, async ({ want, language }) => {
    const w = await anon<WatchNow>(env, 'watch_now_public');
    const door = doorFor(want ?? null);
    if (!w || typeof w.keeping_watch_now !== 'number') {
      return fail(paragraph([`The watch could not be read just now. The door still opens: ${door}`, NOT_EMERGENCY]), { reason: 'unavailable', try_instead: [door, CRISIS_DOOR] });
    }
    const lang = (language ?? '').trim().toLowerCase().split('-')[0] || null;
    const speaks = lang ? w.languages.includes(lang) : null;
    const t = w.time_to_a_person_7d;
    const how = 'On the page they give a first name, what they would like (prayer, talk, a hard season, or to know Jesus), a language, and optionally an email or keep the tab open. It reaches whoever keeps watch now (and their own family, if they are signed in); if nobody takes it, it widens in waves, at about ten minutes, thirty minutes and then every hour, each to new believers who can actually be reached, until a person answers. They are told each time more people are asked. The first to answer writes to them there (first name only), and they can write back.';
    return ok(paragraph([
      watchSentence(w),
      lang ? (speaks ? `Someone on watch uses the app in "${lang}"` : `Nobody on watch this minute uses the app in "${lang}"; a request in any language is still read`) : null,
      `The door, for ${want ? WANT_WORDS[want] : 'a person'}: ${door}. No account is needed; nothing has been sent by this tool`,
      NOT_EMERGENCY,
    ]), {
      keeping_watch_now: w.keeping_watch_now,
      keeping_this_hour: w.keeping_this_hour,
      said_available_now: w.said_available_now,
      languages: w.languages,
      speaks_your_language: speaks,
      this_hour: w.this_hour_kept ? 'kept' : 'gap',
      time_to_a_person: { window_days: 7, asked: t.asked, answered: t.answered, median_minutes: t.median_minutes, in_words: minutesWord(t.median_minutes), watch_asked: t.watch_asked, watch_answered: t.watch_answered, watch_median_minutes: t.watch_median_minutes },
      door,
      doors: doorsBlock(),
      crisis_rule: NOT_EMERGENCY,
      crisis_door: CRISIS_DOOR,
      how_it_works: how,
      keep_an_hour: KEEP_DOOR,
      computed_at: w.computed_at,
      freshness: record(w.computed_at, 'Counted at the moment of the call from kept hours and live availability windows. A count, not a promise that any one person will answer this minute.'),
    });
  });

  /* ---- the_watch_tonight ------------------------------------------------------------------------- */
  tool(server, 'the_watch_tonight', {
    title: 'The watch tonight: kept hours and gaps',
    description: [
      'PURPOSE: The coverage wheel of The Living Bread prayer watch: for the next 24 hours (or the week), which hours believers keep and which are gaps, in UTC and in a time zone you give, and the door to keep an uncovered hour.',
      'WHEN TO USE: when a believer asks how they can help, wants to pray for others at night, asks "when is nobody praying", or you want to invite them to keep an hour ("3am Pacific is uncovered").',
      'WHEN NOT: when a person needs someone now, use a_person_now instead. To actually keep an hour as a signed-in believer, use keep_the_watch (connected at /me).',
      'PARAMETERS: time_zone (IANA, e.g. "America/Los_Angeles"; UTC when omitted or unknown); hours (24 or 168).',
      'OUTPUT: kept and gap counts, each hour with utc, local label and keepers, the gaps folded into local ranges, the first night gap, and the door.',
      'BEHAVIOR: read only; counts only, never who. Coverage is computed from hours real believers chose, never claimed: gaps are shown as gaps.',
    ].join(' '),
    inputSchema: {
      time_zone: z.string().max(64).optional().describe('IANA time zone for local labels, e.g. "America/Los_Angeles", "Africa/Lagos". UTC when omitted.'),
      hours: z.union([z.literal(24), z.literal(168)]).default(24).describe('24 for the next day, 168 for the week.'),
    },
    outputSchema: out({
      time_zone: z.string(), hours_counted: z.number(), kept: z.number(), gaps: z.number(),
      wheel: z.array(z.looseObject({ utc: z.string(), local: z.string(), keepers: z.number() })),
      gap_ranges: z.array(z.string()), invitation: z.string().nullable(), door: z.string(),
    }),
    annotations: READS,
  }, async ({ time_zone, hours }) => {
    const tz = validZone(time_zone) ?? 'UTC';
    const n = hours === 168 ? 168 : 24;
    const rows = await anon<{ hour_start: string; watchers: number }[]>(env, 'prayer_coverage', { p_hours: n });
    if (!Array.isArray(rows)) return fail(`The watch could not be read just now. The hours are at ${KEEP_DOOR}.`, { reason: 'unavailable', try_instead: [KEEP_DOOR] });
    const wheel = rows.map((h) => ({ utc: new Date(h.hour_start).toISOString(), local: localParts(h.hour_start, tz).label, keepers: Number(h.watchers ?? 0) }));
    const kept = wheel.filter((h) => h.keepers > 0).length;
    const gaps = wheel.length - kept;
    const ranges = gapRanges(rows.map((h) => ({ hour_start: h.hour_start, watchers: Number(h.watchers ?? 0) })), tz);
    const firstNight = rows.find((h) => Number(h.watchers ?? 0) === 0 && localParts(h.hour_start, tz).hour <= 5) ?? rows.find((h) => Number(h.watchers ?? 0) === 0) ?? null;
    const zoneName = tz === 'UTC' ? 'UTC' : tz.split('/').pop()!.replace(/_/g, ' ');
    const invitation = firstNight ? `${hourWord(localParts(firstNight.hour_start, tz).hour)} (${zoneName} time) is uncovered. Will you keep it?` : null;
    const door = firstNight ? `${KEEP_DOOR}?keep=${localParts(firstNight.hour_start, tz).dow}-${localParts(firstNight.hour_start, tz).hour}` : KEEP_DOOR;
    return ok(paragraph([
      kept === 0 ? `Nobody keeps an hour of the next ${wheel.length} yet. The first hour kept is the beginning` : `${kept} of the next ${wheel.length} hours are kept; ${gaps} are gaps`,
      ranges.length ? `Gaps (${zoneName} time): ${list(ranges, 8)}` : 'Every hour in this window is kept',
      invitation,
      `Keep an hour at ${door}; a believer connected at /me can keep one with keep_the_watch`,
      HERRNHUT,
    ]), { time_zone: tz, hours_counted: wheel.length, kept, gaps, wheel, gap_ranges: ranges, invitation, door, keep_door: KEEP_DOOR, freshness: record(null, 'Computed at the moment of the call from weekly hours believers chose, in their own zones (DST-true).') });
  });

  /* ---- the resource --------------------------------------------------------------------------- */
  server.registerResource('watch-now', 'living-bread://watch/now', {
    title: 'The watch, now',
    description: 'The live state of The Living Bread prayer watch as JSON: keepers now, languages, this hour kept or a gap, median time to a person over 7 days, and the guest doors. Counts only. The same as a_person_now.',
    mimeType: 'application/json',
  }, async (uri) => {
    const w = await anon<WatchNow>(env, 'watch_now_public');
    const body = w
      ? { ...w, summary: watchSentence(w), doors: doorsBlock(), keep_an_hour: KEEP_DOOR, crisis_rule: NOT_EMERGENCY, crisis_door: CRISIS_DOOR }
      : { error: 'unavailable', doors: doorsBlock(), crisis_rule: NOT_EMERGENCY };
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(body, null, 1) }] };
  });

  /* ---- the prompt ------------------------------------------------------------------------------ */
  server.registerPrompt('i_need_a_person', {
    title: 'I need a person',
    description: 'For someone who needs a human, not an answer: listen first, check for danger, then hand them to a real believer on The Living Bread prayer watch.',
    argsSchema: {
      what: z.string().optional().describe('What they are carrying, in their words.'),
      country: z.string().optional().describe('Their country, for the crisis line if needed.'),
    },
  }, (a) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: paragraph([
          `I need a person${a.what ? `. ${a.what}` : ''}`,
          'First, listen. Say back, briefly and gently, what you heard, and do not hurry me or explain my pain',
          `Then check for danger. If I speak of harming myself or anyone else, or I am not safe, call crisis_resources${a.country ? ` with "${a.country}"` : ' with my country (ask me if you do not know it)'} and give me the real number first, before anything else`,
          'Then call a_person_now with what I want (prayer, talk, hard_season, or know_jesus) and tell me plainly, in its numbers, how many believers are keeping watch and how long a person usually takes to come, even if it is slow',
          'Give me the door it returns and tell me what happens there: a first name, a few words, and a real believer answers me by their first name. Do not pretend to be that person, and do not send anything for me',
          'Stay with me while I decide. If I want Scripture, read it only from verses_for or scripture_passage, exactly as returned',
        ]),
      },
    }],
  }));
}

/* ---- keep_the_watch (/me only, consented) ------------------------------------------------------ */
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

export function registerWatchYours(server: McpServer, env: Env, me: Believer): void {
  tool(server, 'keep_the_watch', {
    title: 'Keep (or release) an hour of the watch',
    description: [
      'PURPOSE: For the signed-in believer: keep a weekly hour of The Living Bread prayer watch in their own time zone (for example Tuesday 3am, every week), or release one. While they keep it, people who ask the watch for a person are handed to them; their quiet hours do not hold back a request in an hour they chose.',
      'WHEN TO USE: when the believer says "I will keep 3am on Tuesdays", "sign me up for an hour of the watch", "let go of my Sunday hour".',
      'WHEN NOT: to see which hours are uncovered, use the_watch_tonight first; to ask for a person, use a_person_now. Pausing every hour is done at the door, not here.',
      'PARAMETERS: weekday (sunday..saturday), hour (0 to 23, their local clock), time_zone (IANA, e.g. "America/Los_Angeles"; ask them if you do not know it), keep (true to keep, false to release), confirmed.',
      'OUTPUT: done, the hour as kept, the next time it comes round (UTC), and the door to see or pause their hours.',
      'BEHAVIOR: acts as the signed-in believer only after they confirm in their own words (confirm with the person first: call with confirmed false and read the restatement back; call again with confirmed true only after they said yes). Keeping the same hour twice is the same hour. The watch is kept by adults.',
    ].join(' '),
    inputSchema: {
      weekday: z.enum(DAYS).describe('The weekday, on their own clock.'),
      hour: z.number().int().min(0).max(23).describe('The hour on their own clock, 0 to 23 (3 = 3am, 15 = 3pm).'),
      time_zone: z.string().min(1).max(64).describe('Their IANA time zone, e.g. "America/Los_Angeles". Ask if unknown; never guess.'),
      keep: z.boolean().default(true).describe('True keeps the hour; false releases it.'),
      confirmed: z.boolean().default(false),
    },
    outputSchema: out({ done: z.boolean(), needs_confirmation: z.boolean(), would: z.string().optional(), kept: z.boolean().optional(), next_at: z.string().nullable().optional(), door: z.string().optional() }),
    annotations: WRITES_ONCE,
  }, async ({ weekday, hour, time_zone, keep, confirmed }) => {
    const tz = validZone(time_zone);
    if (!tz) return fail(`"${time_zone}" is not a time zone we can read. Ask the person for theirs, for example America/Los_Angeles or Africa/Lagos.`, { reason: 'bad_time_zone', try_instead: [KEEP_DOOR] });
    const dow = DAYS.indexOf(weekday);
    const label = `${weekday[0].toUpperCase()}${weekday.slice(1)} at ${hourWord(hour)} (${tz})`;
    const would = keep
      ? `Keep ${label} every week as the believer's hour of the watch; while it lasts, people asking the watch for a person can be handed to them`
      : `Release the believer's weekly hour ${label}`;
    const c = await consent(server, confirmed, would);
    if (c === 'ask') return notYet(would, 'keep_the_watch');
    if (c === 'no') return declined(keep ? 'Keeping the hour' : 'Releasing the hour');
    const r = await rpcAs(env, me, 'keep_watch_hour', { p_dow: dow, p_hour: hour, p_timezone: tz, p_keep: keep });
    const d = (r.data ?? null) as { kept?: boolean; released?: boolean; next_at?: string | null } | null;
    if (r.error || !d) return fail(paragraph([`The hour was not kept${r.error ? ` (${r.error})` : ''}`, `It can be kept at ${KEEP_DOOR}`]), { reason: 'not_done', try_instead: [KEEP_DOOR] });
    if (!keep && !d.released) return ok(paragraph([`They were not keeping ${label}, so there was nothing to release`, `Their hours are at ${KEEP_DOOR}`]), { done: true, needs_confirmation: false, kept: false, next_at: null, door: KEEP_DOOR });
    return ok(paragraph([
      keep ? `Kept: ${label}, every week. Next: ${d.next_at ? new Date(d.next_at).toUTCString().replace('GMT', 'UTC') : 'soon'}` : `Released: ${label}`,
      keep ? 'Nobody is held to an hour they cannot keep; they can pause or let it go any time' : 'Stepping back is not recorded against anyone',
      `Their hours, and what is waiting while they keep watch, are at ${KEEP_DOOR}`,
    ]), { done: true, needs_confirmation: false, kept: keep, next_at: d.next_at ?? null, door: KEEP_DOOR });
  });
}
