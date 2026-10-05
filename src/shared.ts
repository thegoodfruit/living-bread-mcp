/* ============================================================
   THE LIVING BREAD MCP, what every tool file shares.

   One `tool()` so every tool carries its title twice (top level, and inside
   annotations, where the Anthropic directory checker reads it) and an
   explicit destructiveHint. One `ok`/`fail` so every answer has one
   paragraph of text and a compact structured body. Nothing here knows a
   tool's subject; it only keeps the shape honest.
   ============================================================ */
import type { McpServer, RegisteredTool, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { SITE } from './doors';
import { paragraph } from './render';

export type Structured = Record<string, unknown>;

/* Every output schema is open (additional properties allowed) so attribution, license and a tool's
   extra facts never fail a strict client validator; the declared keys are the promise. */
export const out = <T extends z.ZodRawShape>(shape: T) => z.looseObject(shape);

export function ok(text: string, structured: Structured) {
  return { content: [{ type: 'text' as const, text }], structuredContent: structured };
}
/* An error carries its facts in the text alone: clients validate structuredContent against the
   output schema even when isError is set, and an error has a different shape by nature. */
export function fail(text: string, _structured: Structured = {}) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

export const ATTRIBUTION = { attribution: 'The Living Bread (living-bread.org)', license: 'https://creativecommons.org/licenses/by/4.0/' };

/** The honest shape of an outage: a calm sentence and the door that still opens. Never spiritualised. */
export function unavailable(what: string, door: string) {
  return fail(paragraph([`We could not reach ${what} just now. Please try again in a moment`, `The door itself is open at ${door}`]), { error: 'unavailable', door, ...ATTRIBUTION });
}

export function absolute(url: string): string {
  return url.startsWith('/') ? `${SITE}${url}` : url;
}

/** Hints without the title; the title comes from the config and is written into annotations by `tool`. */
export type Hints = Required<Pick<ToolAnnotations, 'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint'>>;
export const READS: Hints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const READS_WORLD: Hints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
export const WRITES: Hints = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
export const WRITES_ONCE: Hints = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export interface ToolConfig<InputArgs, OutputArgs> {
  title: string;
  description: string;
  inputSchema?: InputArgs;
  outputSchema?: OutputArgs;
  annotations: Hints;
  _meta?: Record<string, unknown>;
}

/** Register a tool with its title in BOTH places and every hint explicit. */
export function tool<OutputArgs extends ZodRawShapeCompat | AnySchema, InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined>(
  server: McpServer,
  name: string,
  config: ToolConfig<InputArgs, OutputArgs>,
  cb: ToolCallback<InputArgs>,
): RegisteredTool {
  return server.registerTool(name, { ...config, annotations: { title: config.title, ...config.annotations } }, cb);
}

/** A first name, the way the app shows one (public._first_name). */
export function firstName(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  return n ? n.split(/\s+/)[0] : 'a believer';
}

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
