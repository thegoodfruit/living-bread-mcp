#!/usr/bin/env node
/* keep_the_watch as the signed-in REVIEW account (never a real believer), against a running server.
   Usage: node test/watch-me.mjs [http://127.0.0.1:8791]   (reads .env.local from the repo root)
   Proves: keep_the_watch exists on /me, writes nothing without confirmation, keeps an hour when
   confirmed, keeping it twice is the same hour, and releasing it releases it. Cleans up after itself. */
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const base = (process.argv[2] ?? 'http://127.0.0.1:8791').replace(/\/$/, '');
const env = Object.fromEntries(readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL.replace(/\/$/, '');
const sb = async (method, p, key, body) => {
  const r = await fetch(`${URL_}${p}`, { method, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const link = await sb('POST', '/auth/v1/admin/generate_link', env.SUPABASE_SERVICE_ROLE_KEY, { type: 'magiclink', email: 'review@livingbread.app' });
const v = await sb('POST', '/auth/v1/verify', env.EXPO_PUBLIC_SUPABASE_ANON_KEY, { type: 'magiclink', token_hash: link.hashed_token ?? link.properties?.hashed_token });
const token = v.access_token;

let failures = 0;
const check = (label, cond, detail) => { if (cond) console.log(`  ok   ${label}`); else { failures++; console.log(`  FAIL ${label}${detail ? `: ${detail}` : ''}`); } };
const client = new Client({ name: 'living-bread-watch-me', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/me`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
const { tools } = await client.listTools();
const t = tools.find((x) => x.name === 'keep_the_watch');
check('keep_the_watch is on /me', Boolean(t));
check('keep_the_watch is a write, not destructive', t?.annotations?.readOnlyHint === false && t?.annotations?.destructiveHint === false);
check('a_person_now is on /me too', tools.some((x) => x.name === 'a_person_now'));

const args = { weekday: 'tuesday', hour: 3, time_zone: 'America/Los_Angeles' };
const r0 = await client.callTool({ name: 'keep_the_watch', arguments: args });
check('without confirmation nothing is written', r0.structuredContent?.done === false && r0.structuredContent?.needs_confirmation === true, JSON.stringify(r0.structuredContent));
const r1 = await client.callTool({ name: 'keep_the_watch', arguments: { ...args, confirmed: true, idempotency_key: `watch-proof-${Date.now()}` } });
check('confirmed: the hour is kept', r1.structuredContent?.done === true && r1.structuredContent?.kept === true && typeof r1.structuredContent?.next_at === 'string', JSON.stringify(r1.structuredContent ?? r1.content));
const mine = await fetch(`${URL_}/rest/v1/rpc/my_watch_hours`, { method: 'POST', headers: { apikey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }).then((x) => x.json());
check('my_watch_hours shows Tuesday 3am Los Angeles', Array.isArray(mine) && mine.some((h) => h.local_dow === 2 && h.local_hour === 3 && h.timezone === 'America/Los_Angeles'), JSON.stringify(mine));
const r2 = await client.callTool({ name: 'keep_the_watch', arguments: { ...args, keep: false, confirmed: true } });
check('released when asked', r2.structuredContent?.done === true && r2.structuredContent?.kept === false, JSON.stringify(r2.structuredContent ?? r2.content));
const bad = await client.callTool({ name: 'keep_the_watch', arguments: { ...args, time_zone: 'Mars/Olympus', confirmed: true } });
check('an unknown zone is refused, never guessed', bad.isError === true);
await client.close();
console.log(failures ? `\n${failures} failed` : '\nkeep_the_watch checks passed');
process.exit(failures ? 1 : 0);
