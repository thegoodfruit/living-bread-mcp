/* ============================================================
   THE LIVING BREAD MCP, the funnel, counted without knowing anyone.

   Migration 0840 keeps one row per (day, client name, metric, subject) with
   a count, and nothing else: no IP, no session id, no user id, no question.
   The client name is the one the assistant announces in `initialize`
   ("claude-ai", "openai-mcp", "cursor"), cut to 60 characters.

     connection    an MCP session was initialized
     call          a tool was called (subject = tool name)
     useful        the call returned something (not empty, not an error)
     empty         the call honestly returned nothing
     error         the call failed
     journey       journey_next_steps answered (subject = journey)

   "Repeat" is computed in the report as a client NAME seen on two
   consecutive days: a property of the integration, never of a person.
   "Journey completed" comes from share_opens (0760) on the ?via=mcp...
   tokens journey_next_steps hands out. MCP_METRICS=0 is the kill switch.
   ============================================================ */

const PER_ISOLATE_PER_HOUR = 6000;
let hourKey = '';
let hourCount = 0;

function allow(): boolean {
  const k = new Date().toISOString().slice(0, 13);
  if (k !== hourKey) { hourKey = k; hourCount = 0; }
  if (hourCount >= PER_ISOLATE_PER_HOUR) return false;
  hourCount += 1;
  return true;
}

export type Metric = 'connection' | 'call' | 'useful' | 'empty' | 'error' | 'journey';

export function clientLabel(name: string | null | undefined): string {
  const n = String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9._ -]+/g, '').slice(0, 60);
  return n || 'unknown';
}

/** Never throws, never rejects; callers may ignore it (inside a session) or hand it to waitUntil (in the Worker). */
export function count(env: Env, client: string | null | undefined, metric: Metric | Metric[], subject = ''): Promise<void> {
  try {
    /* OFF unless MCP_METRICS is exactly "1": calling mcp_count before migration 0840 exists makes
       PostgREST hold the request for minutes (observed 2026-10-05), which would tie up the Worker's
       few outbound connections. The coordinator turns it on after applying 0840. */
    if (String((env as { MCP_METRICS?: unknown }).MCP_METRICS ?? '0') !== '1') return Promise.resolve();
    if (!allow()) return Promise.resolve();
    return fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mcp_count`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_client: clientLabel(client), p_metrics: Array.isArray(metric) ? metric : [metric], p_subject: subject.slice(0, 60) }),
      signal: AbortSignal.timeout(4000),
    }).then((r) => r.body?.cancel(), () => undefined).then(() => undefined, () => undefined);
  } catch {
    return Promise.resolve(); /* counting never costs an answer */
  }
}
