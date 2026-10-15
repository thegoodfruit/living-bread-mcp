/* ============================================================
   THE LIVING BREAD MCP, a group's own weekly rhythm, said honestly.

   A community leader can set a weekly prayer time (prayer_times, 0478): a
   title, the weekdays, an hour and a minute. There is NO time zone on it and
   nothing confirms it happened. So it is returned as what the group says, in
   the group's own time, never as a confirmed meeting and never converted.
   ============================================================ */
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface RhythmLike {
  rhythm_title?: string | null;
  rhythm_weekdays?: number[] | null;
  rhythm_hour?: number | null;
  rhythm_minute?: number | null;
}

export interface Rhythm {
  title: string;
  days: string[];
  at: string;
  self_described: true;
  time_zone: null;
  note: string;
}

/** The weekly rhythm a group set for itself, or null when none is set. Never claims it is happening. */
export function rhythmOf(c: RhythmLike): Rhythm | null {
  if (!c.rhythm_title || typeof c.rhythm_hour !== 'number' || c.rhythm_hour < 0 || c.rhythm_hour > 23) return null;
  const minute = typeof c.rhythm_minute === 'number' && [0, 15, 30, 45].includes(c.rhythm_minute) ? c.rhythm_minute : 0;
  const days = Array.isArray(c.rhythm_weekdays) && c.rhythm_weekdays.length
    ? c.rhythm_weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).map((d) => DAYS[d])
    : ['every day'];
  return {
    title: String(c.rhythm_title).slice(0, 80),
    days,
    at: `${String(c.rhythm_hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    self_described: true,
    time_zone: null,
    note: 'Set by the group itself, in its own time. No time zone is recorded and nothing confirms it happens; ask the group before relying on it.',
  };
}
