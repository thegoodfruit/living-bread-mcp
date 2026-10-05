/* The landing page at mcp.living-bread.org: what this is and how to connect. Plain HTML, no dashes. */
import { ACT_TOOL_SUMMARY, SIGNED_IN_READ_SUMMARY } from './acts';
import { ME_URL } from './auth';
import { DOORS, KNOWLEDGE_API, MCP_URL, SITE, SSE_URL } from './doors';
import { PERSONAL_TOOL_SUMMARY } from './personal';
import { SHEPHERD_TOOL_SUMMARY } from './shepherd';

/* One-click installs. Cursor takes a base64 JSON config; VS Code takes a URL-encoded JSON object. */
const CURSOR_LINK = `cursor://anysphere.cursor-deeplink/mcp/install?name=living-bread&config=${btoa(JSON.stringify({ url: MCP_URL }))}`;
const VSCODE_LINK = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'living-bread', type: 'http', url: MCP_URL }))}`;
const VSCODE_INSIDERS_LINK = VSCODE_LINK.replace(/^vscode:/, 'vscode-insiders:');

export type ToolGroup = { name: string; purpose: string; tools: ReadonlyArray<[string, string]> };

/** Every public tool, grouped by what a person is doing. The health endpoint lists the same names. */
export const TOOL_GROUPS: ReadonlyArray<ToolGroup> = [
  { name: 'Read', purpose: 'the Word, from a stored text, and the house\'s own pages', tools: [
    ['scripture_passage', 'a verse, range or chapter read verbatim from the stored KJV (or WEB where held)'],
    ['verses_for', 'the verses the house pairs with a need or feeling, in the person\'s own words'],
    ['daily_bread', 'the one verse the whole family receives on a given morning'],
    ['what_the_bible_says_about', 'what the Bible says about one of about 300 topics, verse by verse'],
    ['teaching_of_jesus', 'what Jesus Himself said about love, forgiveness, prayer, worry, money, enemies'],
    ['parable', 'a parable of Jesus: the story, where it is written, what it means'],
    ['miracle', 'a miracle of Jesus and what it shows about who He is'],
    ['reading_plans', 'the app\'s reading plans, day by day, with day one read from the text'],
    ['hymn', 'a great public-domain hymn: its story, its words, the Scripture behind it'],
    ['name_meaning', 'the meaning and Bible story of a biblical name'],
    ['saint_of_the_day', 'who the church remembers on a date, from the house\'s pages'],
  ] },
  { name: 'Pray', purpose: 'with the house\'s own prayers and with real people', tools: [
    ['a_prayer_for', 'a hand-written prayer from the house\'s library for a situation, with its Scripture'],
    ['pray_for_someone', 'the exact door to pray for a person by name, in your own voice'],
    ['prayers_left_near', 'prayers real believers left at places near you (Prayer in Place), approximate centres only'],
    ['hear_the_kingdom_pray', 'where believers from many nations pray out loud over the whole family'],
    ['worship_now', 'what the worship room offers for this hour, the hymns, and the live room'],
    ['crisis_resources', 'the real emergency number and crisis line for a country, FIRST, before the Word'],
  ] },
  { name: 'Find', purpose: 'real churches, gatherings and people, honestly', tools: [
    ['find_churches_near', 'real churches near a place, nearest first, city level, honest when nothing is held'],
    ['church', 'one church as open data by country and slug'],
    ['find_gatherings_near', 'real upcoming gatherings a person could attend, including online'],
    ['events_this_week', 'gatherings in the next seven days near a city'],
    ['communities_to_join', 'discoverable communities on The Living Bread and how to join'],
    ['universities', 'Christian community at universities, by country, state or city'],
    ['kingdom_map', 'privacy-safe counts of believers by city, so nobody thinks they are alone'],
    ['needs_near', 'open, verified Serve needs near a place, approximate places only'],
    ['tables_live_now', 'the Living Bread Tables open now (read as yourself; the door for everyone)'],
  ] },
  { name: 'Understand', purpose: 'Christ, the faith and its traditions, in the house\'s words', tools: [
    ['the_gospel', 'the good news in the house\'s words: Jesus Christ is God and Lord, and the door to say yes'],
    ['christianity_and_other_faiths', 'for a seeker from another faith or none: honest, respectful, never an argument'],
    ['ask_living_bread', 'a grounded answer from the Christian Knowledge API, with sources and the road to Christ'],
    ['belief', 'what Christians believe: grace, sin, repentance, faith, salvation, the Holy Spirit, the Trinity'],
    ['heritage_lookup', 'a denomination, saint, sacred site, biblical figure or Bible place, sourced'],
    ['denomination_compare', 'two traditions side by side, charitably, with their family trees'],
    ['faith_in_a_hard_season', 'Christ at a threshold of life: grief, loneliness, church hurt, starting out'],
    ['testimonies', 'real testimonies believers chose to share with the Body'],
    ['body_today', 'what the whole family did today: a mirror, never a leaderboard'],
    ['begin', 'the invitation, the web home, the stores, and what a newcomer finds first'],
    ['search, fetch', 'the connector contract (ChatGPT and others) over the same real data'],
  ] },
];

export const TOOL_SUMMARY: ReadonlyArray<[string, string]> = TOOL_GROUPS.flatMap((g) => g.tools);

export const PROMPTS: ReadonlyArray<string> = [
  'pray_with_me', 'find_my_church', 'a_verse_for_today',
  'i_am_not_sure_i_believe', 'i_want_to_pray_but_do_not_know_how', 'someone_i_love_died', 'i_cannot_forgive_myself', 'i_want_to_find_a_church',
  'explain_the_gospel_simply', 'what_happens_when_we_die', 'i_am_alone_tonight', 'i_did_something_terrible', 'walk_me_through_my_first_week',
];
export const RESOURCES: ReadonlyArray<string> = [
  'living-bread://llms.txt', 'living-bread://knowledge/llms.txt', 'living-bread://openapi.json',
  'living-bread://verse/{reference}', 'living-bread://need/{slug}', 'living-bread://church/{country}/{slug}', 'living-bread://answer/{slug}',
  'ui://living-bread/church-card.html', 'ui://living-bread/verse-card.html', 'ui://living-bread/prayer-card.html',
];

const li = (rows: ReadonlyArray<[string, string]>) => rows.map(([n, d]) => `<li><code>${n}</code> <span>${d}</span></li>`).join('');

export function landingHTML(): string {
  const groups = TOOL_GROUPS.map((g) => `<h3>${g.name} <small>${g.purpose}</small></h3><ul class="tools">${li(g.tools)}</ul>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Living Bread for AI assistants</title>
<meta name="description" content="Connect Claude, ChatGPT, Cursor or any MCP client to The Living Bread: Scripture from a stored text, the gospel in the house's words, real churches and gatherings, grounded answers, prayers for every situation, and the doors to pray for someone by name.">
<link rel="canonical" href="https://mcp.living-bread.org/">
<meta property="og:title" content="The Living Bread for AI assistants"><meta property="og:description" content="A remote MCP server. Every tool points to Christ and to love one another."><meta property="og:url" content="https://mcp.living-bread.org/"><meta property="og:image" content="${SITE}/og.png">
<style>
:root{--paper:#f7f4ec;--ink:#12222e;--muted:#5a6b78;--gold:#b8892f;--aqua:#0d7a72;--line:#e7e0d2;--navy:#12222e}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--paper);color:var(--ink);font:17px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
header{background:var(--navy);color:#eaf6f4;padding:56px 20px 44px}
.wrap{max-width:46rem;margin:0 auto}
.eyebrow{color:var(--gold);font:700 12px/1 sans-serif;letter-spacing:.14em;text-transform:uppercase}
h1{font:600 38px/1.15 Georgia,'Times New Roman',serif;margin:10px 0 12px}
h2{font:600 24px/1.3 Georgia,serif;margin:36px 0 10px}
h3{font:600 18px/1.3 Georgia,serif;margin:22px 0 6px}h3 small{color:var(--muted);font:15px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin-left:6px}
.btns{display:flex;flex-wrap:wrap;gap:10px;margin:10px 0 4px}.btn{display:inline-block;background:var(--navy);color:#fff;text-decoration:none;font:600 14px/1 system-ui,sans-serif;padding:11px 15px;border-radius:999px}.btn.gold{background:var(--gold)}.btn:hover{opacity:.92}
header p{font-size:19px;color:#cfe0dc;margin:0 0 18px}
main{padding:12px 20px 56px}
code,pre{font:14.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
pre{background:#fff;border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:12px;padding:14px 16px;overflow:auto}
code{background:#fff;border:1px solid var(--line);border-radius:6px;padding:1px 6px}
pre code{border:0;padding:0;background:transparent}
ul.tools{list-style:none;padding:0;margin:0}ul.tools li{padding:9px 0;border-bottom:1px solid var(--line)}ul.tools li span{color:var(--muted);display:block;font-size:15.5px}
a{color:var(--aqua)}
.pill{display:inline-block;background:var(--aqua);color:#fff;text-decoration:none;padding:9px 15px;border-radius:999px;font-weight:600;font-size:14.5px;margin:6px 8px 0 0}
.note{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;color:#33475a}
footer{padding:28px 20px 48px;color:var(--muted);text-align:center;font-size:14.5px;border-top:1px solid var(--line)}
</style></head>
<body>
<header><div class="wrap">
<div class="eyebrow">The Living Bread, for AI assistants</div>
<h1>Meet Christ. Meet your family in Christ. Now from any assistant.</h1>
<p>This is a remote MCP server. Connect Claude, ChatGPT, Cursor, Windsurf, VS Code or any client that speaks the Model Context Protocol, and it receives tools that read Scripture from a stored text, tell the gospel in the house's own words, name real churches, gatherings, Tables and needs near a person, answer from a sourced Christian knowledge graph, give the real crisis line for a country first, and hand people the exact doors into The Living Bread: pray for someone by name, hear the Kingdom pray, say yes, begin.</p>
<a class="pill" href="#connect">Connect</a> <a class="pill" href="${SITE}">living-bread.org</a> <a class="pill" href="${KNOWLEDGE_API}/api">Knowledge API</a>
</div></header>
<main><div class="wrap">

<h2 id="connect">Connect</h2>
<p>Endpoint (Streamable HTTP): <code>${MCP_URL}</code><br>Legacy SSE, for older clients: <code>${SSE_URL}</code><br>No account, no key, no cost. Read-only tools. Generous per-IP rate limits.</p>

<h3>Claude (claude.ai and the desktop app)</h3>
<p>Settings, then Connectors, then <em>Add custom connector</em>. Name it <strong>The Living Bread</strong> and paste <code>${MCP_URL}</code>. Leave OAuth blank. Then in any chat, enable it under the tools menu and ask: "find a church near Lagos", "a verse for today", "pray with me for my mother", "explain the gospel simply".</p>

<h3>Claude Code</h3>
<pre><code>claude mcp add --transport http living-bread ${MCP_URL}</code></pre>

<h3>ChatGPT</h3>
<p>Settings, then Connectors (Developer mode must be on under Settings, Apps and Connectors, Advanced). Create a connector, name it <strong>The Living Bread</strong>, URL <code>${MCP_URL}</code>, authentication <em>None</em>. The server provides the <code>search</code> and <code>fetch</code> tools ChatGPT expects, plus every tool below; churches, verses and prayers also come as small cards ChatGPT can show.</p>

<h3>One click</h3>
<div class="btns">
<a class="btn gold" href="${CURSOR_LINK}">Add to Cursor</a>
<a class="btn" href="${VSCODE_LINK}">Add to VS Code</a>
<a class="btn" href="${VSCODE_INSIDERS_LINK}">VS Code Insiders</a>
<a class="btn" href="https://registry.modelcontextprotocol.io/v0/servers?search=org.living-bread.mcp">MCP Registry listing</a>
</div>
<p>Each button installs the same endpoint, <code>${MCP_URL}</code>, with no key and nothing to configure. The manual forms follow.</p>

<h3>Cursor</h3>
<pre><code>{ "mcpServers": { "living-bread": { "url": "${MCP_URL}" } } }</code></pre>
<p>in <code>~/.cursor/mcp.json</code> or the project's <code>.cursor/mcp.json</code>.</p>

<h3>Windsurf</h3>
<pre><code>{ "mcpServers": { "living-bread": { "serverUrl": "${MCP_URL}" } } }</code></pre>
<p>in <code>~/.codeium/windsurf/mcp_config.json</code>.</p>

<h3>VS Code (Copilot agent mode)</h3>
<pre><code>{ "servers": { "living-bread": { "type": "http", "url": "${MCP_URL}" } } }</code></pre>
<p>in <code>.vscode/mcp.json</code>.</p>

<h2 id="yourself">Connect as yourself</h2>
<p>A second endpoint acts as <em>you</em>: <code>${ME_URL}</code>. Add it the same way as the public one; your assistant will send you to sign in to The Living Bread (your own account, through Supabase Auth with OAuth 2.1 and PKCE) and ask you once to approve. From then on it can read what you could read yourself in the app, under the same protections:</p>
<ul class="tools">${li(PERSONAL_TOOL_SUMMARY)}${li(SIGNED_IN_READ_SUMMARY)}</ul>
<h3>It can act for you, when you say so</h3>
<p>A few tools write, and every one of them does only what you asked for in plain words. Your assistant must read back exactly what it is about to do and hear your yes before anything is sent; nothing is written until then. A prayer or a blessing carries <em>your</em> words, never words composed in your name. It never hears a voice for you, never prays in your name, and never reads another person's private prayer. Revoke the connection any time from your assistant's connector settings.</p>
<ul class="tools">${li(ACT_TOOL_SUMMARY)}</ul>
<h3>For shepherds</h3>
<p>When the app recognises you as a pastor (your shepherd calling set, or your pastor page on), three more tools appear, reading only what your own Shepherd Console shows you. For everyone else they do not exist.</p>
<ul class="tools">${li(SHEPHERD_TOOL_SUMMARY)}</ul>

<h2>What the assistant receives</h2>
${groups}
<p>Resources: ${RESOURCES.map((r) => `<code>${r}</code>`).join(', ')}.<br>Prompts, named by the moment a person arrives in: ${PROMPTS.map((p) => `<code>${p}</code>`).join(', ')}.</p>

<h2>What it promises</h2>
<div class="note">
<p>The Living Bread confesses Jesus Christ as God and Lord; every answer points to Him and to loving one another.</p>
<p>Scripture always comes from a stored text, the King James Version the app itself ships, and the World English Bible where a passage is held. Nothing is typed from memory. The house's own pages are quoted, never rewritten.</p>
<p>Churches, gatherings, Tables, needs and communities are real rows read live, city level by design: no addresses, no coordinates, no contact details, nobody's name. When nothing is held near a place, the tool says so.</p>
<p>When a person is in danger, the real crisis line for their country comes first, before the Word. No human is ever titled "Father". No streaks, no scores, no pressure.</p>
</div>

<h2>Try it without a client</h2>
<pre><code>curl -X POST ${MCP_URL} \\
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'</code></pre>

<h2>For developers</h2>
<p>The tools read the open <a href="${KNOWLEDGE_API}/api">Christian Knowledge API</a> (CC BY 4.0, <a href="${KNOWLEDGE_API}/openapi.json">OpenAPI 3.1</a>), the house's own public pages, and a small set of anonymous, privacy-bounded database functions. Build on the API directly if you prefer JSON over MCP. The six public discovery tools record what was asked (the question, cut to 200 characters, the hour, the client's name; never who) so the answer pages can learn; set nothing and nothing about you is kept. Attribution: The Living Bread, <a href="${SITE}">living-bread.org</a>. Privacy: <a href="${DOORS.privacy}">${DOORS.privacy}</a>. Support: <a href="${DOORS.support}">${DOORS.support}</a>.</p>

</div></main>
<footer>"I am the bread of life." John 6:35. The Living Bread, <a href="${SITE}">living-bread.org</a>. Jesus Christ is Lord.</footer>
</body></html>`;
}

export function mcpLlmsTxt(): string {
  return [
    '# The Living Bread MCP server',
    '',
    `> A remote Model Context Protocol server for The Living Bread (${SITE}). Connect any MCP client and receive tools that read Scripture from a stored text, tell the gospel in the house's own words, name real churches, gatherings, Tables and needs near a person, answer from a sourced Christian knowledge graph, give the real crisis line for a country first, and hand people the exact doors to pray for someone by name, hear the Kingdom pray, say yes to Christ, and begin. The Living Bread confesses Jesus Christ as God and Lord.`,
    '',
    `- MCP endpoint (Streamable HTTP): ${MCP_URL}`,
    `- Legacy SSE endpoint: ${SSE_URL}`,
    '- Authentication: none for the read tools. Rate limited per IP, generously.',
    `- Signed-in endpoint (OAuth 2.1, acts as the believer who approves it, only when they say so): ${ME_URL}`,
    `- Signed-in tools: ${[...PERSONAL_TOOL_SUMMARY, ...SIGNED_IN_READ_SUMMARY, ...ACT_TOOL_SUMMARY].map(([n]) => n).join(', ')}`,
    `- Shepherd tools (pastors only): ${SHEPHERD_TOOL_SUMMARY.map(([n]) => n).join(', ')}`,
    ...TOOL_GROUPS.map((g) => `- ${g.name}: ${g.tools.map(([n]) => n).join(', ')}`),
    `- Resources: ${RESOURCES.join(', ')}`,
    `- Prompts: ${PROMPTS.join(', ')}`,
    `- Knowledge API the tools read: ${KNOWLEDGE_API}/api (OpenAPI: ${KNOWLEDGE_API}/openapi.json)`,
    `- The platform: ${SITE} (llms.txt: ${SITE}/llms.txt)`,
    '',
    'Scripture is never generated: it is read from the King James Version the app ships. The house\'s pages are quoted, never rewritten. Churches, gatherings and needs are real rows, city level only. In danger, the real crisis line comes first. No human is titled Father. Everything points to Jesus Christ and to love one another.',
    '',
  ].join('\n');
}
