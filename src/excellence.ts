/* ============================================================
   THE LIVING BREAD MCP, the tools that make an answer trustworthy.

   One registration point for the public tools added in the
   2026-10-06 wave, so agent.ts changes by a single line:

     verify_scripture_quote  the trust layer for Scripture (src/verify.ts)
     real_people_will_pray   a human, not a machine (src/realPeople.ts)
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerRealPeople } from './realPeople';
import { registerVerify } from './verify';

export const EXCELLENCE_TOOL_SUMMARY: [string, string][] = [
  ['verify_scripture_quote', 'check a quoted verse word for word against every held translation, with the closest real verse, a diff and hashes'],
  ['real_people_will_pray', 'the door where real believers pray for a person by name, and how many prayed in the last 24 hours'],
];

export function registerExcellence(server: McpServer, env: Env): void {
  registerVerify(server, env);
  registerRealPeople(server, env);
}
