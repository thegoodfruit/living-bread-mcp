#!/usr/bin/env node
/* ============================================================
   Validate the Living Bread skills (mcp/skills/*).

     node mcp/scripts/validate-skills.mjs            checks against the source of the server
     node mcp/scripts/validate-skills.mjs --live     also against the live tools/list
     node mcp/scripts/validate-skills.mjs --write    first re-insert the shared house rules block

   It checks, for every skill folder:
     1  SKILL.md parses: frontmatter with only the Agent Skills spec fields, name equal to the
        folder, lowercase letters, digits and hyphens, at most 64 characters, no reserved word;
        description present and at most 1024 characters
     2  the shared house rules block is identical to mcp/skills/_shared/house-rules.md
     3  every tool named in metadata.tools exists (source, and with --live the live list), and every
        `tool` + `mode: "x"` pair names a mode that tool really has
     4  no em dash or en dash, no forbidden phrase, no human titled Father, anywhere in mcp/skills,
        mcp/packages, the docs this system owns and the site page
     5  evals/cases.json has at least 8 cases, each with the required fields
     6  the five realistic scenarios appear word for word in some eval input
     7  the ChatGPT plugin copy of the umbrella skill equals the canonical one
     8  every packaged skill copy under mcp/packages equals its canonical source
   Exit code 1 on any failure; every failure is printed.
   ============================================================ */
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP = path.resolve(HERE, '..');
const ROOT = path.resolve(MCP, '..');
const SKILLS = path.join(MCP, 'skills');
const args = new Set(process.argv.slice(2));

const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
const read = (p) => readFileSync(p, 'utf8');

/* ---- the Agent Skills frontmatter (spec: agentskills.io/specification) ---- */
const ALLOWED_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const RESERVED = /(anthropic|claude)/;

export function parseSkill(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return { error: 'no frontmatter block' };
  const fm = {};
  let current = null;
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const nested = line.match(/^\s{2,}([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nested && current && typeof fm[current] === 'object') {
      fm[current][nested[1]] = nested[2].replace(/^"(.*)"$/, '$1');
      continue;
    }
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!top) return { error: `cannot parse frontmatter line: ${line}` };
    current = top[1];
    fm[current] = top[2] === '' ? {} : top[2].replace(/^"(.*)"$/, '$1');
  }
  return { fm, body: text.slice(m[0].length) };
}

/* ---- what tools exist: the source of the server (and the live list with --live) ---- */
function sourceTools() {
  const names = new Set();
  const src = path.join(MCP, 'src');
  for (const f of readdirSync(src)) {
    if (!f.endsWith('.ts')) continue;
    const s = read(path.join(src, f));
    for (const m of s.matchAll(/\btool\(\s*(?:server|yours|app|s),\s*\n?\s*'([a-z_]+)'/g)) names.add(m[1]);
    for (const m of s.matchAll(/\btool\(server,\s*'([a-z_]+)'/g)) names.add(m[1]);
  }
  const lean = JSON.parse(read(path.join(src, 'data', 'lean-map.json'))).tools;
  const modes = {};
  for (const [tool, e] of Object.entries(lean)) {
    names.add(tool);
    modes[tool] = Object.keys(e.modes);
  }
  return { names, modes, lean };
}

async function liveTools() {
  const sdk = path.join(MCP, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client');
  const { Client } = await import(path.join(sdk, 'index.js'));
  const { StreamableHTTPClientTransport } = await import(path.join(sdk, 'streamableHttp.js'));
  const c = new Client({ name: 'living-bread-validate', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL('https://mcp.living-bread.org/mcp')));
  const { tools } = await c.listTools();
  await c.close();
  const modes = {};
  for (const t of tools) modes[t.name] = t.inputSchema?.properties?.mode?.enum ?? [];
  return modes;
}

/* ---- text rules ---- */
const FORBIDDEN_PHRASES = JSON.parse(read(path.join(SKILLS, 'forbidden.json'))).phrases.map((p) => new RegExp(p, 'i'));
const DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
const FATHER_TITLE = /\bFather\s+[A-Z][a-z]+/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === '.git') continue;
    const p = path.join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(md|json|mjs|js|txt|html|toml|yaml|yml|mdc)$/.test(f)) out.push(p);
  }
  return out;
}

function scanText(file) {
  const rel = path.relative(ROOT, file);
  let text = read(file);
  if (/forbidden\.json$/.test(file)) return;
  if (/cases\.json$/.test(file)) {
    try {
      const j = JSON.parse(text);
      const strip = (v) => {
        if (Array.isArray(v)) return v.map(strip);
        if (v && typeof v === 'object') {
          const o = {};
          for (const [k, x] of Object.entries(v)) { if (k === 'forbidden_behaviours' || k === 'notMatches') continue; o[k] = strip(x); }
          return o;
        }
        return v;
      };
      text = JSON.stringify(strip(j), null, 1);
    } catch { /* parsed and reported elsewhere */ }
  }
  if (DASH.test(text)) {
    const i = text.search(DASH);
    fail(rel, `em or en dash at character ${i}: ...${text.slice(Math.max(0, i - 25), i + 25).replace(/\n/g, ' ')}...`);
  }
  for (const line of text.split('\n')) {
    if (/never (title|call)|do not (title|call)|not .*"Father"/i.test(line)) continue;
    if (FATHER_TITLE.test(line)) fail(rel, `a human titled Father: ${line.trim().slice(0, 80)}`);
    for (const re of FORBIDDEN_PHRASES) {
      if (re.test(line) && !/forbidden|must not|never|do not|does not|not say|not claim|not promise|not a promise|a door, not|not a statement|without|unless|forbidden_behaviours/i.test(line)) fail(rel, `forbidden phrase ${re}: ${line.trim().slice(0, 100)}`);
    }
  }
}

/* ---- main ---- */
const src = sourceTools();
const allModes = new Set(Object.values(src.modes).flat());
let live = null;
if (args.has('--live')) {
  try { live = await liveTools(); } catch (e) { fail('live', `could not read tools/list: ${e.message}`); }
}

const RULES = read(path.join(SKILLS, '_shared', 'house-rules.md')).trim();
const START = '<!-- house-rules:start -->';
const END = '<!-- house-rules:end -->';

const skillDirs = readdirSync(SKILLS).filter((d) => !d.startsWith('_') && statSync(path.join(SKILLS, d)).isDirectory() && existsSync(path.join(SKILLS, d, 'SKILL.md')));
if (skillDirs.length < 6) fail('mcp/skills', `expected the five skills and the umbrella skill, found ${skillDirs.length}`);
const FIVE = ['find-your-family-in-christ', 'pray-with-someone', 'meet-christ-in-the-word', 'take-one-step-together', 'bring-your-people-together'];
for (const d of [...FIVE, 'living-bread']) if (!skillDirs.includes(d)) fail('mcp/skills', `missing skill folder ${d}`);

const scenarios = [
  'I moved to Prague and want an English speaking church.',
  "I want someone to pray with me, but I don't want my name public.",
  'Our group has become quiet. Help us reconnect.',
  'There are no communities near me.',
  'Help me understand this passage without signing up',
];
const allInputs = [];

for (const d of skillDirs) {
  const file = path.join(SKILLS, d, 'SKILL.md');
  const rel = path.relative(ROOT, file);
  let text = read(file);
  if (args.has('--write') && text.includes(START) && text.includes(END)) {
    text = text.replace(new RegExp(`${START}[\\s\\S]*?${END}`), `${START}\n${RULES}\n${END}`);
    writeFileSync(file, text);
  }
  const parsed = parseSkill(text);
  if (parsed.error) { fail(rel, parsed.error); continue; }
  const { fm, body } = parsed;
  for (const k of Object.keys(fm)) if (!ALLOWED_FIELDS.has(k)) fail(rel, `frontmatter field "${k}" is not in the Agent Skills spec`);
  if (fm.name !== d) fail(rel, `name "${fm.name}" must equal the folder "${d}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name ?? '') || (fm.name ?? '').length > 64) fail(rel, 'name must be lowercase letters, digits and single hyphens, at most 64 characters');
  if (RESERVED.test(fm.name ?? '')) fail(rel, 'name contains a reserved word');
  if (!fm.description || fm.description.length > 1024) fail(rel, `description must be present and at most 1024 characters (is ${fm.description?.length ?? 0})`);
  if (fm.compatibility && fm.compatibility.length > 500) fail(rel, 'compatibility is over 500 characters');
  if (d !== 'living-bread') {
    if (!text.includes(START) || !text.includes(END)) fail(rel, 'house rules markers missing');
    else {
      const block = text.slice(text.indexOf(START) + START.length, text.indexOf(END)).trim();
      if (block !== RULES) fail(rel, 'house rules block differs from mcp/skills/_shared/house-rules.md (run with --write)');
    }
    if (!/^## When to use/m.test(body)) fail(rel, 'missing a "When to use" section');
    if (!/failure behavior|If nothing|If no /i.test(body)) fail(rel, 'missing failure behaviour');
    if (!/privacy/i.test(body)) fail(rel, 'missing a privacy section');
    if (!/^## Examples/m.test(body)) fail(rel, 'missing an Examples section');
  }

  /* tools named in metadata.tools must exist; every `tool` + mode pair must be real */
  const declared = (fm.metadata?.tools ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (d !== 'living-bread' && declared.length === 0) fail(rel, 'metadata.tools must list the tools the skill uses');
  for (const t of declared) {
    if (!src.names.has(t)) fail(rel, `tool "${t}" does not exist in the server source`);
    if (live && src.lean[t] && !(t in live)) fail(rel, `tool "${t}" is not in the live tools/list`);
  }
  const mentioned = new Set();
  for (const line of body.split('\n')) {
    const toks = [...line.matchAll(/`([a-z_]+)`/g)].map((m) => ({ t: m[1], at: m.index }));
    for (const { t } of toks) if (src.names.has(t) && (src.lean[t] || !allModes.has(t)) && !/^(search|fetch|begin|belief|church|parable|miracle|hymn)$/.test(t)) mentioned.add(t);
    for (const m of line.matchAll(/`mode: "([a-z_]+)"`/g)) {
      const prior = toks.filter((x) => x.at < m.index && src.lean[x.t]).pop();
      if (!prior) continue;
      const known = src.modes[prior.t] ?? [];
      if (known.length && !known.includes(m[1])) fail(rel, `mode "${m[1]}" is not a mode of ${prior.t} (modes: ${known.join(', ')})`);
      if (live && live[prior.t] && live[prior.t].length && !live[prior.t].includes(m[1]) && m[1] !== 'for_my_need') fail(rel, `mode "${m[1]}" of ${prior.t} is not in the live tools/list`);
    }
  }
  for (const t of mentioned) if (d !== 'living-bread' && !declared.includes(t)) fail(rel, `tool "${t}" is used in the text but not listed in metadata.tools`);

  /* evals */
  if (d !== 'living-bread') {
    const ev = path.join(SKILLS, d, 'evals', 'cases.json');
    if (!existsSync(ev)) fail(rel, 'evals/cases.json is missing');
    else {
      let j;
      try { j = JSON.parse(read(ev)); } catch (e) { fail(path.relative(ROOT, ev), `invalid JSON: ${e.message}`); continue; }
      if (j.skill !== d) fail(path.relative(ROOT, ev), `skill is "${j.skill}", expected "${d}"`);
      if (!Array.isArray(j.cases) || j.cases.length < 8) fail(path.relative(ROOT, ev), `needs at least 8 cases (has ${j.cases?.length ?? 0})`);
      const ids = new Set();
      for (const c of j.cases ?? []) {
        const w = `${path.relative(ROOT, ev)}#${c.id}`;
        if (!c.id || ids.has(c.id)) fail(w, 'id missing or duplicated');
        ids.add(c.id);
        for (const k of ['category', 'input', 'expected_skill', 'expected_behaviours', 'forbidden_behaviours']) if (!c[k] || (Array.isArray(c[k]) && !c[k].length)) fail(w, `missing ${k}`);
        if (!c.steps && !c.mocked) fail(w, 'needs steps (read-only live checks), mocked references, or both');
        for (const s of c.steps ?? []) {
          if (!s.tool && !s.simulate) fail(w, 'a step needs a tool');
          if (s.tool && !src.names.has(s.tool)) fail(w, `step tool "${s.tool}" does not exist`);
          if (s.tool && src.modes[s.tool] && s.args?.mode && !src.modes[s.tool].includes(s.args.mode)) fail(w, `step mode "${s.args.mode}" is not a mode of ${s.tool}`);
          if (s.tool && live && src.lean[s.tool] && !(s.tool in live)) fail(w, `step tool "${s.tool}" not in the live list`);
          if (/^(ask_the_family_to_pray|bring_what_i_carry|say_yes|offer_to_serve|set_a_table|someone_to_talk_to|pray_for_someone_signed_in)$/.test(s.tool ?? '')) fail(w, `a live step may only read; "${s.tool}" writes`);
        }
        allInputs.push(c.input);
      }
    }
  }
}

for (const s of scenarios) if (!allInputs.some((i) => i.includes(s))) fail('evals', `the scenario is missing word for word: ${s}`);

/* the plugin copy of the umbrella skill must be the canonical one */
const canonical = path.join(SKILLS, 'living-bread', 'SKILL.md');
const pluginCopy = path.join(MCP, 'plugin', 'skills', 'living-bread', 'SKILL.md');
if (existsSync(pluginCopy) && read(pluginCopy) !== read(canonical)) fail('mcp/plugin/skills/living-bread/SKILL.md', 'differs from mcp/skills/living-bread/SKILL.md (two competing versions)');

/* packaged copies of skills must equal the source */
for (const f of walk(path.join(MCP, 'packages'))) {
  const m = f.match(/\/skills\/([a-z0-9-]+)\/SKILL\.md$/);
  if (!m) continue;
  const c = path.join(SKILLS, m[1], 'SKILL.md');
  if (!existsSync(c)) fail(path.relative(ROOT, f), `no canonical source for ${m[1]}`);
  else if (read(c) !== read(f)) fail(path.relative(ROOT, f), `differs from canonical ${path.relative(ROOT, c)} (run node mcp/scripts/build-packages.mjs)`);
}

/* text rules over everything this system owns */
const owned = [
  ...walk(SKILLS),
  ...walk(path.join(MCP, 'packages')),
  ...['AI_CAPABILITY_MAP.md', 'AI_PLATFORM_MATRIX.md', 'AI_INSTALL_GUIDE.md', 'AI_MAINTAINER_GUIDE.md', 'AI_ARRIVAL_AND_MEASUREMENT.md'].map((n) => path.join(ROOT, 'docs', n)).filter(existsSync),
  path.join(ROOT, 'public', 'ai.html'),
  path.join(MCP, 'src', 'handoff.ts'), path.join(MCP, 'src', 'plan.ts'), path.join(MCP, 'src', 'handoffApply.ts'), path.join(MCP, 'src', 'leader.ts'),
].filter(existsSync);
for (const f of owned) scanText(f);

if (failures.length) {
  console.error(`validate-skills: ${failures.length} problem${failures.length === 1 ? '' : 's'}`);
  for (const f of failures) console.error(' FAIL ' + f);
  process.exit(1);
}
console.log(`validate-skills: ok (${skillDirs.length} skills, ${allInputs.length} eval cases, ${owned.length} files scanned${live ? ', live tools/list checked' : ''})`);
