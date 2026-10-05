/* ============================================================
   THE LIVING BREAD MCP, learning from the asks.

   What people ask an assistant about Christ, a church, a verse or a need is
   the truest picture of the doors the web needs next. So the six public
   discovery tools write one row each to mcp_asks (migration 0680): the tool,
   the question cut to 200 characters, a guess at its language, the HOUR it
   was asked (never the minute), the client's name, and whether the tool had
   anything to answer with. Never a user id, never an address, never anything
   a signed-in tool was given. The RPC is SECURITY DEFINER, callable with the
   anon key, and rate limited on both sides: here per Worker isolate per
   hour, and inside the function per hour overall. MCP_ASK_LOG=0 turns it
   off without a deploy of anything else.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const LOGGED_TOOLS = new Set(['search', 'ask_living_bread', 'verses_for', 'find_churches_near', 'find_gatherings_near', 'heritage_lookup']);

/** Per isolate, per hour. The database keeps its own ceiling too. */
const PER_WORKER_PER_HOUR = 300;
let hourKey = '';
let hourCount = 0;

function allowHere(): boolean {
  const k = new Date().toISOString().slice(0, 13);
  if (k !== hourKey) { hourKey = k; hourCount = 0; }
  if (hourCount >= PER_WORKER_PER_HOUR) return false;
  hourCount += 1;
  return true;
}

/** A coarse language guess from script and a few function words. 'und' when unsure. */
export function guessLanguage(s: string): string {
  const t = s.trim();
  if (!t) return 'und';
  if (/[؀-ۿ]/.test(t)) return 'ar';
  if (/[֐-׿]/.test(t)) return 'he';
  if (/[Ѐ-ӿ]/.test(t)) return 'ru';
  if (/[Ͱ-Ͽ]/.test(t)) return 'el';
  if (/[가-힯]/.test(t)) return 'ko';
  if (/[぀-ヿ]/.test(t)) return 'ja';
  if (/[一-鿿]/.test(t)) return 'zh';
  if (/[ऀ-ॿ]/.test(t)) return 'hi';
  if (/[฀-๿]/.test(t)) return 'th';
  const words = t.toLowerCase().split(/[^\p{L}']+/u).filter(Boolean);
  const sets: Record<string, string[]> = {
    es: ['el', 'la', 'los', 'las', 'que', 'por', 'para', 'una', 'con', 'dios', 'iglesia', 'cerca', 'de', 'mi', 'oracion', 'oración', 'versiculo', 'versículo', 'como', 'cómo', 'donde', 'dónde', 'es', 'y'],
    pt: ['o', 'os', 'as', 'que', 'para', 'uma', 'com', 'deus', 'igreja', 'perto', 'de', 'minha', 'oração', 'versículo', 'como', 'onde', 'é', 'não', 'em', 'e'],
    fr: ['le', 'la', 'les', 'que', 'pour', 'une', 'avec', 'dieu', 'église', 'près', 'de', 'ma', 'prière', 'verset', 'comment', 'où', 'est', 'et', 'je', 'un'],
    de: ['der', 'die', 'das', 'und', 'ist', 'für', 'eine', 'mit', 'gott', 'kirche', 'nähe', 'mein', 'gebet', 'vers', 'wie', 'wo', 'ich', 'nicht', 'ein'],
    it: ['il', 'la', 'le', 'che', 'per', 'una', 'con', 'dio', 'chiesa', 'vicino', 'di', 'mia', 'preghiera', 'versetto', 'come', 'dove', 'è', 'e', 'non'],
    en: ['the', 'a', 'an', 'and', 'is', 'for', 'with', 'god', 'church', 'near', 'my', 'prayer', 'verse', 'how', 'where', 'what', 'i', 'me', 'to', 'of', 'in'],
  };
  let best = 'und';
  let bestScore = 0;
  for (const [lang, list] of Object.entries(sets)) {
    const set = new Set(list);
    const score = words.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0);
    if (score > bestScore) { best = lang; bestScore = score; }
  }
  return bestScore ? best : 'und';
}

/** Fire and forget. Nothing a tool answers ever waits on this. */
export function logAsk(env: Env, server: McpServer, toolName: string, ask: string, answered: boolean): void {
  try {
    if (!LOGGED_TOOLS.has(toolName)) return;
    if (String((env as { MCP_ASK_LOG?: unknown }).MCP_ASK_LOG ?? '1') === '0') return;
    const text = ask.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) return;
    if (!allowHere()) return;
    const client = server.server.getClientVersion()?.name ?? null;
    const p = fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mcp_log_ask`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_tool: toolName, p_ask: text, p_lang: guessLanguage(text), p_client: client ? String(client).slice(0, 80) : null, p_answered: answered }),
      signal: AbortSignal.timeout(4000),
    });
    p.then(() => undefined, () => undefined);
  } catch {
    /* learning never costs an answer */
  }
}
