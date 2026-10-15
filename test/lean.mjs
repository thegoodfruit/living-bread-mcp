/* The lean public set's map (src/data/lean-map.json), for the test scripts: a named call in its lean form.
   Since 1.3.0 /mcp lists 13 lean tools; /me and /app keep the named tools. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEAN = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'lean-map.json'), 'utf8')).tools;

/** Every named public tool, once. */
export const NAMED_PUBLIC = [...new Set(Object.values(LEAN).flatMap((e) => Object.values(e.modes).map((m) => m.tool)))];

/** A named call as the lean endpoint takes it: the lean tool, its mode, and each argument under its lean name. */
export function leanCall(name, args = {}) {
  for (const [lean, e] of Object.entries(LEAN)) {
    for (const [mode, m] of Object.entries(e.modes)) {
      if (m.tool !== name || m.alias) continue;
      const back = Object.fromEntries(Object.entries(m.rename ?? {}).map(([l, n]) => [n, l]));
      const a = Object.fromEntries(Object.entries(args).map(([k, v]) => [back[k] ?? k, v]));
      return { name: lean, mode: e.mode_param === false ? null : mode, args: e.mode_param === false ? a : { mode, ...a } };
    }
  }
  return { name, mode: null, args };
}
