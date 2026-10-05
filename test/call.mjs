#!/usr/bin/env node
/* Call one tool and print its answer: node test/call.mjs <url> <tool> '<json args>' [--full] */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [url, name, args = '{}'] = process.argv.slice(2);
const client = new Client({ name: 'living-bread-call', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
const t0 = Date.now();
const r = await client.callTool({ name, arguments: JSON.parse(args) });
const ms = Date.now() - t0;
console.log(`${name} ${ms}ms isError=${Boolean(r.isError)}`);
for (const c of r.content ?? []) console.log('TEXT:', (c.text ?? '').slice(0, process.argv.includes('--full') ? 100000 : 1200));
if (r.structuredContent) console.log('STRUCT:', JSON.stringify(r.structuredContent, null, process.argv.includes('--full') ? 1 : 0).slice(0, process.argv.includes('--full') ? 100000 : 2500));
if (r._meta) console.log('META:', JSON.stringify(r._meta));
await client.close();
