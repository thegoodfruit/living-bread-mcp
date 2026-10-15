#!/usr/bin/env node
/* ============================================================
   Build the platform packages from the ONE canonical skills source (mcp/skills).

     node mcp/scripts/build-packages.mjs          copy skills and adapters into mcp/packages/*
     node mcp/scripts/build-packages.mjs --check  fail if any packaged copy has drifted (no writes)

   Canonical: mcp/skills/<skill>/SKILL.md (six skills) and mcp/skills/adapters/compact-instructions.md.
   Everything below is a COPY. Hand written files in the packages (README.md, config snippets, manifests)
   are never touched. A skill is copied byte for byte so mcp/scripts/validate-skills.mjs can prove equality.
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP = path.resolve(HERE, '..');
const SKILLS = path.join(MCP, 'skills');
const PKG = path.join(MCP, 'packages');
const check = process.argv.includes('--check');
const drift = [];

const skillNames = readdirSync(SKILLS).filter((d) => !d.startsWith('_') && existsSync(path.join(SKILLS, d, 'SKILL.md'))).sort();
const compact = readFileSync(path.join(SKILLS, 'adapters', 'compact-instructions.md'), 'utf8').trim();

function put(file, content) {
  const full = path.join(PKG, file);
  if (check) {
    if (!existsSync(full) || readFileSync(full, 'utf8') !== content) drift.push(file);
    return;
  }
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/* the skills, copied into every package that has a skills folder */
const SKILL_HOMES = [
  'claude-code/plugin/skills',
  'codex/.agents/skills',
  'cursor/.agents/skills',
  'cursor/plugin/skills',
  'vscode/.github/skills',
  'gemini-cli/extension/skills',
  'antigravity/.agents/skills',
];
for (const home of SKILL_HOMES) {
  for (const n of skillNames) put(`${home}/${n}/SKILL.md`, readFileSync(path.join(SKILLS, n, 'SKILL.md'), 'utf8'));
}

/* the adapters: instructions for surfaces with no native skills, each labelled as an adaptation */
const GENERATED = 'GENERATED from mcp/skills/adapters/compact-instructions.md by mcp/scripts/build-packages.mjs. Do not edit here; edit the source and rebuild.';
const ADAPT = {
  'copilot-studio/agent-instructions.md': `<!-- ${GENERATED}\n     ADAPTATION: Copilot Studio has no Agent Skills support that we have confirmed. These are the five Living Bread skills condensed into agent instructions (paste into the agent's Instructions field). -->\n${compact}\n`,
  'gemini-app/gem-instructions.md': `<!-- ${GENERATED}\n     ADAPTATION: the Gemini app has no skills. Paste into a Gem's instructions. Real lookups need the Living Bread custom app connected; without it the last paragraph applies. -->\n${compact}\n`,
  'perplexity/space-instructions.md': `<!-- ${GENERATED}\n     ADAPTATION: Perplexity skills support is unconfirmed. Paste into a Space's custom instructions, with the Living Bread remote connector added. -->\n${compact}\n`,
  'chatgpt/custom-gpt-instructions.md': `<!-- ${GENERATED}\n     ADAPTATION: a custom GPT has Actions, not MCP and not skills. Use only if the plugin route is not available; OpenAI has announced custom GPTs will be retired. -->\n${compact}\n`,
  'codex/AGENTS.md': `<!-- ${GENERATED}\n     ADAPTATION: AGENTS.md is plain instructions. The native route for Codex is the skills in .agents/skills. -->\n# Living Bread\n\n${compact}\n`,
  'cursor/.cursor/rules/living-bread.mdc': `---\ndescription: Living Bread: help people find community in Christ, pray, read Scripture, serve, and bring their people together, using the Living Bread MCP tools\nalwaysApply: false\n---\n<!-- ${GENERATED}\n     ADAPTATION: a Cursor rule. The native route for Cursor is the skills in .agents/skills. -->\n${compact}\n`,
  'cursor/plugin/rules/living-bread.mdc': `---\ndescription: Living Bread: help people find community in Christ, pray, read Scripture, serve, and bring their people together, using the Living Bread MCP tools\nalwaysApply: false\n---\n<!-- ${GENERATED}\n     ADAPTATION: a Cursor plugin rule. -->\n${compact}\n`,
  'vscode/.github/copilot-instructions.md': `<!-- ${GENERATED}\n     ADAPTATION: repository custom instructions for Copilot Chat. The native route is the skills in .github/skills. -->\n# Living Bread\n\n${compact}\n`,
  'gemini-cli/extension/GEMINI.md': `<!-- ${GENERATED}\n     Context file for the Living Bread Gemini CLI extension. The skills in skills/ are the native route. -->\n# Living Bread\n\n${compact}\n`,
};
for (const [f, c] of Object.entries(ADAPT)) put(f, c);

/* the zips a person can upload as personal skills (Claude and ChatGPT): folder name equals the skill name */
if (!check) {
  const out = path.join(PKG, 'skills-zips');
  if (existsSync(out)) rmSync(out, { recursive: true });
  mkdirSync(out, { recursive: true });
  for (const n of skillNames) {
    const r = spawnSync('zip', ['-r', '-X', '-q', path.join(out, `${n}.zip`), n], { cwd: SKILLS, encoding: 'utf8' });
    // exclude evals from the upload: the person's assistant needs SKILL.md only
    spawnSync('zip', ['-d', '-q', path.join(out, `${n}.zip`), `${n}/evals/*`], { cwd: SKILLS });
    if (r.status !== 0) { console.error(`zip failed for ${n}: ${r.stderr}`); process.exit(1); }
  }
}

if (check) {
  if (drift.length) { console.error(`build-packages --check: ${drift.length} packaged file(s) differ from the source:\n  ${drift.join('\n  ')}`); process.exit(1); }
  console.log('build-packages --check: every packaged copy matches the source');
} else {
  console.log(`build-packages: ${skillNames.length} skills into ${SKILL_HOMES.length} homes, ${Object.keys(ADAPT).length} adapters, ${skillNames.length} upload zips`);
}
