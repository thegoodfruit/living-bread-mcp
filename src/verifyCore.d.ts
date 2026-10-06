/* Types for verifyCore.js (plain JavaScript so the discover worker and Node tests share it). */

export interface VerifyUnit {
  key: string;
  ref: string;
  bookId: string;
  book: string;
  chapter: number;
  verse: number;
  /** Last verse when one unit holds a passage (a cached span), else undefined. */
  to?: number;
  text: string;
  /** Units of one group are contiguous text; a match may span several units of one group. */
  group: string;
}

export interface CorpusMeta {
  id: string;
  name: string;
  license: string;
  coverage?: string;
  language?: string;
}

export interface Corpus {
  meta: CorpusMeta;
  units: VerifyUnit[];
  postings: Map<string, number[]>;
  tokenCounts: Uint32Array;
  size: number;
}

export type Verdict = 'verbatim' | 'close_but_differs' | 'resembles' | 'not_found';

export type DiffOp =
  | { op: 'same'; text: string }
  | { op: 'changed'; quoted: string; held: string }
  | { op: 'added'; quoted: string }
  | { op: 'missing'; held: string };

export interface MatchDescription {
  ref: string;
  translation: string;
  translation_name: string;
  license: string;
  text: string;
  text_sha256: string;
  verses: { ref: string; text: string; sha256: string }[];
  match: Verdict;
  similarity: number;
  whole_verses: boolean;
  exact_characters: boolean;
  words_matched: number;
  diff: DiffOp[];
  read_in_context: string | null;
}

export interface ClaimedCheck {
  ref: string;
  held_text: string;
  held_sha256: string;
  match: Verdict;
  similarity: number;
  diff: DiffOp[];
  is_where_the_words_are: boolean;
}

export interface VerifyResult {
  verdict: Verdict;
  best: MatchDescription | null;
  alternatives: MatchDescription[];
  claimed: ClaimedCheck | null;
  quote_words: number;
}

export type ReadLink = (u: VerifyUnit) => string;

export function tokenize(text: string): { norm: string[]; raw: string[] };
export function normTokens(text: string): string[];
export function buildCorpus(meta: CorpusMeta, units: VerifyUnit[]): Corpus;
export function align(q: string[], h: string[]): { distance: number; start: number; end: number; ops: { op: string; qi?: number; hj?: number }[] };
export function diffSummary(diff: DiffOp[]): string[];
export function sha256Hex(s: string): Promise<string>;
export function verifyQuote(args: {
  quote: string;
  corpora: { corpus: Corpus; readLink?: ReadLink }[];
  claimed?: { corpus: Corpus; from: number; to: number; ref: string; readLink?: ReadLink } | null;
}): Promise<VerifyResult>;
