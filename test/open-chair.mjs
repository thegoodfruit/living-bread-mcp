#!/usr/bin/env node
/* The Open Chair on the MCP, end to end with a real MCP client.
   Usage: node test/open-chair.mjs [https://mcp.living-bread.org/mcp]   (exit code 1 if anything fails)

   Proves what a directory review and a person would rely on: the public door is a mode of
   find_people_to_pray_with (read only), it sends nothing, it names the crisis rule, it never
   carries an em dash, and ask_the_family_to_pray (the consented write) does NOT exist on the
   public endpoint. When the page is not open yet, the answer says so and hands no dead link. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:8791/mcp');
const client = new Client({ name: 'living-bread-open-chair-probe', version: '1.0.0' });
let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FAIL ${label}${detail ? `: ${detail}` : ''}`); }
};
const text = (r) => (r.content ?? []).map((c) => c.text ?? '').join('\n');

await client.connect(new StreamableHTTPClientTransport(url));
console.log(`connected to ${client.getServerVersion()?.name} at ${url}`);
const { tools } = await client.listTools();
const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
const lean = Boolean(byName.find_people_to_pray_with);

check('ask_the_family_to_pray is not on the public endpoint', !byName.ask_the_family_to_pray);
const name = lean ? 'find_people_to_pray_with' : 'the_open_chair';
const args = lean ? { mode: 'ask_the_family', language: 'es' } : { language: 'es' };
if (lean) {
  const t = byName.find_people_to_pray_with;
  check('the lean tool names the mode in its description', /ask_the_family/.test(t.description ?? ''));
  check('the lean tool stays read only', t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false);
}
const r = await client.callTool({ name, arguments: args });
const s = r.structuredContent ?? {};
check('the door answers', !r.isError, text(r).slice(0, 300));
check('open is a boolean, never invented', typeof s.open === 'boolean');
check('when open, the door is the real page; when not, no link is handed', s.open ? /^https:\/\/living-bread\.org\/open-chair\?via=assistant/.test(s.door ?? '') : s.door === null);
check('it says nothing was sent', /nothing (has been )?sent|Nothing was sent/i.test(text(r)));
check('it carries the crisis rule', /crisis_resources|get_crisis_help/.test(text(r)));
check('it says what an assistant may and may not do', Array.isArray(s.assistant_may?.may) && Array.isArray(s.assistant_may?.never));
check('it never promises healing or speaks as God', !/God will heal|you will be healed/i.test(text(r)));
check('no em dash in the answer', !/[–—]/.test(text(r) + JSON.stringify(s)));

await client.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
