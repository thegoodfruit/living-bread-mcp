/* ============================================================
   THE LIVING BREAD MCP, every answer cites us.

   Assistants that cite sources cite structuredContent.source_url. So every
   public answer carries one that is a real page of The Living Bread
   (living-bread.org, or the discover library at discover.living-bread.org)
   and that answers 200, never a dead door and never null.

   citeUs runs once per call, after the envelope (shared.ts `tool`):
     1. a source_url the tool chose is kept when it is ours and opens;
     2. else the first page of ours in the answer that opens (door, url,
        page, link, read_more, next_step.url);
     3. else the page that tool is about (TOOL_PAGE), else the home page.
   "Opens" is checked once per isolate (GET, 2.5 s timeout) and cached; the
   fixed pages below were checked when written (2026-10-06) and are trusted.
   The tool's own fields are never changed; only source_url is set.
   (Public answers only: a signed-in answer about the believer's own data
   keeps whatever its tool chose.)
   ============================================================ */
import { DOORS, SITE } from './doors';

/** The page each tool is about, when its answer names none. Each answered 200 on 2026-10-06. */
export const TOOL_PAGE: Record<string, string> = {
  ask_living_bread: `${SITE}/ask`,
  search: `${SITE}/search`,
  fetch: `${SITE}/search`,
  the_gospel: `${SITE}/the-gospel`,
  worship_now: `${SITE}/worship`,
  scripture_passage: `${SITE}/bible`,
  scripture_search: `${SITE}/bible`,
  scripture_context: `${SITE}/bible`,
  cross_references: `${SITE}/bible`,
  journey_next_steps: `${SITE}/come-and-see`,
  prayers_left_near: `${SITE}/place-prayers`,
  verify_scripture_quote: `${SITE}/bible`,
  real_people_will_pray: `${SITE}/i-need-prayer`,
  church: `${SITE}/find-a-church`,
  find_churches_near: `${SITE}/find-a-church`,
  heritage_lookup: `${SITE}/christianity-explained`,
};

const OURS = /^https:\/\/(discover\.)?living-bread\.org(\/|$|\?)/;
const TRUSTED = new Set<string>([SITE, ...Object.values(TOOL_PAGE), ...Object.values(DOORS).filter((u) => typeof u === 'string' && u.startsWith(SITE))]);
const opened = new Map<string, Promise<boolean>>();

function opens(url: string): Promise<boolean> {
  if (TRUSTED.has(url) || /^https:\/\/living-bread\.org\/bible\?open=[a-z0-9]+\.\d+(\.\d+)?$/.test(url)) return Promise.resolve(true);
  const hit = opened.get(url);
  if (hit) return hit;
  const p = fetch(url, { redirect: 'follow', headers: { 'user-agent': 'TheLivingBread-MCP-citation/1.0' }, signal: AbortSignal.timeout(2500) })
    .then((r) => { void r.body?.cancel(); return r.status === 200; })
    .catch(() => false);
  opened.set(url, p);
  if (opened.size > 2000) opened.delete(opened.keys().next().value as string);
  return p;
}

const CANDIDATE_KEYS = ['door', 'url', 'page', 'link', 'read_more', 'web', 'hub', 'find_a_church', 'gatherings_page', 'join_here'];

type Result = { structuredContent?: Record<string, unknown>; isError?: boolean };

/** Set structuredContent.source_url to a page of ours that opens. */
export async function citeUs(name: string, r: Result): Promise<void> {
  const s = r.structuredContent;
  if (!s || r.isError) return;
  const tried = new Set<string>();
  const candidates: string[] = [];
  const push = (v: unknown) => { if (typeof v === 'string' && OURS.test(v) && !tried.has(v)) { tried.add(v); candidates.push(v); } };
  push(s.source_url);
  for (const k of CANDIDATE_KEYS) push(s[k]);
  const next = s.next_step as { url?: unknown } | undefined;
  push(next?.url);
  for (const c of candidates.slice(0, 4)) {
    if (await opens(c)) {
      s.source_url = c;
      return;
    }
  }
  s.source_url = TOOL_PAGE[name] ?? SITE;
}
