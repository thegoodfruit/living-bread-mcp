/* ============================================================
   THE LIVING BREAD MCP, every call counted, nobody known.

   The Kingdom Intelligence Layer (docs/KINGDOM_INTELLIGENCE.md) begins here.
   Every tools/call on every endpoint (/mcp, /sse, /me, /app) leaves ONE row in
   public.mcp_calls (migration 1009) through the anon RPC mcp_log_call, fire
   and forget, after the answer is already on its way:

     at              the MINUTE (never the second)
     endpoint        mcp | sse | me | app
     tool, mode      the tool called; for a lean /mcp tool, its mode and the
                     named implementation that answered
     client          normalized from the MCP initialize clientInfo ONLY
                     (chatgpt, claude, cursor ... or unknown-mcp-client); never
                     guessed from anything else. The raw name and version too.
     is_internal     our own probes, evals and tests (INTERNAL_CLIENT below,
                     the ONE list), excluded from every number by default
     intent          one of 16 groups, from tool + mode + a coarse keyword pass;
                     the CATEGORY is stored, never the words that decided it
     ok, error_code, result_state (useful | empty | error), latency_ms
     session_hash    a hash of the MCP session id: counts conversations, links
                     to nobody (the session id is random per connection)
     ref             a random trace id. Every living-bread.org link the answer
                     returns carries it as ?lbr=<ref>, so an OPEN of that link in
                     the app (lb.ai.opened, lib/aiRef.ts) can be counted against
                     client, tool, hour and endpoint. Nothing personal is in it.
     country         the 2-letter country Cloudflare reports for the request;
                     city only on the public endpoint, and shown only where at
                     least 3 sessions share it
     question        ONLY for public discovery tools/modes (QUESTION_FIELDS),
                     cut to 200 characters, e-mails and phone numbers removed;
                     it goes to mcp_asks at HOUR precision, never joined to the
                     call row or the session. Nothing a signed-in tool was given
                     is ever kept: no text, no ids, no user id, no IP.

   Kill switches: MCP_CALL_LOG=0 (no rows), MCP_ASK_LOG=0 (no question text),
   MCP_LINK_REF=0 (links untouched).
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { guessLanguage } from './asks';
import { SERVER_VERSION } from './instructions';
import { LEAN_TOOLS } from './lean';
import { handoffsShown, srcFor, type HandoffShown } from './handoff';

/* ---- who is calling ---------------------------------------------------------------------------- */

/** Our own clients: test runners, probes, evals, demos. THE one list (the migration's backfill mirrors it, tested). */
export const INTERNAL_CLIENT = /^(living-bread-(?!web$|ios$|android$).+|demo|x|test|probe|eval|smoke|.*[-_. ](probe|eval|test|tests|smoke)([-_. ].*)?)$/i;

export function isInternalClient(name: string | null | undefined): boolean {
  const n = String(name ?? '').trim();
  if (!n) return false;
  return INTERNAL_CLIENT.test(n);
}

export type ClientKind =
  | 'chatgpt' | 'claude' | 'claude-code' | 'gemini' | 'cursor' | 'vscode' | 'vscode-insiders' | 'windsurf' | 'glama'
  | 'living-bread-web' | 'living-bread-ios' | 'living-bread-android' | 'internal' | 'other' | 'unknown-mcp-client';

/** The client from what it announced in initialize, nothing else. Unknown stays unknown. */
export function normalizeClient(name: string | null | undefined): ClientKind {
  const raw = String(name ?? '').trim();
  const n = raw.toLowerCase();
  if (!n) return 'unknown-mcp-client';
  if (/^living-bread-(web|ios|android)$/.test(n)) return n as ClientKind;
  if (isInternalClient(raw)) return 'internal';
  if (/openai|chatgpt/.test(n)) return 'chatgpt';
  if (/claude[-_ ]?code/.test(n)) return 'claude-code';
  if (/claude|anthropic/.test(n)) return 'claude';
  if (/gemini|google/.test(n)) return 'gemini';
  if (/cursor/.test(n)) return 'cursor';
  if (/insiders/.test(n) && /code|vscode/.test(n)) return 'vscode-insiders';
  if (/visual studio code|vscode|vs code/.test(n)) return 'vscode';
  if (/windsurf|codeium/.test(n)) return 'windsurf';
  if (/glama/.test(n)) return 'glama';
  return 'other';
}

/* ---- the question, only where it is public ------------------------------------------------------ */

/** E-mail addresses and phone-like digit runs (7+ digits) out; Scripture references ("John 3:16", "Psalm 119:105") stay. */
export function scrubQuestion(s: string): string {
  let t = String(s ?? '').replace(/\s+/g, ' ').trim();
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
  t = t.replace(/\+?\d[\d ().-]{5,}\d/g, (m) => ((m.match(/\d/g)?.length ?? 0) >= 7 ? '[number]' : m));
  t = t.replace(/https?:\/\/\S+/g, '[link]');
  return t.slice(0, 200).trim();
}

/** Named public discovery tools whose words may be kept, and which arguments are the question. Nothing else ever is. */
export const QUESTION_FIELDS: Record<string, (a: Record<string, unknown>) => string | null> = {
  search: (a) => str(a.query),
  ask_living_bread: (a) => str(a.question),
  verses_for: (a) => str(a.need),
  find_churches_near: (a) => [str(a.city), str(a.denomination)].filter(Boolean).join(', ') || null,
  find_gatherings_near: (a) => str(a.city) ?? (a.online === true ? 'online' : null),
  gatherings_tonight: (a) => str(a.city),
  events_this_week: (a) => str(a.city),
  heritage_lookup: (a) => (str(a.name) ? `${str(a.kind) ?? 'heritage'}: ${str(a.name)}` : null),
  scripture_search: (a) => str(a.query),
  verify_scripture_quote: (a) => str(a.quote),
  what_the_bible_says_about: (a) => str(a.topic),
  teaching_of_jesus: (a) => str(a.topic),
  belief: (a) => str(a.topic),
  parable: (a) => str(a.name),
  miracle: (a) => str(a.name),
  hymn: (a) => str(a.title),
  denomination_compare: (a) => (str(a.a) && str(a.b) ? `${str(a.a)} vs ${str(a.b)}` : null),
};
/* Deliberately NOT here: christianity_and_other_faiths (a person's own religion in their words),
   name_meaning (often a person's name), a_prayer_for and faith_in_a_hard_season (their circumstances),
   kingdom_protocol_lookup (can name a profile), and every signed-in tool. */

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** The question text a call may keep, or null. Signed-in personal tools never reach here (see `instrument`). */
export function questionOf(named: string, args: Record<string, unknown>): string | null {
  const f = QUESTION_FIELDS[named];
  if (!f) return null;
  const raw = f(args);
  if (!raw) return null;
  const t = scrubQuestion(raw);
  return t || null;
}

/* ---- lean /mcp calls, resolved to the named implementation ---------------------------------------- */

export function resolveLean(tool: string, args: Record<string, unknown>): { named: string; mode: string | null; args: Record<string, unknown> } | null {
  const e = LEAN_TOOLS[tool];
  if (!e) return null;
  const modes = Object.keys(e.modes);
  const mode = e.mode_param === false ? modes[0] : String(args.mode ?? e.default_mode ?? modes[0]);
  const spec = e.modes[mode];
  if (!spec) return { named: tool, mode, args: {} };
  const named: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === 'mode') continue;
    named[spec.rename?.[k] ?? k] = v;
  }
  for (const [k, v] of Object.entries(spec.fixed ?? {})) named[k] = v;
  return { named: spec.tool, mode: e.mode_param === false ? null : mode, args: named };
}

/* ---- what the person is seeking: 16 groups ------------------------------------------------------- */

export const INTENTS = [
  'scripture', 'jesus_gospel', 'prayer', 'pain', 'church', 'community', 'belonging', 'service', 'theology',
  'history', 'worship', 'discipleship', 'curiosity', 'faith_comparison', 'human_connection', 'unknown',
] as const;
export type Intent = (typeof INTENTS)[number];

/** By the implementation that answered. A tool that says what it is for decides; open tools get the keyword pass. */
const TOOL_INTENT: Record<string, Intent> = {
  scripture_passage: 'scripture', scripture_context: 'scripture', scripture_search: 'scripture', compare_translations: 'scripture',
  original_words: 'scripture', cross_references: 'scripture', verify_scripture_quote: 'scripture', list_translations: 'scripture',
  daily_bread: 'scripture', verses_for: 'scripture', what_the_bible_says_about: 'scripture',
  teaching_of_jesus: 'jesus_gospel', the_gospel: 'jesus_gospel', parable: 'jesus_gospel', miracle: 'jesus_gospel',
  belief: 'theology', hymn: 'worship', worship_now: 'worship', name_meaning: 'curiosity',
  saint_of_the_day: 'history', heritage_lookup: 'history', denomination_compare: 'faith_comparison',
  christianity_and_other_faiths: 'faith_comparison', faith_in_a_hard_season: 'pain', crisis_resources: 'pain',
  a_prayer_for: 'prayer', real_people_will_pray: 'prayer', prayers_left_near: 'prayer', hear_the_kingdom_pray: 'prayer',
  pray_for_someone: 'prayer', the_watch_tonight: 'prayer', keep_the_watch: 'prayer', speak_a_blessing: 'prayer',
  prayers_waiting_for_me: 'prayer', prayers_i_offered: 'prayer', say_amen: 'prayer', bring_what_i_carry: 'prayer',
  the_open_chair: 'human_connection', ask_the_family_to_pray: 'prayer',
  a_person_now: 'human_connection', someone_to_talk_to: 'human_connection', who_is_available_now: 'human_connection',
  shepherd_doors: 'human_connection',
  tables_live_now: 'belonging', set_a_table: 'belonging', family_activity_today: 'belonging', kingdom_map: 'belonging',
  testimonies: 'belonging', my_family: 'belonging', family_saying_yes: 'belonging', invite_someone: 'belonging', who_am_i: 'belonging',
  find_churches_near: 'church', church: 'church', my_church: 'church', my_congregation: 'church',
  find_gatherings_near: 'community', gatherings_tonight: 'community', events_this_week: 'community',
  communities_to_join: 'community', universities: 'community', going_to_gathering: 'community', my_invitations: 'community',
  needs_near: 'service', where_can_i_serve_publicly: 'service', offer_to_serve: 'service', find_help_for_my_need: 'service',
  begin: 'curiosity', say_yes: 'jesus_gospel', journey_next_steps: 'discipleship', reading_plans: 'discipleship',
  my_walk: 'discipleship', my_day: 'discipleship',
};
/** Open tools whose words decide the group (the keyword pass runs on their question in memory only). */
const OPEN_TOOLS = new Set(['search', 'ask_living_bread', 'fetch', 'kingdom_protocol_lookup', 'verses_for', 'what_the_bible_says_about']);

/* Ordered: the first group whose words appear wins. Pain and a person come first, on purpose. */
const KEYWORDS: [Intent, RegExp][] = [
  ['pain', /\b(grief|griev|anxi|depress|lonel|alone|afraid|fear|scared|loss|lost my|died|death|dying|divorc|sick|cancer|suicid|hurt|pain|suffer|addict|hopeless|abuse|duelo|ansiedad|tristeza|medo|luto)/i],
  ['human_connection', /\b(talk to (someone|a person|a pastor)|someone to talk|pastor|counsel|mentor|a christian friend|believer near)/i],
  ['prayer', /\b(pray|prayer|intercede|oraci[oó]n|ora[cç][aã]o|orar|gebet|pri[eè]re)/i],
  ['faith_comparison', /\b(islam|muslim|quran|buddh|hindu|jewish|judaism|mormon|lds|jehovah|atheis|agnostic|other religions?|catholic (vs|or)|orthodox (vs|or)|protestant (vs|or)|difference between)/i],
  ['jesus_gospel', /\b(jesus|christ|gospel|salvation|saved|born again|cross|resurrection|evangelio|jesús|jesus cristo)/i],
  ['church', /\b(church|churches|iglesia|igreja|[eé]glise|kirche|mass times|parish|congregation)/i],
  ['community', /\b(community|small group|bible study|youth group|gathering|meetup|fellowship|events?|grupo|comunidad)/i],
  ['service', /\b(serve|volunteer|help (others|the poor|someone)|mission trip|donate|charity|food bank|servir|voluntari)/i],
  ['worship', /\b(worship|hymn|song|praise|music|adora[cç])/i],
  ['theology', /\b(trinity|baptism|sin|grace|doctrine|theolog|predestin|communion|eucharist|holy spirit|heaven|hell|sacrament|justification)/i],
  ['history', /\b(history|saint|reformation|council|martyr|apostle|church father|early church|crusade|luther|augustine)/i],
  ['discipleship', /\b(disciple|grow in|reading plan|devotion|spiritual growth|how to read the bible|quiet time)/i],
  ['belonging', /\b(belong|family|friends?|join|new here|welcome)/i],
  ['scripture', /\b(verse|verses|scripture|bible|psalm|proverb|genesis|exodus|isaiah|matthew|mark|luke|john|romans|corinthians|vers[ií]culo|b[ií]blia)\b/i],
];

export function keywordIntent(text: string | null | undefined): Intent | null {
  const t = String(text ?? '');
  if (!t.trim()) return null;
  for (const [intent, re] of KEYWORDS) if (re.test(t)) return intent;
  return null;
}

/** The group for one call. `words` is the in-memory question (public tools only); it is never stored for this. */
export function intentOf(named: string, words: string | null): Intent {
  if (OPEN_TOOLS.has(named)) {
    const k = keywordIntent(words);
    if (k) return k;
    if (TOOL_INTENT[named]) return TOOL_INTENT[named];
    return words ? 'curiosity' : 'unknown';
  }
  if (TOOL_INTENT[named]) return TOOL_INTENT[named];
  if (/^(my_|prayers_)/.test(named)) return named.startsWith('prayers_') ? 'prayer' : 'discipleship';
  if (/pray|amen|bless/.test(named)) return 'prayer';
  if (/serve|need/.test(named)) return 'service';
  if (/church|congregation/.test(named)) return 'church';
  if (/communit|gathering|table|circle/.test(named)) return 'community';
  return 'unknown';
}

/* ---- the attribution token on every living-bread.org link ----------------------------------------- */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function makeRef(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += ALPHABET[x % ALPHABET.length];
  return s;
}

export const REF_PARAM = 'lbr';
const SITE_URL = /https?:\/\/(?:www\.)?living-bread\.org(?:\/[^\s"'<>)\]\\`]*)?/g;

/** Add ?lbr=<ref> to one living-bread.org url (trailing sentence punctuation kept outside, #hash kept, an existing lbr kept). */
export function withRef(url: string, ref: string): string {
  if (new RegExp(`[?&]${REF_PARAM}=`).test(url)) return url;
  const hashAt = url.indexOf('#');
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  return `${base}${base.includes('?') ? '&' : '?'}${REF_PARAM}=${ref}${hash}`;
}

/** Tag every living-bread.org link in a string. Returns the string and how many links were tagged. */
export function tagLinks(s: string, ref: string): { text: string; n: number } {
  let n = 0;
  const text = s.replace(SITE_URL, (m) => {
    const trail = m.match(/[.,;:!?]+$/)?.[0] ?? '';
    const url = trail ? m.slice(0, -trail.length) : m;
    n += 1;
    return withRef(url, ref) + trail;
  });
  return { text, n };
}

/** Identity fields stay canonical: a source or an id is what a citation or a follow-up call points at. */
const KEEP_KEYS = new Set(['source_url', 'canonical', 'id', 'ids', '@id', 'evidence', 'attribution', 'license', 'freshness']);

/** Tag links throughout a result's content and structuredContent (never _meta, never keys, never identity fields). */
export function tagResult<T extends { content?: unknown; structuredContent?: unknown }>(r: T, ref: string): { result: T; links: number } {
  let links = 0;
  const walk = (v: unknown, depth: number, key = ''): unknown => {
    if (KEEP_KEYS.has(key)) return v;
    if (depth > 10) return v;
    if (typeof v === 'string') {
      if (!v.includes('living-bread.org')) return v;
      const t = tagLinks(v, ref);
      links += t.n;
      return t.text;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x, depth + 1, k)]));
    return v;
  };
  const out = { ...r };
  if (Array.isArray(r.content)) {
    out.content = (r.content as { type?: string; text?: string }[]).map((c) => (c && c.type === 'text' && typeof c.text === 'string' ? { ...c, text: walk(c.text, 0) as string } : c));
  }
  if (r.structuredContent && typeof r.structuredContent === 'object') out.structuredContent = walk(r.structuredContent, 0);
  return { result: out, links };
}

/* ---- the row ------------------------------------------------------------------------------------- */

export interface CallRow {
  endpoint: string;
  tool: string;
  mode: string | null;
  named: string;
  lean: boolean;
  client_kind: ClientKind;
  client_name: string | null;
  client_version: string | null;
  protocol_version: string | null;
  server_version: string;
  is_internal: boolean;
  session_hash: string | null;
  ref: string;
  ok: boolean;
  error_code: string | null;
  result_state: 'useful' | 'empty' | 'error';
  latency_ms: number;
  intent: Intent;
  lang: string | null;
  country: string | null;
  city: string | null;
  links: number;
  question: string | null;
}

type AnyResult = { content?: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean; _meta?: Record<string, unknown> };

export function stateOf(r: AnyResult | null): 'useful' | 'empty' | 'error' {
  if (!r || r.isError) return 'error';
  const s = r.structuredContent;
  if (!s) return 'useful';
  if (s.result_state === 'empty' || s.empty === true || s.found === false) return 'empty';
  if (typeof s.count === 'number' && s.count === 0) return 'empty';
  if ('matched' in s && s.matched === null) return 'empty';
  if (Array.isArray(s.results) && s.results.length === 0) return 'empty';
  return 'useful';
}

export function errorCodeOf(r: AnyResult | null, thrown: unknown): string | null {
  if (thrown) {
    const code = (thrown as { code?: unknown }).code;
    return typeof code === 'number' ? `mcp_${code}` : 'thrown';
  }
  if (!r?.isError) return null;
  const env = r._meta?.['living-bread/error'] as { reason?: unknown } | undefined;
  if (env && typeof env.reason === 'string') return env.reason.slice(0, 40);
  const t = r.content?.[0]?.text ?? '';
  if (/Input validation error/i.test(t)) return 'invalid_arguments';
  if (/not found/i.test(t)) return 'unknown_tool';
  return 'error';
}

/** Build the row. `personal` is true for every signed-in tool: it never yields a question or a keyword pass. */
export function buildRow(input: {
  endpoint: string; tool: string; args: Record<string, unknown>; personal: boolean;
  clientName: string | null; clientVersion: string | null; protocolVersion: string | null;
  sessionHash: string | null; ref: string; result: AnyResult | null; thrown: unknown; latencyMs: number;
  country: string | null; city: string | null; links: number; keepQuestion: boolean;
}): CallRow {
  const lean = input.endpoint === 'mcp' || input.endpoint === 'sse' ? resolveLean(input.tool, input.args) : null;
  const named = lean?.named ?? input.tool;
  const namedArgs = lean?.args ?? input.args;
  const words = input.personal ? null : questionOf(named, namedArgs);
  const state = input.thrown ? 'error' : stateOf(input.result);
  const lang = words ? guessLanguage(words) : (typeof input.args.language === 'string' ? input.args.language.slice(0, 12).toLowerCase() : null);
  const clientName = input.clientName ? input.clientName.slice(0, 60) : null;
  return {
    endpoint: input.endpoint,
    tool: input.tool.slice(0, 60),
    mode: lean?.mode ?? null,
    named: named.slice(0, 60),
    lean: Boolean(lean),
    client_kind: normalizeClient(clientName),
    client_name: clientName,
    client_version: input.clientVersion ? input.clientVersion.slice(0, 40) : null,
    protocol_version: input.protocolVersion ? input.protocolVersion.slice(0, 20) : null,
    server_version: SERVER_VERSION,
    is_internal: isInternalClient(clientName),
    session_hash: input.sessionHash,
    ref: input.ref,
    ok: state !== 'error',
    error_code: errorCodeOf(input.result, input.thrown),
    result_state: state,
    latency_ms: Math.max(0, Math.round(input.latencyMs)),
    intent: intentOf(named, input.personal ? null : (words ?? null)),
    lang: lang && lang !== 'und' ? lang : null,
    country: input.country && /^[A-Z]{2}$/.test(input.country) ? input.country : null,
    city: input.endpoint === 'mcp' || input.endpoint === 'sse' ? (input.city ? input.city.slice(0, 60) : null) : null,
    links: input.links,
    question: input.keepQuestion && !input.personal ? words : null,
  };
}

function decodeCity(c: string | null): string | null {
  if (!c) return null;
  try { return decodeURIComponent(c); } catch { return null; }
}

/* ---- sending: never delays, never throws ------------------------------------------------------- */

const PER_ISOLATE_PER_HOUR = 5000;
let hourKey = '';
let hourCount = 0;
function allow(): boolean {
  const k = new Date().toISOString().slice(0, 13);
  if (k !== hourKey) { hourKey = k; hourCount = 0; }
  if (hourCount >= PER_ISOLATE_PER_HOUR) return false;
  hourCount += 1;
  return true;
}

const flag = (env: Env, key: string, dflt: string) => String((env as unknown as Record<string, unknown>)[key] ?? dflt);
export const callLogOn = (env: Env) => flag(env, 'MCP_CALL_LOG', '1') !== '0';
export const linkRefOn = (env: Env) => flag(env, 'MCP_LINK_REF', '1') !== '0';
const askLogOn = (env: Env) => flag(env, 'MCP_ASK_LOG', '1') !== '0';

export async function sha16(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* If the database refuses or is slow (say the Worker was deployed before migration 1009), stop for ten
   minutes: an unanswered RPC must never hold the few outbound connections an answer needs. */
let restUntil = 0;
function rest(): void { restUntil = Date.now() + 10 * 60_000; }

function send(env: Env, row: CallRow): void {
  try {
    if (Date.now() < restUntil) return;
    if (!allow()) return;
    const p = fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mcp_log_call`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p: row }),
      signal: AbortSignal.timeout(3000),
    });
    p.then((r) => { if (!r.ok) rest(); return r.body?.cancel(); }, () => rest()).then(() => undefined, () => undefined);
  } catch {
    /* counting never costs an answer */
  }
}

/* ---- handoffs shown (migration 1880, rehearsed and NOT applied: off until MCP_HANDOFF_LOG=1) ----------

   The arrival funnel is: a link was SHOWN (here), OPENED (lb.ai.opened, lib/aiRef.ts), a signup STARTED and
   COMPLETED, the intended action COMPLETED, the person came BACK on day 7 and day 30. The shown step is one row per
   handoff: the trace code that is already on its link, the destination type and id, the intent, the surface and
   whether it was verified or only on record. Never any text, never a user id, never the person's words. A shown
   link is a recommendation; it is never reported as a click, a signup or participation. */
export const handoffLogOn = (env: Env) => flag(env, 'MCP_HANDOFF_LOG', '0') === '1';

function sendHandoffs(env: Env, ref: string, client: string | null, shown: HandoffShown[]): void {
  try {
    if (!shown.length || Date.now() < restUntil || !allow()) return;
    const p = fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mcp_log_handoff`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p: { ref, src: srcFor(client), shown } }),
      signal: AbortSignal.timeout(3000),
    });
    p.then((r) => { if (!r.ok) rest(); return r.body?.cancel(); }, () => rest()).then(() => undefined, () => undefined);
  } catch {
    /* counting never costs an answer */
  }
}

/* ---- the one hook: wrap tools/call on a finished server -------------------------------------------- */

export interface InstrumentContext {
  env: Env;
  /** 'public' (/mcp or /sse), 'me' or 'app' */
  profile: 'public' | 'me' | 'app';
}

/** A tool registered as the believer's own (shared.ts asYours marks it): never any text, on any endpoint. */
export function isPersonalTool(server: McpServer, name: string): boolean {
  if (/^(my_|prayers_)/.test(name)) return true;
  const reg = (server as unknown as { _registeredTools?: Record<string, { _meta?: Record<string, unknown> }> })._registeredTools;
  return reg?.[name]?._meta?.['living-bread/visibility'] === 'yours';
}

type Handler = (request: { params?: { name?: string; arguments?: Record<string, unknown> } }, extra: Record<string, unknown>) => Promise<unknown>;
const DONE = new WeakSet<object>();

/** Wrap the server's tools/call handler once. The answer is returned exactly as before, links tagged; the row is sent after. */
export function instrument(server: McpServer, ctx: InstrumentContext): void {
  const inner = server.server as unknown as { _requestHandlers?: Map<string, Handler>; getClientVersion?: () => { name?: string; version?: string } | undefined };
  const handlers = inner._requestHandlers;
  const original = handlers?.get('tools/call');
  if (!handlers || !original || DONE.has(inner)) return;
  DONE.add(inner);
  let fallbackSession: string | null = null;
  handlers.set('tools/call', async (request, extra) => {
    const started = Date.now();
    const on = callLogOn(ctx.env);
    const ref = makeRef();
    let result: AnyResult | null = null;
    let thrown: unknown = null;
    let links = 0;
    try {
      result = (await original(request, extra)) as AnyResult;
    } catch (e) {
      thrown = e;
    }
    const tool = String(request?.params?.name ?? '');
    const personal = ctx.profile !== 'public' && isPersonalTool(server, tool);
    if (result && !thrown && linkRefOn(ctx.env)) {
      try {
        const t = tagResult(result, ref);
        result = t.result as AnyResult;
        links = t.links;
      } catch {
        /* an untagged answer is still the answer */
      }
    }
    if (on && tool) {
      const latency = Date.now() - started;
      const headers = ((extra?.requestInfo as { headers?: Record<string, string | string[] | undefined> } | undefined)?.headers ?? {}) as Record<string, string | string[] | undefined>;
      const h = (k: string) => { const v = headers[k]; return typeof v === 'string' ? v : Array.isArray(v) ? v[0] ?? null : null; };
      const hinted = h('x-lb-endpoint');
      const endpoint = ctx.profile === 'public' ? (hinted === 'sse' ? 'sse' : 'mcp') : ctx.profile;
      let client: { name?: string; version?: string } | undefined;
      try { client = inner.getClientVersion?.(); } catch { client = undefined; }
      const args = (request?.params?.arguments ?? {}) as Record<string, unknown>;
      const sid = typeof extra?.sessionId === 'string' ? extra.sessionId : (fallbackSession ??= makeRef());
      void (async () => {
        try {
          const row = buildRow({
            endpoint, tool, args, personal,
            clientName: client?.name ?? null, clientVersion: client?.version ?? null,
            protocolVersion: h('mcp-protocol-version'),
            sessionHash: await sha16(`lb-mcp-session|${sid}`), ref, result, thrown, latencyMs: latency,
            country: h('x-lb-country'), city: decodeCity(h('x-lb-city')), links, keepQuestion: askLogOn(ctx.env),
          });
          send(ctx.env, row);
          if (handoffLogOn(ctx.env) && !row.is_internal && result && !thrown) sendHandoffs(ctx.env, ref, client?.name ?? null, handoffsShown((result as AnyResult).structuredContent));
        } catch {
          /* never */
        }
      })();
    }
    if (thrown) throw thrown;
    return result;
  });
}
