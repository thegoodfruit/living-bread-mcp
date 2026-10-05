/* ============================================================
   THE LIVING BREAD MCP, reading the Word well.

   Three public read tools over the stored King James text and the
   OpenBible.info cross-references the repo already holds:

     scripture_context   a passage with N verses either side (crossing a
                         chapter boundary inside the same book), so a verse
                         is never read out of its place;
     scripture_search    keyword search over every verse of the stored
                         corpus, bounded and paginated, every term must
                         match, whole words by default;
     cross_references    the passages readers most often link to a verse
                         (OpenBible.info, CC BY), each read from the stored
                         text, strongest first.

   Every verse returned is read from the stored text and noted for the
   evidence label. Which verses are linked to which is a human judgement
   (reader votes), so it is labelled as such, never as Scripture.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { SITE } from './doors';
import { CORPUS, layers, noteCrossReferences, noteReading } from './evidence';
import { kjvPassage, loadBook, loadXrefs } from './kjv';
import { list, paragraph } from './render';
import { BOOKS, bookById, canonicalReference, joinVerses, parseReference, type ParsedReference, type Verse } from './scripture';
import { cursorInput, fail, ok, out, page, READS, tool } from './shared';

const OT_COUNT = 39;

function readLink(bookId: string, chapter: number, verse?: number): string {
  return `${SITE}/bible?open=${bookId}.${chapter}${verse ? `.${verse}` : ''}`;
}

function parsed(bookId: string, chapter: number, from?: number, to?: number): ParsedReference {
  const b = bookById(bookId)!;
  const p: Omit<ParsedReference, 'ref'> = { bookId, book: b.name, chapter, ...(from !== undefined ? { from } : {}), ...(to !== undefined && from !== undefined && to > from ? { to } : {}) };
  return { ...p, ref: canonicalReference(p) };
}

/** "genesis.10.13" to its parts, when the book is one we hold. */
function splitId(id: string): { bookId: string; chapter: number; verse: number } | null {
  const m = id.match(/^([a-z0-9]+)\.(\d+)\.(\d+)$/);
  if (!m || !bookById(m[1])) return null;
  return { bookId: m[1], chapter: Number(m[2]), verse: Number(m[3]) };
}

const passageShape = z.looseObject({ ref: z.string(), text: z.string(), verses: z.array(z.looseObject({ verse: z.number(), text: z.string() })) });

export function registerWord(server: McpServer, env: Env): void {
  // ---- scripture_context -------------------------------------------------------------------
  tool(server, 'scripture_context', {
    title: 'A passage with its surrounding verses',
    description: 'Read a verse or a short passage together with the verses around it, verbatim from the stored King James Version, so a verse is never quoted out of its place. `around` verses are read before and after (default 3, up to 10), crossing into the previous or next chapter of the same book when needed. People ask: "what is the context of Jeremiah 29:11", "read Philippians 4:13 in context", "what comes before John 3:16". Returns the passage, the verses before and after, and an evidence label (translation, canon, corpus version, content hashes).',
    inputSchema: {
      reference: z.string().min(2).max(80).describe('A verse or short range, e.g. "Jeremiah 29:11" or "Romans 8:28-30".'),
      around: z.number().int().min(0).max(10).default(3).describe('How many verses to read before and after, 0 to 10.'),
    },
    outputSchema: out({ ref: z.string(), passage: passageShape, before: passageShape.nullable(), after: passageShape.nullable(), around: z.number(), read_more: z.string(), content_layers: z.record(z.string(), z.unknown()) }),
    annotations: READS,
  }, async ({ reference, around }) => {
    const p = parseReference(reference);
    if (!p) return fail(paragraph([`"${reference}" is not a reference we can read with certainty`, 'Use a book, chapter and verse, like "Jeremiah 29:11"']), { reason: 'unparsed_reference', try_instead: ['scripture_context with "John 3:16"', 'scripture_search for a phrase'] });
    if (p.from === undefined) return fail(paragraph([`${p.ref} is a whole chapter, which is already its own context`, 'Use scripture_passage for a chapter, or give a verse here']), { reason: 'chapter_not_verse', try_instead: [`scripture_passage with "${p.ref}"`] });
    const book = await loadBook(env, p.bookId);
    const chap = book?.c?.[p.chapter - 1];
    if (!book || !chap) return fail('The stored Bible text could not be read just now. Please try again in a moment.', { reason: 'unavailable', try_instead: [`${SITE}/bible`] });
    const last = p.to ?? p.from;
    if (p.from > chap.length) return fail(`${p.book} ${p.chapter} has ${chap.length} verses, so ${p.ref} is not held.`, { reason: 'verse_out_of_range', try_instead: [`scripture_passage with "${p.book} ${p.chapter}"`] });
    const passage = await kjvPassage(env, p);
    if (!passage) return fail('The stored Bible text could not be read just now.', { reason: 'unavailable' });
    const n = around ?? 3;
    const take = async (spans: { ch: number; from: number; to: number }[]) => {
      const verses: (Verse & { chapter: number })[] = [];
      const refs: string[] = [];
      for (const s of spans) {
        if (s.to < s.from) continue;
        const r = await kjvPassage(env, parsed(p.bookId, s.ch, s.from, s.to));
        if (r) { verses.push(...r.verses.map((v) => ({ ...v, chapter: s.ch }))); refs.push(r.ref); }
      }
      return verses.length ? { ref: refs.join('; '), text: joinVerses(verses), verses: verses.map(({ verse, text }) => ({ verse, text })) } : null;
    };
    // before: within this chapter, then the tail of the previous chapter
    const beforeSpans: { ch: number; from: number; to: number }[] = [];
    const inChapterBefore = Math.min(n, p.from - 1);
    const spill = n - inChapterBefore;
    if (spill > 0 && p.chapter > 1) {
      const prev = book.c[p.chapter - 2] ?? [];
      if (prev.length) beforeSpans.push({ ch: p.chapter - 1, from: Math.max(1, prev.length - spill + 1), to: prev.length });
    }
    if (inChapterBefore > 0) beforeSpans.push({ ch: p.chapter, from: p.from - inChapterBefore, to: p.from - 1 });
    // after: within this chapter, then the head of the next chapter
    const afterSpans: { ch: number; from: number; to: number }[] = [];
    const lastHeld = Math.min(last, chap.length);
    const inChapterAfter = Math.min(n, chap.length - lastHeld);
    if (inChapterAfter > 0) afterSpans.push({ ch: p.chapter, from: lastHeld + 1, to: lastHeld + inChapterAfter });
    const spillAfter = n - inChapterAfter;
    if (spillAfter > 0 && book.c[p.chapter]) afterSpans.push({ ch: p.chapter + 1, from: 1, to: Math.min(spillAfter, book.c[p.chapter].length) });
    const before = n > 0 ? await take(beforeSpans) : null;
    const after = n > 0 ? await take(afterSpans) : null;
    const read_more = readLink(p.bookId, p.chapter, p.from);
    return ok(paragraph([
      before ? `Before (${before.ref}): "${before.text}"` : 'Nothing comes before it in this book',
      `The passage (${passage.ref}, KJV): "${passage.text}"`,
      after ? `After (${after.ref}): "${after.text}"` : 'Nothing comes after it in this book',
      `Read the whole chapter at ${read_more}`,
    ]), {
      ref: passage.ref, passage: { ref: passage.ref, text: passage.text, verses: passage.verses }, before, after, around: n, read_more,
      content_layers: layers({ scripture: ['passage', 'before', 'after'] }),
    });
  });

  // ---- scripture_search --------------------------------------------------------------------
  tool(server, 'scripture_search', {
    title: 'Search the words of the Bible',
    description: `Find every verse in the stored King James Version (${CORPUS.verses} verses, 66 books) that contains ALL the given words, in canonical order, a page at a time. Whole words by default; put the words in double quotes to find an exact phrase. Optional: one book, or the Old or New Testament. People ask: "where does the Bible say 'be still'", "verses with the word mercy in Psalms", "find 'love one another'". Searches the King James wording, so modern words may not appear (search "charity" as well as "love"). Bounded: at most 20 per page, with next_cursor for more.`,
    inputSchema: {
      query: z.string().min(2).max(80).describe('Words to find, all of which must appear; in double quotes for an exact phrase.'),
      book: z.string().max(40).optional().describe('Optional book, e.g. "Psalms", "John", "1 Cor".'),
      testament: z.enum(['old', 'new']).optional().describe('Optional: only the Old or the New Testament.'),
      whole_words: z.boolean().default(true).describe('True matches whole words only ("love" does not match "loved").'),
      limit: z.number().int().min(1).max(20).default(10),
      cursor: cursorInput,
    },
    outputSchema: out({ query: z.string(), scope: z.string(), total_matches: z.number(), capped: z.boolean(), count: z.number(), results: z.array(z.looseObject({ ref: z.string(), text: z.string(), read_more: z.string() })), next_cursor: z.string().nullable(), content_layers: z.record(z.string(), z.unknown()) }),
    annotations: READS,
  }, async ({ query, book, testament, whole_words, limit, cursor }) => {
    const raw = query.trim();
    const phrase = /^".+"$/.test(raw);
    const terms = (phrase ? [raw.slice(1, -1)] : raw.split(/\s+/)).map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, '').trim()).filter((t) => t.length >= 2).slice(0, 6);
    if (!terms.length) return fail('Give at least one word of two letters or more.', { reason: 'empty_query', try_instead: ['scripture_search with "mercy"'] });
    let books = BOOKS.map((b, i) => ({ b, i }));
    let scope = 'the whole Bible';
    if (book) {
      const p = parseReference(`${book} 1`);
      if (!p) return fail(`"${book}" is not a book we can name with certainty.`, { reason: 'unknown_book', try_instead: ['a book name like "Psalms" or "John"'] });
      books = books.filter((x) => x.b.id === p.bookId);
      scope = p.book;
    } else if (testament) {
      books = books.filter((x) => (testament === 'old' ? x.i < OT_COUNT : x.i >= OT_COUNT));
      scope = testament === 'old' ? 'the Old Testament' : 'the New Testament';
    }
    const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const res = terms.map((t) => new RegExp(whole_words === false ? esc(t) : `(?<![\\p{L}\\p{N}])${esc(t)}(?![\\p{L}\\p{N}])`, 'iu'));
    const CAP = 2000;
    const hits: { bookId: string; book: string; chapter: number; verse: number; text: string; sha?: string }[] = [];
    let capped = false;
    for (const { b } of books) {
      const data = await loadBook(env, b.id);
      if (!data) return fail('The stored Bible text could not be read just now. Please try again in a moment.', { reason: 'unavailable' });
      for (let c = 0; c < data.c.length && !capped; c++) {
        const ch = data.c[c];
        for (let v = 0; v < ch.length; v++) {
          const t = ch[v];
          if (typeof t === 'string' && res.every((re) => re.test(t))) {
            if (hits.length >= CAP) { capped = true; break; }
            hits.push({ bookId: b.id, book: b.name, chapter: c + 1, verse: v + 1, text: t.trim(), sha: data.sha256 });
          }
        }
      }
      if (capped) break;
    }
    const salt = `${terms.join(' ')}|${scope}|${whole_words}`;
    const pg = page(hits, cursor, limit ?? 10, salt);
    const results = pg.items.map((h) => {
      const ref = `${h.book} ${h.chapter}:${h.verse}`;
      noteReading({ ref, translation: 'KJV', text: h.text, book: h.bookId, book_sha256: h.sha });
      return { ref, text: h.text, read_more: readLink(h.bookId, h.chapter, h.verse) };
    });
    const label = phrase ? `the phrase "${terms[0]}"` : `${terms.map((t) => `"${t}"`).join(' and ')}`;
    if (!hits.length) {
      return ok(paragraph([`No verse in ${scope} (King James Version) contains ${label}${whole_words === false ? '' : ' as whole words'}`, 'The King James wording is older English: try another word for the same thing (for example "charity" for love, "Holy Ghost" for Holy Spirit), or whole_words false', 'ask_living_bread or verses_for can find Scripture by meaning']), {
        query: raw, scope, total_matches: 0, capped: false, count: 0, results: [], next_cursor: null, empty: true,
        content_layers: layers({ scripture: ['results[].text'] }),
      });
    }
    return ok(paragraph([
      `${capped ? `More than ${CAP}` : hits.length} ${hits.length === 1 ? 'verse' : 'verses'} in ${scope} contain ${label}; showing ${pg.offset + 1} to ${pg.offset + results.length}`,
      list(results.map((r) => `${r.ref} "${r.text}"`), results.length),
      pg.next_cursor ? 'More are held: call again with next_cursor' : null,
    ]), { query: raw, scope, total_matches: hits.length, capped, count: results.length, results, next_cursor: pg.next_cursor, content_layers: layers({ scripture: ['results[].text'] }) });
  });

  // ---- cross_references --------------------------------------------------------------------
  tool(server, 'cross_references', {
    title: 'Cross references for a verse',
    description: 'The passages most often linked to a verse by readers (OpenBible.info cross references, CC BY, ranked by reader votes), each read verbatim from the stored King James text. Scripture interprets Scripture: use it to follow a thread through the Bible. Which verses are linked is a human judgement, labelled as such. People ask: "verses related to Romans 8:28", "cross references for John 3:16", "where else does the Bible talk about this verse". At most 12, strongest first.',
    inputSchema: {
      reference: z.string().min(2).max(80).describe('One verse, e.g. "Romans 8:28". For a range, the first verse is used.'),
      limit: z.number().int().min(1).max(12).default(6),
      include_text: z.boolean().default(true).describe('Read each linked passage from the stored text (up to 4 verses each).'),
    },
    outputSchema: out({ ref: z.string(), count: z.number(), references: z.array(z.looseObject({ ref: z.string(), votes: z.number(), text: z.string().nullable(), shortened: z.boolean(), read_more: z.string() })), source: z.string(), license: z.string(), content_layers: z.record(z.string(), z.unknown()) }),
    annotations: READS,
  }, async ({ reference, limit, include_text }) => {
    const p = parseReference(reference);
    if (!p || p.from === undefined) return fail(paragraph([`"${reference}" is not one verse we can read with certainty`, 'Give a book, chapter and verse, like "Romans 8:28"']), { reason: 'unparsed_reference', try_instead: ['cross_references with "Romans 8:28"'] });
    const xr = await loadXrefs(env, p.bookId);
    if (xr === null) return fail('The cross references could not be read just now. Please try again in a moment.', { reason: 'unavailable', try_instead: [`${SITE}/bible-cross-references`] });
    noteCrossReferences();
    const source = CORPUS.cross_references.attribution;
    const self = await kjvPassage(env, parsed(p.bookId, p.chapter, p.from));
    const targets = (xr[`${p.chapter}.${p.from}`] ?? []).slice(0, limit ?? 6);
    const refs: { ref: string; votes: number; text: string | null; shortened: boolean; read_more: string }[] = [];
    for (const [fromId, toId, votes] of targets) {
      const a = splitId(fromId);
      if (!a) continue;
      const b = toId ? splitId(toId) : null;
      const sameChapter = b && b.bookId === a.bookId && b.chapter === a.chapter && b.verse > a.verse;
      const end = sameChapter ? Math.min(b!.verse, a.verse + 3) : undefined;
      const shortened = Boolean(b && (!sameChapter || b.verse > a.verse + 3));
      const pr = parsed(a.bookId, a.chapter, a.verse, end);
      const fullRef = b && sameChapter ? canonicalReference({ bookId: a.bookId, book: pr.book, chapter: a.chapter, from: a.verse, to: b.verse }) : b ? `${pr.book} ${a.chapter}:${a.verse} to ${bookById(b.bookId)!.name} ${b.chapter}:${b.verse}` : pr.ref;
      const text = include_text === false ? null : (await kjvPassage(env, pr))?.text ?? null;
      refs.push({ ref: fullRef, votes, text, shortened, read_more: readLink(a.bookId, a.chapter, a.verse) });
    }
    if (!refs.length) {
      return ok(paragraph([`No cross reference is held for ${p.book} ${p.chapter}:${p.from}`, 'scripture_context reads the verses around it, and ask_living_bread finds related Scripture by meaning', source]), {
        ref: `${p.book} ${p.chapter}:${p.from}`, count: 0, references: [], source, license: CORPUS.cross_references.license, empty: true,
        content_layers: layers({ scripture: ['references[].text'], interpretation: ['references[] (which verses are linked, ranked by votes)'] }),
      });
    }
    return ok(paragraph([
      self ? `${self.ref}: "${self.text}"` : null,
      `Readers most often link it to: ${list(refs.map((r) => `${r.ref}${r.text ? ` "${r.text}"${r.shortened ? ' (first verses)' : ''}` : ''}`), refs.length)}`,
      'Which verses are linked is a human judgement (reader votes); the words are Scripture, read from the stored text',
      source,
    ]), {
      ref: `${p.book} ${p.chapter}:${p.from}`, verse: self ? { ref: self.ref, text: self.text } : null, count: refs.length, references: refs, source, license: CORPUS.cross_references.license,
      content_layers: layers({ scripture: ['references[].text'], interpretation: ['references[] (which verses are linked and their order: reader votes on OpenBible.info)'] }),
    });
  });
}
