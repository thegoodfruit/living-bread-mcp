/* ============================================================
   THE LIVING BREAD MCP, the shelf tools: many translations, one Word.

     list_translations     what is held, honestly: every translation with its
                           language, canon, versification, verbatim license and
                           corpus hash, the language defaults, and what was left
                           out and why.
     compare_translations  one verse or a short range across up to six stored
                           translations (and the Hebrew or Greek line), each row
                           with its own license and hash.
     original_words        the Hebrew or Greek words of a verse: Strong's number,
                           the public domain lexicon entry, the parsing where
                           licensed, and the King James words that render each.

   And the helpers the other Scripture tools share: the translation and
   language inputs, and one read that answers from the KJV or from the shelf.
   Nothing is typed; every word is read from assets/bible.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { layers, noteReading, sha256Hex } from './evidence';
import { kjvPassage } from './kjv';
import { list, paragraph } from './render';
import { fail, ok, out, READS, tool } from './shared';
import {
  asParsed, bookName, describe, doorFor, facts, isPassage, KJV_ENTRY, OT_IDS, parseLoose, readShelf, refString, resolveTranslation, SHELF, shelfById,
  toOwn, type Choice, type LooseRef, type ShelfTranslation,
} from './translations';

/* ---- the inputs every Scripture tool shares ---------------------------------------------------- */
export const translationInput = z.string().min(2).max(24).optional().describe('Optional translation id from list_translations, e.g. "bsb", "web", "dra", "rv1909", "lsg", "cuv", "neno", "wlc", "byz". Default: the King James Version (or the language default).');
export const languageInput = z.string().min(2).max(16).optional().describe('Optional BCP-47 language of the person, e.g. "es", "pt-BR", "sw", "zh-Hant". Picks the best stored public domain or freely licensed translation for that language; translation overrides it.');

export type Pick = { choice: Choice; t: ShelfTranslation | null; why: string };

/** The chosen translation, or an honest error the tool can return as is. */
export function pick(translation?: string, language?: string): Pick | ReturnType<typeof fail> {
  const r = resolveTranslation(translation, language);
  if ('error' in r) {
    const langs = [...new Set(SHELF.translations.map((t) => t.language_name))].slice(0, 30);
    return fail(paragraph([r.error, `Languages held include ${list(langs, 30)}`]), { reason: r.reason, try_instead: ['list_translations', 'the same call without translation (the King James Version)'] });
  }
  return { choice: r.choice, t: r.choice.kind === 'shelf' ? r.choice.t : null, why: r.why };
}
export function isPick(x: unknown): x is Pick {
  return Boolean(x && typeof x === 'object' && 'choice' in (x as object));
}

/** Translations that hold a book, for an honest "try instead". */
export function holders(bookId: string): string[] {
  return SHELF.translations.filter((t) => t.books[bookId]).map((t) => t.id);
}

export interface AnyPassage {
  ref: string; text: string; verses: { verse: number; text: string; chapter?: number; standard?: string }[];
  translation: string; translation_id: string; translation_name: string; own_ref?: string; numbering_note?: string; missing?: string[]; joined?: string[]; door: string;
  book: string; chapter: number;
}

/** One passage from the KJV or from the shelf, or the honest reason it is not there. */
export async function readAny(env: Env, choice: Choice, reference: string | LooseRef): Promise<AnyPassage | { reason: string; message: string }> {
  const r = typeof reference === 'string' ? parseLoose(reference) : reference;
  if (!r) return { reason: 'unparsed_reference', message: `"${String(reference)}" is not a reference we can read with certainty. Try the book, chapter and verse, like "John 3:16".` };
  if (choice.kind === 'kjv') {
    const p = asParsed(r);
    if (!p) {
      const h = holders(r.bookId);
      return { reason: 'book_not_in_translation', message: `The King James Version held here has the 66 books of the Protestant canon, so ${bookName(r.bookId)} is not in it.${h.length ? ` ${bookName(r.bookId)} is held in ${list(h.map((x) => shelfById(x)!.name), 4)}: pass translation "${h[0]}".` : ''}` };
    }
    const k = await kjvPassage(env, p);
    if (!k) return { reason: 'verse_out_of_range', message: `${p.ref} is not held in the King James Version.` };
    return { ref: k.ref, text: k.text, verses: k.verses, translation: 'KJV', translation_id: 'kjv', translation_name: KJV_ENTRY.name, door: doorFor('en', p.bookId, p.chapter, p.from), book: k.book, chapter: k.chapter };
  }
  const res = await readShelf(env, choice.t, r);
  if (!isPassage(res)) {
    const h = res.reason === 'book_not_in_translation' ? holders(r.bookId).filter((x) => x !== choice.t.id) : [];
    return { reason: res.reason, message: res.message + (h.length ? ` It is held in ${list(h.map((x) => shelfById(x)!.name), 4)}.` : '') };
  }
  const t = choice.t;
  return {
    ref: res.ref, text: res.text, verses: res.verses.map((v) => ({ verse: v.verse, text: v.text, chapter: v.chapter, ...(v.standard ? { standard: v.standard } : {}) })),
    translation: t.id.toUpperCase(), translation_id: t.id, translation_name: t.name, own_ref: res.own_ref, ...(res.numbering_note ? { numbering_note: res.numbering_note } : {}),
    ...(res.missing.length ? { missing: res.missing } : {}), ...(res.joined.length ? { joined: res.joined } : {}), door: res.door, book: res.book, chapter: res.chapter,
  };
}

export function isAny(x: AnyPassage | { reason: string; message: string }): x is AnyPassage {
  return (x as AnyPassage).verses !== undefined;
}

/** The sentence notes a reader needs: numbering, missing and joined verses. */
export function notesOf(p: AnyPassage): string[] {
  return [p.numbering_note ?? null, p.missing?.length ? `Not in this translation: ${p.missing.join(', ')}; nothing is put in their place` : null, ...(p.joined ?? [])].filter((x): x is string => Boolean(x));
}

/* ---- morphology, read aloud --------------------------------------------------------------------- */
const G_CASE: Record<string, string> = { N: 'nominative', G: 'genitive', D: 'dative', A: 'accusative', V: 'vocative' };
const G_NUM: Record<string, string> = { S: 'singular', P: 'plural' };
const G_GEN: Record<string, string> = { M: 'masculine', F: 'feminine', N: 'neuter' };
const G_TENSE: Record<string, string> = { P: 'present', I: 'imperfect', F: 'future', A: 'aorist', R: 'perfect', L: 'pluperfect', X: 'no tense' };
const G_VOICE: Record<string, string> = { A: 'active', M: 'middle', P: 'passive', E: 'middle or passive', D: 'middle deponent', O: 'passive deponent', N: 'middle or passive deponent', Q: 'impersonal active', X: 'no voice' };
const G_MOOD: Record<string, string> = { I: 'indicative', S: 'subjunctive', O: 'optative', M: 'imperative', N: 'infinitive', P: 'participle', R: 'imperative participle' };
const G_POS: Record<string, string> = { N: 'noun', A: 'adjective', T: 'article', V: 'verb', P: 'personal pronoun', R: 'relative pronoun', C: 'reciprocal pronoun', D: 'demonstrative pronoun', K: 'correlative pronoun', I: 'interrogative pronoun', X: 'indefinite pronoun', Q: 'correlative or interrogative pronoun', F: 'reflexive pronoun', S: 'possessive pronoun', ADV: 'adverb', CONJ: 'conjunction', COND: 'conditional particle', PRT: 'particle', PREP: 'preposition', INJ: 'interjection', ARAM: 'Aramaic word', HEB: 'Hebrew word', 'N-PRI': 'indeclinable proper noun', 'A-NUI': 'indeclinable numeral', 'N-LI': 'indeclinable letter', 'N-OI': 'indeclinable noun' };

export function greekMorph(code: string): string {
  if (!code) return '';
  if (G_POS[code]) return G_POS[code];
  const parts = code.split('-');
  const pos = parts[0];
  const suffix = parts.slice(1).filter((x) => ['N', 'I', 'C', 'S', 'ATT', 'K', 'ABB'].includes(x));
  const extra = suffix.map((x) => ({ N: 'negative', I: 'interrogative', C: 'contracted or comparative', S: 'superlative', ATT: 'Attic form', K: 'crasis', ABB: 'abbreviated' }[x] ?? '')).filter(Boolean);
  if (pos === 'V') {
    const tvm = parts[1] ?? '';
    const m = tvm.match(/^(2?)([PIFARLX])([AMPEDONQX])([ISOMNPR])$/);
    if (!m) return `verb ${code}`;
    const bits = [`${m[1] ? 'second ' : ''}${G_TENSE[m[2]]}`, G_VOICE[m[3]], G_MOOD[m[4]]];
    const rest = parts[2] ?? '';
    const pn = rest.match(/^([123])([SP])$/);
    if (pn) bits.push(`${pn[1] === '1' ? 'first' : pn[1] === '2' ? 'second' : 'third'} person ${G_NUM[pn[2]]}`);
    const cng = rest.match(/^([NGDAV])([SP])([MFN])$/);
    if (cng) bits.push(G_CASE[cng[1]], G_NUM[cng[2]], G_GEN[cng[3]]);
    return ['verb', ...bits, ...extra].filter(Boolean).join(', ');
  }
  const name = G_POS[pos] ?? pos;
  const cng = (parts[1] ?? '').match(/^([123]?)([NGDAV])([SP])([MFN]?)$/);
  const bits = cng ? [cng[1] ? `${cng[1] === '1' ? 'first' : cng[1] === '2' ? 'second' : 'third'} person` : '', G_CASE[cng[2]], G_NUM[cng[3]], cng[4] ? G_GEN[cng[4]] : ''] : [];
  return [name, ...bits, ...extra].filter(Boolean).join(', ');
}

const H_STEM: Record<string, string> = { q: 'qal', N: 'niphal', p: 'piel', P: 'pual', h: 'hiphil', H: 'hophal', t: 'hithpael', o: 'polel', O: 'polal', r: 'hithpolel', m: 'poel', M: 'poal', k: 'palel', K: 'pulal', Q: 'qal passive', l: 'pilpel', L: 'polpal', f: 'hithpalpel', D: 'nithpael', j: 'pealal', i: 'pilel', u: 'hothpaal', c: 'tiphil', v: 'hishtaphel', w: 'nithpalel', y: 'nithpoel', z: 'hithpoel' };
const A_STEM: Record<string, string> = { q: 'peal', Q: 'peil', u: 'hithpeel', p: 'pael', P: 'ithpaal', M: 'hithpaal', a: 'aphel', h: 'haphel', s: 'saphel', e: 'shaphel', H: 'hophal', i: 'ithpeel', t: 'hishtaphel', v: 'ishtaphel', w: 'hithaphel', o: 'polel', z: 'ithpoel', r: 'hithpolel', f: 'hithpalpel', b: 'hephal', c: 'tiphel', m: 'poel', l: 'palpel', L: 'ithpalpel', O: 'ithpolel', G: 'ittaphal' };
const H_TYPE: Record<string, string> = { p: 'perfect', q: 'sequential perfect', i: 'imperfect', w: 'sequential imperfect (wayyiqtol)', h: 'cohortative', j: 'jussive', v: 'imperative', r: 'participle active', s: 'participle passive', a: 'infinitive absolute', c: 'infinitive construct' };
const H_GEN: Record<string, string> = { b: 'both genders', c: 'common', f: 'feminine', m: 'masculine' };
const H_NUM: Record<string, string> = { d: 'dual', p: 'plural', s: 'singular' };
const H_STATE: Record<string, string> = { a: 'absolute', c: 'construct', d: 'determined' };
const H_PERSON: Record<string, string> = { '1': 'first person', '2': 'second person', '3': 'third person' };

function hebSegment(seg: string, lang: 'H' | 'A'): string {
  const p = seg[0];
  const r = seg.slice(1);
  const gns = (s: string) => [H_PERSON[s[0]] ? '' : '', H_GEN[s[0]], H_NUM[s[1]], H_STATE[s[2]]].filter(Boolean);
  switch (p) {
    case 'N': {
      const type = { c: 'noun', g: 'gentilic noun', p: 'proper noun', x: 'noun' }[r[0]] ?? 'noun';
      return [type, ...gns(r.slice(1))].join(', ');
    }
    case 'A': {
      const type = { a: 'adjective', c: 'cardinal number', g: 'gentilic adjective', o: 'ordinal number' }[r[0]] ?? 'adjective';
      return [type, ...gns(r.slice(1))].join(', ');
    }
    case 'V': {
      const stem = (lang === 'A' ? A_STEM : H_STEM)[r[0]] ?? r[0];
      const type = H_TYPE[r[1]] ?? '';
      const rest = r.slice(2);
      const bits = ['verb', stem, type];
      if (/^[123]/.test(rest)) bits.push(H_PERSON[rest[0]], H_GEN[rest[1]] ?? '', H_NUM[rest[2]] ?? '');
      else bits.push(H_GEN[rest[0]] ?? '', H_NUM[rest[1]] ?? '', H_STATE[rest[2]] ?? '');
      return bits.filter(Boolean).join(', ');
    }
    case 'P': {
      const type = { d: 'demonstrative pronoun', f: 'indefinite pronoun', i: 'interrogative pronoun', p: 'personal pronoun', r: 'relative pronoun' }[r[0]] ?? 'pronoun';
      return [type, H_PERSON[r[1]] ?? '', H_GEN[r[2]] ?? '', H_NUM[r[3]] ?? ''].filter(Boolean).join(', ');
    }
    case 'R': return r[0] === 'd' ? 'preposition with the article' : 'preposition';
    case 'C': return 'conjunction';
    case 'D': return 'adverb';
    case 'T': return { a: 'particle of affirmation', d: 'definite article', e: 'particle of exhortation', i: 'interrogative particle', j: 'interjection', m: 'demonstrative particle', n: 'negative particle', o: 'direct object marker', r: 'relative particle' }[r[0]] ?? 'particle';
    case 'S': return { d: 'directional he suffix', h: 'paragogic he suffix', n: 'paragogic nun suffix', p: ['pronominal suffix', H_PERSON[r[1]] ?? '', H_GEN[r[2]] ?? '', H_NUM[r[3]] ?? ''].filter(Boolean).join(', ') }[r[0]] ?? 'suffix';
    default: return seg;
  }
}

export function hebrewMorph(code: string): string {
  if (!code) return '';
  const lang = code[0] === 'A' ? 'A' : 'H';
  const body = code.slice(1);
  return (lang === 'A' ? 'Aramaic: ' : '') + body.split('/').map((s) => hebSegment(s, lang)).join(' + ');
}

const GREEK_LATIN: Record<string, string> = { α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'ē', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'u', φ: 'ph', χ: 'ch', ψ: 'ps', ω: 'ō' };
/** A plain letter-for-letter transliteration of a Greek form (rough breathing as h, gamma before a velar as n). */
export function greekTranslit(word: string): string {
  const d = word.normalize('NFD');
  let out = '';
  let rough = false;
  const chars = [...d];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '̔') { rough = true; continue; }
    if (/\p{M}/u.test(ch)) continue;
    const low = ch.toLowerCase();
    let tr = GREEK_LATIN[low];
    if (tr === undefined) { if (/[\p{L}]/u.test(ch)) out += ch; continue; }
    if (low === 'γ' && /[γκξχ]/.test((chars.slice(i + 1).find((c) => !/\p{M}/u.test(c)) ?? '').toLowerCase())) tr = 'n';
    if (low === 'υ' && /[αεηο]/.test(out.slice(-1))) tr = 'u'; else if (low === 'υ') tr = 'y';
    out += ch !== low ? tr[0].toUpperCase() + tr.slice(1) : tr;
  }
  if (rough) out = /^[aeiouyēō]/i.test(out) ? `h${out}` : out.replace(/^r/i, (m) => `${m}h`);
  return out;
}

function plain(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').replace(/[ʼʽ'’`]/g, '').toLowerCase();
}

/* ---- the lexicon and the alignment ------------------------------------------------------------- */
type LexEntry = { w: string; tr: string; pr: string; pos: string; def: string; der: string; use: string; lang: string };
const lexCache = new Map<string, Promise<Record<string, LexEntry> | null>>();
function loadJson<T>(env: Env, path: string, cache: Map<string, Promise<T | null>>): Promise<T | null> {
  const hit = cache.get(path);
  if (hit) return hit;
  const p = (async () => {
    try {
      const res = await env.ASSETS.fetch(new Request(`https://assets.living-bread.org/shelf/${path}`));
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  })();
  cache.set(path, p);
  p.then((v) => { if (!v) cache.delete(path); });
  return p;
}
async function lexicon(env: Env, strong: string): Promise<LexEntry | null> {
  const m = strong.match(/^([HG])(\d+)/);
  if (!m) return null;
  const num = Number(m[2]);
  const shard = await loadJson<Record<string, LexEntry>>(env, `lex/${m[1].toLowerCase()}/${Math.floor(num / 200)}.json`, lexCache);
  return shard?.[`${m[1]}${num}`] ?? null;
}
type Words = { n: string; c: [string, string, string][][][] };
const wordsCache = new Map<string, Promise<Words | null>>();
const kjvsCache = new Map<string, Promise<{ c: [string, string[]][][][] } | null>>();

/* ---- the tools ------------------------------------------------------------------------------------ */
export function registerShelf(server: McpServer, env: Env): void {
  // ---- list_translations ---------------------------------------------------------------------------
  tool(server, 'list_translations', {
    title: 'The Bible translations held',
    description: 'List every Bible translation this server holds and can quote word for word: the King James Version, modern English (Berean Standard Bible, World English Bible, ASV, YLT), the Catholic Douay-Rheims with the deuterocanonical books, Brenton\'s English Septuagint, about fifty other languages (Spanish, Portuguese, French, German, Chinese, Arabic, Hindi, Swahili, Russian, Korean and more), and the original Hebrew and Greek. Use it to find the translation id to pass as translation to scripture_passage, scripture_context, scripture_search, cross_references, verses_for, daily_bread or compare_translations, or to answer "which Bibles do you have", "can you quote the Bible in Spanish", "do you have the Catholic Bible". Not for reading a passage (scripture_passage), comparing one verse across Bibles (compare_translations), or the Hebrew or Greek words of a verse (original_words). language filters to one language (base subtag, so "pt-BR" matches "pt"); include_license_text adds each full license statement. Returns one row per translation with id, name, language, license copied verbatim from its source, canon and books held, versification and corpus hash, plus language_default (which id a language parameter picks) and excluded (translations deliberately left out and why). Deterministic, no network; a language with nothing held returns count 0 with empty true and the held languages listed.',
    inputSchema: {
      language: z.string().min(2).max(16).optional().describe('Optional BCP-47 language to filter by, e.g. "es" or "zh".'),
      include_license_text: z.boolean().default(false).describe('True returns each license statement in full; false returns the short license and its source.'),
    },
    outputSchema: out({
      count: z.number().describe('Translations returned; 0 when the language filter matches none.'),
      translations: z.array(z.looseObject({ id: z.string(), name: z.string(), language: z.string(), license: z.string(), canon: z.string() })).describe('One row per translation: id to pass as translation, name, BCP-47 language and language_name, short license (license_statement in full when asked), source, canon and canon_coverage, versification, verse count, corpus_version hash, books held, and the web door.'),
      language_default: z.record(z.string(), z.string()).describe('Which translation id a language parameter picks, keyed by language tag.'),
      excluded: z.array(z.looseObject({ name: z.string(), reason: z.string() })).describe('Translations deliberately not held, each with the reason (usually a license that forbids redistribution).'),
      versification: z.unknown().optional().describe('The versification schemes used and how they map to the KJV numbering.'),
      original_languages: z.looseObject({}).optional().describe('Ids of the Hebrew (wlc) and Greek (byz, tr) texts and the lexicon, for original_words.'),
    }),
    annotations: READS,
  }, async ({ language, include_license_text }) => {
    const want = language ? language.toLowerCase().split('-')[0] : null;
    const rows = [
      { id: 'kjv', name: KJV_ENTRY.name, language: 'en', language_name: 'English', license: KJV_ENTRY.license, license_statement: KJV_ENTRY.license_statement, canon: KJV_ENTRY.canon, canon_coverage: KJV_ENTRY.canon_coverage, versification: 'eng', verses: KJV_ENTRY.verses, corpus_version: KJV_ENTRY.corpus_version, books: 66, door: doorFor('en') },
      ...SHELF.translations.map((t) => ({
        id: t.id, name: t.name, language: t.language, language_name: t.language_name, license: t.license,
        ...(include_license_text ? { license_statement: t.license_statement } : {}), license_source: t.license_source, source: t.source,
        canon: t.canon, canon_coverage: t.canon_coverage, versification: t.versification, verses: t.verses, corpus_version: t.corpus_version, books: Object.keys(t.books).length,
        ...(t.note ? { note: t.note } : {}), ...(t.attribution ? { attribution: t.attribution } : {}), door: doorFor(t.language),
      })),
    ].filter((r) => !want || r.language.toLowerCase().split('-')[0] === want);
    const langs = [...new Set(rows.map((r) => r.language_name))];
    if (!rows.length) {
      return ok(paragraph([`No public domain or freely licensed Bible in "${language}" is held here yet`, `Held languages: ${list([...new Set(SHELF.translations.map((t) => t.language_name))], 60)}`]), {
        count: 0, translations: [], language_default: SHELF.language_default, excluded: SHELF.excluded, empty: true,
      });
    }
    return ok(paragraph([
      `${rows.length} ${rows.length === 1 ? 'translation is' : 'translations are'} held${want ? ` in ${langs.join(', ')}` : ` in ${langs.length} languages`}, every one public domain or under a license that permits redistribution`,
      list(rows.map((r) => `${r.id} (${r.name}, ${r.language_name}, ${r.license})`), 80),
      'Pass the id as translation to scripture_passage, compare_translations, scripture_search, scripture_context, cross_references, verses_for or daily_bread; or pass language and the default is chosen',
      want ? null : `Left out on purpose: ${list(SHELF.excluded.map((e) => e.name), 4)}; excluded explains why`,
    ]), {
      count: rows.length, translations: rows, language_default: SHELF.language_default, excluded: SHELF.excluded,
      versification: SHELF.versification, original_languages: { hebrew: 'wlc', greek: 'byz', textus_receptus: 'tr', lexicon: SHELF.original.lexicon, tool: 'original_words' },
    });
  });

  // ---- compare_translations ------------------------------------------------------------------------
  tool(server, 'compare_translations', {
    title: 'Compare Bible translations',
    description: 'Show one verse or a short passage (up to 8 verses) side by side in up to six stored translations, each read verbatim with its own license, corpus hash and passage hash, plus the Hebrew or Greek line when wanted. Use when the person wants to see how Bibles differ ("how do different Bibles translate John 1:1", "John 3:16 in Spanish and English", "compare Psalm 23 in the KJV and the Douay-Rheims"). Not for reading one passage in one translation (scripture_passage with translation), the word by word Hebrew or Greek with definitions (original_words), or finding which ids exist (list_translations). translations takes ids from list_translations (default kjv, bsb, web, dra); language adds that language\'s default translation first; include_original (default true) appends the Westminster Leningrad Codex or Byzantine Greek line. Versification is mapped honestly (Psalm 23 is Psalm 22 in the Douay-Rheims) and a verse a translation does not have is reported in its row as missing, never filled from another text. A range longer than 8 verses is cut to 8; a whole chapter or unparseable reference returns an error; an unknown id gets a row with text null and the reason. Deterministic, no network.',
    inputSchema: {
      reference: z.string().min(2).max(80).describe('One verse or a short range, e.g. "John 1:1", "Psalm 23:1-3", "Tobit 4:7".'),
      translations: z.array(z.string().min(2).max(24)).min(1).max(6).optional().describe('Up to six ids from list_translations, e.g. ["kjv","bsb","dra","rv1909"].'),
      language: languageInput,
      include_original: z.boolean().default(true).describe('Add the Hebrew (Westminster Leningrad Codex) or Greek (Byzantine text) line.'),
    },
    outputSchema: out({
      ref: z.string().describe('The reference compared, in KJV numbering.'),
      rows: z.array(z.looseObject({ translation: z.string(), name: z.string(), text: z.string().nullable() })).describe('One row per translation asked for: code, name, language, direction, the reference in its own numbering, verbatim text (null with missing and reason when not held), numbering_note, missing_verses, evidence (license, corpus_version, sha256 of the text) and web door.'),
      count: z.number().describe('Rows that hold text.'),
    }),
    annotations: READS,
  }, async ({ reference, translations, language, include_original }) => {
    const r = parseLoose(reference);
    if (!r) return fail(paragraph([`"${reference}" is not a reference we can read with certainty`, 'Use a book, chapter and verse, like "John 1:1"']), { reason: 'unparsed_reference', try_instead: ['compare_translations with "John 1:1"'] });
    if (r.from === undefined) return fail(`${refString(r.bookId, r.chapter)} is a whole chapter; compare one verse or up to 8 verses.`, { reason: 'too_long', try_instead: [`compare_translations with "${refString(r.bookId, r.chapter, 1, 3)}"`] });
    if (r.to !== undefined && r.to - r.from > 7) r.to = r.from + 7;
    let ids = (translations ?? ['kjv', 'bsb', 'web', 'dra']).map((x) => x.toLowerCase());
    if (language) {
      const p = resolveTranslation(undefined, language);
      if (!('error' in p) && !ids.includes(p.id)) ids = [p.id, ...ids].slice(0, 6);
    }
    ids = [...new Set(ids)].slice(0, 6);
    if (include_original !== false) ids.push(OT_IDS.has(r.bookId) ? 'wlc' : 'byz');
    const rows: Record<string, unknown>[] = [];
    for (const id of ids) {
      const res = resolveTranslation(id);
      if ('error' in res) { rows.push({ translation: id.toUpperCase(), name: id, text: null, missing: res.error }); continue; }
      const d = describe(res.choice);
      const got = await readAny(env, res.choice, r);
      if (!isAny(got)) { rows.push({ translation: d.code, name: d.name, language: d.language, license: d.license, text: null, missing: got.message, reason: got.reason }); continue; }
      const f = facts(res.choice.kind === 'shelf' ? res.choice.t : null);
      rows.push({
        translation: d.code, translation_id: d.id, name: d.name, language: d.language, direction: d.direction, ref: got.own_ref ?? got.ref, text: got.text,
        ...(got.numbering_note ? { numbering_note: got.numbering_note } : {}), ...(got.missing ? { missing_verses: got.missing } : {}),
        evidence: { license: f.license, corpus_version: f.corpus_version, sha256: await sha256Hex(got.text) }, door: got.door,
      });
    }
    const asked = refString(r.bookId, r.chapter, r.from, r.to);
    const held = rows.filter((x) => x.text);
    if (!held.length) return fail(paragraph([`${asked} is not held in any of the translations asked for`, String(rows[0]?.missing ?? '')]), { reason: 'not_held', try_instead: ['list_translations'] });
    return ok(paragraph([
      ...rows.map((x) => (x.text ? `${x.ref} (${x.name}): "${x.text}"` : `${x.name}: ${x.missing}`)),
      'Each line is read verbatim from its stored text; each carries its own license and hash in rows[].evidence',
    ]), {
      ref: asked, count: held.length, rows,
      content_layers: layers({ scripture: ['rows[].text'], navigation: ['rows[].door'] }),
    });
  });

  // ---- original_words ------------------------------------------------------------------------------
  tool(server, 'original_words', {
    title: 'The Hebrew or Greek words of a verse',
    description: 'Return the original Hebrew or Greek words of a verse from stored data, never from memory: each Hebrew word (Westminster Leningrad Codex) or Greek word (Robinson-Pierpont Byzantine text) with its Strong\'s number, lexical form and transliteration, the definition and King James usage from Strong\'s public domain dictionary, the parsing in plain words (Open Scriptures Hebrew morphology, CC BY; Byzantine parsing codes, public domain), and the King James words that render it where the KJV-Strong\'s tagging links them. Use for word study ("what Greek word is love in John 21:15-17", "what does bara mean in Genesis 1:1", "is it agape or phileo"). Not for the verse in English or another language (scripture_passage, compare_translations) or for a topic (what_the_bible_says_about). reference is one verse (a range reads at most three); strong filters to one Strong\'s number such as "G25" or "H1254". Definitions and parsing are scholarship about the words, labelled as interpretation in content_layers, not Scripture. Books outside the Hebrew and Greek canon (the deuterocanon) return an error, as does a verse not in the stored text or a strong number absent from the verse. Deterministic, no network.',
    inputSchema: {
      reference: z.string().min(2).max(80).describe('One verse, e.g. "John 3:16" or "Genesis 1:1"; a range reads up to three verses.'),
      strong: z.string().max(8).optional().describe('Optional: only the words with this Strong\'s number, e.g. "G25" or "H1254".'),
    },
    outputSchema: out({
      ref: z.string().describe('The verse or verses read, in KJV numbering.'),
      language: z.string().describe('Biblical Hebrew or Koine Greek.'),
      text_source: z.string().optional().describe('The stored original-language text the words come from.'),
      verses: z.array(z.looseObject({ ref: z.string(), words: z.array(z.looseObject({ word: z.string(), strong: z.string() })) })).describe('Each verse: ref, own_ref when the numbering differs, the original text, and words in order with position, word, strong, translit, lemma and lemma_translit, pronunciation, part_of_speech, definition, kjv_usage, derivation, morph and morph_readable, and kjv_words.'),
      lexicon: z.string().optional().describe('The dictionary the definitions come from.'),
      kjv_alignment: z.string().optional().describe('The source of the KJV word to Strong\'s links.'),
      door: z.string().optional().describe('Web page for Bible word study.'),
    }),
    annotations: READS,
  }, async ({ reference, strong }) => {
    const r = parseLoose(reference);
    if (!r || r.from === undefined) return fail(paragraph([`"${reference}" is not one verse we can read with certainty`, 'Give a book, chapter and verse, like "John 3:16"']), { reason: 'unparsed_reference', try_instead: ['original_words with "John 3:16"'] });
    const isOT = OT_IDS.has(r.bookId);
    const tid = isOT ? 'wlc' : 'byz';
    const t = shelfById(tid);
    if (!t || !t.books[r.bookId]) {
      return fail(`The original words are held for the 39 books of the Hebrew Old Testament and the 27 books of the Greek New Testament; ${bookName(r.bookId)} is not among them.`, { reason: 'book_not_held', try_instead: ['compare_translations', 'list_translations'] });
    }
    const last = Math.min(r.to ?? r.from, r.from + 2);
    const verses: Record<string, unknown>[] = [];
    const kjvs = await loadJson<{ c: [string, string[]][][][] }>(env, `kjvs/${r.bookId}.json`, kjvsCache);
    const want = strong ? strong.toUpperCase().replace(/^([HG])0+/, '$1') : null;
    for (let v = r.from; v <= last; v++) {
      const [ob, oc, ov] = await toOwn(env, t, r.bookId, r.chapter, v);
      const book = await loadJson<Words>(env, `orig/${tid}/${ob}.json`, wordsCache);
      const ws = book?.c?.[oc - 1]?.[ov - 1];
      if (!ws || !ws.length) {
        if (v === r.from) return fail(`${refString(r.bookId, r.chapter, v)} is not in the stored ${isOT ? 'Hebrew' : 'Greek'} text; nothing is put in its place.`, { reason: 'verse_not_held', try_instead: [`original_words with "${refString(r.bookId, r.chapter, 1)}"`] });
        break;
      }
      const align = kjvs?.c?.[r.chapter - 1]?.[v - 1] ?? [];
      const words: Record<string, unknown>[] = [];
      for (let i = 0; i < ws.length; i++) {
        const [w, s, m] = ws[i];
        if (want && s !== want) continue;
        const lex = s ? await lexicon(env, s) : null;
        const kjvWords = align.filter(([, nums]) => nums.includes(s)).map(([en]) => en);
        words.push({
          position: i + 1, word: w, strong: s,
          ...(isOT ? {} : { translit: greekTranslit(w) }),
          ...(lex ? {
            lemma: lex.w, lemma_translit: lex.tr, lemma_translit_plain: plain(lex.tr), pronunciation: lex.pr, part_of_speech: lex.pos || undefined,
            definition: lex.def, kjv_usage: lex.use, derivation: lex.der,
          } : { lexicon: s ? 'no entry for this number in the stored dictionary' : 'untagged in the source' }),
          morph: m || null, morph_readable: m ? (isOT ? hebrewMorph(m) : greekMorph(m)) : null,
          kjv_words: kjvWords,
        });
      }
      const stdRef = refString(r.bookId, r.chapter, v);
      const ownRef = refString(ob, oc, ov);
      const text = ws.map((x) => x[0]).join(' ');
      noteReading({ ref: ownRef, translation: tid.toUpperCase(), text, corpus: tid, book: ob });
      verses.push({ ref: stdRef, ...(ownRef !== stdRef ? { own_ref: ownRef } : {}), text, words });
    }
    const lines = verses.flatMap((v) => [
      `${v.ref} in ${isOT ? 'Hebrew' : 'Greek'}: ${v.text}`,
      ...((v.words as Record<string, unknown>[]).map((w) => `${w.word} (${w.strong}${w.lemma_translit ? `, ${w.lemma_translit}` : ''}${w.morph_readable ? `, ${w.morph_readable}` : ''})${(w.kjv_words as string[]).length ? ` = KJV "${(w.kjv_words as string[]).join('", "')}"` : ''}${w.definition ? `: ${String(w.definition).replace(/[:;,\s]+$/, '')}` : ''}`)),
    ]);
    if (want && !verses.some((v) => (v.words as unknown[]).length)) {
      return fail(`No word with ${want} is in ${refString(r.bookId, r.chapter, r.from, last > r.from ? last : undefined)}.`, { reason: 'no_such_word', try_instead: [`original_words with "${reference}" and no strong filter`] });
    }
    return ok(paragraph([
      ...lines.slice(0, 60),
      `Sources: ${t.name} (${t.license}${t.attribution ? `; ${t.attribution}` : ''}). ${SHELF.original.lexicon} The English links come from the King James words tagged with Strong's numbers`,
    ]), {
      ref: refString(r.bookId, r.chapter, r.from, last > r.from ? last : undefined), language: isOT ? 'Biblical Hebrew' : 'Koine Greek', text_source: t.name, verses,
      lexicon: SHELF.original.lexicon, kjv_alignment: SHELF.original.kjv_alignment,
      door: `https://living-bread.org/bible-word-study`,
      content_layers: layers({ scripture: ['verses[].text', 'verses[].words[].word'], interpretation: ['verses[].words[].definition', 'verses[].words[].kjv_usage', 'verses[].words[].derivation', 'verses[].words[].morph_readable', 'verses[].words[].kjv_words'] }, 'Definitions are James Strong\'s (1890); parsing is the Open Scriptures Hebrew Bible project\'s or the Byzantine text editors\'; both are scholarship about the words, not Scripture.'),
    });
  });
}
