/* ============================================================
   THE LIVING BREAD MCP, the Worker.

   mcp.living-bread.org
     /          the landing page: what this is, how to connect
     /mcp       Model Context Protocol, Streamable HTTP (the one to use)
     /sse       the legacy SSE transport, for older clients
     /llms.txt  a small manifest for answer engines
     /health    a heartbeat
   Every request passes an honest per-IP rate limit first (300 a minute).
   The McpAgent (a Durable Object per session) does the rest.
   ============================================================ */
import { LivingBreadMCP } from './agent';
import { ME_PATH, protectedResourceMetadata, unauthorized, verifyBearer } from './auth';
import { KNOWLEDGE_API, MCP_URL, SSE_URL } from './doors';
import { SERVER_NAME, SERVER_VERSION } from './instructions';
import { ACT_TOOL_SUMMARY, SIGNED_IN_READ_SUMMARY } from './acts';
import { landingHTML, mcpLlmsTxt, PROMPTS, RESOURCES, TOOL_SUMMARY } from './landing';
import { PERSONAL_TOOL_SUMMARY } from './personal';
import { SHEPHERD_TOOL_SUMMARY } from './shepherd';
import serverJson from '../server.json';

/** Public half of the Ed25519 key that proves mcp.living-bread.org to the MCP Registry. */
const REGISTRY_PROOF = 'v=MCPv1; k=ed25519; p=8NsHPj7k8Cjmqt2Lde8DBBhj8PY4jAQyVpCqUUxozEU=';

export { LivingBreadMCP };

const CORS = {
  origin: '*',
  methods: 'GET, POST, DELETE, OPTIONS',
  headers: 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  exposeHeaders: 'Mcp-Session-Id, Mcp-Protocol-Version',
  maxAge: 86400,
};

const mcpHandler = LivingBreadMCP.serve('/mcp', { binding: 'MCP_OBJECT', corsOptions: CORS });
const sseHandler = LivingBreadMCP.serveSSE('/sse', { binding: 'MCP_OBJECT', corsOptions: CORS });
/* The signed-in path. Same agent; the Worker verifies the token first and hands the believer over as props. */
const meHandler = LivingBreadMCP.serve(ME_PATH, { binding: 'MCP_OBJECT', corsOptions: CORS });

function text(body: string, type: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': type, 'access-control-allow-origin': '*', ...extra } });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS' && !p.startsWith('/mcp') && !p.startsWith('/sse') && !p.startsWith('/me')) {
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': CORS.methods, 'access-control-allow-headers': CORS.headers, 'access-control-max-age': String(CORS.maxAge) } });
    }

    // Honest, generous rate limiting per IP, before anything is routed. If the binding is
    // missing (a local run without it), the door stays open rather than closed.
    const limiter = (env as Partial<Env>).RATE;
    if (limiter && typeof limiter.limit === 'function') {
      const key = request.headers.get('cf-connecting-ip') ?? 'anonymous';
      const { success } = await limiter.limit({ key });
      if (!success) {
        return text(JSON.stringify({ error: 'Too many requests from this address. Please wait a minute and try again.', limit: '300 requests a minute per IP' }), 'application/json; charset=utf-8', 429, { 'retry-after': '60' });
      }
    }

    if (p === '/mcp' || p.startsWith('/mcp/')) return mcpHandler.fetch(request, env, ctx);
    if (p === '/sse' || p.startsWith('/sse/')) return sseHandler.fetch(request, env, ctx);
    if (p === ME_PATH || p.startsWith(ME_PATH + '/')) {
      // OAuth 2.1 resource server (RFC 9728): no valid token, one honest 401 that names the
      // authorization server; a valid token, the same MCP server acting as that believer.
      const me = await verifyBearer(env, request.headers.get('authorization'));
      if (!me) return unauthorized('A signed-in connection needs a bearer token issued by The Living Bread.');
      (ctx as ExecutionContext & { props?: unknown }).props = me;
      return meHandler.fetch(request, env, ctx);
    }
    if (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/me') {
      return text(JSON.stringify(protectedResourceMetadata(env), null, 2), 'application/json; charset=utf-8', 200, { 'cache-control': 'public, max-age=3600' });
    }

    if (p === '/') return text(landingHTML(), 'text/html; charset=utf-8', 200, { 'cache-control': 'public, max-age=3600' });
    if (p === '/llms.txt') return text(mcpLlmsTxt(), 'text/plain; charset=utf-8', 200, { 'cache-control': 'public, max-age=86400' });
    if (p === '/openapi.json') return Response.redirect(`${KNOWLEDGE_API}/openapi.json`, 302);
    if (p === '/health' || p === '/.well-known/mcp.json') {
      return text(JSON.stringify({
        name: SERVER_NAME, version: SERVER_VERSION, ok: true,
        transports: { streamable_http: MCP_URL, sse: SSE_URL },
        tools: TOOL_SUMMARY.flatMap(([n]) => n.split(', ')), prompts: PROMPTS, resources: RESOURCES,
        signed_in: { endpoint: 'https://mcp.living-bread.org/me', tools: [...PERSONAL_TOOL_SUMMARY, ...SIGNED_IN_READ_SUMMARY, ...ACT_TOOL_SUMMARY].map(([n]) => n), shepherd_tools: SHEPHERD_TOOL_SUMMARY.map(([n]) => n) },
        auth: 'none on /mcp; OAuth 2.1 (Supabase Auth) on /me', confession: 'Jesus Christ is God and Lord.',
      }, null, 2), 'application/json; charset=utf-8', 200, { 'cache-control': 'no-store' });
    }
    // The official MCP Registry verifies this domain by reading a public key here
    // (mcp-publisher login http). The private key lives outside the repo.
    if (p === '/.well-known/mcp-registry-auth') return text(REGISTRY_PROOF + '\n', 'text/plain; charset=utf-8', 200, { 'cache-control': 'public, max-age=3600' });
    if (p === '/server.json') return text(JSON.stringify(serverJson, null, 2), 'application/json; charset=utf-8', 200, { 'cache-control': 'public, max-age=3600' });
    if (p === '/robots.txt') return text('User-agent: *\nAllow: /\n', 'text/plain; charset=utf-8');

    return text(JSON.stringify({ error: 'not found', see: `${url.origin}/`, mcp: `${url.origin}/mcp` }), 'application/json; charset=utf-8', 404);
  },
} satisfies ExportedHandler<Env>;
