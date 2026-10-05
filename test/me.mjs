#!/usr/bin/env node
/* The signed-in path, exercised by a real MCP client with bearer tokens.

     node test/me.mjs <base url> [access token]

   With a token: lists the personal tools and calls every read-only one, as before.
   Without a token: reads ../.env.local (EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY,
   SUPABASE_SERVICE_ROLE_KEY), mints sessions for the TWO PLATFORM ACCOUNTS ONLY (house@livingbread.app
   and review@livingbread.app, never a real believer) with admin/generate_link + verify, and then
   PROVES the consented acts end to end:
     - pray_for_someone WITHOUT confirmed: a restatement, and no prayer row written
     - pray_for_someone WITH confirmed, house -> review: one prayer_voices row and ONE notification
       (dedup_key voice_prayer:<id>) exist, then both are deleted
     - bring_what_i_carry and say_yes the same way (restatement, then write, then delete)
     - the shepherd tools are ABSENT for the house (not a pastor) and PRESENT for review once the
       app's own set_shepherd_role is set for the test, then cleared again
     - mcp_asks receives one row for a public search and none for a personal tool
     - the widget resources list and read
     - my_day answers */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [base, givenToken] = process.argv.slice(2);
if (!base) { console.error('usage: node test/me.mjs <base url> [access token]'); process.exit(2); }
let failures = 0;
const check = (label, good, note = '') => { console.log(`  ${good ? 'ok  ' : 'FAIL'} ${label}${!good && note ? `: ${note}` : ''}`); if (!good) failures++; };
const textOf = (r) => r.content?.find((c) => c.type === 'text')?.text ?? '';
const HOUSE = 'house@livingbread.app';
const REVIEW = 'review@livingbread.app';

function envFile() {
  const p = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env.local');
  const out = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) { const i = line.indexOf('='); if (i > 0 && !line.startsWith('#')) out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return out;
}

async function connect(token) {
  const client = new Client({ name: 'living-bread-me-test', version: '1.1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/me`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}

// 1. no token -> 401 with the challenge
const r401 = await fetch(`${base}/me`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
check('no token is 401', r401.status === 401);
check('401 names the resource metadata', /resource_metadata="https?:\/\/[^"]+\/\.well-known\/oauth-protected-resource\/me"/.test(r401.headers.get('www-authenticate') ?? ''));
const meta = await (await fetch(`${base}/.well-known/oauth-protected-resource/me`)).json();
check('metadata names the authorization server', Array.isArray(meta.authorization_servers) && /supabase\.co\/auth\/v1$/.test(meta.authorization_servers[0]));

// 2. a token (given, or minted for the house account)
let E = null, URL_ = null, ANON = null, SERVICE = null;
let houseToken = givenToken, houseId = null, reviewToken = null, reviewId = null;
const sb = async (method, p, token, body, prefer) => {
  const r = await fetch(URL_ + p, { method, headers: { apikey: token === SERVICE ? SERVICE : ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(prefer ? { prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const sessionFor = async (email) => {
  const link = await sb('POST', '/auth/v1/admin/generate_link', SERVICE, { type: 'magiclink', email });
  const th = link.hashed_token ?? link.properties?.hashed_token;
  const v = await sb('POST', '/auth/v1/verify', ANON, { type: 'magiclink', token_hash: th });
  return [v.access_token, v.user.id];
};
if (!givenToken) {
  E = envFile(); URL_ = E.EXPO_PUBLIC_SUPABASE_URL.replace(/\/$/, ''); ANON = E.EXPO_PUBLIC_SUPABASE_ANON_KEY; SERVICE = E.SUPABASE_SERVICE_ROLE_KEY;
  [houseToken, houseId] = await sessionFor(HOUSE);
  [reviewToken, reviewId] = await sessionFor(REVIEW);
  console.log(`  minted sessions: house ${houseId}, review ${reviewId}`);
}

const client = await connect(houseToken);
const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
for (const want of ['who_am_i', 'prayers_waiting_for_me', 'prayers_i_offered', 'say_amen', 'my_walk', 'my_family', 'my_day', 'pray_for_someone', 'speak_a_blessing', 'bring_what_i_carry', 'say_yes', 'going_to_gathering', 'set_a_table', 'someone_to_talk_to', 'offer_to_serve', 'invite_someone', 'my_church', 'my_invitations', 'family_saying_yes', 'tables_live_now', 'scripture_passage', 'find_churches_near', 'the_gospel', 'crisis_resources']) check(`tool ${want} listed`, names.includes(want));
check('every tool carries annotations.title', tools.every((t) => typeof t.annotations?.title === 'string' && t.annotations.title.length > 0), tools.filter((t) => !t.annotations?.title).map((t) => t.name).join(','));
check('every tool carries an explicit destructiveHint', tools.every((t) => typeof t.annotations?.destructiveHint === 'boolean'));
check('the acting pray_for_someone replaced the door tool on /me', (tools.find((t) => t.name === 'pray_for_someone')?.inputSchema?.properties ?? {}).confirmed !== undefined);
for (const shep of ['my_congregation', 'shepherd_doors', 'who_has_gone_quiet']) check(`shepherd tool ${shep} ABSENT for a non-pastor`, !names.includes(shep));

for (const [name, args] of [['who_am_i', {}], ['prayers_waiting_for_me', { limit: 5 }], ['prayers_i_offered', { limit: 5 }], ['my_walk', { limit: 5 }], ['my_family', { gatherings: 3 }], ['my_day', {}], ['invite_someone', {}], ['my_church', {}], ['my_invitations', {}], ['family_saying_yes', { limit: 5 }], ['tables_live_now', {}]]) {
  const r = await client.callTool({ name, arguments: args });
  const text = textOf(r);
  check(`${name} answers without error`, !r.isError, text.slice(0, 160));
  check(`${name} text has no dash`, !/[–—]/.test(text));
  console.log(`       ${text.slice(0, 220)}`);
}

// 3. widgets list and read
const { resources } = await client.listResources();
for (const uri of ['ui://living-bread/church-card.html', 'ui://living-bread/verse-card.html', 'ui://living-bread/prayer-card.html']) {
  check(`widget ${uri} listed`, resources.some((r) => r.uri === uri));
  const rr = await client.readResource({ uri });
  check(`widget ${uri} reads as HTML with the MCP Apps MIME type`, (rr.contents?.[0]?.text ?? '').includes('<!doctype html>') && /text\/html/.test(rr.contents?.[0]?.mimeType ?? ''));
}
check('scripture_passage declares openai/outputTemplate', tools.find((t) => t.name === 'scripture_passage')?._meta?.['openai/outputTemplate'] === 'ui://living-bread/verse-card.html');
check('prayers_waiting_for_me declares openai/outputTemplate', tools.find((t) => t.name === 'prayers_waiting_for_me')?._meta?.['openai/outputTemplate'] === 'ui://living-bread/prayer-card.html');

if (!givenToken) {
  // 4. the consented acts, house -> review, then delete
  const countAsks = async () => (await sb('GET', '/rest/v1/mcp_asks?select=id&order=id.desc&limit=1', SERVICE))?.[0]?.id ?? 0;
  const asksBefore = await countAsks();

  // 4a. pray_for_someone WITHOUT confirmed: restatement, no row
  const before = await sb('GET', `/rest/v1/prayer_voices?author_id=eq.${houseId}&recipient_id=eq.${reviewId}&select=id`, SERVICE);
  const r0 = await client.callTool({ name: 'pray_for_someone', arguments: { person: reviewId, words: 'Lord, be near Grace today; test prayer from the MCP proof, to be deleted.' } });
  const t0 = textOf(r0);
  check('pray_for_someone without confirmed does not write', !r0.isError && r0.structuredContent?.needs_confirmation === true && r0.structuredContent?.done === false, t0.slice(0, 200));
  console.log(`       ${t0.slice(0, 260)}`);
  const after0 = await sb('GET', `/rest/v1/prayer_voices?author_id=eq.${houseId}&recipient_id=eq.${reviewId}&select=id`, SERVICE);
  check('no prayer row was written without confirmed', after0.length === before.length);

  // 4b. ambiguity by first name never guesses
  const amb = await client.callTool({ name: 'pray_for_someone', arguments: { person: 'Zzyzxnobody', words: 'test', confirmed: true } });
  check('an unknown first name writes nothing and says so', amb.structuredContent?.done === false, textOf(amb).slice(0, 160));

  // 4c. WITH confirmed: one row, one notification, then delete
  const r1 = await client.callTool({ name: 'pray_for_someone', arguments: { person: reviewId, words: 'Lord, be near Grace today; test prayer from the MCP proof, to be deleted.', confirmed: true } });
  const t1 = textOf(r1);
  const prayerId = r1.structuredContent?.prayer_id;
  check('pray_for_someone with confirmed writes one prayer', !r1.isError && typeof prayerId === 'string', t1.slice(0, 200));
  console.log(`       ${t1.slice(0, 260)}`);
  if (prayerId) {
    const row = await sb('GET', `/rest/v1/prayer_voices?id=eq.${prayerId}&select=id,author_id,recipient_id,kind,words,words_are_spoken,voice_path,delivered_at`, SERVICE);
    check('prayer_voices row exists, written, kind prayer, from house to review', row.length === 1 && row[0].author_id === houseId && row[0].recipient_id === reviewId && row[0].kind === 'prayer' && row[0].words_are_spoken === false && row[0].voice_path === null, JSON.stringify(row).slice(0, 200));
    console.log(`       row: ${JSON.stringify(row[0])}`);
    const notifs = await sb('GET', `/rest/v1/notifications?user_id=eq.${reviewId}&dedup_key=eq.voice_prayer:${prayerId}&select=id,title,body,data`, SERVICE);
    check('exactly one notification reached review', notifs.length === 1, JSON.stringify(notifs).slice(0, 200));
    if (notifs[0]) console.log(`       notification: ${notifs[0].title} | ${notifs[0].body} | ${JSON.stringify(notifs[0].data)}`);
    const seen = await client.callTool({ name: 'prayers_i_offered', arguments: { limit: 3 } });
    check('prayers_i_offered shows it', (seen.structuredContent?.prayers ?? []).some((p) => p.id === prayerId));
    await sb('DELETE', `/rest/v1/notifications?dedup_key=eq.voice_prayer:${prayerId}`, SERVICE, undefined, 'return=representation');
    await sb('DELETE', `/rest/v1/kingdom_presence?voice_id=eq.${prayerId}`, SERVICE, undefined, 'return=representation').catch(() => null);
    const del = await sb('DELETE', `/rest/v1/prayer_voices?id=eq.${prayerId}`, SERVICE, undefined, 'return=representation');
    check('test prayer and its notification deleted', del.length === 1 && (await sb('GET', `/rest/v1/notifications?dedup_key=eq.voice_prayer:${prayerId}&select=id`, SERVICE)).length === 0);
  }

  // 4d. bring_what_i_carry
  const c0 = await client.callTool({ name: 'bring_what_i_carry', arguments: { feeling: 'thankful', words: 'MCP proof carrying, to be deleted', share_with_body: false } });
  check('bring_what_i_carry without confirmed does not write', c0.structuredContent?.needs_confirmation === true, textOf(c0).slice(0, 160));
  const c1 = await client.callTool({ name: 'bring_what_i_carry', arguments: { feeling: 'thankful', words: 'MCP proof carrying, to be deleted', share_with_body: false, confirmed: true } });
  const carryId = c1.structuredContent?.id;
  check('bring_what_i_carry with confirmed writes', !c1.isError && typeof carryId === 'string', textOf(c1).slice(0, 200));
  console.log(`       ${textOf(c1).slice(0, 220)}`);
  if (carryId) {
    const row = await sb('GET', `/rest/v1/carryings?id=eq.${carryId}&select=id,user_id,feeling,audience,note_private,shared_note`, SERVICE);
    check('carryings row exists, private, note kept private', row.length === 1 && row[0].user_id === houseId && row[0].audience === 'private' && row[0].shared_note === null, JSON.stringify(row).slice(0, 200));
    const del = await sb('DELETE', `/rest/v1/carryings?id=eq.${carryId}`, SERVICE, undefined, 'return=representation');
    check('test carrying deleted', del.length === 1);
  }

  // 4e. say_yes
  const y0 = await client.callTool({ name: 'say_yes', arguments: { words: 'MCP proof yes, to be deleted', verse_ref: 'John 3:16' } });
  check('say_yes without confirmed does not write', y0.structuredContent?.needs_confirmation === true, textOf(y0).slice(0, 160));
  const y1 = await client.callTool({ name: 'say_yes', arguments: { words: 'MCP proof yes, to be deleted', verse_ref: 'John 3:16', confirmed: true } });
  const yesId = y1.structuredContent?.yes_id;
  check('say_yes with confirmed writes', !y1.isError && typeof yesId === 'string', textOf(y1).slice(0, 200));
  console.log(`       ${textOf(y1).slice(0, 220)}`);
  // 1.2.0 duplicate protection: the identical confirmed request again is answered from the first result, never written twice
  const yDup = await client.callTool({ name: 'say_yes', arguments: { words: 'MCP proof yes, to be deleted', verse_ref: 'John 3:16', confirmed: true } });
  check('an identical confirmed say_yes is replayed, not written twice', yDup.structuredContent?.replayed === true && yDup.structuredContent?.yes_id === yesId, textOf(yDup).slice(0, 160));
  const key = `mcp-proof-${Date.now()}`;
  const yK1 = await client.callTool({ name: 'say_yes', arguments: { words: 'MCP proof keyed yes, to be deleted', confirmed: true, idempotency_key: key } });
  const yK2 = await client.callTool({ name: 'say_yes', arguments: { words: 'MCP proof keyed yes, to be deleted (retry)', confirmed: true, idempotency_key: key } });
  const keyedId = yK1.structuredContent?.yes_id;
  check('a retry with the same idempotency_key returns the first result', typeof keyedId === 'string' && yK2.structuredContent?.replayed === true && yK2.structuredContent?.yes_id === keyedId, textOf(yK2).slice(0, 160));
  const keyedRows = await sb('GET', `/rest/v1/my_yes?user_id=eq.${houseId}&words=like.MCP%20proof%20keyed*&select=id`, SERVICE);
  check('exactly one keyed yes row exists', keyedRows.length === 1, JSON.stringify(keyedRows));
  for (const r of keyedRows) await sb('DELETE', `/rest/v1/my_yes?id=eq.${r.id}`, SERVICE, undefined, 'return=representation');
  // presence and the router, read as the believer
  const avail = await client.callTool({ name: 'who_is_available_now', arguments: {} });
  check('who_is_available_now answers with honest freshness', !avail.isError && (avail.structuredContent?.statuses ?? []).every((s) => s.people === 0 ? s.freshness?.available_now === false : s.freshness?.kind === 'recently_observed'), textOf(avail).slice(0, 200));
  const route = await client.callTool({ name: 'find_help_for_my_need', arguments: { need: 'prayer' } });
  check('find_help_for_my_need returns at most five doors that resolve to living-bread.org', !route.isError && (route.structuredContent?.doors ?? []).length <= 5 && (route.structuredContent?.doors ?? []).every((d) => /^https:\/\/living-bread\.org/.test(d.door)), textOf(route).slice(0, 200));
  console.log(`       ${textOf(route).slice(0, 260)}`);
  const danger = await client.callTool({ name: 'find_help_for_my_need', arguments: { need: 'talk', danger: true } });
  check('with danger, the crisis door is first', danger.structuredContent?.doors?.[0]?.layer === 'crisis', JSON.stringify(danger.structuredContent?.doors?.[0] ?? {}).slice(0, 160));
  if (yesId) {
    const row = await sb('GET', `/rest/v1/my_yes?id=eq.${yesId}&select=id,user_id,words,verse_ref,share_words,state`, SERVICE);
    check('my_yes row exists, private, open', row.length === 1 && row[0].user_id === houseId && row[0].share_words === false && row[0].verse_ref === 'John 3:16', JSON.stringify(row).slice(0, 200));
    const del = await sb('DELETE', `/rest/v1/my_yes?id=eq.${yesId}`, SERVICE, undefined, 'return=representation');
    check('test yes deleted', del.length === 1);
  }

  // 4f. the other acts restate and write nothing
  const talk = await client.callTool({ name: 'someone_to_talk_to', arguments: { audience: 'any', note: 'MCP proof, not a real request' } });
  check('someone_to_talk_to without confirmed restates only', talk.structuredContent?.needs_confirmation === true && talk.structuredContent?.done === false, textOf(talk).slice(0, 160));
  const tbl = await client.callTool({ name: 'set_a_table', arguments: { title: 'MCP proof table', place: 'nowhere', starts_at: new Date(Date.now() + 86400000).toISOString() } });
  check('set_a_table without confirmed restates only', tbl.structuredContent?.needs_confirmation === true, textOf(tbl).slice(0, 160));
  const amen = await client.callTool({ name: 'say_amen', arguments: { prayer_id: '00000000-0000-4000-8000-000000000000' } });
  check('say_amen without confirmed restates only', amen.structuredContent?.needs_confirmation === true, textOf(amen).slice(0, 160));

  // 5. mcp_asks: one row for a public search, none for a personal tool
  await client.callTool({ name: 'search', arguments: { query: 'mcp proof search ' + Date.now() } });
  await new Promise((r) => setTimeout(r, 2500));
  const asksAfterSearch = await countAsks();
  check('a public search wrote one mcp_asks row', asksAfterSearch > asksBefore, `${asksBefore} -> ${asksAfterSearch}`);
  const lastAsk = (await sb('GET', '/rest/v1/mcp_asks?select=tool,ask,lang,hour,client,answered&order=id.desc&limit=1', SERVICE))[0];
  console.log(`       mcp_asks row: ${JSON.stringify(lastAsk)}`);
  check('the row names the tool and the client, and holds no user id', lastAsk.tool === 'search' && lastAsk.client === 'living-bread-me-test' && !('user_id' in lastAsk) && /mcp proof search/.test(lastAsk.ask));
  await client.callTool({ name: 'prayers_waiting_for_me', arguments: { limit: 2 } });
  await client.callTool({ name: 'my_day', arguments: {} });
  await new Promise((r) => setTimeout(r, 1500));
  check('personal tools wrote no mcp_asks row', (await countAsks()) === asksAfterSearch);

  await client.close();

  // 6. shepherd tools PRESENT for a believer the app recognises as a pastor (review, with the app's own set_shepherd_role, then cleared)
  const prior = await sb('GET', `/rest/v1/users?id=eq.${reviewId}&select=shepherd_role`, SERVICE);
  const priorRole = prior?.[0]?.shepherd_role ?? null;
  try {
    await sb('POST', '/rest/v1/rpc/set_shepherd_role', reviewToken, { p_role: 'pastor' });
    const rc = await connect(reviewToken);
    const list = (await rc.listTools()).tools.map((t) => t.name);
    for (const shep of ['my_congregation', 'shepherd_doors', 'who_has_gone_quiet']) check(`shepherd tool ${shep} PRESENT for a pastor`, list.includes(shep));
    const doors = await rc.callTool({ name: 'shepherd_doors', arguments: {} });
    check('shepherd_doors answers with the three routes', !doors.isError && doors.structuredContent?.pray_now === `https://living-bread.org/rooms/pastor-${reviewId}`, textOf(doors).slice(0, 160));
    console.log(`       ${textOf(doors).slice(0, 240)}`);
    const cong = await rc.callTool({ name: 'my_congregation', arguments: { limit: 5 } });
    check('my_congregation answers', !cong.isError, textOf(cong).slice(0, 160));
    const quiet = await rc.callTool({ name: 'who_has_gone_quiet', arguments: {} });
    check('who_has_gone_quiet is honest without a church', !quiet.isError && /not named their church|members|Nobody/.test(textOf(quiet)), textOf(quiet).slice(0, 160));
    await rc.close();
  } finally {
    await sb('POST', '/rest/v1/rpc/set_shepherd_role', reviewToken, { p_role: priorRole ?? '' });
    const restored = await sb('GET', `/rest/v1/users?id=eq.${reviewId}&select=shepherd_role`, SERVICE);
    check('review shepherd_role restored', (restored?.[0]?.shepherd_role ?? null) === priorRole, JSON.stringify(restored));
  }
} else {
  await client.close();
}

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
