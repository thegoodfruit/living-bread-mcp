/* ============================================================
   THE LIVING BREAD MCP, the stored King James Version.

   The 66 book files are the app's own (assets/bible/books/<id>.json, shape
   { n: name, c: string[][] }), shipped as Workers Static Assets and read
   here through the ASSETS binding, one book per request, cached in the
   isolate. Scripture is read from this stored text or not returned at all.
   ============================================================ */
import { bookById, joinVerses, parseReference, selectVerses, type ParsedReference, type Verse } from './scripture';

export interface BookText {
  n: string;
  c: string[][];
}

const cache = new Map<string, Promise<BookText | null>>();

export function loadBook(env: Env, bookId: string): Promise<BookText | null> {
  if (!bookById(bookId)) return Promise.resolve(null);
  const hit = cache.get(bookId);
  if (hit) return hit;
  const p = (async () => {
    try {
      const res = await env.ASSETS.fetch(new Request(`https://assets.living-bread.org/${bookId}.json`));
      if (!res.ok) return null;
      const data = (await res.json()) as BookText;
      return Array.isArray(data?.c) ? data : null;
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
  return { ref: p.ref, book: p.book, chapter: p.chapter, verses, text: joinVerses(verses) };
}

/** Convenience: a human reference string straight to its KJV passage. */
export async function kjvByRef(env: Env, ref: string): Promise<Passage | null> {
  const p = parseReference(ref);
  return p ? kjvPassage(env, p) : null;
}
