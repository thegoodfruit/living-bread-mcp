#!/usr/bin/env node
/* Every answer cites us: each public tool's structuredContent.source_url must be a page on
   https://living-bread.org (or the discover library on discover.living-bread.org) that answers 200, so an assistant that cites its sources sends the reader
   to the page itself. The arguments are the first example of each tool in test/client.mjs.
   Usage: node test/sources.mjs [http://127.0.0.1:8787/mcp] [--verbose]   (exit 1 on any failure) */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const url = new URL(process.argv.slice(2).find((a) => /^https?:\/\//.test(a)) ?? 'http://127.0.0.1:8787/mcp');
const verbose = process.argv.includes('--verbose');
const src = readFileSync(path.join(HERE, 'client.mjs'), 'utf8');
const block = src.slice(src.indexOf('const calls = ['), src.indexOf('\n];', src.indexOf('const calls = [')) + 3);
const calls = new Function(`${block}; return calls;`)();

const client = new Client({ name: 'living-bread-sources', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(url));
const { tools } = await client.listTools();
const firstArgs = new Map();
for (const [name, args] of calls) if (!firstArgs.has(name)) firstArgs.set(name, args);
const examples = {};
const statusCache = new Map();
async function status(u) {
  if (statusCache.has(u)) return statusCache.get(u);
  let s = 0;
  try { s = (await fetch(u, { redirect: 'follow', headers: { 'user-agent': 'TheLivingBread-MCP-sources/1.0' } })).status; } catch { s = 0; }
  statusCache.set(u, s);
  return s;
}
let failures = 0;
const rows = [];
for (const t of tools) {
  let args = firstArgs.get(t.name);
  if (typeof args === 'function') { try { args = args(examples); } catch { args = undefined; } }
  if (args === undefined) { rows.push([t.name, 'no example', '']); continue; }
  let r;
  try { r = await client.callTool({ name: t.name, arguments: args }); } catch (e) { rows.push([t.name, `threw ${e.message}`, '']); failures++; continue; }
  if (!examples[t.name]) examples[t.name] = { args, structured: r.structuredContent };
  if (r.isError) { rows.push([t.name, 'error answer (no source_url by design)', '']); continue; }
  const s = r.structuredContent?.source_url;
  const onSite = typeof s === 'string' && /^https:\/\/(discover\.)?living-bread\.org(\/|$|\?)/.test(s);
  const code = typeof s === 'string' ? await status(s) : 0;
  const good = onSite && code === 200;
  if (!good) failures++;
  rows.push([t.name, good ? 'ok' : 'FAIL', `${s ?? 'null'} ${code || ''}`]);
}
for (const [n, st, d] of rows) if (verbose || st !== 'ok') console.log(`${st.padEnd(8)} ${n.padEnd(34)} ${d}`);
console.log(`\n${rows.filter((r) => r[1] === 'ok').length} of ${rows.length} tools cite a living-bread.org page that answers 200; ${failures} failed`);
await client.close();
process.exit(failures ? 1 : 0);
