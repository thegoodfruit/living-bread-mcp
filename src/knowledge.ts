/* ============================================================
   THE LIVING BREAD MCP, the living sources.

   Nothing here is remembered; everything is read live:
     - the Christian Knowledge API on discover.living-bread.org (open, CC-BY,
       stable lb: entity ids, provenance): ask, nearby, church, denomination,
       saint, sacred site, biblical figure, Bible place;
     - the anon-callable Supabase functions an AI may read (0491, 0492, 0493,
       0538): ai_find_churches, ai_find_gatherings, ai_resolve_place,
       ai_get_church, ai_get_gathering, communities_overview. The column lists
       of those functions ARE the privacy policy: city-level places, no
       addresses, no coordinates, no contact details, nobody's name.
   Every call has a timeout and returns null on failure, so a tool can say
   "we could not reach this just now" instead of guessing.
   ============================================================ */
import { slugify } from './render';

const TIMEOUT_MS = 9000;

async function getJSON<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', 'User-Agent': 'TheLivingBread-MCP/1.0 (+https://mcp.living-bread.org)', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ---- the Knowledge API ----------------------------------------------------
export interface AskEntity {
  id: string;
  type: string;
  name: string;
  url: string;
  image?: string | null;
  facts?: Record<string, unknown>;
  source?: string | null;
}
export interface AskResult {
  question: string;
  entities: AskEntity[];
  answer: string | null;
  churches: unknown;
  scripture: { url?: string; urn?: string; name?: string; type?: string; resonance?: number } | null;
  road_to_christ: { url: string; urn?: string; name: string }[] | null;
  next_steps: { label: string; url: string }[] | null;
  grounding?: string;
  license?: string;
  attribution?: string;
}

export function ask(env: Env, question: string): Promise<AskResult | null> {
  return getJSON<AskResult>(`${env.KNOWLEDGE_API}/api/ask?q=${encodeURIComponent(question.slice(0, 300))}`);
}

export interface NearbyChurch {
  id: string;
  name: string;
  denomination: string | null;
  distance_km: number;
  url: string;
  image?: string | null;
}
export interface NearbyResult {
  count: number;
  results: NearbyChurch[];
}

export function nearby(env: Env, country: string, lat: number, lon: number, limit: number, denomination?: string): Promise<NearbyResult | null> {
  const u = new URL(`${env.KNOWLEDGE_API}/api/nearby`);
  u.searchParams.set('country', country);
  u.searchParams.set('lat', String(lat));
  u.searchParams.set('lon', String(lon));
  u.searchParams.set('limit', String(limit));
  if (denomination) u.searchParams.set('denomination', denomination);
  return getJSON<NearbyResult>(u.toString());
}

export type HeritageKind = 'denomination' | 'saint' | 'sacred-site' | 'biblical-figure' | 'bible-place';

export function entity(env: Env, kind: HeritageKind, slug: string): Promise<Record<string, unknown> | null> {
  return getJSON<Record<string, unknown>>(`${env.KNOWLEDGE_API}/api/${kind}/${encodeURIComponent(slug)}`);
}

export function church(env: Env, country: string, slug: string): Promise<Record<string, unknown> | null> {
  return getJSON<Record<string, unknown>>(`${env.KNOWLEDGE_API}/api/church/${encodeURIComponent(slugify(country))}/${encodeURIComponent(slugify(slug))}`);
}

/** A name that is not a slug yet becomes one; a known entity found by asking becomes its slug. */
export async function findEntity(env: Env, kind: HeritageKind, nameOrSlug: string): Promise<Record<string, unknown> | null> {
  const direct = await entity(env, kind, slugify(nameOrSlug));
  if (direct) return direct;
  const asked = await ask(env, nameOrSlug);
  const match = asked?.entities?.find((e) => e.type === kind || e.type === kind.replace(/-/g, '_'));
  if (!match) return null;
  const slug = match.id.split(':').slice(2).join(':');
  return slug ? entity(env, kind, slug) : null;
}

// ---- Supabase, as anon --------------------------------------------------------
export async function rpc<T>(env: Env, fn: string, body: Record<string, unknown>): Promise<T[] | null> {
  const data = await getJSON<unknown>(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
    body: JSON.stringify(body),
  });
  return Array.isArray(data) ? (data as T[]) : null;
}

export interface Church {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  distance_km: number | null;
  claimed: boolean;
}
export interface Gathering {
  id: string;
  title: string;
  city: string | null;
  region: string | null;
  starts_at: string;
  is_online: boolean;
  category: string | null;
  beginner_friendly: boolean | null;
  distance_km: number | null;
  has_passed?: boolean;
}
export interface Community {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  city: string | null;
  country: string | null;
  is_global: boolean;
  member_count: number;
  is_verified: boolean;
  discoverable: boolean;
  join_policy: string | null;
  next_gathering_title: string | null;
  next_gathering_at: string | null;
  rhythm_title: string | null;
}

export function findChurches(env: Env, args: { lat: number | null; lon: number | null; place: string | null; limit: number }) {
  return rpc<Church>(env, 'ai_find_churches', { p_lat: args.lat, p_lon: args.lon, p_place: args.lat === null ? args.place : null, p_limit: args.limit });
}
export function findGatherings(env: Env, args: { lat: number | null; lon: number | null; place: string | null; online: boolean | null; limit: number }) {
  return rpc<Gathering>(env, 'ai_find_gatherings', {
    p_lat: args.lat, p_lon: args.lon, p_place: args.lat === null ? args.place : null, p_online: args.online, p_limit: args.limit,
  });
}
export async function getChurch(env: Env, id: string): Promise<Church | null> {
  return (await rpc<Church>(env, 'ai_get_church', { p_id: id }))?.[0] ?? null;
}
export async function getGathering(env: Env, id: string): Promise<Gathering | null> {
  return (await rpc<Gathering>(env, 'ai_get_gathering', { p_id: id }))?.[0] ?? null;
}
export async function communities(env: Env): Promise<Community[] | null> {
  const rows = await rpc<Community>(env, 'communities_overview', {});
  // a family room is never discoverable, and the function already hides what a visitor may not see
  return rows ? rows.filter((c) => c.kind !== 'family' && c.discoverable !== false) : null;
}

// ---- a place becomes coordinates ---------------------------------------------
export interface Geo {
  lat: number;
  lon: number;
  label: string;
  /** The country as a slug the Knowledge API understands, when known: "united-states". */
  countrySlug: string | null;
}

/* Three tiers, learned at cost in the earlier edge server: Mapbox (permits
   server use, accurate anywhere), Nominatim (refuses most datacentre
   traffic, so it is a fallback), then our own rows via ai_resolve_place,
   which cannot be rate limited and always covers a place we hold. */
export async function geocode(env: Env, place: string): Promise<Geo | null> {
  const q = place.trim().slice(0, 120);
  if (!q) return null;

  const token = (env as { MAPBOX_TOKEN?: string }).MAPBOX_TOKEN;
  if (token) {
    const u = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?limit=1&types=place,region,country,locality,district&access_token=${token}`;
    const d = await getJSON<{ features?: { center?: number[]; place_name?: string; place_type?: string[]; text?: string; context?: { id: string; text: string }[] }[] }>(u);
    const f = d?.features?.[0];
    const c = f?.center;
    if (c && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
      const countryText = f?.place_type?.includes('country') ? f.text : f?.context?.find((x) => x.id.startsWith('country'))?.text;
      return { lat: c[1], lon: c[0], label: f?.place_name ?? q, countrySlug: countryText ? slugify(countryText) : null };
    }
  }

  const params = new URLSearchParams({ q, format: 'jsonv2', limit: '1', addressdetails: '1', 'accept-language': 'en' });
  const rows = await getJSON<{ lat?: string; lon?: string; display_name?: string; address?: { country?: string } }[]>(
    `https://nominatim.openstreetmap.org/search?${params}`,
  );
  const top = rows?.[0];
  if (top?.lat && top?.lon) {
    return { lat: Number(top.lat), lon: Number(top.lon), label: top.display_name ?? q, countrySlug: top.address?.country ? slugify(top.address.country) : null };
  }

  const own = await rpc<{ lat: number; lon: number; matched: string; how: string }>(env, 'ai_resolve_place', { p_place: q });
  const o = own?.[0];
  if (o && Number.isFinite(o.lat) && Number.isFinite(o.lon)) {
    return { lat: o.lat, lon: o.lon, label: o.how === 'approximate' ? `near ${o.matched}` : o.matched, countrySlug: null };
  }
  return null;
}

export async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}
