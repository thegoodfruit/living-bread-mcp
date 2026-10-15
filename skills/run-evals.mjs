#!/usr/bin/env node
/* ============================================================
   Run the read-only part of the Living Bread skill evaluations against an MCP endpoint.

     node mcp/skills/run-evals.mjs                       the live public endpoint
     node mcp/skills/run-evals.mjs --url http://127.0.0.1:8787/mcp      a local `wrangler dev`
     node mcp/skills/run-evals.mjs --skill pray-with-someone
     node mcp/skills/run-evals.mjs --case ffic-01-prague-english
     node mcp/skills/run-evals.mjs --json /path/out.json   also write the full record
     node mcp/skills/run-evals.mjs --mocked                also run the vitest files the cases cite

   What it does, honestly:
     - It makes only READ calls (initialize, tools/list, and the read tools a case lists). It never
       calls a writing tool and the validator refuses a case that does.
     - Each case's `steps` are real tool calls with assertions on the real answer.
     - A step that needs a capability the endpoint does not advertise yet (for_my_need, which is in
       the source and not yet deployed) is SKIPPED, never counted as a pass.
     - What an assistant SAYS (expected_behaviours, forbidden_behaviours) needs a model to judge. This
       runner does not pretend to; it prints how many behaviours remain for a model run.
   Statuses: PASS (every live step passed), FAIL, SKIP (every live step needs a capability not
   deployed), MOCKED (no live step; covered by the cited unit test), RUBRIC (no live step; behaviour only).
   ============================================================ */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP = path.resolve(HERE, '..');
const ROOT = path.resolve(MCP, '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_MCP = opt('--url', 'https://mcp.living-bread.org/mcp');
const only = { skill: opt('--skill'), id: opt('--case') };

const sdk = path.join(MCP, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client');
const { Client } = await import(path.join(sdk, 'index.js'));
const { StreamableHTTPClientTransport } = await import(path.join(sdk, 'streamableHttp.js'));

const WRITERS = /^(ask_the_family_to_pray|bring_what_i_carry|say_yes|offer_to_serve|set_a_table|someone_to_talk_to|speak_a_blessing|going_to_gathering|say_amen|keep_the_watch)$/;
const HOSTS = /^(?:[a-z0-9-]+\.)*(living-bread\.org|apple\.com|google\.com|wikipedia\.org|wikidata\.org|988lifeline\.org|creativecommons\.org)$/i;

/* ---- the assertion language ------------------------------------------------------------------- */
function getPath(root, p) {
  const parts = p.replace(/\[(\*|\d+)\]/g, '.[$1]').split('.').filter(Boolean);
  let cur = [root];
  let wild = false;
  for (const part of parts) {
    const next = [];
    for (const v of cur) {
      if (v === undefined || v === null) { next.push(undefined); continue; }
      if (part === '[*]') { wild = true; if (Array.isArray(v)) next.push(...v); continue; }
      const m = part.match(/^\[(\d+)\]$/);
      if (m) { next.push(Array.isArray(v) ? v[Number(m[1])] : undefined); continue; }
      next.push(v[part]);
    }
    cur = next;
  }
  return { values: cur, wild };
}
const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

function urlsIn(blob) {
  const found = new Set();
  for (const m of blob.matchAll(/(?:https?|livingbread):\/\/[^\s"'<>)\]\\`,]+/g)) found.add(m[0].replace(/[.;:!?]+$/, ''));
  return [...found];
}

function check(a, ctx) {
  if (a.urls) {
    const blob = ctx.text + '\n' + JSON.stringify(ctx.s ?? {});
    const urls = urlsIn(blob);
    if (a.urls === 'hosts') {
      const bad = urls.filter((u) => { try { const x = new URL(u); return x.protocol === 'livingbread:' ? false : !(x.protocol === 'https:' && HOSTS.test(x.hostname)); } catch { return true; } });
      return bad.length ? `urls off the allowed hosts or not https: ${bad.slice(0, 3).join(' ')}` : null;
    }
    if (a.urls === 'noPrivate') {
      const leaks = urls.filter((u) => { let d = u; try { d = decodeURIComponent(u); } catch { /* keep */ } return a.words.some((w) => d.toLowerCase().includes(w.toLowerCase())); });
      return leaks.length ? `a link carries a private word: ${leaks.slice(0, 2).join(' ')}` : null;
    }
  }
  const root = { s: ctx.s, t: ctx.text, r: ctx.r };
  const { values, wild } = getPath(root, a.p);
  const def = values.filter((v) => v !== undefined);
  if (wild && values.length === 0 && !('absent' in a) && !('gte' in a)) return null; // a wildcard over an empty list: nothing to violate
  if ('absent' in a) return def.length === 0 ? null : `${a.p} is present (${JSON.stringify(def[0]).slice(0, 60)}) and must be absent`;
  if ('type' in a) {
    if (wild && values.length === 0) return null;
    return values.length && values.every((v) => typeOf(v) === a.type) ? null : `${a.p} is ${values.length ? [...new Set(values.map(typeOf))].join('|') : 'missing'}, expected ${a.type}`;
  }
  if ('equals' in a) return def.length && def.every((v) => v === a.equals) ? null : `${a.p} is ${JSON.stringify(def[0])}, expected ${JSON.stringify(a.equals)}`;
  if ('in' in a) return def.length && def.every((v) => a.in.includes(v)) ? null : `${a.p} is ${JSON.stringify(def[0])}, expected one of ${JSON.stringify(a.in)}`;
  if ('gte' in a) return def.length && def.every((v) => typeof v === 'number' && v >= a.gte) ? null : `${a.p} is ${JSON.stringify(def[0])}, expected >= ${a.gte}`;
  if ('length' in a) return def.length && def.every((v) => Array.isArray(v) && v.length === a.length) ? null : `${a.p} has length ${Array.isArray(def[0]) ? def[0].length : 'n/a'}, expected ${a.length}`;
  if ('includes' in a) return def.some((v) => v === a.includes || (Array.isArray(v) && v.includes(a.includes))) ? null : `${a.p} does not include ${JSON.stringify(a.includes)}`;
  if ('matches' in a) { const re = new RegExp(a.matches, a.flags ?? 'i'); return def.length && def.every((v) => re.test(String(v))) ? null : `${a.p} does not match /${a.matches}/`; }
  if ('notMatches' in a) { const re = new RegExp(a.notMatches, a.flags ?? 'i'); return def.every((v) => !re.test(String(v))) ? null : `${a.p} matches the forbidden /${a.notMatches}/`; }
  return `unknown assertion ${JSON.stringify(a)}`;
}

/* ---- the endpoint ----------------------------------------------------------------------------- */
async function connect(url) {
  const c = new Client({ name: 'living-bread-eval', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(url)));
  return c;
}

const client = await connect(URL_MCP);
const { tools } = await client.listTools();
const byName = new Map(tools.map((t) => [t.name, t]));
const caps = {
  for_my_need: Boolean(byName.get('start_with_christ')?.inputSchema?.properties?.mode?.enum?.includes('for_my_need')),
};
console.log(`Endpoint ${URL_MCP}`);
console.log(`Server ${JSON.stringify(client.getServerVersion())}; ${tools.length} tools listed; capabilities: for_my_need=${caps.for_my_need}`);
console.log('');

async function runStep(step) {
  const rec = { tool: step.tool, args: step.args ?? {}, status: 'PASS', problems: [], ms: 0 };
  if (step.requires && !caps[step.requires]) { rec.status = 'SKIP'; rec.problems.push(`needs "${step.requires}", which this endpoint does not advertise yet`); return rec; }
  if (WRITERS.test(step.tool ?? '')) { rec.status = 'FAIL'; rec.problems.push('refusing to call a writing tool'); return rec; }
  let ctx = { text: '', s: undefined, r: { isError: false } };
  const t0 = Date.now();
  try {
    let c = client;
    if (step.simulate === 'unreachable') c = await connect('https://mcp.invalid.example/mcp').catch((e) => ({ failed: e }));
    if (c.failed) { ctx = { text: '', s: undefined, r: { isError: true, error: String(c.failed.message ?? c.failed) } }; }
    else {
      const res = await c.callTool({ name: step.tool, arguments: step.args ?? {} });
      ctx = { text: (res.content ?? []).filter((x) => x.type === 'text').map((x) => x.text).join('\n'), s: res.structuredContent, r: { isError: Boolean(res.isError) } };
    }
  } catch (e) {
    ctx = { text: String(e.message ?? e), s: undefined, r: { isError: true, error: String(e.message ?? e) } };
  }
  rec.ms = Date.now() - t0;
  for (const a of step.assert ?? []) {
    const problem = check(a, ctx);
    if (problem) { rec.status = 'FAIL'; rec.problems.push(problem); }
  }
  rec.answer = ctx.text.slice(0, 160).replace(/\s+/g, ' ');
  return rec;
}

/* ---- the cases -------------------------------------------------------------------------------- */
const skillsDir = HERE;
const dirs = readdirSync(skillsDir).filter((d) => existsSync(path.join(skillsDir, d, 'evals', 'cases.json')));
const results = [];
let rubric = 0;
const cited = new Set();
for (const d of dirs) {
  if (only.skill && only.skill !== d) continue;
  const file = JSON.parse(readFileSync(path.join(skillsDir, d, 'evals', 'cases.json'), 'utf8'));
  console.log(`== ${d} (${file.cases.length} cases)`);
  for (const c of file.cases) {
    if (only.id && only.id !== c.id) continue;
    const steps = [];
    for (const s of c.steps ?? []) steps.push(await runStep(s));
    for (const m of c.mocked ?? []) { const f = m.split(':')[0].trim(); if (/\.test\.ts$/.test(f)) cited.add(f); }
    const live = steps.filter((s) => s.status !== 'SKIP');
    let status;
    if (steps.length === 0) status = (c.mocked?.length ? 'MOCKED' : 'RUBRIC');
    else if (steps.some((s) => s.status === 'FAIL')) status = 'FAIL';
    else if (live.length === 0) status = 'SKIP';
    else status = 'PASS';
    rubric += (c.expected_behaviours?.length ?? 0) + (c.forbidden_behaviours?.length ?? 0);
    const calls = steps.map((s) => `${s.tool}${s.status === 'SKIP' ? '(skipped)' : ''}${JSON.stringify(s.args).slice(0, 90)}`).join('  ');
    console.log(` ${status.padEnd(6)} ${c.id}  [${c.category}]${calls ? '\n          calls: ' + calls : ''}`);
    for (const s of steps) for (const p of s.problems) console.log(`          ${s.status === 'SKIP' ? 'skip' : 'problem'}: ${s.tool}: ${p}`);
    results.push({ skill: d, id: c.id, category: c.category, status, input: c.input, steps, mocked: c.mocked ?? [], behaviours: (c.expected_behaviours ?? []).length, forbidden: (c.forbidden_behaviours ?? []).length });
  }
  console.log('');
}

/* ---- the cited unit tests (opt in; vitest is heavy on a small machine) -------------------------- */
let mockedRun = null;
if (flag('--mocked') && cited.size) {
  const files = [...cited].filter((f) => existsSync(path.join(ROOT, f)));
  const r = spawnSync('npx', ['vitest', 'run', ...files], { cwd: ROOT, encoding: 'utf8' });
  mockedRun = { files, status: r.status === 0 ? 'PASS' : 'FAIL', tail: (r.stdout + r.stderr).split('\n').slice(-8).join('\n') };
  console.log(`Unit tests cited by MOCKED cases (${files.join(', ')}): ${mockedRun.status}`);
  console.log(mockedRun.tail);
}

const n = (s) => results.filter((r) => r.status === s).length;
console.log(`SUMMARY: ${results.length} cases: PASS ${n('PASS')}, FAIL ${n('FAIL')}, SKIP ${n('SKIP')} (capability not deployed), MOCKED ${n('MOCKED')}, RUBRIC ${n('RUBRIC')}`);
const stepCount = results.flatMap((r) => r.steps);
console.log(`Live steps: ${stepCount.filter((s) => s.status === 'PASS').length} passed, ${stepCount.filter((s) => s.status === 'FAIL').length} failed, ${stepCount.filter((s) => s.status === 'SKIP').length} skipped`);
console.log(`Not judged here: ${rubric} expected and forbidden behaviours need a model run (see mcp/skills/README.md).`);
const jsonOut = opt('--json');
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ endpoint: URL_MCP, at: new Date().toISOString(), server: client.getServerVersion(), caps, results, mockedRun }, null, 1));
await client.close();
process.exit(n('FAIL') > 0 || mockedRun?.status === 'FAIL' ? 1 : 0);
