/* ============================================================
   THE LIVING BREAD MCP, the Kingdom Protocol doors.

   Three public read tools over the protocol reads of migration 0800
   (protocol_gatherings, protocol_needs, protocol_<kind>), the same
   functions the discover worker's /api serves. Public data only: a public
   gathering, a verified need from a ministry, an object its owner already
   made public. Never a person's place, never a coordinate for a need,
   never a private prayer. Empty results say so, and end with a door.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { SITE } from './doors';
import { record, scheduled } from './freshness';
import { list, paragraph } from './render';
import { ATTRIBUTION, isUuid, ok, out, READS, READS_WORLD, tool, unavailable } from './shared';

const API = 'https://discover.living-bread.org/api';
const GRAPH = 'https://eiekmrbmscorzjogpbzf.supabase.co/functions/v1/graph';
const EVENTS = `${SITE}/events`;
const SERVE = `${SITE}/serve`;
const SCHEMA = (kind: string) => `${SITE}/protocol/v0.1/${kind}.schema.json`;

type Row = Record<string, unknown>;

async function anonRpc(env: Env, fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; data: unknown }> {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return { ok: false, data: null };
    const t = await r.text();
    return { ok: true, data: t ? JSON.parse(t) : null };
  } catch {
    return { ok: false, data: null };
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

function whenText(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC` : iso;
}

export function registerProtocol(server: McpServer, env: Env): void {
  // ---- gatherings_tonight ---------------------------------------------------------------
  tool(server, 'gatherings_tonight', {
    title: 'Gatherings tonight',
    description: 'Public Christian gatherings that start between now and the end of tonight (the next 12 hours by default) in a city: worship nights, prayer gatherings, Bible studies, services, as listed publicly by real churches, groups and believers on The Living Bread. Only public gatherings are returned; a gathering that keeps its address private keeps its city private too, so it is not listed by city. People ask: "is there a prayer meeting tonight in Atlanta", "Bible study tonight near me", "worship tonight". Honest when nothing is listed, with the door to every gathering.',
    inputSchema: {
      city: z.string().min(2).max(80).describe('The city, for example "Atlanta" or "San Diego".'),
      country: z.string().max(80).optional().describe('Optional country, as an ISO code (US) or a name.'),
      hours: z.number().int().min(1).max(36).default(12).describe('How many hours ahead to look, 1 to 36. Default 12.'),
    },
    outputSchema: out({ city: z.string(), hours: z.number(), count: z.number(), gatherings: z.array(z.looseObject({ id: z.string(), title: z.string(), starts_at: z.string(), city: z.string().nullable(), region: z.string().nullable(), country: z.string().nullable(), is_online: z.boolean(), host: z.string(), place_name: z.string().nullable(), data_url: z.string() })), honest: z.string().optional(), door: z.string() }),
    annotations: READS,
  }, async ({ city, country, hours }) => {
    const h = hours ?? 12;
    const r = await anonRpc(env, 'protocol_gatherings', { p_city: city, p_country: country ?? null, p_days: 2, p_limit: 50 });
    if (!r.ok) return unavailable('the gatherings', EVENTS);
    const now = Date.now();
    const until = now + h * 3600_000;
    const rows = (Array.isArray(r.data) ? r.data : []) as Row[];
    const picked = rows
      .filter((g) => g.status !== 'cancelled')
      .filter((g) => { const t = Date.parse(String(g.starts_at)); return t >= now - 3600_000 && t <= until; })
      .map((g) => ({
        id: String(g.id),
        title: String(g.title ?? ''),
        starts_at: String(g.starts_at),
        city: str(g.city), region: str(g.region), country: str(g.country),
        is_online: g.is_online === true,
        host: str((g.host as Row | null)?.name) ?? 'A believer',
        place_name: str(g.place_name),
        data_url: `${API}/gathering/${g.id}`, freshness: scheduled(String(g.starts_at), undefined, str(((g.source as Row | null)?.last_verified_at)) ?? str(g.updated_at)),
      }));
    if (!picked.length) {
      const honest = `No public gathering is listed in ${city} in the next ${h} hours. That means none is listed here, not that the church is not meeting.`;
      return ok(paragraph([honest, `Every listed gathering is at ${EVENTS}`]), { city, hours: h, count: 0, gatherings: [], honest, door: EVENTS, ...ATTRIBUTION });
    }
    return ok(paragraph([
      `${picked.length} public ${picked.length === 1 ? 'gathering' : 'gatherings'} in ${city} in the next ${h} hours: ${list(picked.map((g) => `${g.title}, ${whenText(g.starts_at)}${g.place_name ? `, ${g.place_name}` : ''}${g.is_online ? ', online' : ''}, hosted by ${g.host}`), 10)}`,
      'Times are in UTC; please confirm with the host before you go',
      `Every gathering is at ${EVENTS}`,
    ]), { city, hours: h, count: picked.length, gatherings: picked, door: EVENTS, ...ATTRIBUTION });
  });

  // ---- where_can_i_serve_publicly --------------------------------------------------------
  tool(server, 'where_can_i_serve_publicly', {
    title: 'Where can I serve (publicly listed needs)',
    description: 'Verified, open needs that ask for people, posted publicly by verified ministries on The Living Bread Serve network: what is needed, the city and country, whether it can be met in person or remotely, and the ministry behind it. Only public data is returned: never coordinates, never a contact. People ask: "where can I volunteer", "where can I serve this Saturday", "something I can help with remotely". Honest when nothing is listed.',
    inputSchema: {
      country: z.string().max(80).optional().describe('Optional country, as a name or ISO code.'),
      city: z.string().max(80).optional().describe('Optional city.'),
      remote_only: z.boolean().optional().describe('Only needs that can be met remotely.'),
    },
    outputSchema: out({ count: z.number(), needs: z.array(z.looseObject({ id: z.string(), title: z.string(), category: z.string().nullable(), urgency: z.string().nullable(), city: z.string().nullable(), region: z.string().nullable(), country: z.string().nullable(), local: z.boolean(), remote: z.boolean(), ministry: z.string().nullable(), ministry_url: z.string().nullable(), data_url: z.string() })), honest: z.string().optional(), door: z.string() }),
    annotations: READS,
  }, async ({ country, city, remote_only }) => {
    const r = await anonRpc(env, 'protocol_needs', { p_country: country ?? null, p_city: city ?? null, p_people_only: true, p_limit: 20 });
    if (!r.ok) return unavailable('the Serve network', SERVE);
    let rows = (Array.isArray(r.data) ? r.data : []) as Row[];
    if (remote_only) rows = rows.filter((n) => n.remote === true);
    const needs = rows.map((n) => {
      const m = n.ministry as Row | null;
      return {
        id: String(n.id), title: String(n.title ?? ''), category: str(n.category), urgency: str(n.urgency),
        city: str(n.city), region: str(n.region), country: str(n.country),
        local: n.local === true, remote: n.remote === true,
        ministry: str(m?.name), ministry_url: str(m?.slug) ? `${SITE}/ministries/${m!.slug}` : null,
        data_url: `${API}/need/${n.id}`, freshness: record(str(n.created_at) ?? str(n.updated_at), "A need a verified ministry posted; open when read. Timing is coordinated by the ministry."),
      };
    });
    const where = [city, country].filter(Boolean).join(', ') || 'the whole network';
    if (!needs.length) {
      const honest = `No public need asking for people is listed for ${where}${remote_only ? ' that can be met remotely' : ''}. That means none is listed yet, not that nobody is in need.`;
      return ok(paragraph([honest, `All of Serve is at ${SERVE}`]), { count: 0, needs: [], honest, door: SERVE, ...ATTRIBUTION });
    }
    return ok(paragraph([
      `${needs.length} public ${needs.length === 1 ? 'need' : 'needs'} asking for people in ${where}: ${list(needs.map((n) => `${n.title}${n.urgency === 'urgent' ? ' (urgent)' : ''}, ${[n.city, n.country].filter(Boolean).join(', ') || 'place not given'}, ${[n.local ? 'in person' : null, n.remote ? 'remotely' : null].filter(Boolean).join(' or ')}${n.ministry ? `, with ${n.ministry}` : ''}`), 10)}`,
      'Places are a city and a country only; the ministry coordinates the rest',
      `All of Serve is at ${SERVE}`,
    ]), { count: needs.length, needs, door: SERVE, ...ATTRIBUTION });
  });

  // ---- kingdom_protocol_lookup -----------------------------------------------------------
  const KINDS: Record<string, { fn: string; arg: 'p_id' | 'p_slug' | 'p_handle'; kind: string; uuid: boolean }> = {
    gathering: { fn: 'protocol_gathering', arg: 'p_id', kind: 'gathering', uuid: true },
    church: { fn: 'protocol_church', arg: 'p_id', kind: 'church', uuid: true },
    ministry: { fn: 'protocol_ministry', arg: 'p_slug', kind: 'ministry', uuid: false },
    community: { fn: 'protocol_community', arg: 'p_id', kind: 'community', uuid: true },
    need: { fn: 'protocol_need', arg: 'p_id', kind: 'need', uuid: true },
    service: { fn: 'protocol_need', arg: 'p_id', kind: 'service-opportunity', uuid: true },
    testimony: { fn: 'protocol_testimony', arg: 'p_id', kind: 'testimony', uuid: true },
    prayer: { fn: 'protocol_prayer', arg: 'p_id', kind: 'prayer', uuid: true },
    profile: { fn: 'protocol_person', arg: 'p_handle', kind: 'person', uuid: false },
  };

  tool(server, 'kingdom_protocol_lookup', {
    title: 'Look up a Kingdom Protocol object',
    description: 'Resolve a Living Bread lb: URN to its public object under the Kingdom Protocol v0.1: lb:gathering:<id>, lb:church:<id>, lb:ministry:<slug>, lb:community:<id>, lb:need:<id>, lb:service:<id>, lb:testimony:<id>, lb:prayer:<id>, lb:profile:<handle>. Any other lb: URN (a directory church, a city, a Scripture, a topic, a person of the Bible) is resolved through the public Kingdom Graph. Only public data is returned; an object that is not public answers as not found. Returns the object, its protocol kind and its JSON Schema.',
    inputSchema: { urn: z.string().min(5).max(300).describe('An lb: URN, for example lb:gathering:<uuid> or lb:ministry:hope-for-a-good-life.') },
    outputSchema: out({ urn: z.string(), found: z.boolean(), protocol_kind: z.string().nullable(), schema: z.string().nullable(), object: z.unknown().nullable(), source: z.string(), door: z.string() }),
    annotations: READS_WORLD,
  }, async ({ urn }) => {
    const u = urn.trim();
    const m = u.match(/^lb:([a-z_]+):(.+)$/);
    if (!m) {
      return ok(paragraph([`${u} is not an lb: URN. A URN looks like lb:gathering:<id> or lb:ministry:<slug>`, `The protocol is described at ${SITE}/protocol`]), { urn: u, found: false, protocol_kind: null, schema: null, object: null, source: 'none', door: `${SITE}/protocol`, ...ATTRIBUTION });
    }
    const [, type, id] = m;
    const k = KINDS[type];
    if (k && (!k.uuid || isUuid(id))) {
      const r = await anonRpc(env, k.fn, { [k.arg]: id });
      if (!r.ok) return unavailable('the Kingdom Protocol reads', `${SITE}/protocol`);
      if (!r.data) {
        return ok(paragraph([`${u} is not found, or it is not public`, `The protocol is described at ${SITE}/protocol`]), { urn: u, found: false, protocol_kind: k.kind, schema: SCHEMA(k.kind), object: null, source: k.fn, door: `${SITE}/protocol`, ...ATTRIBUTION });
      }
      const o = r.data as Row;
      const name = str(o.title) ?? str(o.name) ?? str(o.handle) ?? u;
      return ok(paragraph([`${u} is a public ${k.kind.replace('-', ' ')}: ${name}`, `Its JSON Schema is ${SCHEMA(k.kind)}`]), { urn: u, found: true, protocol_kind: k.kind, schema: SCHEMA(k.kind), object: o, source: k.fn, door: `${SITE}/protocol`, ...ATTRIBUTION });
    }
    // everything else: the public Kingdom Graph resolver
    try {
      const r = await fetch(`${GRAPH}?urn=${encodeURIComponent(u)}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
      if (!r.ok && r.status !== 404) return unavailable('the Kingdom Graph', `${SITE}/kingdom-graph`);
      const data = (await r.json().catch(() => null)) as Row | null;
      const ent = (data && (data.entity as Row | undefined)) ?? data;
      const found = Boolean(r.ok && ent && !data?.error);
      const name = found ? str((ent as Row).canonical_name) ?? str((ent as Row).name) ?? u : u;
      return ok(paragraph([found ? `${u} resolves in the Kingdom Graph: ${name}` : `${u} is not found in the Kingdom Graph`, `The graph is described at ${SITE}/kingdom-graph`]), { urn: u, found, protocol_kind: null, schema: null, object: found ? data : null, source: 'kingdom_graph', door: `${SITE}/kingdom-graph`, ...ATTRIBUTION });
    } catch {
      return unavailable('the Kingdom Graph', `${SITE}/kingdom-graph`);
    }
  });
}
