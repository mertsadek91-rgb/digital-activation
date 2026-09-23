/**
 * Sale dates in the store's time zone.
 *
 * A sale "from midnight on the 1st" means midnight in Riyadh, whatever zone
 * the laptop setting it up is in. The inputs are `datetime-local` — a wall
 * clock with no zone — so these two convert between that wall clock in the
 * store zone and the UTC instant the API stores, via `Intl` rather than a
 * fixed +03:00, so a store zone with daylight saving still comes out right.
 */

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Milliseconds the zone is ahead of UTC at that instant. */
function offsetAt(instant: number, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** An ISO instant as `YYYY-MM-DDTHH:mm` on the store's wall clock. */
export function toZonedInput(iso: string, timeZone: string): string {
  const instant = new Date(iso).getTime();
  if (Number.isNaN(instant)) return '';
  const w = wallClock(instant, timeZone);
  return `${String(w.year)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** A `YYYY-MM-DDTHH:mm` wall-clock time in the store zone, as an ISO instant. */
export function fromZonedInput(local: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const at = (index: number): number => Number(match[index]);
  const guess = Date.UTC(at(1), at(2) - 1, at(3), at(4), at(5));
  // Twice, so an instant next to a daylight-saving change settles on the
  // offset in force at the result rather than at the guess.
  let instant = guess - offsetAt(guess, timeZone);
  instant = guess - offsetAt(instant, timeZone);
  return new Date(instant).toISOString();
}
