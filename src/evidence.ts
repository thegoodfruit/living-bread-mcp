/* ============================================================
   THE LIVING BREAD MCP, the evidence label on every Scripture answer.

   Every tool that returns words of Scripture carries, in structuredContent,
   an `evidence` object that lets anyone check those words: the translation,
   the canon the corpus covers, the corpus version (a SHA-256 over the 66
   bundled book files, written by scripts/build-corpus.py), the attribution
   and license, when the words were read, and a SHA-256 of each passage as
   returned and of all of them together.

   How it reaches every tool without each tool remembering to add it: a
   tool call runs inside an AsyncLocalStorage context (see shared.ts); every
   read of the stored text (kjv.ts, webPassage) notes itself there; the tool
   wrapper attaches the label when the call is done. A tool that read no
   Scripture carries no label.

   The book's own hash is computed again from the bytes the Worker actually
   read, so a label can never claim a corpus version the text does not match.
   ============================================================ */
import { AsyncLocalStorage } from 'node:async_hooks';

import corpus from './data/corpus.json';
import shelf from './data/translations.json';

export const CORPUS = corpus as {
  translation: string; translation_name: string; license: string; canon: string; books: number; verses: number;
  corpus_version: string; corpus_sha256: string; source: string;
  book_files: Record<string, { sha256: string; chapters: number; verses: number }>;
  cross_references: { source: string; license: string; attribution: string; url: string; source_sha256: string; links_kept: number; rule: string; verses_with_links: number };
};

export interface Reading {
  ref: string;
  /** 'KJV', 'WEB' (the old cache) or the upper-case id of a translation on the shelf (src/translations.ts). */
  translation: string;
  text: string;
  /** The SHA-256 of the book file as the Worker read it. */
  book_sha256?: string;
  book?: string;
  /** The shelf id when the words came from assets/bible/shelf (src/translations.ts). */
  corpus?: string;
}

export interface CallContext {
  readings: Reading[];
  crossRefs: boolean;
}

export const callStore = new AsyncLocalStorage<CallContext>();

/** Note one passage that was read for the current tool call. Outside a call it does nothing. */
export function noteReading(r: Reading): void {
  const ctx = callStore.getStore();
  if (ctx && ctx.readings.length < 200) ctx.readings.push(r);
}

export function noteCrossReferences(): void {
  const ctx = callStore.getStore();
  if (ctx) ctx.crossRefs = true;
}

const enc = new TextEncoder();

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const WEB_LABEL = {
  translation: 'WEB',
  translation_name: 'World English Bible',
  license: 'Public domain',
  canon: 'Held here only for a limited set of passages cached in the repository (src/data/web.json); every other passage is read from the King James Version.',
};

export const KJV_ATTRIBUTION = 'King James Version, public domain. Read verbatim from the text The Living Bread app ships (assets/bible/books).';

/** The label for everything read in one call. Null when no Scripture was read. */
export async function evidenceFor(ctx: CallContext): Promise<Record<string, unknown> | null> {
  if (!ctx.readings.length) return null;
  const seen = new Set<string>();
  const unique = ctx.readings.filter((r) => {
    const k = `${r.translation}|${r.ref}|${r.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.some((r) => r.corpus)) return shelfLabel(unique, ctx);
  const passages = await Promise.all(unique.map(async (r) => ({ ref: r.ref, translation: r.translation, sha256: await sha256Hex(r.text) })));
  const translations = [...new Set(unique.map((r) => r.translation))];
  const mismatched = unique.filter((r) => r.translation === 'KJV' && r.book && r.book_sha256 && CORPUS.book_files[r.book]?.sha256 !== r.book_sha256).map((r) => r.book as string);
  const label: Record<string, unknown> = {
    translation: translations.length === 1 ? translations[0] : translations.join('+'),
    translation_name: translations.map((t) => (t === 'WEB' ? WEB_LABEL.translation_name : CORPUS.translation_name)).join(' and '),
    canon_coverage: translations.includes('KJV') ? CORPUS.canon : WEB_LABEL.canon,
    corpus_version: CORPUS.corpus_version,
    corpus_books: CORPUS.books,
    corpus_verses: CORPUS.verses,
    attribution: translations.includes('WEB') ? `${KJV_ATTRIBUTION} World English Bible, public domain (stored cache).` : KJV_ATTRIBUTION,
    license: 'Public domain',
    retrieved_at: new Date().toISOString(),
    content_hash: await sha256Hex(unique.map((r) => r.text).join('\n')),
    hash_algorithm: 'SHA-256 of the UTF-8 text exactly as returned; content_hash covers every passage joined by a newline, in order',
    passages,
    corpus_check: mismatched.length ? `MISMATCH: ${[...new Set(mismatched)].join(', ')} differ from the manifest; the text is what the Worker read, the corpus_version is stale` : 'every book read matched the manifest hash',
  };
  if (translations.includes('WEB')) label.web_note = WEB_LABEL.canon;
  if (ctx.crossRefs) label.cross_references = { source: CORPUS.cross_references.source, license: CORPUS.cross_references.license, attribution: CORPUS.cross_references.attribution, url: CORPUS.cross_references.url, dataset_sha256: CORPUS.cross_references.source_sha256, rule: CORPUS.cross_references.rule };
  return label;
}

/* ---- the label when any word came from the shelf of translations --------------------------------
   One entry per translation read, each with its own license statement (verbatim from its source),
   canon, versification and corpus version (a SHA-256 over its book files), and each passage hashed
   with the translation it came from. The KJV keeps its own entry when it is read beside the others. */
type ShelfEntry = { id: string; name: string; language: string; license: string; license_statement: string; license_source: string; source: string; canon_coverage: string; versification: string; corpus_version: string; books: Record<string, [number, string, string]>; attribution?: string; note?: string };
const SHELF_BY = new Map<string, ShelfEntry>((shelf as unknown as { translations: ShelfEntry[] }).translations.map((t) => [t.id, t]));

async function shelfLabel(unique: Reading[], ctx: CallContext): Promise<Record<string, unknown>> {
  const passages = await Promise.all(unique.map(async (r) => ({ ref: r.ref, translation: r.translation, sha256: await sha256Hex(r.text) })));
  const ids = [...new Set(unique.map((r) => (r.corpus ?? (r.translation === 'KJV' ? 'kjv' : r.translation.toLowerCase()))))];
  const entries = ids.map((id) => {
    if (id === 'kjv') {
      return { id: 'kjv', name: CORPUS.translation_name, license: CORPUS.license, license_statement: KJV_ATTRIBUTION, canon_coverage: CORPUS.canon, versification: 'eng (the standard numbering every reference is read in)', corpus_version: CORPUS.corpus_version, source: CORPUS.source };
    }
    if (id === 'web' && !SHELF_BY.has('web')) return { id: 'web', name: WEB_LABEL.translation_name, license: WEB_LABEL.license, canon_coverage: WEB_LABEL.canon };
    const t = SHELF_BY.get(id);
    if (!t) return { id, name: id, license: 'unknown' };
    return {
      id: t.id, name: t.name, language: t.language, license: t.license, license_statement: t.license_statement, license_source: t.license_source, source: t.source,
      canon_coverage: t.canon_coverage, versification: t.versification, corpus_version: t.corpus_version, ...(t.attribution ? { attribution: t.attribution } : {}), ...(t.note ? { note: t.note } : {}),
    };
  });
  const mismatched = unique.filter((r) => r.book && r.book_sha256 && (r.corpus ? SHELF_BY.get(r.corpus)?.books?.[r.book]?.[1] : CORPUS.book_files[r.book]?.sha256) !== r.book_sha256).map((r) => `${r.corpus ?? 'kjv'}/${r.book}`);
  const one = entries.length === 1 ? entries[0] : null;
  const label: Record<string, unknown> = {
    translation: ids.map((i) => i.toUpperCase()).join('+'),
    translation_name: entries.map((e) => e.name).join(' and '),
    canon_coverage: one ? one.canon_coverage : Object.fromEntries(entries.map((e) => [e.id, e.canon_coverage])),
    corpus_version: one ? (one as { corpus_version?: string }).corpus_version : Object.fromEntries(entries.map((e) => [e.id, (e as { corpus_version?: string }).corpus_version])),
    license: one ? one.license : entries.map((e) => `${e.id.toUpperCase()}: ${e.license}`).join('; '),
    attribution: entries.map((e) => (e as { attribution?: string }).attribution ?? `${e.name}, ${e.license}`).join(' '),
    translations: entries,
    retrieved_at: new Date().toISOString(),
    content_hash: await sha256Hex(unique.map((r) => r.text).join('\n')),
    hash_algorithm: 'SHA-256 of the UTF-8 text exactly as returned; content_hash covers every passage joined by a newline, in order; corpus_version is a SHA-256 over the translation\'s book files (scripts/build-translations.py)',
    passages,
    corpus_check: mismatched.length ? `MISMATCH: ${[...new Set(mismatched)].join(', ')} differ from the manifest; the text is what the Worker read, the corpus_version is stale` : 'every book read matched the manifest hash',
  };
  if (ctx.crossRefs) label.cross_references = { source: CORPUS.cross_references.source, license: CORPUS.cross_references.license, attribution: CORPUS.cross_references.attribution, url: CORPUS.cross_references.url, dataset_sha256: CORPUS.cross_references.source_sha256, rule: CORPUS.cross_references.rule };
  return label;
}

/* ---- what each field of a Scripture answer IS -------------------------------------------------
   Text is Scripture, read verbatim. Interpretation is a reading of it by someone (the house's pages,
   labelled as such). Reflection is a short word in the house's own voice. An assistant must never
   present the second or third as the first. */
export type Layer = 'scripture' | 'interpretation' | 'reflection' | 'navigation';

export function layers(map: Partial<Record<Layer, string[]>>, tradition?: string): Record<string, unknown> {
  return {
    ...map,
    rule: 'Only fields listed under scripture are Scripture. interpretation and reflection are human words about it, and must be presented as such, never as the Bible.',
    ...(tradition ? { tradition } : {}),
  };
}

export const HOUSE_TRADITION = 'The Living Bread\'s own pages: one Christ-centred, broadly ecumenical voice that confesses Jesus Christ as God and Lord. Not the official teaching of any single church or tradition.';
