/* ============================================================
   THE LIVING BREAD MCP, for shepherds.

   Registered only when the token's believer is one the app recognises as a
   pastor (my_pastor_page: page on, verified, or a shepherd calling set;
   users.is_pastor / pastor_verified). For everyone else these tools do not
   exist. Everything reads the Shepherd Console's own functions: the people
   who asked to meet them (pastor_requests_for_me), the church layer of the
   prayer wall (get_prayer_wall, what members see), and the Pattern
   Shepherd's briefing (shepherd_briefing, migration 0136), which is the ONE
   place the house already names who has gone quiet. Nothing here computes
   a list of absent people on its own.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { type Believer, rpcAs, selectAs } from './auth';
import { DOORS, SITE } from './doors';
import { list, paragraph, sinceWordOf } from './render';
import { fail, firstName, ok, out, READS, tool } from './shared';

export interface PastorPage { page_on: boolean; available: boolean; intro: string | null; verified: boolean; role: string | null; church_id: string | null; denomination: string | null }

/** The app's own test: a shepherd calling set, or the pastor page on, or verified, or the older is_pastor flag. */
export async function pastorOf(env: Env, me: Believer): Promise<PastorPage | null> {
  const [page, flags] = await Promise.all([
    rpcAs(env, me, 'my_pastor_page'),
    selectAs<{ is_pastor: boolean | null; pastor_verified: boolean | null; church_id: string | null }>(env, me, 'users', `id=eq.${me.userId}&select=is_pastor,pastor_verified,church_id&limit=1`),
  ]);
  const row = (Array.isArray(page.data) ? page.data[0] : page.data) as PastorPage | null;
  const f = flags?.[0];
  const isPastor = Boolean(row && (row.page_on || row.verified || row.role)) || Boolean(f?.is_pastor) || Boolean(f?.pastor_verified);
  if (!isPastor) return null;
  return { page_on: Boolean(row?.page_on), available: Boolean(row?.available), intro: row?.intro ?? null, verified: Boolean(row?.verified || f?.pastor_verified), role: row?.role ?? null, church_id: row?.church_id ?? f?.church_id ?? null, denomination: row?.denomination ?? null };
}

export const SHEPHERD_TOOL_SUMMARY: ReadonlyArray<[string, string]> = [
  ['my_congregation', 'the people who asked to pray or meet with them, and the prayer requests their church shares with its members'],
  ['shepherd_doors', 'their three doors with the exact routes: pray now, meet online, meet nearby'],
  ['who_has_gone_quiet', 'the Pattern Shepherd briefing: who in their church has not been seen in three weeks, by first name only'],
];

interface CareRequest { id: string; seeker_id: string; seeker_name: string; kind: string; note: string | null; status: string; preferred_at: string | null; created_at: string; mine: boolean }
interface WallRow { id: string; title: string | null; body: string; category: string; is_urgent: boolean; is_anonymous: boolean; author_name: string | null; created_at: string; pray_count: number; status: string }
interface Briefing { flock?: number; quiet_count?: number; quiet_names?: string[]; new_count?: number; new_names?: string[]; struggling_count?: number; unmet_needs?: number; prayers_this_week?: number; prayers_prior_week?: number }

const KIND_WORD: Record<string, string> = { pray: 'asked to pray with you now', online: 'asked to meet online', nearby: 'asked to meet in person' };

export function registerShepherd(server: McpServer, env: Env, me: Believer, pastor: PastorPage): void {
  const SHEPHERD = 'Exists only for a believer the app recognises as a pastor; read-only, showing exactly what their Shepherd Console shows.';

  tool(server, 'my_congregation', {
    title: 'My congregation: who asked, and what they are praying',
    description: `List, for a pastor, the open care requests addressed to them (people asking to pray now, meet online or meet in person, with each person's note and preferred time) and the prayer requests their church shares with members. Use for "who asked to meet me this week" or "what is my church praying for". Accepting or answering happens in the console link, not here. For members who have stopped coming use who_has_gone_quiet; for the pastor's own room links use shepherd_doors. church_prayers is empty when no church is set in their console. ${SHEPHERD}`,
    inputSchema: { limit: z.number().int().min(1).max(40).default(12).describe('Maximum items per list, 1 to 40 (default 12).') },
    outputSchema: out({
      requests: z.array(z.looseObject({ id: z.string(), from: z.string(), kind: z.string(), note: z.string().nullable(), status: z.string(), preferred_at: z.string().nullable(), when: z.string() })).describe('Open care requests, newest first: id, first name, kind (pray, online, nearby), note, status (requested or accepted), preferred time, created time.'),
      church_prayers: z.array(z.looseObject({ id: z.string(), from: z.string(), title: z.string().nullable(), body: z.string(), urgent: z.boolean(), prayed: z.number(), when: z.string() })).describe('Church prayer requests: first name or "someone in the church", title, text, urgency, how many prayed, posted time.'),
      church_id: z.string().nullable().describe('The church set in their console, or null.'),
      door: z.string().describe('Link to the Shepherd Console.'),
    }),
    annotations: READS,
  }, async ({ limit }) => {
    const [reqs, wall] = await Promise.all([
      rpcAs(env, me, 'pastor_requests_for_me'),
      pastor.church_id ? rpcAs(env, me, 'get_prayer_wall', { p_layer: 'church', p_category: null, p_church_id: pastor.church_id, p_page: 0 }) : Promise.resolve({ data: [], error: null }),
    ]);
    if (reqs.error) return fail(`The requests could not be read just now (${reqs.error}). The console is at ${DOORS.shepherdCare}.`);
    const requests = (Array.isArray(reqs.data) ? (reqs.data as CareRequest[]) : []).filter((r) => ['requested', 'accepted'].includes(r.status)).slice(0, limit)
      .map((r) => ({ id: r.id, from: firstName(r.seeker_name), kind: r.kind, note: r.note, status: r.status, preferred_at: r.preferred_at, when: r.created_at }));
    const church_prayers = (Array.isArray(wall.data) ? (wall.data as WallRow[]) : []).slice(0, limit)
      .map((p) => ({ id: p.id, from: p.is_anonymous ? 'someone in the church' : firstName(p.author_name), title: p.title, body: p.body, urgent: p.is_urgent, prayed: p.pray_count, when: p.created_at }));
    return ok(paragraph([
      requests.length ? `${requests.length} ${requests.length === 1 ? 'person has' : 'people have'} asked for them: ${list(requests.slice(0, 6).map((r) => `${r.from} ${KIND_WORD[r.kind] ?? r.kind} ${sinceWordOf(r.when)}${r.note ? ` ("${r.note.slice(0, 80)}")` : ''}${r.preferred_at ? `, preferred ${r.preferred_at}` : ''}`), 6)}` : 'Nobody is waiting on a request to meet them right now',
      pastor.church_id ? (church_prayers.length ? `Their church is praying for: ${list(church_prayers.slice(0, 5).map((p) => `${p.from}: ${p.title ?? p.body.slice(0, 80)}${p.urgent ? ' (urgent)' : ''}`), 5)}` : 'No prayer request is shared with the church right now') : 'They have not named their church in the Shepherd Console, so the church prayer wall is not read',
      `Answer, accept and meet from the console at ${DOORS.shepherdCare}; the prayer wall is at ${DOORS.prayer}`,
    ]), { requests, church_prayers, church_id: pastor.church_id, door: DOORS.shepherdCare });
  });

  tool(server, 'shepherd_doors', {
    title: 'My three doors',
    description: `Return a pastor's own links and page status: their live voice prayer room, their video room, where in-person meeting requests wait, their public pastor page, and whether that page is on, marked available, and verified. Use for "what is my prayer room link" or "is my page on". Changes nothing (availability is toggled in the console). For the people who asked to meet them use my_congregation. ${SHEPHERD}`,
    inputSchema: {},
    outputSchema: out({
      pray_now: z.string().describe('Their live voice prayer room.'),
      meet_online: z.string().describe('Their video room.'),
      meet_nearby: z.string().describe('Console page where in-person requests wait.'),
      public_page: z.string().describe('Their public pastor page.'),
      console: z.string().describe('The Shepherd Console.'),
      page_on: z.boolean().describe('Whether the public page is on.'),
      available: z.boolean().describe('Whether they marked themselves available.'),
      verified: z.boolean().describe('Whether The Living Bread verified them.'),
      role: z.string().nullable().describe('Their stated role, e.g. Pastor, Priest, or null.'),
    }),
    annotations: READS,
  }, async () => {
    const doors = { pray_now: `${SITE}/rooms/pastor-${me.userId}`, meet_online: `${SITE}/video/pastor-video-${me.userId}`, meet_nearby: DOORS.shepherdCare, public_page: `${SITE}/pastor/${me.userId}`, console: DOORS.shepherdCare };
    return ok(paragraph([
      `Pray with someone now: ${doors.pray_now} (their live voice room; a seeker who presses the door lands there with them)`,
      `Meet online: ${doors.meet_online} (their video room)`,
      `Meet nearby: the requests of kind "nearby" wait in the console at ${doors.meet_nearby}, each with the seeker's preferred time`,
      `Their public page is ${doors.public_page}, ${pastor.page_on ? 'on' : 'off'}${pastor.page_on ? `, ${pastor.available ? 'available now' : 'resting (not available this minute)'}` : ''}${pastor.verified ? ', verified by the house' : ''}${pastor.role ? `, calling: ${pastor.role}` : ''}`,
      'Be shepherds of God\'s flock that is under your care (1 Peter 5:2)',
    ]), { ...doors, page_on: pastor.page_on, available: pastor.available, verified: pastor.verified, role: pastor.role });
  });

  tool(server, 'who_has_gone_quiet', {
    title: 'Who has gone quiet (the Pattern Shepherd)',
    description: `Read a pastor's weekly church briefing: first names of members who consented to shepherd signals and have not been seen in three weeks, the newest members, the member count, and prayer counts this week and last. Nothing about why anyone is away, nothing private. Only the church's own admins may read it; others get the refusal as an error. Use for "who has gone quiet" or "who joined recently". For open care requests use my_congregation. Returns church_id null when no church is set in their console. ${SHEPHERD}`,
    inputSchema: {},
    outputSchema: out({
      church_id: z.string().nullable().describe('The church read, or null when none is set.'),
      flock: z.number().optional().describe('Member count.'),
      quiet_count: z.number().optional().describe('Consenting members not seen in three weeks.'),
      quiet_names: z.array(z.string()).optional().describe('Their first names.'),
      new_count: z.number().optional().describe('Newest members.'),
      new_names: z.array(z.string()).optional().describe('Their first names.'),
      prayers_this_week: z.number().optional().describe('Prayers in the church this week.'),
      prayers_prior_week: z.number().optional().describe('Prayers the week before.'),
      door: z.string().describe('Link to the Shepherd Console.'),
    }),
    annotations: READS,
  }, async () => {
    if (!pastor.church_id) return ok(paragraph(['They have not named their church in the Shepherd Console, so there is no congregation to read', `Set it at ${DOORS.shepherdCare}, and bring the church onto the platform at ${SITE}/churches`]), { church_id: null, door: DOORS.shepherdCare });
    const r = await rpcAs(env, me, 'shepherd_briefing', { p_church: pastor.church_id });
    if (r.error) return fail(paragraph([`The briefing was refused or could not be read: ${r.error}`, `Only the church's own admins may read it; the console is at ${DOORS.shepherdCare}`]));
    const b = (r.data ?? {}) as Briefing;
    const quiet = (b.quiet_names ?? []).map((n) => firstName(n));
    const fresh = (b.new_names ?? []).map((n) => firstName(n));
    return ok(paragraph([
      b.quiet_count ? `${b.quiet_count} ${b.quiet_count === 1 ? 'member has' : 'members have'} not been seen in three weeks${quiet.length ? `, among them ${list(quiet, 8)}` : ''}; one message brings a sheep back more often than a hundred announcements` : 'Nobody in the flock has gone quiet for three weeks',
      b.new_count ? `${b.new_count} new ${b.new_count === 1 ? 'member' : 'members'} joined this fortnight${fresh.length ? `: ${list(fresh, 5)}` : ''}; the first month decides whether a door becomes a home` : null,
      typeof b.prayers_this_week === 'number' ? `${b.prayers_this_week} ${b.prayers_this_week === 1 ? 'prayer' : 'prayers'} raised on the church wall this week, ${b.prayers_prior_week ?? 0} the week before` : null,
      `Pray for them by name; the console is at ${DOORS.shepherdCare}`,
    ]), { church_id: pastor.church_id, flock: b.flock, quiet_count: b.quiet_count, quiet_names: quiet, new_count: b.new_count, new_names: fresh, prayers_this_week: b.prayers_this_week, prayers_prior_week: b.prayers_prior_week, door: DOORS.shepherdCare });
  });
}
