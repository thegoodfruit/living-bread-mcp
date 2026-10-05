/* ============================================================
   THE LIVING BREAD MCP, the stored King James Version.

   The 66 book files are the app's own (assets/bible/books/<id>.json, shape
   { n: name, c: string[][] }), shipped as Workers Static Assets (the
   assets directory is assets/bible, so a book is /books/<id>.json and its
   cross-references /xref/<id>.json) and read here through the ASSETS
   binding, one book per request, cached in the isolate. Scripture is read
   from this stored text or not returned at all. Every read notes itself for
   the evidence label (src/evidence.ts), with the SHA-256 of the bytes read.
   ============================================================ */
import { noteReading, sha256Hex } from './evidence';
import { bookById, joinVerses, parseReference, selectVerses, type ParsedReference, type Verse } from './scripture';

export interface BookText {
  n: string;
  c: string[][];
  /** SHA-256 of the file exactly as the Worker read it (src/evidence.ts compares it to the manifest). */
  sha256?: string;
}

const cache = new Map<string, Promise<BookText | null>>();

export function loadBook(env: Env, bookId: string): Promise<BookText | null> {
  if (!bookById(bookId)) return Promise.resolve(null);
  const hit = cache.get(bookId);
  if (hit) return hit;
  const p = (async () => {
    try {
      const res = await env.ASSETS.fetch(new Request(`https://assets.living-bread.org/books/${bookId}.json`));
      if (!res.ok) return null;
      const raw = await res.arrayBuffer();
      const data = JSON.parse(new TextDecoder().decode(raw)) as BookText;
      if (!Array.isArray(data?.c)) return null;
      data.sha256 = await sha256Hex(raw);
      return data;
    } catch {
      return null;
    }
  })();
  cache.set(bookId, p);
  p.then((v) => {
    if (!v) cache.delete(bookId);
  });
  return p;
}

export interface Passage {
  ref: string;
  book: string;
  chapter: number;
  verses: Verse[];
  text: string;
}

/** The KJV words for a parsed reference, or null when the stored text cannot be read. */
export async function kjvPassage(env: Env, p: ParsedReference): Promise<Passage | null> {
  const book = await loadBook(env, p.bookId);
  const chapter = book?.c?.[p.chapter - 1];
  if (!chapter) return null;
  const verses = selectVerses(chapter, p.from, p.to);
  if (!verses.length) return null;
  const text = joinVerses(verses);
  noteReading({ ref: p.ref, translation: 'KJV', text, book: p.bookId, book_sha256: book?.sha256 });
  return { ref: p.ref, book: p.book, chapter: p.chapter, verses, text };
}

/** Convenience: a human reference string straight to its KJV passage. */
export async function kjvByRef(env: Env, ref: string): Promise<Passage | null> {
  const p = parseReference(ref);
  return p ? kjvPassage(env, p) : null;
}

/* ---- the cross-references (OpenBible.info, CC BY), split by book by scripts/build-corpus.py ----
   Shape: { "<chapter>.<verse>": [[ "<book>.<ch>.<v>", "<book>.<ch>.<v>" | null, votes ], ...] }. */
export type XrefTarget = [string, string | null, number];
const xcache = new Map<string, Promise<Record<string, XrefTarget[]> | null>>();

export function loadXrefs(env: Env, bookId: string): Promise<Record<string, XrefTarget[]> | null> {
  if (!bookById(bookId)) return Promise.resolve(null);
  const hit = xcache.get(bookId);
  if (hit) return hit;
  const p = (async () => {
    try {
      const res = await env.ASSETS.fetch(new Request(`https://assets.living-bread.org/xref/${bookId}.json`));
      if (!res.ok) return null;
      return (await res.json()) as Record<string, XrefTarget[]>;
    } catch {
      return null;
    }
  })();
  xcache.set(bookId, p);
  p.then((v) => {
    if (!v) xcache.delete(bookId);
  });
  return p;
}
