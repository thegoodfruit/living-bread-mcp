/* ============================================================
   THE LIVING BREAD MCP, /status: a cheap, honest self-check.

   Three probes, each bounded, the result kept for sixty seconds per
   isolate so a busy status page never becomes load:
     scripture       one stored book read through ASSETS, its SHA-256
                     compared with the corpus manifest
     database        one trivial anonymous function (router_kind)
     knowledge_api   one cached entity from discover.living-bread.org
   "ok" means every probe answered. The human line says exactly which did not.
   ============================================================ */
import { CORPUS, sha256Hex } from './evidence';
import { SERVER_VERSION } from './instructions';

interface Check { ok: boolean; ms: number; detail: string }
let cached: { at: number; body: Record<string, unknown> } | null = null;

async function timed(fn: () => Promise<string>): Promise<Check> {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { ok: true, ms: Date.now() - t0, detail };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message.slice(0, 160) : 'failed' };
  }
}

export async function status(env: Env): Promise<Record<string, unknown>> {
  if (cached && Date.now() - cached.at < 60_000) return { ...cached.body, cached: true };
  const [scripture, database, knowledge] = await Promise.all([
    timed(async () => {
      const r = await env.ASSETS.fetch(new Request('https://assets.living-bread.org/books/john.json'));
      if (!r.ok) throw new Error(`book read ${r.status}`);
      const h = await sha256Hex(await r.arrayBuffer());
      if (h !== CORPUS.book_files.john?.sha256) throw new Error('John does not match the corpus manifest');
      return `stored KJV readable, corpus ${CORPUS.corpus_version}`;
    }),
    timed(async () => {
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/router_kind`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json' }, body: '{"p_kind":"prayer"}', signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`database ${r.status}`);
      return 'live data reachable';
    }),
    timed(async () => {
      const r = await fetch(`${env.KNOWLEDGE_API}/api/denomination/methodism`, { headers: { accept: 'application/json', 'user-agent': 'TheLivingBread-MCP-status/1.0' }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`knowledge api ${r.status}`);
      return 'Christian Knowledge API answering';
    }),
  ]);
  const checks = { scripture, database, knowledge_api: knowledge };
  const down = Object.entries(checks).filter(([, c]) => !c.ok).map(([k]) => k.replace('_', ' '));
  const body = {
    ok: down.length === 0,
    version: SERVER_VERSION,
    checked_at: new Date().toISOString(),
    line: down.length === 0 ? 'Every part is answering: the stored Scripture, the live data and the Knowledge API.' : `Degraded: ${down.join(', ')} not answering just now. Scripture tools ${checks.scripture.ok ? 'still work' : 'are affected'}.`,
    checks,
    endpoints: { public: 'https://mcp.living-bread.org/mcp', signed_in: 'https://mcp.living-bread.org/me', chatgpt_profile: 'https://mcp.living-bread.org/app' },
  };
  cached = { at: Date.now(), body };
  return body;
}
