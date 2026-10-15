#!/usr/bin/env node
/* Print the tools an endpoint lists (name, annotations, input properties), as JSON.
   Usage: node test/list-tools.mjs http://127.0.0.1:8791/mcp [--full] [--token <bearer>] */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:8791/mcp');
const ti = process.argv.indexOf('--token');
const token = ti > 0 ? process.argv[ti + 1] : null;
const client = new Client({ name: 'living-bread-list', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(url, token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : undefined));
const { tools } = await client.listTools();
const full = process.argv.includes('--full');
console.log(JSON.stringify(full ? tools : tools.map((t) => ({ name: t.name, annotations: t.annotations, input: Object.keys(t.inputSchema?.properties ?? {}) })), null, 1));
await client.close();
