/* ============================================================
   THE LIVING BREAD MCP, the shelf of Bibles.

   Every stored translation beside the King James Version: modern English
   (BSB, WEB, ASV, YLT), the traditions (the Douay-Rheims with the
   deuterocanonical books, Brenton's English Septuagint), about fifty other
   languages, and the original Hebrew and Greek texts. Each one is public
   domain or under a license that permits redistribution, and its statement
   is copied verbatim into src/data/translations.json by
   scripts/build-translations.py, which also wrote the books:

     assets/bible/shelf/t/<id>/<book>.json   { n, c }   c[chapter][verse]:
         a string is the verse; "" means this translation joins the verse to
         the one before it; null means this translation has no such verse.
     assets/bible/shelf/vrs/<scheme>.json    the versification maps.

   A reference is read in the standard (King James) numbering and mapped to
   the translation's own numbering (Psalm 23 is Psalm 22 in the Douay-Rheims).
   When a verse does not exist in a translation the answer says so; nothing is
   ever substituted. Every read notes itself for the evidence label with the
   translation's license and the SHA-256 of the bytes read.
   ============================================================ */
import manifest from './data/translations.json';
import { noteReading, sha256Hex } from './evidence';
import { loadBook } from './kjv';
import { BOOKS, parseReference, type ParsedReference } from './scripture';
import { SITE } from './doors';

export interface ShelfTranslation {
  id: string; name: string; language: string; language_name: string; direction: string;
  license: string; license_kind: string; license_statement: string; license_source: string; source: string;
  canon: string; canon_coverage: string; versification: string; corpus_version: string; verses: number;
  /** Books whose numbering follows another scheme than the translation's main one (e.g. Psalms by the Hebrew numbering). */
  versification_books?: Record<string, string>;
  /** book id to [chapters, sha256, name in this translation] */
  books: Record<string, [number, string, string]>;
  note?: string; attribution?: string; books_not_held?: string[];
}

interface Manifest {
  kjv: { id: string; name: string; language: string; language_name: string; license: string; license_statement: string; canon: string; canon_coverage: string; versification: string; corpus_version: string; verses: number };
  translations: ShelfTranslation[];
  language_default: Record<string, string>;
  books: [string, string, string][];
  excluded: { name: string; reason: string }[];
  doors: Record<string, string>;
  versification: { source: string; license: string; rule: string };
  original: { lexicon: string; lexicon_entries: number; kjv_alignment: string; hebrew: string; greek: string };
  assets: { files: number; bytes: number };
}

export const SHELF = manifest as unknown as Manifest;
const BY_ID = new Map<string, ShelfTranslation>(SHELF.translations.map((t) => [t.id, t]));
export const BOOK_NAME = new Map<string, string>(SHELF.books.map(([id, name]) => [id, name]));
const BOOK_ORDER = SHELF.books.map(([id]) => id);
const KJV_IDS = new Set(BOOKS.map((b) => b.id));
export const OT_IDS = new Set(BOOKS.slice(0, 39).map((b) => b.id));

/** The KJV, described in the same shape as every other translation (its books are the app's own). */
export const KJV_ENTRY = {
  ...SHELF.kjv, direction: 'ltr', license_kind: 'public-domain', license_source: 'assets/bible/books', source: 'assets/bible/books (the text the Living Bread app ships)',
};

export type Choice = { kind: 'kjv' } | { kind: 'shelf'; t: ShelfTranslation };

export function translationCount(): number {
  return SHELF.translations.length + 1;
}

/* ---- choosing a translation ------------------------------------------------------------------- */
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/_/g, '-');
}

const LEGACY: Record<string, string> = { 'douay-rheims': 'dra', drb: 'dra', 'douay': 'dra', 'reina-valera': 'rv1909', rvr1909: 'rv1909', 'louis-segond': 'lsg', segond: 'lsg', luther: 'luther1912', lut: 'luther1912', 'union': 'cuv', cuvs: 'cuv', 'cuv-s': 'cuv', 'cuv-t': 'cuvt', vulgata: 'vulgate', vul: 'vulgate', lxx: 'brenton', septuagint: 'brenton', hebrew: 'wlc', greek: 'byz', rp: 'byz', 'web-c': 'web', berean: 'bsb' };

export interface Resolved { choice: Choice; id: string; why: string }

/**
 * Pick the translation: an explicit id wins; otherwise the language hint picks the best stored
 * translation for that language; otherwise the King James Version. Null when the id is unknown or
 * the language has nothing stored (the caller says so and lists what is held).
 */
export function resolveTranslation(translation?: string | null, language?: string | null): Resolved | { error: string; reason: string } {
  if (translation && translation.trim()) {
    let id = norm(translation);
    id = LEGACY[id] ?? id;
    if (id === 'kjv' || id === 'av' || id === 'kjv1769') return { choice: { kind: 'kjv' }, id: 'kjv', why: 'asked for by id' };
    const t = BY_ID.get(id);
    if (t) return { choice: { kind: 'shelf', t }, id, why: 'asked for by id' };
    return { error: `"${translation}" is not a translation held here. list_translations shows every one, with its license.`, reason: 'unknown_translation' };
  }
  if (language && language.trim()) {
    const tag = norm(language);
    const parts = tag.split('-');
    const tries = [tag, parts.slice(0, 2).join('-'), parts[0]];
    for (const k of tries) {
      const id = SHELF.language_default[k];
      if (id === 'kjv') return { choice: { kind: 'kjv' }, id: 'kjv', why: `the default for language ${language}` };
      const t = id ? BY_ID.get(id) : undefined;
      if (t) return { choice: { kind: 'shelf', t }, id: t.id, why: `the default stored translation for language ${language}` };
    }
    const any = SHELF.translations.find((t) => norm(t.language).split('-')[0] === parts[0]);
    if (any) return { choice: { kind: 'shelf', t: any }, id: any.id, why: `the stored translation for language ${language}` };
    return { error: `No public domain or freely licensed Bible in the language "${language}" is held here yet. list_translations shows the languages held.`, reason: 'language_not_held' };
  }
  return { choice: { kind: 'kjv' }, id: 'kjv', why: 'the default' };
}

export function describe(c: Choice) {
  if (c.kind === 'kjv') return { id: 'kjv', code: 'KJV', name: KJV_ENTRY.name, language: 'en', language_name: 'English', license: KJV_ENTRY.license, canon_coverage: KJV_ENTRY.canon_coverage, direction: 'ltr' };
  const t = c.t;
  return { id: t.id, code: t.id.toUpperCase(), name: t.name, language: t.language, language_name: t.language_name, license: t.license, canon_coverage: t.canon_coverage, direction: t.direction };
}

export function shelfById(id: string): ShelfTranslation | undefined {
  return BY_ID.get(id);
}

/* ---- references in any held book, in many languages ------------------------------------------ */
const EXTRA_ALIASES: Record<string, string[]> = {
  tobit: ['tob', 'tb', 'tobias'], judith: ['jdt', 'jdth', 'jud ith'], esthergreek: ['estg', 'esthergr', 'greekesther', 'addesth', 'additionstoesther'],
  wisdom: ['wis', 'ws', 'wisdomofsolomon', 'sap', 'sapientia', 'bookofwisdom'], sirach: ['sir', 'ecclesiasticus', 'ecclus', 'bensira', 'siracide'],
  baruch: ['bar'], letterofjeremiah: ['lje', 'epjer', 'epistleofjeremiah', 'letterofjeremy'], songofthethree: ['s3y', 'prayerofazariah', 'azariah', 'songofthethreeyoungmen', 'songofthreeyouths'],
  susanna: ['sus'], belandthedragon: ['bel', 'belanddragon'], '1maccabees': ['1macc', '1mac', '1ma', '1mc'], '2maccabees': ['2macc', '2mac', '2ma', '2mc'],
  '3maccabees': ['3macc', '3mac', '3ma'], '4maccabees': ['4macc', '4mac', '4ma'], '1esdras': ['1esd', '1es'], '2esdras': ['2esd', '2es'],
  prayerofmanasseh: ['prman', 'manasseh', 'prayerofmanasses', 'man'], psalm151: ['ps151', 'psalm151', 'psalms151'], danielgreek: ['dag', 'greekdaniel', 'danielgr'],
};

function squash(s: string): string {
  return s.toLowerCase().normalize('NFKC').replace(/[\s.·'’]+/g, '');
}
function normalizeBook(raw: string): string {
  let s = raw.trim().toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ');
  s = s.replace(/^(first|1st)\s+/, '1 ').replace(/^(second|2nd)\s+/, '2 ').replace(/^(third|3rd)\s+/, '3 ').replace(/^(fourth|4th)\s+/, '4 ')
    .replace(/^iv\s+/, '4 ').replace(/^iii\s+/, '3 ').replace(/^ii\s+/, '2 ').replace(/^i\s+/, '1 ');
  return squash(s);
}

const ALIAS = new Map<string, string>();
(() => {
  for (const [id, name] of SHELF.books) { ALIAS.set(squash(name), id); ALIAS.set(id, id); }
  for (const [id, al] of Object.entries(EXTRA_ALIASES)) for (const a of al) ALIAS.set(squash(a), id);
  // every book name a held translation uses, in its own language ("Juan", "Jean", "约翰福音", "Yohana"),
  // kept only when no two books share the name
  const seen = new Map<string, Set<string>>();
  for (const t of SHELF.translations) for (const [id, v] of Object.entries(t.books)) {
    const k = squash(v[2] ?? '');
    if (k.length < 2 || /^\d+$/.test(k)) continue;
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k)!.add(id);
  }
  for (const [k, ids] of seen) if (ids.size === 1 && !ALIAS.has(k)) ALIAS.set(k, [...ids][0]);
})();

export interface LooseRef { bookId: string; chapter: number; from?: number; to?: number }

/** Any reference in any held book, in English or in a held translation's own book names; chapter bounds are checked later. */
export function parseLoose(input: string): LooseRef | null {
  if (typeof input !== 'string') return null;
  const s = input.replace(/[\u2013\u2014\u2012\u2212]/g, '-').replace(/\s*([:.,])\s*/g, '$1').replace(/\s*-\s*/g, '-').trim();
  const m = s.match(/^(.*?[\p{L}\p{M}][\p{L}\p{M}.]*)\s*(\d{1,3})(?:[:.,](\d{1,3})(?:-(\d{1,3}))?)?$/u);
  if (!m) return null;
  const bookId = ALIAS.get(normalizeBook(m[1])) ?? ALIAS.get(squash(m[1]));
  if (!bookId) return null;
  const chapter = parseInt(m[2], 10);
  const from = m[3] ? parseInt(m[3], 10) : undefined;
  let to = m[4] ? parseInt(m[4], 10) : undefined;
  if (!(chapter >= 1) || (from !== undefined && from < 1)) return null;
  if (to !== undefined && from !== undefined && to <= from) to = undefined;
  return { bookId, chapter, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
}

export function bookName(id: string): string {
  return BOOK_NAME.get(id) ?? id;
}

export function refString(bookId: string, chapter: number, from?: number, to?: number, name?: string): string {
  const base = `${name ?? bookName(bookId)} ${chapter}`;
  if (from === undefined) return base;
  return to === undefined || to === from ? `${base}:${from}` : `${base}:${from}-${to}`;
}

/** The ParsedReference shape the KJV code uses, when the reference is a KJV book. */
export function asParsed(r: LooseRef): ParsedReference | null {
  if (!KJV_IDS.has(r.bookId)) return null;
  return parseReference(refString(r.bookId, r.chapter, r.from, r.to));
}

/* ---- reading the books ------------------------------------------------------------------------ */
export interface TBook { n: string; c: (string | null)[][]; sha256: string }
const tcache = new Map<string, Promise<TBook | null>>();

export function loadTBook(env: Env, t: ShelfTranslation, bookId: string): Promise<TBook | null> {
  if (!t.books[bookId]) return Promise.resolve(null);
  const key = `${t.id}/${bookId}`;
  const hit = tcache.get(key);
  if (hit) return hit;
  const p = (async () => {
    try {
      const res = await env.ASSETS.fetch(new Request(`https://assets.living-bread.org/shelf/t/${t.id}/${bookId}.json`));
      if (!res.ok) return null;
      const raw = await res.arrayBuffer();
      const data = JSON.parse(new TextDecoder().decode(raw)) as TBook;
      if (!Array.isArray(data?.c)) return null;
      data.sha256 = await sha256Hex(raw);
      return data;
    } catch {
      return null;
    }
  })();
  tcache.set(key, p);
  p.then((v) => { if (!v) tcache.delete(key); });
  return p;
}

type Vrs = { to: Record<string, string>; from: Record<string, string> };
const vcache = new Map<string, Promise<Vrs | null>>();
export function loadScheme(env: Env, scheme: string): Promise<Vrs | null> {
  if (scheme === 'eng') return Promise.resolve({ to: {}, from: {} });
  const hit = vcache.get(scheme);
  if (hit) return hit;
  const p = (async () => {
    try {
      const res = await env.ASSETS.fetch(new Request(`https://assets.living-bread.org/shelf/vrs/${scheme}.json`));
      return res.ok ? ((await res.json()) as Vrs) : null;
    } catch {
      return null;
    }
  })();
  vcache.set(scheme, p);
  p.then((v) => { if (!v) vcache.delete(scheme); });
  return p;
}

function splitKey(k: string): [string, number, number] {
  const [b, c, v] = k.split('.');
  return [b, Number(c), Number(v)];
}

/** A standard (KJV numbered) verse to the translation's own numbering. */
function schemeOf(t: ShelfTranslation, bookId: string): string {
  return t.versification_books?.[bookId] ?? t.versification;
}

export async function toOwn(env: Env, t: ShelfTranslation, bookId: string, chapter: number, verse: number): Promise<[string, number, number]> {
  const s = await loadScheme(env, schemeOf(t, bookId));
  const k = s?.to?.[`${bookId}.${chapter}.${verse}`];
  return k ? splitKey(k) : [bookId, chapter, verse];
}

/** A verse in the translation's own numbering back to the standard (KJV) numbering. */
export async function toStandard(env: Env, t: ShelfTranslation, bookId: string, chapter: number, verse: number): Promise<[string, number, number]> {
  const s = await loadScheme(env, schemeOf(t, bookId));
  const k = s?.from?.[`${bookId}.${chapter}.${verse}`];
  return k ? splitKey(k) : [bookId, chapter, verse];
}

export interface TVerse { verse: number; chapter: number; book: string; text: string; standard?: string }

export interface TPassage {
  translation: string;
  /** The reference as asked, in the standard numbering. */
  ref: string;
  /** The same words in this translation's own numbering, when it differs. */
  own_ref: string;
  book: string;
  chapter: number;
  verses: TVerse[];
  text: string;
  /** Verses this translation does not have, said plainly. */
  missing: string[];
  /** Verses this translation joins to another. */
  joined: string[];
  numbering_note?: string;
  door: string;
}

function joinTexts(vs: { text: string }[]): string {
  return vs.map((v) => v.text).join(' ').replace(/[,;:]\s*$/, '');
}

async function kjvChapterLength(env: Env, bookId: string, chapter: number): Promise<number> {
  const b = await loadBook(env, bookId);
  return b?.c?.[chapter - 1]?.length ?? 0;
}

/** The door for a translation and a verse: the reader for English, the house in that language otherwise; only pages that answered 200 at build. */
export function doorFor(language: string, bookId?: string, chapter?: number, verse?: number): string {
  const l = language.split('-')[0].toLowerCase();
  if (l === 'en' || l === 'hbo' || l === 'grc') {
    return bookId && KJV_IDS.has(bookId) && chapter ? `${SITE}/bible?open=${bookId}.${chapter}${verse ? `.${verse}` : ''}` : SHELF.doors.en ?? `${SITE}/bible`;
  }
  return SHELF.doors[l] ?? (bookId && KJV_IDS.has(bookId) && chapter ? `${SITE}/bible?open=${bookId}.${chapter}${verse ? `.${verse}` : ''}` : `${SITE}/bible`);
}

/**
 * Read a reference from a stored translation. The reference is read in the standard numbering when it
 * exists there, and mapped; a reference that only exists in the translation's own numbering (Daniel 13
 * in the Douay-Rheims) is read as given. Returns a reason instead of words when nothing is held.
 */
export async function readShelf(env: Env, t: ShelfTranslation, r: LooseRef): Promise<TPassage | { reason: string; message: string }> {
  const meta = t.books[r.bookId];
  const asked = refString(r.bookId, r.chapter, r.from, r.to);
  if (!meta) {
    return { reason: 'book_not_in_translation', message: `${t.name} does not hold the book of ${bookName(r.bookId)}. ${t.canon_coverage}` };
  }
  const kjvLen = KJV_IDS.has(r.bookId) ? await kjvChapterLength(env, r.bookId, r.chapter) : 0;
  const standard = kjvLen > 0 && (r.from === undefined || r.from <= kjvLen);
  const wanted: [number, number][] = [];
  if (standard) {
    const end = r.from === undefined ? kjvLen : Math.min(r.to ?? r.from, kjvLen);
    for (let v = r.from ?? 1; v <= end; v++) wanted.push([r.chapter, v]);
  } else {
    const book = await loadTBook(env, t, r.bookId);
    if (!book) return { reason: 'unavailable', message: 'The stored text could not be read just now. Please try again in a moment.' };
    const ch = book.c[r.chapter - 1];
    if (!ch) return { reason: 'chapter_out_of_range', message: `${t.name} has ${book.c.length} chapters in ${book.n}, so ${asked} is not held.` };
    const end = r.from === undefined ? ch.length : Math.min(r.to ?? r.from, ch.length);
    for (let v = r.from ?? 1; v <= end; v++) wanted.push([r.chapter, v]);
    if (!wanted.length) return { reason: 'verse_out_of_range', message: `${book.n} ${r.chapter} has ${ch.length} verses in ${t.name}, so ${asked} is not held.` };
  }
  const verses: TVerse[] = [];
  const missing: string[] = [];
  const joined: string[] = [];
  const seen = new Set<string>();
  let anyMapped = false;
  let bookRead: TBook | null = null;
  for (const [c, v] of wanted) {
    const [ob, oc, ov] = standard ? await toOwn(env, t, r.bookId, c, v) : [r.bookId, c, v];
    if (ob !== r.bookId || oc !== c || ov !== v) anyMapped = true;
    const book = await loadTBook(env, t, ob);
    if (!book) { missing.push(refString(r.bookId, c, v)); continue; }
    bookRead = book;
    const row = book.c[oc - 1];
    let text = row?.[ov - 1];
    let at = ov;
    if (text === '') {
      // joined to an earlier verse in this translation: read that verse once, and say so
      let back = ov - 1;
      while (back >= 1 && row?.[back - 1] === '') back--;
      text = row?.[back - 1] ?? null;
      at = back;
      joined.push(`${refString(r.bookId, c, v)} is joined with verse ${back} in this translation`);
    }
    if (typeof text !== 'string' || !text.trim()) { missing.push(refString(r.bookId, c, v)); continue; }
    const key = `${ob}.${oc}.${at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    verses.push({ verse: at, chapter: oc, book: ob, text: text.trim(), ...(standard && (ob !== r.bookId || oc !== c || at !== v) ? { standard: refString(r.bookId, c, v) } : {}) });
    noteReading({ ref: refString(ob, oc, at, undefined, book.n), translation: t.id.toUpperCase(), text: text.trim(), book: ob, book_sha256: book.sha256, corpus: t.id });
  }
  if (!verses.length) {
    return { reason: 'verse_not_in_translation', message: `${asked} is not in ${t.name}${missing.length ? '' : ''}. This translation has no such verse, and nothing is put in its place.` };
  }
  const first = verses[0];
  const last = verses[verses.length - 1];
  const name = bookRead?.n ?? bookName(first.book);
  const own = first.book === last.book && first.chapter === last.chapter
    ? refString(first.book, first.chapter, r.from === undefined && !anyMapped ? undefined : first.verse, r.from === undefined && !anyMapped ? undefined : last.verse !== first.verse ? last.verse : undefined, name)
    : `${refString(first.book, first.chapter, first.verse, undefined, name)} to ${refString(last.book, last.chapter, last.verse)}`;
  const text = joinTexts(verses);
  return {
    translation: t.id, ref: asked, own_ref: own, book: bookName(r.bookId), chapter: r.chapter, verses, text, missing, joined,
    ...(anyMapped ? { numbering_note: `${asked} in the standard (King James) numbering is numbered ${first.book === last.book && first.chapter === last.chapter ? refString(first.book, first.chapter, first.verse, last.verse) : `${refString(first.book, first.chapter, first.verse)} to ${refString(last.book, last.chapter, last.verse)}`} in ${t.name}` } : {}),
    door: standard ? doorFor(t.language, r.bookId, r.chapter, r.from) : doorFor(t.language),
  };
}

export function isPassage(x: TPassage | { reason: string; message: string }): x is TPassage {
  return (x as TPassage).verses !== undefined;
}

/** The books a translation holds, in canonical order. */
export function heldBooks(t: ShelfTranslation): string[] {
  return BOOK_ORDER.filter((b) => t.books[b]);
}

/** Search-folding: case, and the marks (accents, Hebrew points, Greek breathings) set aside. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().normalize('NFC');
}

/** Scripts written without spaces between words, where a whole-word match means nothing. */
export function spacelessScript(s: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Myanmar}\p{Script=Khmer}\p{Script=Lao}]/u.test(s);
}

/** The short public facts about a translation, as every answer carries them. */
export function facts(t: ShelfTranslation | null) {
  if (!t) return { id: 'kjv', name: KJV_ENTRY.name, language: 'en', license: KJV_ENTRY.license, canon_coverage: KJV_ENTRY.canon_coverage, corpus_version: KJV_ENTRY.corpus_version };
  return { id: t.id, name: t.name, language: t.language, license: t.license, canon_coverage: t.canon_coverage, corpus_version: t.corpus_version, ...(t.note ? { note: t.note } : {}) };
}
