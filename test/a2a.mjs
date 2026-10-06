#!/usr/bin/env node
/* Validate the A2A Agent Card and one SendMessage answer against the official A2A JSON Schema bundle
   (a2a-protocol.org/<version>/spec/a2a.json, generated from specification/a2a.proto).
   Usage: node test/a2a.mjs [http://127.0.0.1:8787] [--spec latest]   (exit code 1 if anything fails). The default bundle is /latest/ (A2A 1.0.x, $defs layout). */
import Ajv2020 from 'ajv/dist/2020.js';

const base = (process.argv.slice(2).find((a) => /^https?:\/\//.test(a)) ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const spec = process.argv.includes('--spec') ? process.argv[process.argv.indexOf('--spec') + 1] : 'latest';
let failures = 0;
const check = (label, cond, detail) => { if (cond) console.log(`  ok   ${label}`); else { failures++; console.log(`  FAIL ${label}${detail ? `: ${detail}` : ''}`); } };

const bundle = await fetch(`https://a2a-protocol.org/${spec}/spec/a2a.json`).then((r) => r.json());
const validate = (def, value) => {
  const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false });
  const { $id: _id, ...rest } = bundle;
  const defs = rest.$defs ? '$defs' : 'definitions';
  const v = ajv.compile({ ...rest, $ref: `#/${defs}/${def}` });
  const okay = v(value);
  return { okay, errors: okay ? '' : ajv.errorsText(v.errors) };
};
console.log(`A2A schema ${bundle.version} (${spec}), server ${base}`);

const card = await fetch(`${base}/.well-known/agent-card.json`).then((r) => r.json());
const c = validate('AgentCard', card);
check('the Agent Card validates against $defs/AgentCard', c.okay, c.errors);
check('the card names a JSONRPC interface at /a2a, protocol 1.0', card.supportedInterfaces?.[0]?.protocolBinding === 'JSONRPC' && /\/a2a$/.test(card.supportedInterfaces[0].url) && card.supportedInterfaces[0].protocolVersion === '1.0');
check('every skill has id, name, description and tags', (card.skills ?? []).every((s) => s.id && s.name && s.description && Array.isArray(s.tags) && s.tags.length));
check('no dash reaches the card', !/[\u2013\u2014]/.test(JSON.stringify(card)));

const send = async (method, message) => fetch(`${base}/a2a`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { message } }) }).then((r) => r.json());
const r1 = await send('SendMessage', { messageId: 'probe-1', role: 'ROLE_USER', parts: [{ text: 'Psalm 23:1' }] });
const m = validate('SendMessageResponse', r1.result);
check('SendMessage returns a valid SendMessageResponse (a Message)', m.okay && r1.result?.message?.role === 'ROLE_AGENT', m.errors || JSON.stringify(r1.error ?? {}));
check('scripture-with-evidence carries an evidence label and a living-bread.org source', r1.result?.message?.parts?.[1]?.data?.evidence?.translation === 'KJV' && /^https:\/\/living-bread\.org\//.test(r1.result?.message?.parts?.[1]?.data?.source_url ?? ''));
const r2 = await send('SendMessage', { messageId: 'probe-2', role: 'ROLE_USER', parts: [{ data: { skill: 'verify-scripture-quote', quote: 'God helps those who help themselves' } }] });
check('verify-scripture-quote flags a proverb that is not Scripture', r2.result?.message?.parts?.[1]?.data?.verdict === 'not_found');
const r3 = await send('SendMessage', { messageId: 'probe-3', role: 'ROLE_USER', parts: [{ text: 'Please pray for me' }] });
check('real-people-will-pray answers with a door and never claims to pray', r3.result?.message?.parts?.[1]?.data?.this_tool_prays === false && /living-bread\.org/.test(r3.result?.message?.parts?.[1]?.data?.door ?? ''));
const r4 = await send('SendStreamingMessage', { messageId: 'probe-4', role: 'ROLE_USER', parts: [{ text: 'x' }] });
check('streaming is refused with UnsupportedOperationError (-32004)', r4.error?.code === -32004);
const r5 = await send('message/send', { messageId: 'probe-5', role: 'user', parts: [{ kind: 'text', text: 'John 11:35' }] });
check('message/send (0.3) answers in the 0.3 shape', r5.result?.kind === 'message' && r5.result?.parts?.[0]?.kind === 'text');

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
