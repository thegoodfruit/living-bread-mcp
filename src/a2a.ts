/* ============================================================
   THE LIVING BREAD, Agent2Agent (A2A).

   An Agent Card per the A2A specification 1.0 (a2a-protocol.org; the
   AgentCard, AgentInterface, AgentSkill and AgentCapabilities messages of
   specification/a2a.proto), served at /.well-known/agent-card.json, and the
   one interface it names: a JSON-RPC 2.0 binding at /a2a.

   What the agent does is small and true. It has no language model. It routes
   a message to one of four skills and answers with a Message (never a Task):

     scripture-with-evidence   a passage read from the stored King James text,
                               with the evidence label (translation, corpus
                               version, SHA-256 of the text)
     verify-scripture-quote    src/verify.ts, the same as the MCP tool
     churches-and-gatherings   the grounded ask engine of the discover worker
                               (/api/ask) and public gatherings (/api/gatherings)
     real-people-will-pray     src/realPeople.ts, the same as the MCP tool

   The skill is chosen by metadata.skill (on the message or the request) or a
   DataPart { "skill": ... }, else by plain rules on the text. Methods:
   SendMessage (A2A 1.0) and message/send (0.3, answered in the 0.3 shape).
   Streaming, push notifications and the extended card are not offered, and
   say so with UnsupportedOperationError (-32004), as section 3.3.4 requires.
   ============================================================ */
import { MCP_URL, SITE } from './doors';
import { callStore, evidenceFor, type CallContext } from './evidence';
import { SERVER_VERSION } from './instructions';
import { kjvByRef } from './kjv';
import { prayerDoorPayload } from './realPeople';
import { parseReference, verseSlug } from './scripture';
import { isVerifyError, verifyForAgent } from './verify';

export const A2A_URL = 'https://mcp.living-bread.org/a2a';
export const A2A_PROTOCOL_VERSION = '1.0';
const KNOWLEDGE = 'https://discover.living-bread.org';

export const SKILLS = [
  {
    id: 'scripture-with-evidence',
    name: 'Scripture with evidence',
    description: 'Reads a Bible passage verbatim from the stored King James Version (public domain) and returns it with an evidence label: translation, canon covered, corpus version, retrieval time and the SHA-256 of the text returned. Never from memory.',
    tags: ['bible', 'scripture', 'kjv', 'verse', 'evidence', 'christian'],
    examples: ['John 3:16', 'Read Psalm 23', '{"skill":"scripture-with-evidence","reference":"Romans 8:38-39"}'],
  },
  {
    id: 'verify-scripture-quote',
    name: 'Verify a Scripture quotation',
    description: 'Checks a quoted verse against every held translation: verbatim, close but differing (with a word diff), resembling, or not found in any held translation. Returns the closest real verse with reference, translation, stored words and SHA-256 hashes, and whether a claimed reference holds the words.',
    tags: ['bible', 'scripture', 'verification', 'fact-check', 'citation', 'hallucination'],
    examples: ['{"skill":"verify-scripture-quote","quote":"God helps those who help themselves"}', 'Is this a real verse: "<the words>" (John 3:16)'],
  },
  {
    id: 'churches-and-gatherings',
    name: 'Churches and gatherings',
    description: 'Grounded answers from The Living Bread knowledge graph: real churches in its open directory (country, count, directory page), denominations, saints, biblical people and places, and upcoming PUBLIC gatherings in a named city. Never invented; empty when nothing is held.',
    tags: ['church', 'gathering', 'events', 'bible study', 'denomination', 'christian'],
    examples: ['churches in Kenya', 'Bible study gatherings in Atlanta', 'what is a Methodist'],
  },
  {
    id: 'real-people-will-pray',
    name: 'Real people who will pray',
    description: 'For a person who asks for prayer: the door on living-bread.org where real believers pray for them by name, what that needs (a free account), a way to listen to believers praying now without one, and how many people prayed through The Living Bread in the last 24 hours. The agent does not pray; it connects to people who will.',
    tags: ['prayer', 'pray for me', 'community', 'christian'],
    examples: ['Please pray for me', 'I need someone to pray for my mother'],
  },
] as const;

type SkillId = (typeof SKILLS)[number]['id'];

export function agentCard(): Record<string, unknown> {
  return {
    name: 'The Living Bread',
    description: 'The Christian discovery and relationship layer (living-bread.org): Scripture from a stored text with evidence, verification of quoted verses, real churches and public gatherings, and doors to real believers who pray for people by name. Free, no ads, read only. The same skills, and many more, are offered as Model Context Protocol tools at https://mcp.living-bread.org/mcp. Jesus Christ is God and Lord.',
    supportedInterfaces: [{ url: A2A_URL, protocolBinding: 'JSONRPC', protocolVersion: A2A_PROTOCOL_VERSION }],
    provider: { organization: 'The Living Bread', url: SITE },
    version: SERVER_VERSION,
    documentationUrl: 'https://mcp.living-bread.org/',
    iconUrl: `${SITE}/logo.png`,
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: SKILLS.map((s) => ({ ...s, tags: [...s.tags], examples: [...s.examples] })),
  };
}

/* ---- JSON-RPC -------------------------------------------------------------------------------- */
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
type Id = string | number | null;
const rpcError = (id: Id, code: number, message: string, data?: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } }), { status: 200, headers: JSON_HEADERS });
const rpcResult = (id: Id, result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200, headers: JSON_HEADERS });

interface Part { text?: string; data?: unknown; kind?: string; url?: string; mediaType?: string }
interface Message { messageId?: string; contextId?: string; role?: string; parts?: Part[]; metadata?: Record<string, unknown> }

function textOf(m: Message): string {
  return (m.parts ?? []).map((p) => (typeof p.text === 'string' ? p.text : '')).filter(Boolean).join('\n').trim();
}
function dataOf(m: Message): Record<string, unknown> {
  for (const p of m.parts ?? []) if (p.data && typeof p.data === 'object' && !Array.isArray(p.data)) return p.data as Record<string, unknown>;
  return {};
}

const SKILL_IDS = new Set<string>(SKILLS.map((s) => s.id));

/** Plain rules, never a guess dressed as understanding. */
export function chooseSkill(text: string, data: Record<string, unknown>, hint: unknown): SkillId {
  if (typeof hint === 'string' && SKILL_IDS.has(hint)) return hint as SkillId;
  if (typeof data.skill === 'string' && SKILL_IDS.has(data.skill)) return data.skill as SkillId;
  if (typeof data.quote === 'string') return 'verify-scripture-quote';
  if (typeof data.reference === 'string') return 'scripture-with-evidence';
  const t = text.toLowerCase();
  if (/\b(verify|real verse|is this (a )?(real )?verse|is this in the bible|check (this|the) (quote|verse)|did the bible say|where is this verse)\b/.test(t)) return 'verify-scripture-quote';
  if (/\bpray(er)? for (me|my|us|him|her|them)\b|\bi need prayer\b|\bplease pray\b|\bsomeone to pray\b/.test(t)) return 'real-people-will-pray';
  const stripped = text.replace(/^(read|show me|what does|open)\s+/i, '').replace(/\s+say\??$/i, '').trim();
  if (parseReference(stripped)) return 'scripture-with-evidence';
  return 'churches-and-gatherings';
}

function quoteFrom(text: string): { quote: string; reference: string | null } {
  const q = text.match(/["“]([^"”]{3,2000})["”]/);
  const r = text.match(/\(([^()]{3,60})\)\s*$/);
  return { quote: q ? q[1] : text.replace(/^.*?:\s*/, ''), reference: r && parseReference(r[1]) ? r[1] : null };
}

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
    return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Run one skill. Returns the words for a TextPart and the structured result for a DataPart. */
export async function runSkill(env: Env, skill: SkillId, text: string, data: Record<string, unknown>): Promise<{ text: string; data: Record<string, unknown> }> {
  if (skill === 'verify-scripture-quote') {
    const parsed = quoteFrom(text);
    const quote = typeof data.quote === 'string' ? data.quote : parsed.quote;
    const reference = typeof data.reference === 'string' ? data.reference : parsed.reference;
    if (!quote || quote.trim().length < 3) return { text: 'Send the words to check, in quotation marks, or as data { "quote": "..." }.', data: { skill, ok: false, reason: 'no_quote' } };
    const ctx: CallContext = { readings: [], crossRefs: false };
    const v = await callStore.run(ctx, () => verifyForAgent(env, quote, reference));
    if (isVerifyError(v)) return { text: v.error, data: { skill, ok: false, reason: v.reason } };
    const evidence = await evidenceFor(ctx);
    const b = v.best_match as { ref: string; translation: string; text: string } | null;
    return { text: [v.verdict_sentence, b ? `The held text (${b.ref}, ${b.translation}): "${b.text}"` : null].filter(Boolean).join('. '), data: { skill, ok: true, ...v, evidence } };
  }
  if (skill === 'real-people-will-pray') {
    const p = await prayerDoorPayload(env);
    return { text: p.text, data: { skill, ok: true, ...p.structured } };
  }
  if (skill === 'scripture-with-evidence') {
    const ref = typeof data.reference === 'string' ? data.reference : text.replace(/^(read|show me|what does|open)\s+/i, '').replace(/\s+say\??$/i, '').trim();
    const p = parseReference(ref);
    if (!p) return { text: `"${ref}" is not a reference that can be read with certainty. Try "John 3:16" or "Psalm 23".`, data: { skill, ok: false, reason: 'unparsed_reference' } };
    const ctx: CallContext = { readings: [], crossRefs: false };
    const passage = await callStore.run(ctx, () => kjvByRef(env, p.ref));
    if (!passage) return { text: 'The stored Bible text could not be read just now, or the verse is not held.', data: { skill, ok: false, reason: 'unavailable' } };
    const evidence = await evidenceFor(ctx);
    const source_url = p.from !== undefined ? `${SITE}/bible?open=${p.bookId}.${p.chapter}.${p.from}` : `${SITE}/bible?open=${p.bookId}.${p.chapter}`;
    return { text: `${passage.ref} (King James Version): "${passage.text}"`, data: { skill, ok: true, ref: passage.ref, translation: 'KJV', text: passage.text, verses: passage.verses, slug: verseSlug(p), source_url, evidence } };
  }
  // churches-and-gatherings: the grounded ask engine, and public gatherings when a city is named
  const q = (typeof data.query === 'string' ? data.query : text).slice(0, 300);
  if (!q) return { text: 'Ask about a church, a gathering in a city, a denomination, or a person or place of the Bible.', data: { skill, ok: false, reason: 'empty_query' } };
  const city = q.match(/\b(?:in|near|around)\s+([A-Z][\p{L}.'\s-]{1,40}?)(?:[,?.!]|$)/u)?.[1]?.trim() ?? null;
  const [ask, gatherings] = await Promise.all([
    getJson(`${KNOWLEDGE}/api/ask?q=${encodeURIComponent(q)}`),
    city && /gather|event|study|worship|prayer meeting|service|tonight|this week/i.test(q) ? getJson(`${KNOWLEDGE}/api/gatherings?city=${encodeURIComponent(city)}&days=14&limit=10`) : Promise.resolve(null),
  ]);
  if (!ask && !gatherings) return { text: 'The knowledge graph could not be reached just now. Please try again in a moment.', data: { skill, ok: false, reason: 'unavailable', door: `${SITE}/find-a-church` } };
  const entities = Array.isArray(ask?.entities) ? (ask!.entities as { name: string; type: string; url: string }[]) : [];
  const churches = (ask?.churches ?? null) as { country: string; church_count: number; directory: string } | null;
  const items = Array.isArray(gatherings?.items) ? (gatherings!.items as { title: string; starts_at: string; url: string }[]) : [];
  const words = [
    churches ? `The open directory holds ${churches.church_count} churches in ${churches.country}: ${churches.directory}` : null,
    entities.length ? `Found: ${entities.slice(0, 5).map((e) => `${e.name} (${e.type}) ${e.url}`).join('; ')}` : null,
    city && gatherings ? (items.length ? `Public gatherings in ${city} in the next 14 days: ${items.slice(0, 5).map((g) => `${g.title}, ${g.starts_at} ${g.url}`).join('; ')}` : `No public gathering is listed in ${city} in the next 14 days; every gathering is at ${SITE}/events`) : null,
  ].filter(Boolean);
  return {
    text: words.length ? words.join('. ') : `Nothing in the knowledge graph names that directly. Find a church near you at ${SITE}/find-a-church.`,
    data: { skill, ok: true, query: q, city, ask, gatherings: gatherings ? { count: items.length, items } : null, source_url: churches ? `${SITE}/find-a-church` : `${SITE}/find-a-church` },
  };
}

function newId(): string {
  return crypto.randomUUID();
}

/** /a2a and /.well-known/agent-card.json. Returns null for any other path. */
export async function a2aRoute(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path === '/.well-known/agent-card.json' || path === '/.well-known/agent.json') {
    return new Response(JSON.stringify(agentCard(), null, 2), { status: 200, headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=3600' } });
  }
  if (path !== '/a2a') return null;
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'The A2A JSON-RPC interface answers POST. The Agent Card is at /.well-known/agent-card.json.', agent_card: 'https://mcp.living-bread.org/.well-known/agent-card.json', mcp: MCP_URL }, null, 2), { status: 405, headers: { ...JSON_HEADERS, allow: 'POST, OPTIONS' } });
  }
  let body: { jsonrpc?: string; id?: Id; method?: string; params?: { message?: Message; metadata?: Record<string, unknown> } };
  try {
    const raw = await request.text();
    if (raw.length > 65_536) return rpcError(null, -32600, 'Request too large');
    body = JSON.parse(raw);
  } catch {
    return rpcError(null, -32700, 'Parse error');
  }
  const id = body?.id ?? null;
  if (body?.jsonrpc !== '2.0' || typeof body.method !== 'string') return rpcError(id, -32600, 'Invalid Request');
  const method = body.method;
  if (method === 'SendStreamingMessage' || method === 'message/stream' || method === 'SubscribeToTask' || method === 'tasks/resubscribe') return rpcError(id, -32004, 'UnsupportedOperationError: streaming is not offered by this agent (capabilities.streaming is false)');
  if (method === 'GetExtendedAgentCard' || method === 'agent/getAuthenticatedExtendedCard') return rpcError(id, -32004, 'UnsupportedOperationError: there is no extended agent card');
  if (/PushNotification|pushNotificationConfig/.test(method)) return rpcError(id, -32003, 'PushNotificationNotSupportedError');
  if (method === 'GetTask' || method === 'CancelTask' || method === 'tasks/get' || method === 'tasks/cancel' || method === 'ListTasks') return rpcError(id, -32001, 'TaskNotFoundError: this agent answers with messages and keeps no tasks');
  const legacy = method === 'message/send';
  if (method !== 'SendMessage' && !legacy) return rpcError(id, -32601, 'Method not found');
  const message = body.params?.message;
  if (!message || !Array.isArray(message.parts) || !message.parts.length) return rpcError(id, -32602, 'Invalid params: params.message with at least one part is required');
  const text = textOf(message);
  const data = dataOf(message);
  const skill = chooseSkill(text, data, message.metadata?.skill ?? body.params?.metadata?.skill);
  const out = await runSkill(env, skill, text, data);
  const contextId = typeof message.contextId === 'string' && message.contextId ? message.contextId : newId();
  if (legacy) {
    return rpcResult(id, { kind: 'message', messageId: newId(), contextId, role: 'agent', parts: [{ kind: 'text', text: out.text }, { kind: 'data', data: out.data }], metadata: { skill } });
  }
  return rpcResult(id, { message: { messageId: newId(), contextId, role: 'ROLE_AGENT', parts: [{ text: out.text, mediaType: 'text/plain' }, { data: out.data, mediaType: 'application/json' }], metadata: { skill } } });
}
