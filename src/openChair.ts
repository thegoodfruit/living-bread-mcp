/* ============================================================
   THE LIVING BREAD MCP, the Open Chair: "Ask once. Someone will answer.
   And we will come back to ask how you are."

   A person who tells an assistant they are scared, grieving, or carrying
   something too heavy, and who asks for prayer, has until now been handed
   verses and a link, and then left. The Open Chair is the middle that was
   missing: they leave their request once, a chair opens in the family,
   believers who chose to pray for a stranger take it, and the person is
   asked gently how they are on day 3 and day 7.
   Spec and laws: docs/OPEN_CHAIR_PROMPT_2026-10-14.md.

     the_open_chair            (public, read only) the door, how it works, what
                               an assistant may and may not do. Sends nothing.
     ask_the_family_to_pray    (/me only, consented) opens a chair FOR the
                               signed-in believer, with their OWN words,
                               only after they say yes. The public endpoint
                               is read only by rule (tests/mcpLean.test.ts),
                               so a person with no account is handed the
                               door and asks there, in their own words.

   WHAT AN ASSISTANT MAY DO (also said in machine-readable form below)
     offer the link; never submit for a person without their own words;
     never compose a prayer request, or a prayer, in their name; danger
     first: crisis_resources, then the chair, and never a chair for words of
     danger until the person says they are safe and only want prayer.

   NOTHING OF THE REQUEST IS LOGGED HERE. It is not written to mcp_asks and
   not into any telemetry: the words belong to the person and the believers
   they are offered to (the Open Chair's privacy law).
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { type Believer, rpcAs } from './auth';
import { consent, declined, notYet } from './consent';
import { SITE, setChairLive } from './doors';
import { paragraph } from './render';
import { fail, ok, out, READS, tool, WRITES_ONCE } from './shared';

export const CHAIR_DOOR = `${SITE}/open-chair`;
export const CRISIS_DOOR = `${SITE}/sos`;

/** What an assistant may do, stable and machine readable (also in llms.txt and the house page). */
export const ASSISTANT_MAY = {
  may: [
    'offer the link to the Open Chair to a person who asks for prayer, comfort or someone to be with them',
    'explain in plain words how it works and what it does not promise',
    'with a signed-in believer on /me, open a chair for them with ask_the_family_to_pray, only after they confirm, using their own words',
  ],
  never: [
    'submit a request for a person without their own words and their yes',
    'compose a prayer request, or a prayer, in a person\'s name',
    'open a chair for words of danger before the person says they are safe and only want prayer',
    'promise healing, or that a particular person will answer, or speak as God',
  ],
  danger_first: 'If anyone is in danger or speaks of harming themselves or others, call crisis_resources with their country first and give the real number. Never a Scripture in place of a phone number.',
} as const;

/** Early warning only; the database decides (_chair_crisis, 1730). A false positive costs one more screen with a number. */
const CRISIS =
  /(suicid|kill (my ?self|me)|end (my life|it all)|take my (own )?life|want to die|wanna die|better off dead|hurt(ing)? my ?self|self.?harm|overdose|not safe at home|being abused|(he|she) (hits|beats) me|in danger|no reason to live|can'?t go on|cannot go on|don'?t want to (be here|live|wake up)|not want to live|kill (him|her|them)|hurt (him|her|them|someone)|being (beaten|hit|hurt)|afraid (he|she|they) will (hurt|kill)|unsafe at home)/i;
export function looksLikeDanger(s: string | null | undefined): boolean { return CRISIS.test(s ?? ''); }

/* A door is named only if it opens: /open-chair ships with the next web release, and this server is deployed
   separately. Checked live, remembered for five minutes inside this isolate. */
let liveAt = 0;
let liveVal = false;
export async function chairDoorLive(): Promise<boolean> {
  const now = Date.now();
  if (now - liveAt < 300_000) { setChairLive(liveVal); return liveVal; }
  try {
    const r = await fetch(CHAIR_DOOR, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(3500) });
    liveVal = r.ok;
  } catch {
    liveVal = false;
  }
  liveAt = now;
  setChairLive(liveVal);
  return liveVal;
}

async function anon<T>(env: Env, fn: string, args: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const HOW = 'On the page they give a first name (any name), what they are facing in their own words (up to 800 characters), may keep their name from the believers, and confirm they are 18 or older. A chair opens in the family. Believers who chose to pray for a stranger are offered it, and the first three who say "I will pray" take it. The person gets a private link to come back to: it shows, truthfully, whether anyone has taken the chair (first names only if each believer allows), and any short line they left. On day 3 and day 7 the page asks one gentle question, how are you; never more than two. After they have been prayed for, and only then, it offers a door: an account, a church near them, a person who says hello. If no one takes the chair for twenty minutes, a person who looks after this is told.';

const NOT_PROMISED = 'Prayer is a gift, not a promise about what will happen. It never says God will heal anyone, and nobody speaks as God. No account is needed to ask.';

export function registerOpenChair(server: McpServer, env: Env): void {
  tool(server, 'the_open_chair', {
    title: 'The Open Chair: ask the family to pray for you, once',
    description: [
      'PURPOSE: The door where anyone, with no account, asks The Living Bread family to pray for them. A chair opens, believers who chose to pray for a stranger take it, the person is told truthfully who is praying, and is asked how they are on day 3 and day 7. Promise: ask once, someone will answer, and we will come back to ask how you are.',
      'WHEN TO USE: a person tells you they are scared (a surgery tomorrow), grieving, anxious, struggling silently, or asks "will someone pray for me", and wants real people, not only verses.',
      'WHEN NOT: anyone in danger or speaking of harming themselves or others: crisis_resources first with their country, then this. If they need a person to talk to right now, use a_person_now. A signed-in believer can have the chair opened for them with ask_the_family_to_pray on /me.',
      'PARAMETERS: language (optional ISO code like "es"): only echoed back; the page itself works in the person\'s own language.',
      'OUTPUT: door (the page where they ask), open (whether the chair is open right now), how_it_works, what_it_does_not_promise, assistant_may (what you may and may not do, machine readable), crisis_door and the crisis rule.',
      'BEHAVIOR: read only; it sends nothing and contacts no one. Offer the link in plain words and let the person write their own words there; never submit for them, never write a prayer request in their name. Counts and activity are never invented: a chair no one has taken says so.',
    ].join(' '),
    inputSchema: {
      language: z.string().min(2).max(8).optional().describe('Optional ISO language code, e.g. "es". Echoed back only.'),
    },
    outputSchema: out({
      door: z.string().nullable(), open: z.boolean(), how_it_works: z.string(), what_it_does_not_promise: z.string(),
      assistant_may: z.looseObject({}), crisis_door: z.string(), crisis_rule: z.string(),
    }),
    annotations: READS,
  }, async ({ language }) => {
    const [cfg, live] = await Promise.all([anon<{ open: boolean; email_returns: boolean }>(env, 'chair_config'), chairDoorLive()]);
    const open = Boolean(cfg?.open) && live;
    const door = open ? `${CHAIR_DOOR}?via=assistant${language ? `&lang=${encodeURIComponent(language.toLowerCase().split('-')[0])}` : ''}` : null;
    const crisisRule = ASSISTANT_MAY.danger_first;
    if (!open) {
      return ok(paragraph([
        'The Open Chair is not open just now. Nothing was sent',
        'For a person to talk to right now, call a_person_now; to be prayed for, the prayer page is at ' + `${SITE}/prayer`,
        crisisRule,
      ]), {
        door: null, open: false, how_it_works: HOW, what_it_does_not_promise: NOT_PROMISED, assistant_may: ASSISTANT_MAY, crisis_door: CRISIS_DOOR, crisis_rule: crisisRule, try_instead: ['a_person_now', `${SITE}/prayer`],
      });
    }
    return ok(paragraph([
      `The door where they can ask the family to pray for them, once, with no account: ${door}`,
      HOW,
      NOT_PROMISED,
      'Nothing has been sent by this tool. Offer the link, and let them write their own words there',
      crisisRule,
    ]), {
      door, open: true, how_it_works: HOW, what_it_does_not_promise: NOT_PROMISED, assistant_may: ASSISTANT_MAY, crisis_door: CRISIS_DOOR, crisis_rule: crisisRule,
    });
  });
}

/* ---- ask_the_family_to_pray (/me only, consented) ------------------------------------------------ */
export function registerOpenChairYours(server: McpServer, env: Env, me: Believer): void {
  tool(server, 'ask_the_family_to_pray', {
    title: 'Ask the family to pray for me (open a chair)',
    description: [
      'PURPOSE: For the signed-in believer: open an Open Chair, so believers who chose to pray for a stranger can take it. It returns the believer\'s private link and the plain explanation. Their words are shown only to the believers the chair is offered to, never in a link or a notification.',
      'WHEN TO USE: the believer says, in their own words, that they want the family to pray for them about something, and they have told you what to say ("ask the family to pray about my surgery tomorrow").',
      'WHEN NOT: never to ask on behalf of someone else, never with words you wrote for them, never for a person with no account (hand them the_open_chair door). For words of danger: crisis_resources first.',
      'PARAMETERS: words (their own, 3 to 800 characters; required), anonymous (true keeps their name from the believers), confirmed (true only after they said yes), confirmed_safe (true only if their words speak of danger AND they said they are safe and only want prayer).',
      'OUTPUT: done, needs_confirmation, would (the restatement to read back), the private link (page), and what happens next.',
      'BEHAVIOR: acts as the signed-in believer only after they confirm in their own words (call with confirmed false, read the restatement back, call again with confirmed true only after they said yes). If the words speak of danger, nothing is opened: crisis_resources comes first and a chair opens only when they say they are safe. Never composes a prayer or a request in their name. The believer is adult-checked by the database.',
    ].join(' '),
    inputSchema: {
      words: z.string().min(3).max(800).describe('What they are facing, in THEIR OWN words. Never your words, never a paraphrase they did not approve.'),
      anonymous: z.boolean().default(false).describe('True keeps their name from the believers who read it.'),
      confirmed: z.boolean().default(false),
      confirmed_safe: z.boolean().default(false).describe('Only for words that speak of danger: the person said they are safe right now and want prayer only.'),
    },
    outputSchema: out({
      done: z.boolean(), needs_confirmation: z.boolean(), would: z.string().optional(), page: z.string().optional(),
      crisis: z.boolean().optional(), next: z.string().optional(), door: z.string().optional(),
    }),
    annotations: WRITES_ONCE,
  }, async ({ words, anonymous, confirmed, confirmed_safe }) => {
    const text = words.trim();
    if (looksLikeDanger(text) && !confirmed_safe) {
      return ok(paragraph([
        'Nothing has been opened. Their words speak of danger, and a person comes before a page',
        ASSISTANT_MAY.danger_first,
        'If they are safe right now and only want prayer, they can say so; then call this again with confirmed_safe true and, once they say yes, confirmed true. Stay with them',
      ]), { done: false, needs_confirmation: false, crisis: true, door: CRISIS_DOOR, try_instead: ['crisis_resources', 'a_person_now'] });
    }
    const would = `Open an Open Chair for the believer with exactly these words: "${text}". Believers who chose to pray for a stranger may take it. ${anonymous ? 'Their name is kept from the believers.' : 'Their first name is shown to the believers.'} They get a private link, and will be asked how they are on day 3 and day 7`;
    const c = await consent(server, confirmed, would);
    if (c === 'ask') return notYet(would, 'ask_the_family_to_pray', { crisis: false });
    if (c === 'no') return declined('Opening the chair');
    if (!(await chairDoorLive())) {
      return fail(paragraph(['The Open Chair is not open on the web yet, so nothing was created and no private link was made', 'It will be soon. For a person right now, use a_person_now']), { reason: 'not_open', try_instead: ['a_person_now', `${SITE}/prayer`] });
    }
    const r = await rpcAs(env, me, 'chair_ask', { p_words: text, p_anonymous: anonymous, p_adult: true, p_safe: Boolean(confirmed_safe), p_via: 'assistant' });
    const d = (r.data ?? null) as { ok?: boolean; token?: string | null; reason?: string; why?: string; crisis?: boolean; page?: string } | null;
    if (r.error || !d) return fail(paragraph(['The chair was not opened, and nothing was sent', r.error ? `(${r.error})` : null, `They can ask directly at ${CHAIR_DOOR}`]), { reason: 'not_done', try_instead: [CHAIR_DOOR] });
    if (d.reason === 'crisis') return ok(paragraph(['Nothing has been opened. Their words speak of danger', ASSISTANT_MAY.danger_first]), { done: false, needs_confirmation: false, crisis: true, door: CRISIS_DOOR, try_instead: ['crisis_resources'] });
    if (!d.ok || !d.page) return fail(paragraph(['The chair was not opened', d.why ?? `They can ask directly at ${CHAIR_DOOR}`]), { reason: d.reason ?? 'not_done', try_instead: [CHAIR_DOOR] });
    return ok(paragraph([
      'A chair is open. The believer\'s private link is below; it shows, truthfully, whether anyone has taken it',
      `Private link (give it only to them): ${d.page}`,
      'Believers who chose to pray for a stranger are offered it; if no one takes it in twenty minutes, a person who looks after this is told. On day 3 and day 7 the page asks one gentle question, and never more',
      NOT_PROMISED,
    ]), { done: true, needs_confirmation: false, page: d.page, next: 'Keep the link private. The page shows who is praying and any line they left.', door: CHAIR_DOOR });
  });
}
