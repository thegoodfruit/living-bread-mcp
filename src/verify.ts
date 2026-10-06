/* ============================================================
   THE LIVING BREAD MCP, verify a quotation of Scripture.

   The trust layer for Scripture in AI. Assistants misremember verses, blend
   two together, or attribute a proverb of men to the Bible. Before quoting,
   an assistant can send the words it means to quote (and the reference it
   believes they come from) and receive, from the stored text:

     - whether the words are held verbatim, and where;
     - the closest real verse or verses, with reference, translation, the
       stored words, and a SHA-256 of each verse and of the whole match;
     - a word by word diff of what differs;
     - whether the claimed reference is where those words are;
     - "not found in any held translation" when nothing held is close.

   The corpora are a LIST (CORPUS_PROVIDERS): the King James Version the app
   ships (whole Bible, read through the ASSETS binding) and the World English
   Bible passages cached in src/data/web.json. A further held translation is
   one more provider; nothing else changes. The matching itself is
   src/verifyCore.js, shared with the discover worker's /api/verify.
   ============================================================ */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import WEB from './data/web.json';
import { SITE } from './doors';
import { CORPUS, layers, noteReading } from './evidence';
import { loadBook } from './kjv';
import { paragraph } from './render';
import { BOOKS, bookById, parseReference } from './scripture';
import { fail, ok, out, READS, tool } from './shared';
import { buildCorpus, diffSummary, verifyQuote, type Corpus, type ReadLink, type VerifyResult, type VerifyUnit } from './verifyCore.js';

/** The reader on the website opens at a verse: https://living-bread.org/bible?open=john.3.16 (answers 200). */
export const readLink: ReadLink = (u) => `${SITE}/bible?open=${u.bookId}.${u.chapter}.${u.verse}`;

export interface CorpusProvider {
  id: string;
  name: string;
  license: string;
  coverage: string;
  /** Build (once per isolate) or return null when the stored text cannot be read. */
  load(env: Env): Promise<Corpus | null>;
}

/* ---- the King James Version, the whole Bible ---------------------------------------------------- */
let kjvCorpus: Promise<Corpus | null> | null = null;
const kjvIndex = new Map<string, number>();
const kjvBookSha = new Map<string, string>();

function loadKjv(env: Env): Promise<Corpus | null> {
  if (kjvCorpus) return kjvCorpus;
  kjvCorpus = (async () => {
    const books = await Promise.all(BOOKS.map((b) => loadBook(env, b.id)));
    if (books.some((b) => !b)) return null;
    const units: VerifyUnit[] = [];
    books.forEach((data, bi) => {
      const meta = BOOKS[bi];
      if (data?.sha256) kjvBookSha.set(meta.id, data.sha256);
      data!.c.forEach((ch, ci) => ch.forEach((t, vi) => {
        if (typeof t !== 'string' || !t.trim()) return;
        kjvIndex.set(`${meta.id}.${ci + 1}.${vi + 1}`, units.length);
        units.push({ key: `${meta.id}.${ci + 1}.${vi + 1}`, ref: `${meta.name} ${ci + 1}:${vi + 1}`, bookId: meta.id, book: meta.name, chapter: ci + 1, verse: vi + 1, text: t, group: `${meta.id}.${ci + 1}` });
      }));
    });
    return buildCorpus({ id: 'KJV', name: CORPUS.translation_name, license: CORPUS.license, coverage: CORPUS.canon }, units);
  })();
  kjvCorpus.then((c) => { if (!c) kjvCorpus = null; });
  return kjvCorpus;
}

/* ---- the World English Bible passages the repository caches ------------------------------------ */
let webCorpus: Corpus | null = null;
function loadWeb(): Corpus {
  if (webCorpus) return webCorpus;
  const units: VerifyUnit[] = [];
  for (const [key, v] of Object.entries(WEB as Record<string, { ref: string; text: string }>)) {
    const m = key.match(/^([a-z0-9]+)\.(\d+)\.(\d+)-(\d+)$/);
    const b = m ? bookById(m[1]) : undefined;
    if (!m || !b) continue;
    const from = Number(m[3]);
    const to = Number(m[4]);
    units.push({ key, ref: v.ref, bookId: b.id, book: b.name, chapter: Number(m[2]), verse: from, ...(to > from ? { to } : {}), text: v.text, group: key });
  }
  webCorpus = buildCorpus({ id: 'WEB', name: 'World English Bible', license: 'Public domain', coverage: `${units.length} passages cached in the repository (src/data/web.json), not the whole Bible` }, units);
  return webCorpus;
}

/** Every held translation, in order. Adding a held translation is adding one entry here. */
export const CORPUS_PROVIDERS: CorpusProvider[] = [
  { id: 'KJV', name: CORPUS.translation_name, license: CORPUS.license, coverage: `${CORPUS.canon}, ${CORPUS.verses} verses`, load: loadKjv },
  { id: 'WEB', name: 'World English Bible', license: 'Public domain', coverage: 'a limited set of passages cached in the repository', load: async () => loadWeb() },
];

export interface VerifyPayload extends Record<string, unknown> {
  verdict: VerifyResult['verdict'];
  verdict_sentence: string;
}
export interface VerifyError { error: string; reason: string }
export function isVerifyError(v: VerifyPayload | VerifyError): v is VerifyError {
  return typeof (v as VerifyError).error === 'string' && !('verdict' in v);
}

function sentenceFor(r: VerifyResult, checked: string): string {
  const b = r.best;
  switch (r.verdict) {
    case 'verbatim':
      return `Verified: these words are held word for word at ${b!.ref} (${b!.translation_name})${b!.whole_verses ? '' : ', as part of the verse'}${b!.exact_characters ? '' : '; only letter case or punctuation differ'}`;
    case 'close_but_differs':
      return `Close, but not word for word: the nearest held text is ${b!.ref} (${b!.translation_name}). Quote the held words below, not the version sent`;
    case 'resembles':
      return `Resembles ${b!.ref} (${b!.translation_name}) but differs substantially: it may be a paraphrase, a memory of the verse, or a translation not held here. If it is presented as Scripture, quote the held words instead`;
    default:
      return `This wording is not found in any held translation (checked ${checked}). Do not present it as a quotation of the Bible`;
  }
}

/** The whole verification, shared by the MCP tool and the A2A skill. Returns null when no stored text could be read. */
export async function verifyForAgent(env: Env, quote: string, reference?: string | null): Promise<VerifyPayload | VerifyError> {
  const loaded = await Promise.all(CORPUS_PROVIDERS.map(async (p) => ({ p, corpus: await p.load(env).catch(() => null) })));
  const corpora = loaded.filter((x): x is { p: CorpusProvider; corpus: Corpus } => Boolean(x.corpus));
  if (!corpora.some((x) => x.p.id === 'KJV')) return { error: 'The stored Bible text could not be read just now. Please try again in a moment.', reason: 'unavailable' };
  const kjv = corpora.find((x) => x.p.id === 'KJV')!.corpus;

  let claimed: { corpus: Corpus; from: number; to: number; ref: string; readLink: ReadLink } | null = null;
  let claimedNote: string | null = null;
  if (reference && reference.trim()) {
    const p = parseReference(reference);
    if (!p) claimedNote = `"${reference}" is not a reference we can read with certainty, so only the words were checked`;
    else {
      const meta = bookById(p.bookId)!;
      const first = p.from ?? 1;
      const last = p.to ?? p.from;
      const fromIdx = kjvIndex.get(`${meta.id}.${p.chapter}.${first}`);
      let toIdx = last !== undefined ? kjvIndex.get(`${meta.id}.${p.chapter}.${last}`) : undefined;
      if (last === undefined && fromIdx !== undefined) {
        toIdx = fromIdx;
        while (toIdx + 1 < kjv.size && kjv.units[toIdx + 1].group === kjv.units[fromIdx].group) toIdx++;
      }
      if (fromIdx === undefined || toIdx === undefined) claimedNote = `${p.ref} is not held in the King James Version (no such verse), so only the words were checked`;
      else claimed = { corpus: kjv, from: fromIdx, to: toIdx, ref: p.ref, readLink };
    }
  }

  const result = await verifyQuote({ quote, corpora: corpora.map((x) => ({ corpus: x.corpus, readLink })), claimed });
  const checked = corpora.map((x) => `${x.p.name} (${x.p.id === 'KJV' ? `the whole Bible, ${x.corpus.size} verses` : `${x.corpus.size} cached passages`})`).join(' and ');

  // The words returned are Scripture read from the stored text: note them for the evidence label.
  for (const m of [result.best, ...result.alternatives]) {
    if (!m) continue;
    const bookId = BOOKS.find((b) => m.ref.startsWith(`${b.name} `))?.id;
    noteReading({ ref: m.ref, translation: m.translation === 'WEB' ? 'WEB' : 'KJV', text: m.text, ...(m.translation === 'KJV' && bookId ? { book: bookId, book_sha256: kjvBookSha.get(bookId) } : {}) });
  }
  if (result.claimed) noteReading({ ref: result.claimed.ref, translation: 'KJV', text: result.claimed.held_text });

  const differences = result.best ? diffSummary(result.best.diff) : [];
  const claimedSentence = result.claimed
    ? result.claimed.match === 'verbatim'
      ? `The claimed reference ${result.claimed.ref} holds these words`
      : result.claimed.is_where_the_words_are
        ? `The claimed reference ${result.claimed.ref} is the right place, but the wording differs from it`
        : `The claimed reference ${result.claimed.ref} does not hold these words${result.best ? `; the nearest held text is ${result.best.ref}` : ''}`
    : claimedNote;
  const source_url = result.best?.read_in_context ?? `${SITE}/bible`;
  return {
    verdict: result.verdict,
    verdict_sentence: sentenceFor(result, checked),
    quote: quote.trim(),
    quote_words: result.quote_words,
    claimed_reference: reference ?? null,
    claimed_check: result.claimed,
    claimed_sentence: claimedSentence,
    best_match: result.best,
    alternatives: result.alternatives,
    differences,
    not_found: result.verdict === 'not_found' ? `This wording is not found in any held translation (checked ${checked}).` : null,
    corpora_checked: corpora.map((x) => ({ id: x.p.id, name: x.p.name, license: x.p.license, coverage: x.p.coverage, units: x.corpus.size })),
    method: 'Word level comparison after folding letter case, accents and punctuation; an inverted index finds candidate verses and a semi-global alignment finds the best span (it may cross verses inside one chapter). Thresholds: verbatim when every word matches in order; close_but_differs at 80 percent of words or more; resembles at 50 percent and at least four words; otherwise not found.',
    limits: 'Only the translations listed in corpora_checked are held. A faithful quotation from a translation not held here (for example a modern copyrighted one) will show as differing; that is not proof it is wrong, only that these stored texts do not hold those words.',
    hash_rule: 'sha256 is the SHA-256 of the UTF-8 verse text exactly as stored, trimmed; text_sha256 covers the matched verses joined by single spaces.',
    source_url,
    read_more: source_url,
    content_layers: layers({ scripture: ['best_match.text', 'best_match.verses[].text', 'alternatives[].text', 'claimed_check.held_text'], navigation: ['source_url'] }),
  };
}

export function registerVerify(server: McpServer, env: Env): void {
  tool(server, 'verify_scripture_quote', {
    title: 'Verify a Scripture quotation',
    description: 'Check whether quoted words are really in the Bible, word for word, against the stored King James Version (the whole Bible) and the World English Bible passages cached here, and return the real wording when they are not. Use before presenting any remembered or user supplied wording as a quotation of Scripture ("is this a real Bible verse", "where is this verse from", "did the Bible say this"). Not for reading a known reference (scripture_passage), finding verses by a word (scripture_search), or reading a verse in another of the stored translations (compare_translations); quotations from other translations are not matched, so a faithful quotation of a translation not checked here shows as differing, which is not proof it is wrong. quote is the exact words as they would be quoted; reference, optional, is where they are attributed and is checked too. Returns verdict (verbatim, close_but_differs, resembles, not_found) with a verdict_sentence, best_match (reference, translation, stored text, SHA-256 per verse and for the whole match, word diff), alternatives, claimed_check, differences, not_found, and corpora_checked. Matching folds case, accents and punctuation; deterministic, no network; an unreadable stored text returns an error to retry.',
    inputSchema: {
      quote: z.string().min(3).max(2000).describe('The exact words to check, as they would be quoted.'),
      reference: z.string().max(80).optional().describe('Optional: the reference the words are attributed to, e.g. "John 3:16" or "Philippians 4:13".'),
    },
    outputSchema: out({
      verdict: z.enum(['verbatim', 'close_but_differs', 'resembles', 'not_found']).describe('verbatim: every word held in order; close_but_differs: 80 percent of words or more; resembles: 50 percent and at least four words; not_found: nothing held is close.'),
      verdict_sentence: z.string().describe('One plain sentence stating the verdict and what to quote instead.'),
      best_match: z.looseObject({ ref: z.string(), translation: z.string(), text: z.string(), text_sha256: z.string(), verses: z.array(z.looseObject({ ref: z.string(), text: z.string(), sha256: z.string() })), diff: z.array(z.looseObject({ op: z.string() })) }).nullable().describe('The closest held text: reference, translation, verbatim stored words, SHA-256 of the whole match, each verse with its own hash, and the word diff against the quote; null when not_found.'),
      alternatives: z.array(z.looseObject({ ref: z.string(), translation: z.string(), text: z.string() })).describe('Other close held passages, verbatim.'),
      claimed_check: z.looseObject({ ref: z.string(), match: z.string() }).nullable().describe('When reference was given and read: whether that reference holds the words; null otherwise.'),
      differences: z.array(z.string()).describe('Readable list of the words that differ from the held text.'),
      not_found: z.string().nullable().describe('Sentence naming the texts checked, present only when not_found.'),
      corpora_checked: z.array(z.looseObject({ id: z.string(), name: z.string(), license: z.string() })).describe('The stored texts compared against, with license and coverage.'),
      source_url: z.string().describe('Web page where the best match can be read in context.'),
    }),
    annotations: READS,
  }, async ({ quote, reference }) => {
    const v = await verifyForAgent(env, quote, reference);
    if (isVerifyError(v)) return fail(v.error, { reason: v.reason, try_instead: [`${SITE}/bible`, 'the same call again in a minute'] });
    const b = v.best_match as VerifyResult['best'];
    return ok(paragraph([
      v.verdict_sentence,
      b && v.verdict !== 'verbatim' && (v.differences as string[]).length ? `Differences: ${(v.differences as string[]).slice(0, 6).join('; ')}` : null,
      b ? `The held text (${b.ref}, ${b.translation}): "${b.text}"` : null,
      v.claimed_sentence as string | null,
      b ? `SHA-256 of the held text: ${b.text_sha256}. Read it in context at ${b.read_in_context}` : null,
    ]), v);
  });
}
