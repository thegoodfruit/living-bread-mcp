/* ============================================================
   THE LIVING BREAD MCP, reading the house's own pages.

   living-bread.org carries hand-written families of pages: a prayer for
   every situation, what the Bible says about three hundred topics, the
   parables and miracles of Jesus, what Christians believe, the hymns, the
   thresholds of life, Come and See for seekers of other faiths, and the
   answers. The words on those pages are the house's; an assistant should
   quote them rather than compose its own. So these tools read a page at
   call time, keep its headings and paragraphs, drop its navigation, and
   re-read every Scripture reference it names from the stored King James
   text (src/kjv.ts). Nothing here is remembered or generated; when a page
   cannot be reached, the tool says so and hands over the door.
   ============================================================ */
import { SITE } from './doors';
import { kjvByRef } from './kjv';
import { noDashes, slugify } from './render';

const UA = 'TheLivingBread-MCP/1.0 (+https://mcp.living-bread.org)';
const TTL_MS = 60 * 60_000;

const pageCache = new Map<string, { at: number; html: string | null }>();

async function fetchHTML(path: string): Promise<string | null> {
  const hit = pageCache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.html;
  let html: string | null = null;
  try {
    const r = await fetch(`${SITE}${path}`, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(9000) });
    if (r.ok) html = await r.text();
  } catch {
    html = null;
  }
  pageCache.set(path, { at: Date.now(), html });
  return html;
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;|&#8217;/g, '’').replace(/&lsquo;|&#8216;/g, '‘').replace(/&ldquo;|&#8220;/g, '“').replace(/&rdquo;|&#8221;/g, '”')
    .replace(/&hellip;/g, '...').replace(/&middot;/g, '·').replace(/&rarr;/g, '').replace(/&larr;/g, '').replace(/&mdash;|&ndash;|&#8212;|&#8211;/g, ', ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

function textOf(fragment: string): string {
  return noDashes(decode(fragment.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
}

export interface Block { tag: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'blockquote'; text: string }
export interface HouseLink { href: string; label: string }
export interface HousePage {
  path: string;
  url: string;
  title: string;
  description: string | null;
  blocks: Block[];
  links: HouseLink[];
}

function mainOf(html: string): string {
  const m = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  return m ? m[1] : html;
}

/** The page as the house wrote it: headings and paragraphs inside <main>, navigation removed. */
export async function housePage(path: string): Promise<HousePage | null> {
  const html = await fetchHTML(path);
  if (!html) return null;
  const title = textOf((html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').replace(/\s*\|\s*The Living Bread\s*$/, ''));
  const description = html.match(/<meta\s+name="description"\s+content="([^"]*)"/)?.[1] ?? null;
  let main = mainOf(html).replace(/<(script|style|nav|footer|form)[^>]*>[\s\S]*?<\/\1>/g, '');
  const blocks: Block[] = [];
  const re = /<(h1|h2|h3|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(main)) && blocks.length < 80) {
    const text = textOf(m[2]);
    if (!text) continue;
    /* breadcrumbs and eyebrows are navigation, not the page */
    if (/›/.test(text) && text.length < 90) continue;
    blocks.push({ tag: m[1] as Block['tag'], text });
  }
  const links: HouseLink[] = [];
  const seen = new Set<string>();
  const lre = /<a\b[^>]*href="(\/[a-z0-9@/_.%-]*)"[^>]*>([\s\S]*?)<\/a>/g;
  while ((m = lre.exec(main)) && links.length < 400) {
    const label = textOf(m[2]);
    if (!label || seen.has(m[1])) continue;
    seen.add(m[1]);
    links.push({ href: m[1], label });
  }
  main = '';
  return { path, url: `${SITE}${path}`, title, description: description ? textOf(description) : null, blocks, links };
}

/** The entries of a hub page (the links that live under a prefix or match a pattern). */
export async function hubEntries(hubPath: string, accept: (href: string) => boolean): Promise<HouseLink[] | null> {
  const page = await housePage(hubPath);
  if (!page) return null;
  return page.links.filter((l) => accept(l.href) && l.href !== hubPath);
}

function tokens(s: string): string[] {
  return slugify(s).split('-').filter((w) => w && !['the', 'a', 'an', 'of', 'and', 'for', 'to', 'in', 'on', 'my', 'about', 'what', 'does', 'bible', 'say', 'prayer', 'jesus', 'parable', 'miracle', 'christianity', 'is', 'who', 'are'].includes(w));
}

/** Pick the hub entry a person means. Exact slug first, then every word matched, then most words. Null when nothing fits. */
export function pickEntry(entries: HouseLink[], query: string): { entry: HouseLink; exact: boolean } | null {
  const q = slugify(query);
  if (!q) return null;
  const bySlug = entries.find((e) => e.href.split('/').filter(Boolean).pop() === q || e.href.split('/').filter(Boolean).pop()?.replace(/^(parable-of|miracle|prayer-for|what-jesus-said-about|christianity-and)-?/, '') === q.replace(/^(parable-of|miracle|prayer-for|what-jesus-said-about|christianity-and)-?/, ''));
  if (bySlug) return { entry: bySlug, exact: true };
  const want = tokens(query);
  if (!want.length) return null;
  let best: { entry: HouseLink; score: number } | null = null;
  for (const e of entries) {
    const hay = new Set([...tokens(e.label), ...tokens(e.href.replace(/\//g, ' '))]);
    const score = want.reduce((n, w) => n + (hay.has(w) ? 1 : [...hay].some((h) => h.startsWith(w) || w.startsWith(h)) ? 0.5 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { entry: e, score };
  }
  if (!best) return null;
  /* at least half the asked words have to be there, or we would be guessing */
  if (best.score < Math.max(1, want.length / 2)) return null;
  return { entry: best.entry, exact: best.score >= want.length };
}

const REF_RE = /\b((?:[1-3]\s?)?(?:Song of Solomon|[A-Z][a-z]+)(?:\s[A-Z][a-z]+)?)\s(\d{1,3}):(\d{1,3})(?:\s?-\s?(\d{1,3}))?\b/g;

/** The Scripture references a page names, re-read from the stored KJV (never the page's own typing). */
export async function versesNamedIn(env: Env, blocks: Block[], max = 4): Promise<{ ref: string; text: string }[]> {
  const refs: string[] = [];
  for (const b of blocks) {
    let m: RegExpExecArray | null;
    REF_RE.lastIndex = 0;
    while ((m = REF_RE.exec(b.text))) {
      const ref = `${m[1]} ${m[2]}:${m[3]}${m[4] ? `-${m[4]}` : ''}`;
      if (!refs.includes(ref)) refs.push(ref);
    }
  }
  const out: { ref: string; text: string }[] = [];
  for (const ref of refs) {
    if (out.length >= max) break;
    const p = await kjvByRef(env, ref);
    if (p) out.push({ ref: p.ref, text: p.text });
  }
  return out;
}

/** The body of a page as readable prose: headings as sentences, paragraphs as they are, capped. */
export function prose(blocks: Block[], maxChars = 1800): string {
  const parts: string[] = [];
  let n = 0;
  for (const b of blocks) {
    if (b.tag === 'h1') continue;
    const t = b.tag === 'h2' || b.tag === 'h3' ? `${b.text}:` : b.text;
    if (n + t.length > maxChars) break;
    parts.push(t);
    n += t.length;
  }
  return parts.join(' ');
}
