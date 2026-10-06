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
import { isAny, isPick, languageInput, notesOf, pick, readAny, translationInput } from './shelf';
import { doorFor, fold, heldBooks, loadTBook, OT_IDS, parseLoose, refString, spacelessScript, toStandard, type ShelfTranslation } from './translations';

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
    description: 'Read a verse or short range together with the verses immediately before and after it (default 3 each side, up to 10), verbatim from the stored King James Version, crossing into the neighbouring chapter of the same book when needed. translation or language (ids from list_translations) reads the context from that stored Bible instead, in its own numbering. Use when a verse needs its context ("Jeremiah 29:11 in context", "what comes before John 3:16"). For the passage alone or a whole chapter use scripture_passage (a chapter reference here returns an error pointing to it); for related passages elsewhere in the Bible use cross_references; for one verse in several Bibles use compare_translations. around applies to each side; a range keeps all its verses. Deterministic; the evidence field carries translation and content hashes. An unknown translation or language returns an error pointing to list_translations.',
    inputSchema: {
      reference: z.string().min(2).max(80).describe('One verse or a short range, not a whole chapter: "Jeremiah 29:11", "Romans 8:28-30".'),
      around: z.number().int().min(0).max(10).default(3).describe('Verses to read on each side, 0 to 10 (default 3).'),
      translation: translationInput,
      language: languageInput,
    },
    outputSchema: out({
      ref: z.string().describe('Normalised reference of the passage asked for.'),
      passage: passageShape.describe('The passage itself: ref, verbatim text, and verses.'),
      before: passageShape.nullable().describe('The verses just before, or null at the start of the book.'),
      after: passageShape.nullable().describe('The verses just after, or null at the end of the book.'),
      around: z.number().describe('Verses read on each side.'),
      read_more: z.string().describe('Web page for the passage.'),
      content_layers: z.record(z.string(), z.unknown()).describe('Marks which fields are Scripture.'),
    }),
    annotations: READS,
  }, async ({ reference, around, translation, language }) => {
    if (translation || language) {
      const chosen = pick(translation, language);
      if (!isPick(chosen)) return chosen;
      if (chosen.t) return shelfContext(env, chosen.t, reference, around ?? 3);
    }
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
    description: `Find every verse in the stored King James Version (${CORPUS.verses} verses) containing all the given words, or an exact phrase in double quotes, in canonical order and paged, optionally within one book or testament. translation or language (ids from list_translations) searches that stored Bible in its own words instead (for example "paz" in the Reina-Valera), with a parallel translation beside each verse found. A literal text match, not a search by meaning: the chosen wording applies, so modern words may be missing from the KJV (try "charity" as well as "love"). Use for "where does the Bible say 'be still'" or "verses with mercy in Psalms". For verses on a feeling use verses_for; for a topic explained use what_the_bible_says_about; for a known reference use scripture_passage. Up to 6 words of 2+ letters are used. No match returns count 0; total_matches may be capped (capped true). An unknown translation or language returns an error pointing to list_translations.`,
    inputSchema: {
      query: z.string().min(2).max(80).describe('Words that must all appear ("mercy truth"), or an exact phrase in double quotes ("\\"be still\\""). Case-insensitive.'),
      book: z.string().max(40).optional().describe('Optional single book, full name or common abbreviation: "Psalms", "John", "1 Cor".'),
      testament: z.enum(['old', 'new']).optional().describe('Optional: "old" or "new" to search one testament.'),
      whole_words: z.boolean().default(true).describe('true (default): whole words only, so "love" does not match "loved". false: match inside words.'),
      limit: z.number().int().min(1).max(20).default(10).describe('Page size, 1 to 20 (default 10).'),
      cursor: cursorInput,
      translation: translationInput,
      language: languageInput,
      parallel: z.string().min(2).max(24).optional().describe('Optional translation id read beside each verse found, e.g. "kjv" or "bsb". Default for a search in another language: kjv.'),
    },
    outputSchema: out({
      query: z.string().describe('The query as run.'),
      scope: z.string().describe('What was searched: the whole Bible, a testament, or a book.'),
      total_matches: z.number().describe('All matching verses found (see capped).'),
      capped: z.boolean().describe('True when matching stopped at the internal ceiling, so total_matches is a lower bound.'),
      count: z.number().describe('Verses on this page.'),
      results: z.array(z.looseObject({ ref: z.string(), text: z.string(), read_more: z.string() })).describe('Matching verses in canonical order: reference, verbatim text in the chosen translation (KJV by default), web link; a search in another translation adds the parallel verse.'),
      next_cursor: z.string().nullable().describe('Pass back as cursor for the next page; null when there is none.'),
      content_layers: z.record(z.string(), z.unknown()).describe('Marks which fields are Scripture.'),
    }),
    annotations: READS,
  }, async ({ query, book, testament, whole_words, limit, cursor, translation, language, parallel }) => {
    if (translation || language) {
      const chosen = pick(translation, language);
      if (!isPick(chosen)) return chosen;
      if (chosen.t) return shelfSearch(env, chosen.t, { query, book, testament, whole_words, limit: limit ?? 10, cursor, parallel });
    }
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
    description: 'List the passages elsewhere in the Bible most often linked to one verse, from the OpenBible.info cross-reference dataset (CC BY, stored locally), ranked by reader votes, strongest first, each read verbatim from the stored KJV, or from the stored Bible chosen by translation or language (ids from list_translations). Use to follow a thread through Scripture ("verses related to Romans 8:28"). For the verses around a verse use scripture_context; for verses on a feeling use verses_for; for words in the text use scripture_search; for one verse in several Bibles use compare_translations. Which passages are linked is a human judgement, labelled as such in content_layers. For a range in reference only its first verse is looked up; include_text false returns references and votes only (faster). A verse with no links returns count 0; a linked passage the chosen translation does not hold has text null.',
    inputSchema: {
      reference: z.string().min(2).max(80).describe('One verse: "Romans 8:28". For a range, its first verse is used; a whole chapter is an error.'),
      limit: z.number().int().min(1).max(12).default(6).describe('Maximum linked passages, 1 to 12 (default 6).'),
      include_text: z.boolean().default(true).describe('true (default): read each linked passage verbatim (up to 4 verses each, shortened flag set when cut). false: references and votes only.'),
      translation: translationInput,
      language: languageInput,
    },
    outputSchema: out({
      ref: z.string().describe('The verse looked up.'),
      count: z.number().describe('Linked passages returned; 0 when the verse has none.'),
      references: z.array(z.looseObject({ ref: z.string(), votes: z.number(), text: z.string().nullable(), shortened: z.boolean(), read_more: z.string() })).describe('Strongest first: reference, reader votes, verbatim text in the chosen translation, KJV by default (null when include_text is false or the translation lacks it), whether the text was shortened to 4 verses, and web link.'),
      source: z.string().describe('The cross-reference dataset.'),
      license: z.string().describe('The dataset\'s license.'),
      content_layers: z.record(z.string(), z.unknown()).describe('Marks Scripture fields and the human judgement of which passages link.'),
    }),
    annotations: READS,
  }, async ({ reference, limit, include_text, translation, language }) => {
    const chosen = translation || language ? pick(translation, language) : null;
    if (chosen && !isPick(chosen)) return chosen;
    const shelfT = chosen && isPick(chosen) ? chosen.t : null;
    const readText = async (pr: ParsedReference): Promise<string | null> => {
      if (!shelfT) return (await kjvPassage(env, pr))?.text ?? null;
      const got = await readAny(env, { kind: 'shelf', t: shelfT }, { bookId: pr.bookId, chapter: pr.chapter, from: pr.from, to: pr.to });
      return isAny(got) ? got.text : null;
    };
    const p = parseReference(reference);
    if (!p || p.from === undefined) return fail(paragraph([`"${reference}" is not one verse we can read with certainty`, 'Give a book, chapter and verse, like "Romans 8:28"']), { reason: 'unparsed_reference', try_instead: ['cross_references with "Romans 8:28"'] });
    const xr = await loadXrefs(env, p.bookId);
    if (xr === null) return fail('The cross references could not be read just now. Please try again in a moment.', { reason: 'unavailable', try_instead: [`${SITE}/bible-cross-references`] });
    noteCrossReferences();
    const source = CORPUS.cross_references.attribution;
    const selfP = parsed(p.bookId, p.chapter, p.from);
    const selfText = await readText(selfP);
    const self = selfText ? { ref: selfP.ref, text: selfText } : null;
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
      const text = include_text === false ? null : await readText(pr);
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
      translation: shelfT ? shelfT.id.toUpperCase() : 'KJV', door: doorFor(shelfT?.language ?? 'en', p.bookId, p.chapter, p.from),
      content_layers: layers({ scripture: ['references[].text'], interpretation: ['references[] (which verses are linked and their order: reader votes on OpenBible.info)'] }),
    });
  });
}

/* ---- the same three readings over a stored translation (src/translations.ts) ----------------- */
async function shelfContext(env: Env, t: ShelfTranslation, reference: string, around: number) {
  const r = parseLoose(reference);
  if (!r) return fail(paragraph([`"${reference}" is not a reference we can read with certainty`, 'Use a book, chapter and verse, like "Jeremiah 29:11"']), { reason: 'unparsed_reference', try_instead: ['scripture_context with "John 3:16"'] });
  if (r.from === undefined) return fail(`${refString(r.bookId, r.chapter)} is a whole chapter, which is already its own context. Use scripture_passage for a chapter.`, { reason: 'chapter_not_verse', try_instead: [`scripture_passage with "${refString(r.bookId, r.chapter)}"`] });
  const main = await readAny(env, { kind: 'shelf', t }, r);
  if (!isAny(main)) return fail(main.message, { reason: main.reason, try_instead: ['list_translations', 'scripture_context without translation'] });
  // the context is read in the translation's own numbering, around the verses just read
  const first = main.verses[0];
  const last = main.verses[main.verses.length - 1];
  const book = await loadTBook(env, t, r.bookId);
  if (!book) return fail('The stored text could not be read just now. Please try again in a moment.', { reason: 'unavailable' });
  const collect = (ch: number, from: number, to: number) => {
    const out: { chapter: number; verse: number; text: string }[] = [];
    const row = book.c[ch - 1] ?? [];
    for (let v = Math.max(1, from); v <= Math.min(to, row.length); v++) {
      const x = row[v - 1];
      if (typeof x === 'string' && x.trim()) out.push({ chapter: ch, verse: v, text: x.trim() });
    }
    return out;
  };
  const fc = first.chapter ?? r.chapter;
  const lc = last.chapter ?? r.chapter;
  let before = collect(fc, first.verse - around, first.verse - 1);
  if (before.length < around && fc > 1) {
    const prevLen = book.c[fc - 2]?.length ?? 0;
    before = [...collect(fc - 1, prevLen - (around - before.length) + 1, prevLen), ...before];
  }
  let after = collect(lc, last.verse + 1, last.verse + around);
  if (after.length < around && book.c[lc]) after = [...after, ...collect(lc + 1, 1, around - after.length)];
  const shape = (vs: { chapter: number; verse: number; text: string }[]) => {
    if (!vs.length) return null;
    for (const v of vs) noteReading({ ref: refString(r.bookId, v.chapter, v.verse, undefined, book.n), translation: t.id.toUpperCase(), text: v.text, book: r.bookId, book_sha256: book.sha256, corpus: t.id });
    const a = vs[0];
    const b = vs[vs.length - 1];
    const ref = a.chapter === b.chapter ? refString(r.bookId, a.chapter, a.verse, b.verse, book.n) : `${refString(r.bookId, a.chapter, a.verse, undefined, book.n)} to ${b.chapter}:${b.verse}`;
    return { ref, text: vs.map((v) => v.text).join(' '), verses: vs.map((v) => ({ verse: v.verse, text: v.text, chapter: v.chapter })) };
  };
  const B = around > 0 ? shape(before) : null;
  const A = around > 0 ? shape(after) : null;
  const passageRef = main.own_ref ?? main.ref;
  return ok(paragraph([
    B ? `Before (${B.ref}): "${B.text}"` : 'Nothing comes before it in this book',
    `The passage (${passageRef}, ${t.name}): "${main.text}"`,
    A ? `After (${A.ref}): "${A.text}"` : 'Nothing comes after it in this book',
    ...notesOf(main),
    `Keep reading: ${main.door}`,
  ]), {
    ref: main.ref, own_ref: main.own_ref, translation: t.id.toUpperCase(), translation_name: t.name, passage: { ref: passageRef, text: main.text, verses: main.verses }, before: B, after: A, around, read_more: main.door, door: main.door,
    ...(main.numbering_note ? { numbering_note: main.numbering_note } : {}),
    content_layers: layers({ scripture: ['passage', 'before', 'after'] }),
  });
}

async function shelfSearch(env: Env, t: ShelfTranslation, o: { query: string; book?: string; testament?: 'old' | 'new'; whole_words?: boolean; limit: number; cursor?: string; parallel?: string }) {
  const raw = o.query.trim();
  const phrase = /^".+"$/.test(raw);
  const terms = (phrase ? [raw.slice(1, -1)] : raw.split(/\s+/)).map((x) => fold(x).replace(/[^\p{L}\p{N}' ]+/gu, '').trim()).filter((x) => x.length >= (spacelessScript(x) ? 1 : 2)).slice(0, 6);
  if (!terms.length) return fail('Give at least one word of two letters or more.', { reason: 'empty_query', try_instead: ['scripture_search with "paz" and translation "rv1909"'] });
  let books = heldBooks(t);
  let scope = `the whole of ${t.name}`;
  if (o.book) {
    const r = parseLoose(`${o.book} 1`);
    if (!r || !t.books[r.bookId]) return fail(`"${o.book}" is not a book ${t.name} holds.`, { reason: 'unknown_book', try_instead: ['a book name like "Psalms" or "John"'] });
    books = [r.bookId];
    scope = `${t.books[r.bookId][2]} (${t.name})`;
  } else if (o.testament) {
    books = books.filter((b) => (o.testament === 'old' ? OT_IDS.has(b) : !OT_IDS.has(b) && BOOKS.some((x) => x.id === b)));
    scope = `the ${o.testament === 'old' ? 'Old' : 'New'} Testament of ${t.name}`;
  }
  const whole = o.whole_words !== false && !terms.some(spacelessScript);
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const res = terms.map((x) => new RegExp(whole ? `(?<![\\p{L}\\p{N}])${esc(x)}(?![\\p{L}\\p{N}])` : esc(x), 'u'));
  const CAP = 2000;
  const hits: { bookId: string; name: string; chapter: number; verse: number; text: string; sha: string }[] = [];
  let capped = false;
  for (const b of books) {
    const data = await loadTBook(env, t, b);
    if (!data) return fail('The stored text could not be read just now. Please try again in a moment.', { reason: 'unavailable' });
    for (let c = 0; c < data.c.length && !capped; c++) {
      const ch = data.c[c];
      for (let v = 0; v < ch.length; v++) {
        const x = ch[v];
        if (typeof x === 'string' && x && res.every((re) => re.test(fold(x)))) {
          if (hits.length >= CAP) { capped = true; break; }
          hits.push({ bookId: b, name: data.n, chapter: c + 1, verse: v + 1, text: x.trim(), sha: data.sha256 });
        }
      }
    }
    if (capped) break;
  }
  const parallelId = (o.parallel ?? (t.language.startsWith('en') ? '' : 'kjv')).toLowerCase();
  const par = parallelId ? pick(parallelId) : null;
  if (par && !isPick(par)) return par;
  const salt = `${t.id}|${terms.join(' ')}|${scope}|${whole}|${parallelId}`;
  const pg = page(hits, o.cursor, o.limit, salt);
  const results: Record<string, unknown>[] = [];
  for (const h of pg.items) {
    const own = refString(h.bookId, h.chapter, h.verse, undefined, h.name);
    noteReading({ ref: own, translation: t.id.toUpperCase(), text: h.text, book: h.bookId, book_sha256: h.sha, corpus: t.id });
    const [sb, sc, sv] = await toStandard(env, t, h.bookId, h.chapter, h.verse);
    const standard = refString(sb, sc, sv);
    let parallelRow: Record<string, unknown> | null = null;
    if (par && isPick(par)) {
      const got = await readAny(env, par.choice, { bookId: sb, chapter: sc, from: sv });
      parallelRow = isAny(got) ? { translation: got.translation, ref: got.own_ref ?? got.ref, text: got.text } : { translation: par.t ? par.t.id.toUpperCase() : 'KJV', text: null, missing: got.message };
    }
    results.push({ ref: own, standard_ref: standard, text: h.text, read_more: doorFor(t.language, sb, sc, sv), ...(parallelRow ? { parallel: parallelRow } : {}) });
  }
  const label = phrase ? `the phrase "${terms[0]}"` : terms.map((x) => `"${x}"`).join(' and ');
  if (!hits.length) {
    return ok(paragraph([`No verse in ${scope} contains ${label}${whole ? ' as whole words' : ''}`, 'Try another form of the word, or whole_words false', 'ask_living_bread or verses_for can find Scripture by meaning']), {
      query: raw, scope, translation: t.id.toUpperCase(), total_matches: 0, capped: false, count: 0, results: [], next_cursor: null, empty: true,
      content_layers: layers({ scripture: ['results[].text', 'results[].parallel.text'] }),
    });
  }
  const line = (x: Record<string, unknown>) => {
    const pr = x.parallel as { translation?: string; ref?: string; text?: string | null } | undefined;
    return `${x.ref} "${x.text}"${pr?.text ? ` (${pr.translation} ${pr.ref ?? x.standard_ref}: "${pr.text}")` : ''}`;
  };
  return ok(paragraph([
    `${capped ? `More than ${CAP}` : hits.length} ${hits.length === 1 ? 'verse' : 'verses'} in ${scope} contain ${label}; showing ${pg.offset + 1} to ${pg.offset + results.length}`,
    list(results.map(line), results.length),
    pg.next_cursor ? 'More are held: call again with next_cursor' : null,
  ]), {
    query: raw, scope, translation: t.id.toUpperCase(), translation_name: t.name, total_matches: hits.length, capped, count: results.length, results, next_cursor: pg.next_cursor,
    content_layers: layers({ scripture: ['results[].text', 'results[].parallel.text'] }),
  });
}
