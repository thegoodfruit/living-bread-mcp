/* ============================================================
   THE LIVING BREAD MCP, resource templates for clients that browse.

     living-bread://verse/{reference}        the stored King James text
     living-bread://need/{slug}              the verses the house pairs with a need
     living-bread://church/{country}/{slug}  one church as open data
     living-bread://answer/{slug}            one of the public answers pages

   Each template completes its variables where the SDK allows (needs from
   the bundled table, answers from the live hub, churches by country slug),
   and reads from the same sources the tools read.
   ============================================================ */
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { DOORS, SITE } from './doors';
import { housePage, hubEntries, prose, versesNamedIn } from './house';
import { kjvByRef, kjvPassage } from './kjv';
import { church as churchApi } from './knowledge';
import { allNeeds, needBySlug } from './needs';
import { paragraph } from './render';
import { parseReference } from './scripture';

const text = (uri: URL, mimeType: string, body: string) => ({ contents: [{ uri: uri.href, mimeType, text: body }] });

export function registerTemplates(server: McpServer, env: Env): void {
  server.registerResource('verse', new ResourceTemplate('living-bread://verse/{reference}', { list: undefined }), {
    title: 'A verse, from the stored text', description: 'living-bread://verse/John 3:16 (or a range or chapter): the King James words the app ships, verbatim.', mimeType: 'application/json',
  }, async (uri, vars) => {
    const ref = decodeURIComponent(String(vars.reference ?? ''));
    const p = parseReference(ref);
    const pass = p ? await kjvPassage(env, p) : null;
    if (!pass) return text(uri, 'application/json', JSON.stringify({ error: 'unparsed_or_unavailable', reference: ref, example: 'living-bread://verse/John 3:16', bible: DOORS.bible }));
    return text(uri, 'application/json', JSON.stringify({ ref: pass.ref, translation: 'KJV', text: pass.text, verses: pass.verses, source: 'King James Version, public domain (the text the app ships)', read_more: DOORS.bible }, null, 1));
  });

  server.registerResource('need', new ResourceTemplate('living-bread://need/{slug}', {
    list: async () => ({ resources: allNeeds().slice(0, 120).map((n) => ({ uri: `living-bread://need/${n.slug}`, name: n.slug, title: `Scripture for ${n.label.toLowerCase()}`, mimeType: 'application/json' })) }),
    complete: { slug: (value) => allNeeds().map((n) => n.slug).filter((s) => s.startsWith(value.toLowerCase())).slice(0, 50) },
  }), {
    title: 'The verses for a need', description: 'living-bread://need/grief (99 needs held): the verses the house pairs with a need, read from the stored text, and the page where the family prays over it.', mimeType: 'application/json',
  }, async (uri, vars) => {
    const slug = String(vars.slug ?? '').toLowerCase();
    const n = needBySlug(slug);
    if (!n) return text(uri, 'application/json', JSON.stringify({ error: 'no_such_need', slug, needs: allNeeds().map((x) => x.slug) }));
    const verses: { ref: string; text: string; why?: string }[] = [];
    for (const r of n.refs) { if (verses.length >= 8) break; const p = await kjvByRef(env, r.ref); if (p) verses.push({ ref: p.ref, text: p.text, ...(r.why ? { why: r.why } : {}) }); }
    return text(uri, 'application/json', JSON.stringify({ need: n.slug, label: n.label, lead: n.lead || undefined, verses, translation: 'KJV', page: n.page, pray_with_the_family: DOORS.prayer }, null, 1));
  });

  server.registerResource('church', new ResourceTemplate('living-bread://church/{country}/{slug}', { list: undefined }), {
    title: 'One church, as open data', description: 'living-bread://church/colombia/iglesia-la-capuchina: a church from the Christian Knowledge API by country and slug, with provenance.', mimeType: 'application/json',
  }, async (uri, vars) => {
    const country = String(vars.country ?? '');
    const slug = String(vars.slug ?? '');
    const c = country && slug ? await churchApi(env, country, slug) : null;
    if (!c || !c.name) return text(uri, 'application/json', JSON.stringify({ error: 'not_found', country, slug, find_a_church: DOORS.findAChurch }));
    return text(uri, 'application/json', JSON.stringify(c, null, 1));
  });

  server.registerResource('answer', new ResourceTemplate('living-bread://answer/{slug}', {
    list: async () => {
      const entries = (await hubEntries('/answers', (h) => h.startsWith('/answers/'))) ?? [];
      return { resources: entries.slice(0, 60).map((e) => ({ uri: `living-bread://answer/${e.href.slice('/answers/'.length)}`, name: e.href.slice('/answers/'.length), title: e.label, mimeType: 'text/plain' })) };
    },
    complete: { slug: async (value) => ((await hubEntries('/answers', (h) => h.startsWith('/answers/'))) ?? []).map((e) => e.href.slice('/answers/'.length)).filter((s) => s.startsWith(value.toLowerCase())).slice(0, 50) },
  }), {
    title: 'An answer from the house', description: 'living-bread://answer/can-god-forgive-me: one of the public answers pages (who is Jesus, is Jesus God, why did Jesus die, is there a God, what is grace, does God love me, can God forgive me...), in the house\'s words with the Scripture re-read from the stored text.', mimeType: 'text/plain',
  }, async (uri, vars) => {
    const slug = String(vars.slug ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    const page = slug ? await housePage(`/answers/${slug}`) : null;
    if (!page) return text(uri, 'text/plain', `No answer page is held at ${SITE}/answers/${slug}. All answers: ${SITE}/answers`);
    const verses = await versesNamedIn(env, page.blocks, 4);
    return text(uri, 'text/plain', paragraph([page.title, prose(page.blocks, 2400), verses.length ? `Scripture, read from the stored text: ${verses.map((v) => `${v.ref} "${v.text}"`).join('; ')}` : null, `Page: ${page.url}`]));
  });
}
