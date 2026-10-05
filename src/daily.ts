/* ============================================================
   THE LIVING BREAD MCP, the Daily Bread.

   The whole family receives the same verse each morning. The reference for a
   day is chosen by public.send_daily_bread (supabase/migrations/0299): the
   number of days since 2026-01-01, modulo 88, indexes this list. The list
   here is that list, extracted from the migration, so an assistant hands a
   person the SAME bread the family received. The words are resolved from the
   stored KJV at call time, never typed.
   ============================================================ */

export const DAILY_BREAD_EPOCH = '2026-01-01';

export const DAILY_BREAD_REFS: readonly string[] = [
  'John 15:4', 'Philippians 4:6', 'Proverbs 3:5', 'Matthew 6:33', 'Psalm 46:10', 'Joshua 1:9',
  'Romans 12:2', 'Galatians 5:22', 'Isaiah 40:31', 'Matthew 5:16', 'Philippians 4:13', '1 John 4:19',
  'Psalm 23:1', 'Matthew 11:28', 'Colossians 3:23', 'James 1:22', 'Ephesians 4:32', 'Psalm 119:105',
  'Micah 6:8', 'Hebrews 12:2', '2 Corinthians 5:17', 'Psalm 37:4', 'Romans 8:28', 'John 13:34',
  '1 Thessalonians 5:16', 'Proverbs 16:3', 'Matthew 22:37', 'Psalm 51:10', 'John 8:12', 'Lamentations 3:22',
  'Matthew 28:19', 'Psalm 34:8', '1 Peter 5:7', 'Galatians 6:9', 'John 3:16', 'Psalm 143:8',
  'John 6:35', 'Psalm 27:1', 'Psalm 34:18', 'Psalm 42:1', 'Psalm 90:12', 'Psalm 100:4',
  'Psalm 118:24', 'Psalm 121:2', 'Psalm 139:23', 'Proverbs 4:23', 'Proverbs 16:9', 'Proverbs 18:10',
  'Isaiah 26:3', 'Isaiah 41:10', 'Isaiah 43:2', 'Isaiah 53:5', 'Jeremiah 29:11', 'Deuteronomy 31:8',
  'Zephaniah 3:17', 'Matthew 5:9', 'Matthew 6:14', 'Matthew 6:21', 'Matthew 7:7', 'Luke 12:32',
  'John 14:27', 'John 15:13', 'John 16:33', 'Acts 20:35', 'Romans 5:8', 'Romans 15:13',
  '1 Corinthians 16:14', 'Galatians 2:20', 'Ephesians 2:8', 'Philippians 1:6', 'Hebrews 11:1', 'Hebrews 13:8',
  'James 1:5', 'James 4:8', '1 John 1:9', 'Revelation 21:5', 'John 13:35', 'Romans 12:12',
  'Psalm 121:1', '2 Timothy 1:7', '1 Peter 2:9', 'Hosea 6:3', 'John 1:5', 'Habakkuk 3:17-18',
  'Matthew 5:14', 'Ecclesiastes 3:11', 'Isaiah 30:15', 'Romans 8:38-39',
];

const DAY_MS = 86_400_000;

/** A calendar date as YYYY-MM-DD, UTC. The person's own date may be passed instead. */
export function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Mirrors `mod((current_date - date '2026-01-01')::int, 88)`, kept non-negative for days before the epoch. */
export function dailyBreadOrdinal(dateISO: string): number {
  const days = Math.round((Date.parse(`${dateISO}T00:00:00Z`) - Date.parse(`${DAILY_BREAD_EPOCH}T00:00:00Z`)) / DAY_MS);
  const n = DAILY_BREAD_REFS.length;
  return ((days % n) + n) % n;
}

export function dailyBreadReference(dateISO: string): string {
  return DAILY_BREAD_REFS[dailyBreadOrdinal(dateISO)];
}
