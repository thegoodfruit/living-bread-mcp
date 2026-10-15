#!/usr/bin/env node
/* The watch, end to end with a real MCP client: a_person_now, the_watch_tonight, the resource
   living-bread://watch/now and the prompt i_need_a_person, against a running server.
   Usage: node test/watch.mjs [http://127.0.0.1:8791/mcp]   (exit code 1 if anything fails)

   It proves the promises the plugin reviews read: the two public tools are read only and
   closed world, they send nothing (the watch's request count does not move), they never name
   anyone, and keep_the_watch does not exist on the public endpoint. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { leanCall } from './lean.mjs';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:8791/mcp');
const client = new Client({ name: 'living-bread-watch-probe', version: '1.0.0' });
let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FAIL ${label}${detail ? `: ${detail}` : ''}`); }
};

await client.connect(new StreamableHTTPClientTransport(url));
console.log(`connected to ${client.getServerVersion()?.name} at ${url}`);

const { tools } = await client.listTools();
const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
/* 1.3.0: on the lean /mcp the two watch tools are modes of find_people_to_pray_with; on /me and /app they keep their names */
const lean = Boolean(byName.find_people_to_pray_with);
const CRISIS = lean ? 'get_crisis_help' : 'crisis_resources';
const call = (name, args) => { const c = lean ? leanCall(name, args) : { name, args }; return client.callTool({ name: c.name, arguments: c.args }); };
if (lean) {
  const t = byName.find_people_to_pray_with;
  check('find_people_to_pray_with readOnlyHint true, destructiveHint false', t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false);
  check('find_people_to_pray_with has the a_person_now and the_watch modes', ['a_person_now', 'the_watch'].every((m) => t.inputSchema?.properties?.mode?.enum?.includes(m)));
  check('find_people_to_pray_with description says when, when not, output and behavior, and names get_crisis_help', /WHEN TO USE/.test(t.description) && /WHEN NOT/.test(t.description) && /OUTPUT/.test(t.description) && /BEHAVIOR/.test(t.description) && /get_crisis_help/.test(t.description));
  check('find_people_to_pray_with description has no dashes', !/[–—]/.test(t.description));
}
for (const name of lean ? [] : ['a_person_now', 'the_watch_tonight']) {
  const t = byName[name];
  check(`${name} listed`, Boolean(t));
  if (!t) continue;
  check(`${name} readOnlyHint true`, t.annotations?.readOnlyHint === true);
  check(`${name} destructiveHint false`, t.annotations?.destructiveHint === false);
  check(`${name} openWorldHint false`, t.annotations?.openWorldHint === false);
  check(`${name} carries its title in annotations`, typeof t.annotations?.title === 'string' && t.annotations.title.length > 5);
  check(`${name} description says when, when not, output and behavior`, /WHEN TO USE/.test(t.description) && /WHEN NOT/.test(t.description) && /OUTPUT/.test(t.description) && /BEHAVIOR/.test(t.description));
  check(`${name} description has no dashes`, !/[–—]/.test(t.description));
}
if (!lean) check('a_person_now names crisis_resources first for danger', /crisis_resources/.test(byName.a_person_now?.description ?? ''));
check('keep_the_watch is NOT on the public endpoint', !byName.keep_the_watch);

const text = (r) => (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const before = await client.readResource({ uri: 'living-bread://watch/now' });
const b = JSON.parse(before.contents[0].text);
check('resource watch/now reads', typeof b.keeping_watch_now === 'number', before.contents[0].text.slice(0, 200));
check('resource carries the guest doors', /\/a-person\?/.test(b.doors?.prayer ?? ''));
const askedBefore = b.time_to_a_person_7d?.watch_asked;

for (const want of [undefined, 'prayer', 'talk', 'know_jesus', 'hard_season']) {
  const r = await call('a_person_now', want ? { want, language: 'en' } : {});
  const s = r.structuredContent ?? {};
  check(`a_person_now ${want ?? '(no want)'} answers`, !r.isError && typeof s.keeping_watch_now === 'number', text(r).slice(0, 300));
  check(`a_person_now ${want ?? '(no want)'} hands the right door`, typeof s.door === 'string' && s.door.startsWith('https://living-bread.org/a-person?') && (!want || s.door.includes(`want=${want}`)));
  check(`a_person_now ${want ?? '(no want)'} says this hour honestly`, s.this_hour === 'kept' || s.this_hour === 'gap');
  check(`a_person_now ${want ?? '(no want)'} median is a number or null, never invented`, s.time_to_a_person && (s.time_to_a_person.median_minutes === null || typeof s.time_to_a_person.median_minutes === 'number'));
  check(`a_person_now ${want ?? '(no want)'} says it sent nothing`, /nothing has been sent/i.test(text(r)));
  check(`a_person_now ${want ?? '(no want)'} carries the crisis rule`, new RegExp(CRISIS).test(text(r)));
  check(`a_person_now ${want ?? '(no want)'} names nobody`, !('names' in s) && !('first_names' in s) && !JSON.stringify(s).includes('@'));
}

for (const [tz, hours] of [['America/Los_Angeles', 24], ['Africa/Lagos', 168], ['Not/AZone', 24], [undefined, 24]]) {
  const r = await call('the_watch_tonight', { ...(tz ? { time_zone: tz } : {}), hours });
  const s = r.structuredContent ?? {};
  check(`the_watch_tonight ${tz ?? 'UTC'} ${hours}h answers`, !r.isError && Array.isArray(s.wheel) && s.wheel.length === hours, text(r).slice(0, 300));
  check(`the_watch_tonight ${tz ?? 'UTC'} kept + gaps = hours`, s.kept + s.gaps === hours);
  check(`the_watch_tonight ${tz ?? 'UTC'} zone is valid or UTC`, tz === 'Not/AZone' || !tz ? s.time_zone === 'UTC' : s.time_zone === tz);
  check(`the_watch_tonight ${tz ?? 'UTC'} door opens the watch`, typeof s.door === 'string' && s.door.startsWith('https://living-bread.org/watch'));
  check(`the_watch_tonight ${tz ?? 'UTC'} never claims 24/7`, !/24\/7|unbroken|round the clock/i.test(text(r)));
}

const after = await client.readResource({ uri: 'living-bread://watch/now' });
const a = JSON.parse(after.contents[0].text);
check('reading the watch sent nothing (watch requests unchanged)', a.time_to_a_person_7d?.watch_asked === askedBefore, `${askedBefore} -> ${a.time_to_a_person_7d?.watch_asked}`);

const { prompts } = await client.listPrompts();
check('prompt i_need_a_person listed', prompts.some((p) => p.name === 'i_need_a_person'));
const p = await client.getPrompt({ name: 'i_need_a_person', arguments: { what: 'my father died', country: 'Kenya' } });
const pt = p.messages?.[0]?.content?.text ?? '';
check('prompt listens, checks for danger, then a_person_now', /listen/i.test(pt) && new RegExp(CRISIS).test(pt) && /a_person_now/.test(pt) && pt.indexOf(CRISIS) < pt.indexOf('a_person_now'));
check('prompt has no dashes', !/[–—]/.test(pt));

await client.close();
console.log(failures ? `\n${failures} failed` : '\nall watch checks passed');
process.exit(failures ? 1 : 0);
