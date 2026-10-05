/* ============================================================
   THE LIVING BREAD MCP, acting as the signed-in believer.

   Supabase Auth is the OAuth 2.1 authorization server (PKCE, dynamic client
   registration). This Worker is only a resource server: it publishes where
   the authorization server is, and it verifies the bearer token an assistant
   presents against Supabase's JWKS. A verified token names one believer
   (sub); every personal tool then calls the database AS that believer, with
   the same row-level security the app itself lives under. The Worker holds
   no password, no session, no secret of its own.
   ============================================================ */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export const ME_PATH = '/me';
/** The ChatGPT app profile: the same sign-in, a narrower, read-only set of tools (OpenAI's app review
    declines care matching, crisis services and most writes; the Claude directory keeps the full /me). */
export const APP_PATH = '/app';
export const ME_URL = 'https://mcp.living-bread.org/me';
export const RESOURCE_METADATA_URL = 'https://mcp.living-bread.org/.well-known/oauth-protected-resource/me';

/** What a verified token tells us. Passed to the agent as props. */
export interface Believer {
  userId: string;
  email: string | null;
  /** The OAuth client that holds the grant, when the token came through OAuth. */
  clientId: string | null;
  /** The raw token, forwarded to PostgREST so RLS sees the believer. */
  token: string;
  /** 'app' narrows the tool set for the ChatGPT app directory. */
  profile?: 'app';
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwks(env: Env) {
  const url = `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  let set = jwksCache.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url), { cooldownDuration: 60_000, cacheMaxAge: 10 * 60_000 });
    jwksCache.set(url, set);
  }
  return set;
}

/** The issuer Supabase writes into every token it signs. */
export function issuer(env: Env): string {
  return `${env.SUPABASE_URL}/auth/v1`;
}

/** Verify a bearer token. Returns null for anything but a valid, unexpired,
    asymmetrically signed token for a real user of this project. */
export async function verifyBearer(env: Env, authorization: string | null): Promise<Believer | null> {
  if (!authorization) return null;
  const m = authorization.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  try {
    const { payload } = await jwtVerify(token, jwks(env), { issuer: issuer(env), algorithms: ['ES256', 'RS256'] });
    const p = payload as JWTPayload & { email?: string; client_id?: string; role?: string };
    if (typeof p.sub !== 'string' || !p.sub) return null;
    if (p.role && p.role !== 'authenticated') return null;
    return { userId: p.sub, email: typeof p.email === 'string' ? p.email : null, clientId: typeof p.client_id === 'string' ? p.client_id : null, token };
  } catch {
    return null;
  }
}

/** RFC 9728: where an assistant learns how to sign a believer in. */
export function protectedResourceMetadata(env: Env, path: string = ME_PATH) {
  return {
    resource: path === APP_PATH ? ME_URL.replace(ME_PATH, APP_PATH) : ME_URL,
    authorization_servers: [issuer(env)],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'email', 'profile', 'offline_access'],
    resource_name: 'The Living Bread, as yourself',
    resource_documentation: 'https://mcp.living-bread.org/#yourself',
  };
}

/** The 401 that starts the OAuth dance (RFC 9728 section 5.1). */
export function unauthorized(detail: string, path: string = ME_PATH): Response {
  return new Response(JSON.stringify({ error: 'unauthorized', detail, sign_in: 'Connect this URL in your assistant and it will ask you to sign in to The Living Bread.' }), {
    status: 401,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'WWW-Authenticate',
      'www-authenticate': `Bearer realm="The Living Bread", resource_metadata="https://mcp.living-bread.org/.well-known/oauth-protected-resource${path}"`,
    },
  });
}

/** Call a database function AS the believer. PostgREST applies RLS from the token. */
export async function rpcAs(env: Env, believer: Believer, fn: string, args: Record<string, unknown> = {}): Promise<{ data: unknown; error: string | null }> {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${believer.token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(args),
    });
    const text = await r.text();
    if (!r.ok) {
      let msg = text.slice(0, 200);
      try { msg = (JSON.parse(text) as { message?: string }).message ?? msg; } catch { /* keep text */ }
      return { data: null, error: msg || `HTTP ${r.status}` };
    }
    return { data: text ? JSON.parse(text) : null, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'network' };
  }
}

/** A table write AS the believer, the way the app itself writes (PostgREST + RLS), always asking
    the row back so a policy-filtered no-op is seen for what it is instead of counted as success. */
export async function restAs(env: Env, believer: Believer, method: 'POST' | 'PATCH' | 'DELETE', pathAndQuery: string, body: unknown, prefer: string): Promise<{ rows: unknown[] | null; error: string | null }> {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
      method,
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${believer.token}`, 'content-type': 'application/json', accept: 'application/json', prefer },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) {
      let msg = text.slice(0, 200);
      try { msg = (JSON.parse(text) as { message?: string }).message ?? msg; } catch { /* keep text */ }
      return { rows: null, error: msg || `HTTP ${r.status}` };
    }
    const data: unknown = text ? JSON.parse(text) : [];
    return { rows: Array.isArray(data) ? data : [data], error: null };
  } catch (e) {
    return { rows: null, error: e instanceof Error ? e.message : 'network' };
  }
}

/** Read the believer's own profile row (RLS lets a person read themselves). */
export async function selectAs<T>(env: Env, believer: Believer, table: string, query: string): Promise<T[] | null> {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${believer.token}`, accept: 'application/json' },
    });
    if (!r.ok) return null;
    return (await r.json()) as T[];
  } catch {
    return null;
  }
}
