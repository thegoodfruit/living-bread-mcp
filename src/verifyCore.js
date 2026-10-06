/* ============================================================
   THE LIVING BREAD, Scripture verification: the matching core.

   Pure JavaScript with no imports, so the SAME code runs in the MCP Worker
   (mcp/src/verify.ts), on the discover worker (/api/verify,
   render-service/lib/verify.js) and in Node tests. Types: verifyCore.d.ts.

   What it does. A quoted text is compared with every verse of every held
   corpus. An inverted index finds the verses that share the quote's rarer
   words; a semi-global word alignment (edit distance where the held text
   may start and end anywhere) then finds the best matching span, which may
   cross verse boundaries inside one chapter. The alignment is the diff.

   It never generates a word of Scripture. Every word it returns is a word
   of a held corpus, read from the stored text, or a word of the quote the
   caller sent. When nothing held is close, it says so.

   Normalization (for matching only; the returned text is always the stored
   text as stored): Unicode NFKD with combining marks removed, lower case,
   curly quotes folded, punctuation removed, Han, kana, Thai, Lao, Khmer and
   Burmese characters treated one character to a token.
   ============================================================ */

const SPLIT_CHARS = /[぀-ヿ㐀-鿿豈-﫿฀-໿က-႟ក-៿]/u;

/** One word as it is compared, and as it was written. */
export function tokenize(text) {
  const norm = [];
  const raw = [];
  const src = String(text ?? '');
  const re = /[\p{L}\p{N}\p{M}'’ʼ]+/gu;
  let m;
  while ((m = re.exec(src))) {
    const word = m[0];
    const n = fold(word);
    if (!n) continue;
    if (SPLIT_CHARS.test(n)) {
      for (const ch of n) {
        if (/[\p{L}\p{N}]/u.test(ch)) { norm.push(ch); raw.push(ch); }
      }
      continue;
    }
    norm.push(n);
    raw.push(word.replace(/^['’ʼ]+|['’ʼ]+$/g, ''));
  }
  return { norm, raw };
}

/** The compared words only (the same words tokenize().norm gives), fast enough to index a whole Bible. */
export function normTokens(text) {
  const s = String(text ?? '');
  if (SPLIT_CHARS.test(s)) return tokenize(s).norm;
  if (/^[\x00-\x7f]*$/.test(s)) return s.toLowerCase().replace(/'/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  return fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function fold(word) {
  return word
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['’ʼ]/g, '');
}

/** Whitespace collapsed, for the exact character check. */
function squashSpace(s) {
  return String(s ?? '').replace(/[“”„"]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * Build a searchable corpus once (callers cache it for the life of the isolate).
 * units: [{ key, ref, bookId, book, chapter, verse, text, group }] in canonical order;
 * `group` is the chapter (or a single passage) inside which a match may span several units.
 */
export function buildCorpus(meta, units) {
  const postings = new Map();
  const tokenCounts = new Uint32Array(units.length);
  for (let i = 0; i < units.length; i++) {
    const norm = normTokens(units[i].text);
    tokenCounts[i] = norm.length;
    const seen = new Set(norm);
    for (const t of seen) {
      let p = postings.get(t);
      if (!p) { p = []; postings.set(t, p); }
      p.push(i);
    }
  }
  return { meta, units, postings, tokenCounts, size: units.length };
}

/** The verses that share the most (rarer) words with the quote, best first. */
function candidates(corpus, qnorm, k) {
  const N = corpus.size;
  if (!N) return [];
  const distinct = [...new Set(qnorm)];
  const withDf = distinct.map((t) => ({ t, p: corpus.postings.get(t) })).filter((x) => x.p && x.p.length);
  if (!withDf.length) return [];
  // Very common words (in more than a fifth of all verses) are left to the alignment, unless
  // they are all the quote has.
  let use = withDf.filter((x) => x.p.length <= N * 0.2);
  if (!use.length) use = withDf;
  const score = new Float64Array(N);
  const touched = [];
  for (const { p } of use) {
    const idf = Math.log(1 + N / p.length);
    for (const i of p) {
      if (score[i] === 0) touched.push(i);
      score[i] += idf;
    }
  }
  touched.sort((a, b) => score[b] - score[a] || a - b);
  return touched.slice(0, k);
}

/**
 * Semi-global alignment of the quote (q) against held words (h): the quote must be aligned
 * whole; the held text may begin and end anywhere. Returns the edit distance, the held span,
 * and the operations in order.
 */
export function align(q, h) {
  const m = q.length;
  const n = h.length;
  const W = n + 1;
  const D = new Int32Array((m + 1) * W);
  for (let i = 1; i <= m; i++) D[i * W] = i;
  for (let i = 1; i <= m; i++) {
    const qi = q[i - 1];
    for (let j = 1; j <= n; j++) {
      const sub = D[(i - 1) * W + j - 1] + (qi === h[j - 1] ? 0 : 1);
      const del = D[(i - 1) * W + j] + 1; // a quoted word the held text does not have
      const ins = D[i * W + j - 1] + 1; // a held word the quote left out
      D[i * W + j] = sub < del ? (sub < ins ? sub : ins) : (del < ins ? del : ins);
    }
  }
  let end = 0;
  let best = Infinity;
  for (let j = 0; j <= n; j++) {
    const v = D[m * W + j];
    if (v < best) { best = v; end = j; }
  }
  const ops = [];
  let i = m;
  let j = end;
  while (i > 0) {
    const cur = D[i * W + j];
    if (j > 0 && cur === D[(i - 1) * W + j - 1] + (q[i - 1] === h[j - 1] ? 0 : 1)) {
      ops.push({ op: q[i - 1] === h[j - 1] ? 'same' : 'changed', qi: i - 1, hj: j - 1 });
      i--; j--;
    } else if (cur === D[(i - 1) * W + j] + 1) {
      ops.push({ op: 'added', qi: i - 1 });
      i--;
    } else {
      ops.push({ op: 'missing', hj: j - 1 });
      j--;
    }
  }
  ops.reverse();
  return { distance: best, start: j, end, ops };
}

/** Consecutive operations of the same kind, as words a person can read. */
function readableDiff(ops, qraw, hraw) {
  const out = [];
  for (const o of ops) {
    const last = out[out.length - 1];
    const quoted = o.qi !== undefined ? qraw[o.qi] : null;
    const held = o.hj !== undefined ? hraw[o.hj] : null;
    if (last && last.op === o.op) {
      if (quoted !== null) last.quoted = last.quoted ? `${last.quoted} ${quoted}` : quoted;
      if (held !== null) last.held = last.held ? `${last.held} ${held}` : held;
    } else {
      out.push({ op: o.op, quoted, held });
    }
  }
  return out.map((d) => {
    if (d.op === 'same') return { op: 'same', text: d.held };
    if (d.op === 'changed') return { op: 'changed', quoted: d.quoted, held: d.held };
    if (d.op === 'added') return { op: 'added', quoted: d.quoted };
    return { op: 'missing', held: d.held };
  });
}

export function diffSummary(diff) {
  const parts = [];
  for (const d of diff) {
    if (d.op === 'changed') parts.push(`the quote says "${d.quoted}" where the held text says "${d.held}"`);
    else if (d.op === 'added') parts.push(`the quote adds "${d.quoted}"`);
    else if (d.op === 'missing') parts.push(`the quote leaves out "${d.held}"`);
  }
  return parts;
}

const RANK = { verbatim: 3, close_but_differs: 2, resembles: 1, not_found: 0 };

function verdictOf(distance, matches, m, spanLen) {
  const sim = matches / Math.max(m, spanLen, 1);
  if (distance === 0) return { verdict: 'verbatim', similarity: 1 };
  if (m >= 3 && sim >= 0.8) return { verdict: 'close_but_differs', similarity: sim };
  if (m >= 4 && sim >= 0.5 && matches >= 4) return { verdict: 'resembles', similarity: sim };
  return { verdict: 'not_found', similarity: sim };
}

/** Align a quote against a run of units [from, to] of one corpus. */
function alignUnits(corpus, quote, qtok, from, to) {
  const hnorm = [];
  const hraw = [];
  const owner = [];
  for (let u = from; u <= to; u++) {
    const t = tokenize(corpus.units[u].text);
    for (let w = 0; w < t.norm.length; w++) { hnorm.push(t.norm[w]); hraw.push(t.raw[w]); owner.push(u); }
  }
  if (!hnorm.length) return null;
  const a = align(qtok.norm, hnorm);
  const matches = a.ops.filter((o) => o.op === 'same').length;
  // the span of held words the quote covers, trimmed of leading or trailing omissions
  let s = a.start;
  let e = a.end - 1;
  const used = a.ops.filter((o) => o.hj !== undefined && o.op !== 'missing').map((o) => o.hj);
  if (used.length) { s = Math.min(...used); e = Math.max(...used); }
  const ops = a.ops.filter((o) => !(o.op === 'missing' && (o.hj < s || o.hj > e)));
  const spanLen = Math.max(0, e - s + 1);
  const v = verdictOf(a.distance - (a.ops.length - ops.length), matches, qtok.norm.length, spanLen);
  const firstUnit = spanLen ? owner[s] : from;
  const lastUnit = spanLen ? owner[e] : from;
  // whole verses: the span starts at a verse's first word and ends at a verse's last word
  const wholeVerses = spanLen > 0 && (s === 0 || owner[s - 1] !== owner[s]) && (e === owner.length - 1 || owner[e + 1] !== owner[e]);
  return {
    corpus,
    firstUnit,
    lastUnit,
    distance: a.distance - (a.ops.length - ops.length),
    matches,
    spanLen,
    verdict: v.verdict,
    similarity: Math.round(v.similarity * 1000) / 1000,
    wholeVerses,
    diff: readableDiff(ops, qtok.raw, hraw),
  };
}

function rangeFor(corpus, i, reach) {
  const g = corpus.units[i].group;
  let from = i;
  let to = i;
  while (from > 0 && i - from < reach && corpus.units[from - 1].group === g) from--;
  while (to < corpus.size - 1 && to - i < reach && corpus.units[to + 1].group === g) to++;
  return [from, to];
}

/** The best match for a quote inside one corpus, and the runners up. */
export function matchInCorpus(corpus, quote, opts = {}) {
  const qtok = tokenize(quote);
  if (!qtok.norm.length) return { best: null, others: [] };
  const reach = Math.max(1, Math.min(8, Math.ceil(qtok.norm.length / 15)));
  const cands = candidates(corpus, qtok.norm, opts.candidates ?? 12);
  const seen = new Set();
  const results = [];
  for (const i of cands) {
    const [from, to] = rangeFor(corpus, i, reach);
    const key = `${from}-${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = alignUnits(corpus, quote, qtok, from, to);
    if (r) results.push(r);
  }
  results.sort((a, b) => RANK[b.verdict] - RANK[a.verdict] || b.similarity - a.similarity || a.distance - b.distance);
  const uniq = [];
  const spans = new Set();
  for (const r of results) {
    const k = `${r.firstUnit}-${r.lastUnit}`;
    if (spans.has(k)) continue;
    spans.add(k);
    uniq.push(r);
  }
  return { best: uniq[0] ?? null, others: uniq.slice(1) };
}

/** Align a quote against the units of a claimed reference only (no search). */
export function matchAgainst(corpus, quote, from, to) {
  const qtok = tokenize(quote);
  if (!qtok.norm.length || from < 0 || to < from) return null;
  return alignUnits(corpus, quote, qtok, from, to);
}

export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A match as the public answer shows it: real references, stored words, per-verse hashes. */
export async function describeMatch(r, quote, readLink) {
  if (!r) return null;
  const units = r.corpus.units.slice(r.firstUnit, r.lastUnit + 1);
  const text = units.map((u) => u.text.trim()).join(' ');
  const first = units[0];
  const last = units[units.length - 1];
  const sameChapter = first.bookId === last.bookId && first.chapter === last.chapter;
  const ref = units.length === 1
    ? first.ref
    : sameChapter && first.to === undefined
      ? `${first.book} ${first.chapter}:${first.verse}-${last.verse}`
      : `${first.ref}; ${last.ref}`;
  const verses = await Promise.all(units.map(async (u) => ({ ref: u.ref, text: u.text.trim(), sha256: await sha256Hex(u.text.trim()) })));
  const exact = squashSpace(text).includes(squashSpace(quote).replace(/^["']+|["']+$/g, ''));
  return {
    ref,
    translation: r.corpus.meta.id,
    translation_name: r.corpus.meta.name,
    license: r.corpus.meta.license,
    text,
    text_sha256: await sha256Hex(text),
    verses,
    match: r.verdict,
    similarity: r.similarity,
    whole_verses: r.wholeVerses,
    exact_characters: exact,
    words_matched: r.matches,
    diff: r.diff,
    read_in_context: readLink ? readLink(first) : null,
  };
}

/**
 * Verify a quote against every corpus given. Pure apart from hashing.
 * corpora: [{ corpus, readLink? }]. claimed: { corpus, from, to, ref } or null.
 */
export async function verifyQuote({ quote, corpora, claimed }) {
  const trimmed = String(quote ?? '').trim();
  const per = corpora.map(({ corpus, readLink }) => ({ readLink, ...matchInCorpus(corpus, trimmed) }));
  const all = [];
  for (const p of per) {
    if (p.best) all.push({ r: p.best, readLink: p.readLink });
    for (const o of p.others) all.push({ r: o, readLink: p.readLink });
  }
  all.sort((a, b) => RANK[b.r.verdict] - RANK[a.r.verdict] || b.r.similarity - a.r.similarity || a.r.distance - b.r.distance);
  const top = all[0] ?? null;
  const verdict = top ? top.r.verdict : 'not_found';
  const best = top && verdict !== 'not_found' ? await describeMatch(top.r, trimmed, top.readLink) : null;
  const alternatives = [];
  for (const x of all.slice(1)) {
    if (alternatives.length >= 3) break;
    if (x.r.verdict === 'not_found') continue;
    alternatives.push(await describeMatch(x.r, trimmed, x.readLink));
  }
  let claimedCheck = null;
  if (claimed && claimed.corpus) {
    const c = matchAgainst(claimed.corpus, trimmed, claimed.from, claimed.to);
    if (c) {
      const d = await describeMatch(c, trimmed, claimed.readLink);
      const bestInside = Boolean(top && top.r.corpus === claimed.corpus && top.r.firstUnit >= claimed.from && top.r.lastUnit <= claimed.to);
      claimedCheck = { ref: claimed.ref, held_text: d.text, held_sha256: d.text_sha256, match: c.verdict, similarity: c.similarity, diff: c.diff, is_where_the_words_are: verdict !== 'not_found' && (bestInside || c.verdict === verdict) };
    }
  }
  return { verdict, best, alternatives, claimed: claimedCheck, quote_words: tokenize(trimmed).norm.length };
}
