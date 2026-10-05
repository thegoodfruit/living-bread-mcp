/* ============================================================
   THE LIVING BREAD MCP, consent before any act.

   An assistant may act for a believer only when the believer asked for
   exactly that act in plain words. Every writing tool therefore takes a
   `confirmed` flag. Without it, the tool writes nothing and returns a short
   restatement of what it WOULD do, so the assistant can read it back and
   the person can say yes. When the client declares the elicitation
   capability, the server asks the person directly through it (MCP
   elicitation, SDK 1.30) and falls back to the flag otherwise. A decline is
   honoured silently: nothing is written, nothing is argued.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { paragraph } from './render';
import { ok, type Structured } from './shared';

export type Consent = 'yes' | 'no' | 'ask';

/** Did the person say yes? The flag first; the client's elicitation when it has one; otherwise ask through the assistant. */
export async function consent(server: McpServer, confirmed: boolean | undefined, message: string): Promise<Consent> {
  if (confirmed === true) return 'yes';
  let hasElicitation = false;
  try {
    hasElicitation = Boolean(server.server.getClientCapabilities()?.elicitation);
  } catch {
    hasElicitation = false;
  }
  if (!hasElicitation) return 'ask';
  try {
    const r = await server.server.elicitInput({
      mode: 'form',
      message,
      requestedSchema: {
        type: 'object',
        properties: { confirm: { type: 'boolean', title: 'Yes, do this as me', description: message, default: false } },
        required: ['confirm'],
      },
    });
    if (r.action === 'accept' && (r.content as { confirm?: unknown } | undefined)?.confirm === true) return 'yes';
    return 'no';
  } catch {
    return 'ask';
  }
}

/** The answer when nothing was written because the person has not said yes yet. */
export function notYet(would: string, toolName: string, extra: Structured = {}) {
  return ok(paragraph([`Nothing has been done yet`, would, `Read this back to the person; when they say yes in their own words, call ${toolName} again with confirmed true`]), { done: false, needs_confirmation: true, would, ...extra });
}

/** The answer when the person declined through the client's own prompt. */
export function declined(what: string, extra: Structured = {}) {
  return ok(paragraph([`${what} was not done; the person did not confirm it`, 'Nothing was written']), { done: false, needs_confirmation: false, declined: true, ...extra });
}
