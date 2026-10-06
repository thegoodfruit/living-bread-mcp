/* ============================================================
   THE LIVING BREAD MCP, a human, not a machine.

   When a person in any assistant asks for prayer, the most faithful thing an
   assistant can do is not to pray in their place but to bring them to people
   who will. This tool never prays and never says it did. It returns:

     - the door on living-bread.org where a person asks real believers to pray
       for them by name, and the honest truth about what that needs today: a
       free account (no guest form exists that sends a request to believers;
       the app's guest mode can read and listen, not ask);
     - the number of people who prayed through The Living Bread in the last
       24 hours, from the public aggregate protocol_praying_now (migration
       0800), the same count /api/praying-now serves. Counts of distinct
       people only; never a name, a request or a place.

   Every link here answered 200 on the live web host when it was written.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { DOORS, SITE } from './doors';
import { paragraph } from './render';
import { ok, out, READS_WORLD, tool } from './shared';

export const PRAYER_DOORS = {
  /** A prayer to pray now, Scripture for a heavy heart, and the way to ask the family to pray. */
  ask: `${SITE}/i-need-prayer`,
  /** Begin (free): the account that lets believers pray for a person by name. */
  begin: SITE,
  /** Listen now, no account: believers praying aloud, guided. */
  listenNow: `${SITE}/guided`,
  prayer: DOORS.prayer,
} as const;

export interface PrayedCount { people: number; as_of: string | null; hours: number; counted_from: string | null }

/** People who prayed through The Living Bread in the last `hours`, or null when the count cannot be read. Never invented. */
export async function prayedLast(env: Env, hours = 24): Promise<PrayedCount | null> {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/protocol_praying_now`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ p_hours: hours }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { people?: unknown; as_of?: unknown; counted_from?: unknown };
    if (typeof d?.people !== 'number' || !Number.isFinite(d.people)) return null;
    return { people: d.people, as_of: typeof d.as_of === 'string' ? d.as_of : null, hours, counted_from: typeof d.counted_from === 'string' ? d.counted_from : null };
  } catch {
    return null;
  }
}

export async function prayerDoorPayload(env: Env): Promise<{ text: string; structured: Record<string, unknown> }> {
  const count = await prayedLast(env, 24);
  const countSentence = count
    ? count.people === 0
      ? 'No one has prayed through The Living Bread in the last 24 hours yet'
      : `${count.people} ${count.people === 1 ? 'person' : 'people'} prayed through The Living Bread in the last 24 hours`
    : 'The live count of people who prayed in the last 24 hours could not be read just now';
  const text = paragraph([
    'This tool does not pray, and an assistant should never say it prayed for someone. It connects a person to real believers who will',
    `To be prayed for by name, the person opens ${PRAYER_DOORS.ask} and asks; sending a request to believers needs a free account, which they can begin at ${PRAYER_DOORS.begin}`,
    `Without an account, they can listen to believers praying aloud now at ${PRAYER_DOORS.listenNow}`,
    countSentence,
    'If the person is in danger or may harm themselves, give them their country\'s emergency number and a crisis line first (crisis_resources), and only then this door',
  ]);
  return {
    text,
    structured: {
      this_tool_prays: false,
      what_it_does: 'Connects a person who asked for prayer to real believers on The Living Bread who pray for people by name. It does not pray, and it never says that it did.',
      door: PRAYER_DOORS.ask,
      door_label: 'Ask real believers to pray for you',
      sign_in_needed: true,
      sign_in_truth: 'A request reaches believers only from a free account. There is no guest form that sends a prayer request to people; the guest mode of the app can read and listen, not ask.',
      begin: PRAYER_DOORS.begin,
      listen_now_without_an_account: PRAYER_DOORS.listenNow,
      how_it_works: [
        'The person opens the door and begins a free account (email, Google or Apple).',
        'They write what they are carrying, sharing only what they want.',
        'Believers on The Living Bread pray for them by name, and they are told when someone prayed.',
      ],
      prayed_last_24h: count,
      prayed_last_24h_means: 'distinct people who prayed for someone through The Living Bread in the last 24 hours (protocol_praying_now, the same count as https://discover.living-bread.org/api/praying-now?hours=24); never names, never places',
      crisis_first: 'If the person is in danger, call crisis_resources with their country before anything else.',
      source_url: PRAYER_DOORS.ask,
    },
  };
}

export function registerRealPeople(server: McpServer, env: Env): void {
  tool(server, 'real_people_will_pray', {
    title: 'Real people who will pray for you',
    description: 'Return the door on living-bread.org where real believers will pray for a person by name, and how many distinct people prayed through The Living Bread in the last 24 hours (a live public count, never names or places). Use when a person asks for prayer ("please pray for me", "can someone pray for my mother", "I need prayer"). This tool does not pray and must never be described as praying; it connects a person to people who will. Not for a written prayer to read (a_prayer_for), for asking the family as a signed in member (bring_what_i_carry on /me), for talking with a person now (someone_to_talk_to), or for danger: if the person may harm themselves or others use crisis_resources first. No inputs. Returns the door, sign_in_needed with sign_in_truth (posting a request needs a free account; there is no guest form that reaches people), begin, a page to listen to believers praying aloud now without an account, and prayed_last_24h (null when the live count cannot be read). Reads a live count from the house database; writes nothing.',
    inputSchema: {},
    outputSchema: out({
      this_tool_prays: z.boolean().describe('Always false: the tool connects to people, it does not pray.'),
      door: z.string().describe('Page where a request for prayer reaches real believers.'),
      sign_in_needed: z.boolean().describe('True: posting a request needs a free account.'),
      sign_in_truth: z.string().describe('Plain sentence explaining what the account is for and that there is no guest form.'),
      begin: z.string().describe('Page to create the free account.'),
      listen_now_without_an_account: z.string().describe('Page to hear believers praying aloud now, no account needed.'),
      prayed_last_24h: z.looseObject({ people: z.number(), as_of: z.string().nullable(), hours: z.number() }).nullable().describe('Distinct people who prayed for someone in the window, with its time; null when the live count is unavailable.'),
      source_url: z.string().describe('Public source of the count.'),
    }),
    annotations: READS_WORLD,
  }, async () => {
    const p = await prayerDoorPayload(env);
    return ok(p.text, p.structured);
  });
}
