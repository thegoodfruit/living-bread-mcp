#!/usr/bin/env node
/* Mint a session for the platform's HOUSE account (never a real believer) from ../.env.local and run
   test/oauth-flow.mjs with it.   node test/run-oauth-flow.mjs [mcp base] */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(path.resolve(here, '..', '..', '.env.local'), 'utf8').split('\n')) { const i = line.indexOf('='); if (i > 0 && !line.startsWith('#')) env[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL.replace(/\/$/, '');
const H = (tok) => ({ apikey: tok, authorization: `Bearer ${tok}`, 'content-type': 'application/json' });
const link = await (await fetch(`${URL_}/auth/v1/admin/generate_link`, { method: 'POST', headers: H(env.SUPABASE_SERVICE_ROLE_KEY), body: JSON.stringify({ type: 'magiclink', email: 'house@livingbread.app' }) })).json();
const th = link.hashed_token ?? link.properties?.hashed_token;
const v = await (await fetch(`${URL_}/auth/v1/verify`, { method: 'POST', headers: H(env.EXPO_PUBLIC_SUPABASE_ANON_KEY), body: JSON.stringify({ type: 'magiclink', token_hash: th }) })).json();
const r = spawnSync(process.execPath, [path.join(here, 'oauth-flow.mjs'), process.argv[2] ?? 'https://mcp.living-bread.org'], {
  stdio: 'inherit',
  env: { ...process.env, SUPABASE_URL: URL_, SUPABASE_ANON_KEY: env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY, USER_TOKEN: v.access_token },
});
process.exit(r.status ?? 1);
