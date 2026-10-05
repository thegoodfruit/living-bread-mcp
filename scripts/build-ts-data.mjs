#!/usr/bin/env node
/* Lift two of the app's own TypeScript datasets into JSON the Worker can import:
     lib/locale/emergency.ts  -> src/data/crisis.json   (crisis and emergency lines per country)
     lib/planCatalog.ts (+ lib/pathways.ts) -> src/data/plans.json (the reading plans, day by day)
   The TS is transpiled with the TypeScript compiler and evaluated with the app-only imports
   stubbed (icons, AsyncStorage), so the data is the app's data, never a retyped copy.
     node scripts/build-ts-data.mjs            (run from mcp/) */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');

function load(relPath, stubs) {
  const src = readFileSync(path.join(repo, relPath), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  const req = (name) => {
    if (name in stubs) return stubs[name];
    throw new Error(`unexpected import ${name} in ${relPath}`);
  };
  new Function('require', 'module', 'exports', js)(req, module, module.exports);
  return module.exports;
}

const emergency = load('lib/locale/emergency.ts', {});
const countries = emergency.EMERGENCY_COUNTRIES.map((c) => emergency.emergencyFor(c.code));

const pathways = load('lib/pathways.ts', { '@react-native-async-storage/async-storage': {}, '@/components/Icon': {} });
const plans = load('lib/planCatalog.ts', { '@/components/Icon': {}, '@/lib/pathways': pathways });

mkdirSync(path.join(here, '..', 'src', 'data'), { recursive: true });
writeFileSync(path.join(here, '..', 'src', 'data', 'crisis.json'), JSON.stringify(countries, null, 1));
writeFileSync(path.join(here, '..', 'src', 'data', 'plans.json'), JSON.stringify(plans.PLANS.map((p) => ({ id: p.id, title: p.title, subtitle: p.subtitle, category: p.category, forWhom: p.forWhom, needs: p.needs, days: p.days })), null, 1));
console.log(`crisis.json: ${countries.length} countries; plans.json: ${plans.PLANS.length} plans, ${plans.PLANS.reduce((n, p) => n + p.days.length, 0)} days`);
