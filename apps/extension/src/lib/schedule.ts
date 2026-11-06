const INPUT_FORMAT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, '0');

/** Formats a date as the value of a `datetime-local` input, in local time. */
export function toLocalInputValue(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Converts a `datetime-local` value (wall-clock time in the user's timezone)
 * to an ISO 8601 UTC string for the API. Returns null when the value is empty,
 * malformed, or a local time that does not exist (spring-forward gap).
 */
export function localInputToIso(value: string): string | null {
  const match = INPUT_FORMAT.exec((value || '').trim());
  if (!match) {
    return null;
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  return date.toISOString();
}

/** Suggested schedule time: the start of the next full hour, at least 15 minutes away. */
export function defaultScheduleValue(now: Date = new Date()): string {
  const next = new Date(now.getTime());
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  if (next.getTime() - now.getTime() < 15 * 60 * 1000) {
    next.setHours(next.getHours() + 1);
  }
  return toLocalInputValue(next);
}

/** True when the ISO date is at least `minLeadMs` after `now`. */
export function isInFuture(
  iso: string,
  now: Date = new Date(),
  minLeadMs = 60 * 1000
): boolean {
  return new Date(iso).getTime() - now.getTime() >= minLeadMs;
}
