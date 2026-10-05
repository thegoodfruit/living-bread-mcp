/* ============================================================
   THE LIVING BREAD MCP, how fresh a result is, said honestly.

   Every result about people, a room or a gathering carries `freshness`:

     scheduled          a time somebody posted. It says nothing about now:
                        a scheduled gathering is never "happening now".
     recently_observed  somebody was seen, or said they were available,
                        at observed_at; the window is stated. Never
                        "available now" beyond that window.
     verified_live      the source confirmed activity within the last two
                        minutes, at the moment of reading.
     record             not about availability at all (a church in a
                        directory, a need a ministry posted, a prayer that
                        was left); observed_at is when it was written,
                        when the source says.

   `available_now` is true ONLY for verified_live, or for
   recently_observed while its stated window is still open.
   ============================================================ */

export type FreshnessKind = 'scheduled' | 'recently_observed' | 'verified_live' | 'record';

export interface Freshness {
  kind: FreshnessKind;
  observed_at: string | null;
  retrieved_at: string;
  available_now: boolean;
  valid_until?: string | null;
  note: string;
}

const LIVE_MS = 2 * 60_000;

export function scheduled(startsAt: string | null | undefined, note?: string, observedAt?: string | null): Freshness {
  const seen = observedAt ? Date.parse(observedAt) : NaN;
  return {
    kind: 'scheduled',
    observed_at: Number.isFinite(seen) ? new Date(seen).toISOString() : null,
    retrieved_at: new Date().toISOString(),
    available_now: false,
    ...(startsAt ? { valid_until: startsAt } : {}),
    note: note ?? 'A time the host posted. It is not a confirmation that it is happening; confirm with the host before going.',
  };
}

export function observed(observedAt: string | null | undefined, windowMinutes: number, note: string): Freshness {
  const now = Date.now();
  const at = observedAt ? Date.parse(observedAt) : NaN;
  const until = Number.isFinite(at) ? at + windowMinutes * 60_000 : NaN;
  const live = Number.isFinite(at) && now - at <= LIVE_MS;
  return {
    kind: live ? 'verified_live' : 'recently_observed',
    observed_at: Number.isFinite(at) ? new Date(at).toISOString() : null,
    retrieved_at: new Date(now).toISOString(),
    available_now: live || (Number.isFinite(until) && until > now),
    valid_until: Number.isFinite(until) ? new Date(until).toISOString() : null,
    note,
  };
}

/** The source itself confirmed activity within the last two minutes, at the moment of reading. */
export function liveNow(note: string): Freshness {
  const now = new Date().toISOString();
  return { kind: 'verified_live', observed_at: now, retrieved_at: now, available_now: true, note };
}

/** A window the source enforces itself (for example kingdom_availability.until > now()): open at the moment of reading. */
export function openWindow(note: string): Freshness {
  return { kind: 'recently_observed', observed_at: null, retrieved_at: new Date().toISOString(), available_now: true, note };
}

export function record(writtenAt: string | null | undefined, note = 'A record, not a statement about availability.'): Freshness {
  const t = writtenAt ? Date.parse(writtenAt) : NaN;
  return { kind: 'record', observed_at: Number.isFinite(t) ? new Date(t).toISOString() : null, retrieved_at: new Date().toISOString(), available_now: false, note };
}

/** The wording a sentence may use. Never "available now" unless the freshness says so. */
export function availabilityWords(f: Freshness): string {
  if (f.kind === 'verified_live') return 'active right now';
  if (f.kind === 'recently_observed') return f.available_now ? 'said they are available (their window is still open)' : 'was available earlier; not confirmed now';
  if (f.kind === 'scheduled') return 'scheduled';
  return 'on record';
}
