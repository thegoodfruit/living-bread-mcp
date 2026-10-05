/* ============================================================
   THE LIVING BREAD MCP, rendering.

   Every tool returns compact structured output AND one paragraph of text an
   assistant can read aloud. These renderers are pure so a test can hold them
   still. House rules applied here: no em or en dash ever reaches a person
   (noDashes), and a sentence never claims more than its inputs say.
   ============================================================ */

/** The house has no em dashes. A dash between words becomes a comma; a bare one a colon. */
export function noDashes(s: string): string {
  return s
    .replace(/\s*[\u2013\u2014]\s*/g, ', ')
    .replace(/\s--\s/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/\s+,/g, ',');
}

/** Join sentence fragments into one paragraph, skipping empties, ending each with a period. */
export function paragraph(parts: ReadonlyArray<string | null | undefined | false>): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    const t = String(p).trim();
    if (!t) continue;
    out.push(/[.!?"”)]$/.test(t) ? t : `${t}.`);
  }
  return noDashes(out.join(' '));
}

export function km(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  if (n < 1) return 'under 1 km away';
  return `about ${Math.round(n)} km away`;
}

export function placeOf(c: { city?: string | null; region?: string | null; country?: string | null }): string {
  return [c.city, c.region, c.country].filter(Boolean).join(', ') || 'place not given';
}

export function whenUTC(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toUTCString().replace(' GMT', ' UTC');
}

export function list(items: readonly string[], max = 8): string {
  const shown = items.slice(0, max);
  if (!shown.length) return '';
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join('; ')}; and ${shown[shown.length - 1]}`;
}

/** "just now", "3 hours ago", "yesterday", "4 days ago". Empty for nothing. */
export function sinceWordOf(iso: string | null | undefined): string {
  if (!iso) return '';
  const h = Math.max(0, (Date.now() - new Date(iso).getTime()) / 36e5);
  if (!Number.isFinite(h)) return '';
  if (h < 1) return 'just now';
  if (h < 24) return `${Math.round(h)} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
