#!/usr/bin/env node
/* ============================================================
   THE LIVING BREAD MCP, the evaluation set, run against a live server.

     node eval/run.mjs [base] [--label production|local] [--only category]

   base defaults to https://mcp.living-bread.org. Every case in eval/cases.jsonl is run with a
   real MCP client; Scripture is checked word for word against the stored corpus in
   assets/bible/books (the same files the server reads); deep links are fetched; /app and /me are
   reached with a session minted for the house platform account ONLY (house@livingbread.app),
   never a real believer, and the two duplicate-action cases delete what they wrote.
   Writes eval/results-<label>.json and regenerates eval/RESULTS.md from every results file.
   ============================================================ */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* In this repository the corpus is two levels up (assets/bible/books); in the public mirror, one. */
const ROOT = existsSync(path.resolve(HERE, '..', 'assets', 'bible', 'books')) ? path.resolve(HERE, '..') : path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const base = (argv.find((a) => /^https?:\/\//.test(a)) ?? 'https://mcp.living-bread.org').replace(/\/$/, '');
const label = argv.includes('--label') ? argv[argv.indexOf('--label') + 1] : /127\.0\.0\.1|localhost/.test(base) ? 'local' : 'production';
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
/* The discover worker (NLWeb /ask, /api/verify): --knowledge <url>, default production. */
const knowledge = (argv.includes('--knowledge') ? argv[argv.indexOf('--knowledge') + 1] : 'https://discover.living-bread.org').replace(/\/$/, '');

/* ---- the stored corpus, read here exactly as the server reads it ------------------------------ */
const BOOKS_DIR = path.join(ROOT, 'assets', 'bible', 'books');
const books = new Map();
const nameToId = new Map();
for (const f of readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json'))) {
  const id = f.replace(/\.json$/, '');
  const data = JSON.parse(readFileSync(path.join(BOOKS_DIR, f), 'utf8'));
  books.set(id, data);
  nameToId.set(String(data.n).toLowerCase().replace(/\s+/g, ''), id);
}
nameToId.set('psalm', 'psalms'); nameToId.set('psalms', 'psalms'); nameToId.set('songofsolomon', 'songofsolomon');
const join = (vs) => vs.map((v) => v.trim()).filter(Boolean).join(' ').replace(/[,;:]\s*$/, '');
function corpusText(book, chapter, from, to) {
  const ch = books.get(book)?.c?.[chapter - 1];
  if (!ch) return null;
  if (from === undefined) return join(ch);
  return join(ch.slice(from - 1, to ?? from));
}
function refText(ref) {
  const m = String(ref).match(/^(.*?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/);
  if (!m) return null;
  const id = nameToId.get(m[1].toLowerCase().replace(/\s+/g, ''));
  if (!id) return null;
  return corpusText(id, Number(m[2]), m[3] ? Number(m[3]) : undefined, m[4] ? Number(m[4]) : undefined);
}
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
/* Arguments that carry Scripture are never typed into a case: { "$corpus": { book, chapter, from, to },
   "$replace": [word, other] } is read from the stored corpus here, and optionally altered by one word. */
function derive(v) {
  if (Array.isArray(v)) return v.map(derive);
  if (!v || typeof v !== 'object') return v;
  if (v.$corpus) {
    let t = corpusText(v.$corpus.book, v.$corpus.chapter, v.$corpus.from, v.$corpus.to);
    if (t && Array.isArray(v.$replace)) t = t.replace(new RegExp(`\\b${v.$replace[0]}\\b`), v.$replace[1]);
    return t;
  }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, derive(x)]));
}

/* ---- the shelf of translations (assets/bible/shelf/t/<id>/<book>.json), read as the server reads it ---- */
const SHELF_DIR = path.join(ROOT, 'assets', 'bible', 'shelf', 't');
function shelfText(id, book, chapter, from, to) {
  const f = path.join(SHELF_DIR, id, `${book}.json`);
  if (!existsSync(f)) return null;
  const ch = JSON.parse(readFileSync(f, 'utf8')).c?.[chapter - 1];
  if (!ch) return null;
  const vs = ch.slice(from - 1, to ?? from).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
  return vs.length ? vs.join(' ').replace(/[,;:]\s*$/, '') : null;
}

/* ---- sessions ------------------------------------------------------------------------------------ */
function envFile() {
  const out = {};
  const f = [path.join(ROOT, '.env.local'), path.resolve(HERE, '..', '..', '.env.local')].find((x) => existsSync(x));
  if (!f) return { EXPO_PUBLIC_SUPABASE_URL: '' }; // without it the /me and /app cases fail with a clear message
  for (const line of readFileSync(f, 'utf8').split('\n')) { const i = line.indexOf('='); if (i > 0 && !line.startsWith('#')) out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, ''); }
  return out;
}
const E = envFile();
const SB = E.EXPO_PUBLIC_SUPABASE_URL.replace(/\/$/, '');
async function sb(method, p, key, body, prefer) {
  const r = await fetch(SB + p, { method, headers: { apikey: key === E.SUPABASE_SERVICE_ROLE_KEY ? key : E.EXPO_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(prefer ? { prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 160)}`);
  return t ? JSON.parse(t) : null;
}
let houseToken = null;
let houseId = null;
async function house() {
  if (houseToken) return houseToken;
  const link = await sb('POST', '/auth/v1/admin/generate_link', E.SUPABASE_SERVICE_ROLE_KEY, { type: 'magiclink', email: 'house@livingbread.app' });
  const v = await sb('POST', '/auth/v1/verify', E.EXPO_PUBLIC_SUPABASE_ANON_KEY, { type: 'magiclink', token_hash: link.hashed_token ?? link.properties?.hashed_token });
  houseToken = v.access_token; houseId = v.user.id;
  return houseToken;
}
const clients = {};
async function client(endpoint) {
  if (clients[endpoint]) return clients[endpoint];
  const c = new Client({ name: 'living-bread-eval', version: '1.2.0' });
  const opts = endpoint === 'mcp' ? {} : { requestInit: { headers: { authorization: `Bearer ${await house()}` } } };
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/${endpoint}`), opts));
  clients[endpoint] = c;
  return c;
}

/* ---- checks ------------------------------------------------------------------------------------- */
function get(r, p) {
  if (p === 'text') return r.content?.[0]?.text ?? '';
  let v = p.startsWith('sc.') ? r.structuredContent : r;
  for (const k of p.replace(/^sc\./, '').split('.')) { if (v === undefined || v === null) return undefined; v = v[k]; }
  return v;
}
const errOf = (r) => { try { return JSON.parse(r.content?.[1]?.text ?? 'null'); } catch { return null; } };
function strings(v, out = []) { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => strings(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out)); return out; }
function urlsOf(sc) {
  const out = new Set();
  const add = (u) => { if (typeof u === 'string' && /^https:\/\/living-bread\.org/.test(u)) out.add(u); };
  if (!sc) return [];
  add(sc.next_step?.url); add(sc.door); add(sc.plan?.door);
  for (const a of sc.next_actions ?? []) add(a.url);
  for (const a of sc.alternatives ?? []) add(a.url);
  for (const x of sc.results ?? []) add(x.next_step?.url);
  for (const x of sc.plans ?? []) add(x.door);
  for (const x of sc.needs ?? []) add(x.door);
  return [...out].slice(0, 12);
}
async function status200(u) {
  try { const r = await fetch(u, { redirect: 'follow', headers: { 'user-agent': 'TheLivingBread-MCP-eval/1.0' } }); return r.status; } catch { return 0; }
}

async function runChecks(c, r, cs, tools) {
  const fails = [];
  const f = (msg) => fails.push(msg);
  for (const [op, p, v] of c.checks ?? []) {
    const val = p !== undefined ? get(r, p) : undefined;
    switch (op) {
      case 'notError': if (r.isError) f(`error: ${(r.content?.[0]?.text ?? '').slice(0, 120)}`); break;
      case 'isError': if (!r.isError) f('expected an error'); break;
      case 'eq': if (JSON.stringify(val) !== JSON.stringify(v)) f(`${p} = ${JSON.stringify(val)?.slice(0, 80)}, wanted ${JSON.stringify(v)}`); break;
      case 'match': if (!new RegExp(v, 'i').test(String(val ?? ''))) f(`${p} does not match ${v}`); break;
      case 'noMatch': if (new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(String(val ?? ''))) f(`${p} contains "${v}"`); break;
      case 'gte': if (!(Number(val) >= v)) f(`${p} = ${val}, wanted >= ${v}`); break;
      case 'lte': if (!(Number(val) <= v)) f(`${p} = ${val}, wanted <= ${v}`); break;
      case 'gteLen': if (!((val?.length ?? 0) >= v)) f(`${p} has ${val?.length ?? 0}, wanted >= ${v}`); break;
      case 'truthy': if (!val) f(`${p} is empty`); break;
      case 'absent': if (val !== undefined) f(`${p} should be absent`); break;
      case 'isArray': if (!Array.isArray(val)) f(`${p} is not an array`); break;
      case 'contains': if (!Array.isArray(val) || !val.includes(v)) f(`${p} lacks ${v}`); break;
      case 'corpus': { const want = corpusText(v.book, v.chapter, v.from, v.to); if (!want || val !== want) f(`${p} differs from the stored corpus`); break; }
      case 'corpusEach': for (const x of val ?? []) { const want = refText(x.ref); if (want !== x.text) { f(`${x.ref} differs from the corpus`); break; } } break;
      case 'corpusEachRef': for (const x of val ?? []) { if (x.text == null) continue; const want = refText(x.ref.split(' to ')[0]); if (want !== x.text && !(x.shortened && want?.startsWith(x.text.slice(0, 20)))) { f(`${x.ref} differs from the corpus`); break; } } break;
      case 'everyMatch': for (const x of val ?? []) if (!String(x[v] ?? '').toLowerCase().includes(String(c.checks.find((k) => k[0] === 'everyMatch')[3]).toLowerCase())) { f(`${x.ref ?? x.id} lacks the words`); break; } break;
      case 'hash': {
        const ev = r.structuredContent?.evidence;
        if (!ev) { f('no evidence label'); break; }
        const set = new Set(strings(r.structuredContent).filter((s) => s.length > 10).map(sha));
        const missing = (ev.passages ?? []).filter((x) => !set.has(x.sha256));
        if (!ev.passages?.length || missing.length) f(`${missing.length} passage hash(es) match no returned text`);
        break;
      }
      case 'freshHonest': {
        const items = val ?? [];
        for (const x of items) {
          const fr = x.freshness;
          if (!fr) { f(`${x.id ?? x.title} has no freshness`); break; }
          if ((fr.kind === 'scheduled' || fr.kind === 'record') && fr.available_now !== false) { f(`${x.id} claims available_now from a ${fr.kind}`); break; }
          if (fr.kind === 'recently_observed' && fr.valid_until && Date.parse(fr.valid_until) < Date.now() && fr.available_now) { f(`${x.id} claims available_now after its window`); break; }
        }
        break;
      }
      case 'links200': {
        const urls = urlsOf(r.structuredContent);
        if (!urls.length) { f('no living-bread.org links to check'); break; }
        for (const u of urls) { const s = await status200(u); if (s !== 200) f(`${u} answered ${s}`); }
        break;
      }
      case 'source200': {
        const u = r.structuredContent?.source_url;
        if (typeof u !== 'string' || !/^https:\/\/(discover\.)?living-bread\.org(\/|$|\?)/.test(u)) { f(`source_url ${u} is not a page of ours`); break; }
        const st = await status200(u); if (st !== 200) f(`source_url ${u} answered ${st}`);
        break;
      }
      case 'tcorpus': { const want = shelfText(v.id, v.book, v.chapter, v.from, v.to); if (!want || val !== want) f(`${p} differs from the stored ${v.id} text`); break; }
      case 'url200': { const s = typeof val === 'string' ? await status200(val) : 0; if (s !== 200) f(`${p} (${val}) answered ${s}`); break; }
      case 'stableHash': {
        const cl = await client(cs.endpoint);
        const r2 = await cl.callTool({ name: cs.tool, arguments: derive(cs.args) });
        const a = r.structuredContent?.evidence; const b = r2.structuredContent?.evidence;
        if (!a?.content_hash || a.content_hash !== b?.content_hash) f('content_hash differs between two runs');
        if (JSON.stringify(a?.corpus_version) !== JSON.stringify(b?.corpus_version)) f('corpus_version differs between two runs');
        break;
      }
      case 'noField': if ((val ?? []).some((x) => x && p && v in x)) f(`a row carries ${v}`); break;
      case 'allLte': if ((val ?? []).some((x) => x?.[v] != null && x[v] > c.checks.find((k) => k[0] === 'allLte')[3])) f(`a row has ${v} beyond the bound`); break;
      case 'everyField': if ((val ?? []).some((x) => !x?.[v])) f(`a row lacks ${v}`); break;
      case 'errReason': if (errOf(r)?.reason !== p) f(`reason ${errOf(r)?.reason}, wanted ${p}`); break;
      case 'errTry': if (!(errOf(r)?.try_instead?.length > 0)) f('no try_instead'); break;
      case 'answered': if (r.isError && !(errOf(r)?.try_instead?.length > 0)) f('an error with no alternative'); break;
      case 'noDash': if (/[\u2013\u2014]/.test(r.content?.map((x) => x.text).join(' ') ?? '')) f('a dash reached the text'); break;
      case 'paginates': {
        const cl = await client(cs.endpoint);
        const r2 = await cl.callTool({ name: cs.tool, arguments: { ...derive(cs.args), cursor: r.structuredContent?.next_cursor } });
        if (r2.structuredContent?.results?.[0]?.ref === r.structuredContent?.results?.[0]?.ref) f('the next page repeats the first');
        break;
      }
      default: f(`unknown check ${op}`);
    }
  }
  return fails;
}

async function runList(cs) {
  const fails = [];
  const cl = await client(cs.endpoint);
  const { tools } = await cl.listTools();
  const by = Object.fromEntries(tools.map((t) => [t.name, t]));
  for (const [op, name, field] of cs.checks) {
    if (op === 'toolAbsent' && by[name]) fails.push(`${name} is listed on /${cs.endpoint}`);
    if (op === 'toolPresent' && !by[name]) fails.push(`${name} is missing on /${cs.endpoint}`);
    if (op === 'noInputField' && by[name] && by[name].inputSchema?.properties?.[field]) fails.push(`${name} asks for ${field}`);
    if (op === 'inputField' && !by[name]?.inputSchema?.properties?.[field]) fails.push(`${name} lacks ${field}`);
    if (op === 'allAnnotated') {
      const bad = tools.filter((t) => !(typeof t.annotations?.title === 'string' && ['readOnlyHint', 'destructiveHint', 'openWorldHint'].every((h) => typeof t.annotations?.[h] === 'boolean')));
      if (bad.length) fails.push(`not fully annotated: ${bad.map((t) => t.name).join(', ')}`);
    }
  }
  return fails;
}

async function runHttp(cs) {
  const fails = [];
  const init = { method: cs.method, headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } };
  if (cs.method === 'POST') init.body = JSON.stringify(cs.body ?? {});
  const r = await fetch((cs.host === 'knowledge' ? knowledge : base) + cs.path, init);
  const body = await r.text();
  let j = null; try { j = JSON.parse(body); } catch { /* not JSON */ }
  const at = (p) => { let x = j; for (const k of String(p).split('.')) { if (x === undefined || x === null) return undefined; x = x[k]; } return x; };
  for (const [op, a, b] of cs.checks) {
    if (op === 'status' && r.status !== a) fails.push(`status ${r.status}, wanted ${a}`);
    if (op === 'jsonPath' && at(a) !== b) fails.push(`${a} = ${JSON.stringify(at(a))}`);
    if (op === 'contentType' && !new RegExp(a, 'i').test(r.headers.get('content-type') ?? '')) fails.push(`content-type ${r.headers.get('content-type')}`);
    if (op === 'gteLen' && !((at(a)?.length ?? 0) >= b)) fails.push(`${a} has ${at(a)?.length ?? 0}, wanted >= ${b}`);
    /* NLWeb: every result carries url, name, site, score and a schema.org JSON-LD schema_object */
    if (op === 'nlwebJsonLd') {
      const rs = j?.results;
      if (!Array.isArray(rs) || !rs.length) fails.push('no results');
      else for (const x of rs) { const o = x.schema_object; const one = Array.isArray(o) ? o[0] : o; if (!x.url || !x.name || !x.site || typeof x.score !== 'number' || !one || one['@context'] !== 'https://schema.org' || !one['@type']) { fails.push(`result ${x.name ?? '?'} is not NLWeb JSON-LD`); break; } }
    }
    /* A2A 1.0 AgentCard: the REQUIRED fields of specification/a2a.proto (test/a2a.mjs validates the whole schema) */
    if (op === 'agentCard') {
      const req = ['name', 'description', 'supportedInterfaces', 'version', 'capabilities', 'defaultInputModes', 'defaultOutputModes', 'skills'];
      const miss = req.filter((k) => j?.[k] === undefined);
      if (miss.length) fails.push(`card lacks ${miss.join(', ')}`);
      if (!(j?.supportedInterfaces ?? []).every((i) => i.url && i.protocolBinding && i.protocolVersion)) fails.push('an interface lacks url, protocolBinding or protocolVersion');
      if (!(j?.skills ?? []).every((k) => k.id && k.name && k.description && Array.isArray(k.tags))) fails.push('a skill lacks id, name, description or tags');
    }
    if (op === 'status200Of') { const u = at(a); const st = typeof u === 'string' ? await status200(u) : 0; if (st !== 200) fails.push(`${a} ${u} answered ${st}`); }
  }
  return fails;
}

async function runWrite(cs) {
  const fails = [];
  const cl = await client('me');
  const keyed = cs.kind === 'idempotency';
  const key = `eval-${Date.now()}`;
  try {
    const a1 = keyed ? { ...cs.args, idempotency_key: key } : cs.args;
    const a2 = keyed ? { ...cs.args, words: `${cs.args.words} (retry)`, idempotency_key: key } : cs.args;
    const r1 = await cl.callTool({ name: cs.tool, arguments: a1 });
    const r2 = await cl.callTool({ name: cs.tool, arguments: a2 });
    if (r1.isError) fails.push(`first call failed: ${(r1.content?.[0]?.text ?? '').slice(0, 100)}`);
    if (r2.structuredContent?.replayed !== true) fails.push('the second call was not replayed');
    if (r1.structuredContent?.yes_id && r2.structuredContent?.yes_id !== r1.structuredContent.yes_id) fails.push('the second call returned a different row');
  } finally {
    const rows = await sb('GET', `/rest/v1/my_yes?user_id=eq.${houseId}&words=like.Eval*&select=id`, E.SUPABASE_SERVICE_ROLE_KEY);
    if (rows.length > 1) fails.push(`${rows.length} rows were written`);
    for (const row of rows) await sb('DELETE', `/rest/v1/my_yes?id=eq.${row.id}`, E.SUPABASE_SERVICE_ROLE_KEY, undefined, 'return=representation');
  }
  return fails;
}

async function runLocal(cs) {
  if (cs.check === 'corpusUntouched') {
    const { clean } = await import('../src/sanitize.ts');
    let n = 0;
    const hit = [];
    for (const [id, b] of books) b.c.forEach((ch, ci) => ch.forEach((t, vi) => { n++; if (clean(t).text !== t) hit.push(`${id} ${ci + 1}:${vi + 1}`); }));
    return hit.length ? [`${hit.length} of ${n} verses would be altered: ${hit.slice(0, 5).join(', ')}`] : [];
  }
  if (cs.check === 'shelfUntouched') {
    // every verse of every stored translation, quoted in a sentence the way a tool quotes it, leaves the
    // cleaning exactly as read (src/sanitize.ts cleanExcept, as src/shared.ts applies it)
    const { cleanExcept } = await import('../src/sanitize.ts');
    const clean = (t) => { const line = `X 1:1 (T): "${t}" Keep reading.`; const c = cleanExcept(line, [t]); return { text: c.text === line ? t : c.text }; };
    let n = 0;
    const hit = [];
    for (const id of readdirSync(SHELF_DIR)) {
      for (const f of readdirSync(path.join(SHELF_DIR, id)).filter((x) => x.endsWith('.json'))) {
        const b = JSON.parse(readFileSync(path.join(SHELF_DIR, id, f), 'utf8'));
        b.c.forEach((ch, ci) => ch.forEach((t, vi) => { if (typeof t !== 'string' || !t) return; n++; if (clean(t.trim()).text !== t.trim()) hit.push(`${id}/${f.replace('.json', '')} ${ci + 1}:${vi + 1}`); }));
      }
    }
    return hit.length ? [`${hit.length} of ${n} verses would be altered: ${hit.slice(0, 5).join(', ')}`] : [];
  }
  return [`unknown local check ${cs.check}`];
}

/* ---- run ------------------------------------------------------------------------------------------ */
const REPORT_ONLY = argv.includes('--report');
const cases = REPORT_ONLY ? [] : readFileSync(path.join(HERE, 'cases.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((c) => !only || c.category === only);
const results = [];
let serverVersion = null;
for (const cs of cases) {
  const t0 = Date.now();
  let fails;
  try {
    if (cs.kind === 'list') fails = await runList(cs);
    else if (cs.kind === 'http') fails = await runHttp(cs);
    else if (cs.kind === 'duplicate' || cs.kind === 'idempotency') fails = await runWrite(cs);
    else if (cs.kind === 'local') fails = await runLocal(cs);
    else if (cs.kind === 'instructions') { const cl = await client(cs.endpoint); fails = (cl.getInstructions() ?? '').includes(cs.checks[0][1]) ? [] : ['instructions lack the law']; }
    else {
      const cl = await client(cs.endpoint);
      serverVersion ??= cl.getServerVersion()?.version;
      const r = await cl.callTool({ name: cs.tool, arguments: derive(cs.args) });
      fails = await runChecks(cs, r, cs);
    }
  } catch (e) {
    fails = [`threw: ${String(e.message ?? e).slice(0, 160)}`];
  }
  const ms = Date.now() - t0;
  results.push({ id: cs.id, category: cs.category, tool: cs.tool ?? cs.kind, pass: fails.length === 0, fails, ms });
  console.log(`${fails.length ? 'FAIL' : 'ok  '} ${cs.id} ${ms}ms ${fails.join('; ').slice(0, 200)}`);
}
for (const c of Object.values(clients)) await c.close().catch(() => undefined);

if (!REPORT_ONLY) {
const out = { label, base, server_version: serverVersion, ran_at: new Date().toISOString(), total: results.length, passed: results.filter((r) => r.pass).length, results };
writeFileSync(path.join(HERE, `results-${label}.json`), JSON.stringify(out, null, 1));
console.log(`\n${out.passed}/${out.total} passed against ${base} (${serverVersion ?? 'version unknown'})`);
}

/* ---- RESULTS.md from every results file ------------------------------------------------------------ */
const runs = readdirSync(HERE).filter((f) => /^results-.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(path.join(HERE, f), 'utf8')));
const pct = (a, b) => (b ? Math.round((a * 100) / b) : 0);
const q = (arr, p) => { const s = [...arr].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
const L = ['# MCP evaluation results', '', 'Generated by `node mcp/eval/run.mjs <base> --label <name>` from `mcp/eval/cases.jsonl`. Scripture is checked word for word against `assets/bible/books`; links are fetched; /app and /me use a session for the house platform account only, and the duplicate-action cases delete what they wrote. Every run is reported as it came out; nothing is edited by hand.', '', '`production` is the server deployed at the time of the run. `local` is this branch running in `wrangler dev` against the same production data (live database, Knowledge API, web pages), before deploy. A case that fails only on production and passes locally is waiting for the deploy.', ''];
for (const run of runs) {
  L.push(`## ${run.label}: ${run.passed} of ${run.total} passed (${pct(run.passed, run.total)}%)`, '');
  L.push(`Server ${run.base}, version ${run.server_version ?? 'unknown'}, run ${run.ran_at}. Latency per case: p50 ${q(run.results.map((r) => r.ms), 0.5)} ms, p95 ${q(run.results.map((r) => r.ms), 0.95)} ms.`, '');
  const cats = [...new Set(run.results.map((r) => r.category))];
  L.push('| Category | Passed | Of |', '|---|---|---|');
  for (const c of cats) { const rs = run.results.filter((r) => r.category === c); L.push(`| ${c} | ${rs.filter((r) => r.pass).length} | ${rs.length} |`); }
  const failed = run.results.filter((r) => !r.pass);
  if (failed.length) {
    L.push('', 'Failures:', '');
    for (const r of failed) L.push(`- \`${r.id}\` (${r.tool}): ${r.fails.join('; ').replace(/\|/g, '/').slice(0, 300)}`);
  }
  L.push('');
}
writeFileSync(path.join(HERE, 'RESULTS.md'), L.join('\n'));
process.exit(0);
