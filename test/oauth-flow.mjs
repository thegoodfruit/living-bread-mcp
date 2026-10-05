#!/usr/bin/env node
/* The whole OAuth 2.1 flow, as an assistant would run it, with the consent step
   performed by REST as the signed-in believer (the same two calls the consent
   page makes). Uses the platform's house account only.
     SUPABASE_URL= SUPABASE_ANON_KEY= SUPABASE_SERVICE_ROLE_KEY= USER_TOKEN= node test/oauth-flow.mjs <mcp base> */
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const base = process.argv[2] ?? 'https://mcp.living-bread.org';
const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, USER_TOKEN } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !USER_TOKEN) { console.error('missing env'); process.exit(2); }
let failures = 0;
const check = (l, g, n = '') => { console.log(`  ${g ? 'ok  ' : 'FAIL'} ${l}${!g && n ? `: ${n}` : ''}`); if (!g) failures++; };
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// 1. discovery, from the resource metadata the way a client does it
const meta = await (await fetch(`${base}/.well-known/oauth-protected-resource/me`)).json();
const issuer = meta.authorization_servers[0];
const u = new URL(issuer);
const disc = await (await fetch(`${u.origin}/.well-known/oauth-authorization-server${u.pathname}`)).json();
check('discovery has authorize, token, register', Boolean(disc.authorization_endpoint && disc.token_endpoint && disc.registration_endpoint));

// 2. dynamic client registration (public client, PKCE)
const redirect = 'https://example.com/callback';
const reg = await (await fetch(disc.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Living Bread flow test', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) })).json();
check('client registered', typeof reg.client_id === 'string', JSON.stringify(reg).slice(0, 160));

try {
  // 3. authorize -> consent page
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const authz = new URL(disc.authorization_endpoint);
  Object.entries({ client_id: reg.client_id, redirect_uri: redirect, response_type: 'code', scope: 'openid email profile', state: 'st1', code_challenge: challenge, code_challenge_method: 'S256' }).forEach(([k, v]) => authz.searchParams.set(k, v));
  const r1 = await fetch(authz, { redirect: 'manual' });
  const consentUrl = r1.headers.get('location') ?? '';
  check('authorize redirects to the consent page', r1.status === 302 && consentUrl.startsWith('https://living-bread.org/oauth/consent?authorization_id='), `${r1.status} ${consentUrl}`);
  const authorizationId = new URL(consentUrl).searchParams.get('authorization_id');

  // 4. the consent page's two calls, as the believer
  const H = { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${USER_TOKEN}`, 'content-type': 'application/json' };
  const details = await (await fetch(`${issuer}/oauth/authorizations/${authorizationId}`, { headers: H })).json();
  check('details name the client and the user', details?.client?.name === 'Living Bread flow test' && typeof details?.user?.email === 'string', JSON.stringify(details).slice(0, 200));
  const approved = await (await fetch(`${issuer}/oauth/authorizations/${authorizationId}/consent`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'approve' }) })).json();
  const back = new URL(approved.redirect_url);
  const code = back.searchParams.get('code');
  check('approval returns to the client with a code and the state', back.origin + back.pathname === redirect && Boolean(code) && back.searchParams.get('state') === 'st1', approved.redirect_url ?? JSON.stringify(approved).slice(0, 160));

  // 5. exchange the code (PKCE)
  const tok = await (await fetch(disc.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier }) })).json();
  check('token endpoint issues an access token and a refresh token', typeof tok.access_token === 'string' && typeof tok.refresh_token === 'string', JSON.stringify(tok).slice(0, 160));

  // 6. the assistant connects as the believer
  const client = new Client({ name: 'flow-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/me`), { requestInit: { headers: { authorization: `Bearer ${tok.access_token}` } } }));
  const who = await client.callTool({ name: 'who_am_i', arguments: {} });
  const text = who.content?.find((c) => c.type === 'text')?.text ?? '';
  check('who_am_i answers as the believer through the OAuth token', !who.isError && /acting for/.test(text), text.slice(0, 160));
  console.log(`       ${text.slice(0, 200)}`);
  await client.close();
} finally {
  // 7. leave nothing behind
  const del = await fetch(`${issuer}/admin/oauth/clients/${reg.client_id}`, { method: 'DELETE', headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } });
  check('test client deleted', del.status === 204, String(del.status));
}
console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
