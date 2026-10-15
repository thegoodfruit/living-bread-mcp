#!/usr/bin/env node
/* The ChatGPT plugin profile /app is live and reviewed: its tool names, titles, annotations and input
   fields must never change by accident. This reads /app's tools/list as the house platform account
   (house@livingbread.app only, minted from ../.env.local) and compares it to test/app-profile.lock.json.
     node test/app-lock.mjs <base>            check (exit 1 on any difference)
     node test/app-lock.mjs <base> --write    write the lock from that server (only from production, on purpose) */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCK = path.join(HERE, 'app-profile.lock.json');
const base = (process.argv[2] ?? 'https://mcp.living-bread.org').replace(/\/$/, '');
const E = Object.fromEntries(readFileSync(path.join(HERE, '..', '..', '.env.local'), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const SB = E.EXPO_PUBLIC_SUPABASE_URL.replace(/\/$/, '');
const sb = async (p, key, body) => {
  const r = await fetch(SB + p, { method: 'POST', headers: { apikey: key === E.SUPABASE_SERVICE_ROLE_KEY ? key : E.EXPO_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json();
};
const link = await sb('/auth/v1/admin/generate_link', E.SUPABASE_SERVICE_ROLE_KEY, { type: 'magiclink', email: 'house@livingbread.app' });
const v = await sb('/auth/v1/verify', E.EXPO_PUBLIC_SUPABASE_ANON_KEY, { type: 'magiclink', token_hash: link.hashed_token ?? link.properties?.hashed_token });

const client = new Client({ name: 'living-bread-app-lock', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/app`), { requestInit: { headers: { authorization: `Bearer ${v.access_token}` } } }));
const { tools } = await client.listTools();
await client.close();
const shape = tools.map((t) => ({ name: t.name, title: t.title ?? null, annotations: t.annotations ?? null, input: Object.keys(t.inputSchema?.properties ?? {}).sort(), required: [...(t.inputSchema?.required ?? [])].sort() })).sort((a, b) => a.name.localeCompare(b.name));

if (process.argv.includes('--write')) {
  writeFileSync(LOCK, JSON.stringify({ $comment: `The /app (ChatGPT plugin) profile as listed by ${base} on ${new Date().toISOString().slice(0, 10)}. Changing it is a plugin resubmission: update only on purpose.`, tools: shape }, null, 1) + '\n');
  console.log(`wrote ${shape.length} tools to ${LOCK}`);
  process.exit(0);
}
const lock = JSON.parse(readFileSync(LOCK, 'utf8')).tools;
let failures = 0;
const byName = new Map(shape.map((t) => [t.name, t]));
for (const want of lock) {
  const got = byName.get(want.name);
  if (!got) { failures++; console.log(`  FAIL ${want.name} is missing from /app`); continue; }
  for (const k of ['title', 'annotations', 'input', 'required']) if (JSON.stringify(got[k]) !== JSON.stringify(want[k])) { failures++; console.log(`  FAIL ${want.name}.${k}: ${JSON.stringify(got[k])} != locked ${JSON.stringify(want[k])}`); }
}
for (const t of shape) if (!lock.some((x) => x.name === t.name)) { failures++; console.log(`  FAIL ${t.name} is on /app but not in the lock`); }
console.log(failures ? `\n${failures} difference(s) from the /app lock` : `\n/app matches the lock: ${shape.length} tools, names, titles, annotations and inputs unchanged`);
process.exit(failures ? 1 : 0);
