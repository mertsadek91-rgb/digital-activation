/**
 * Calendar days, as the store keeps them.
 *
 * Split out from the service and given its own tests because this is the part
 * of a dashboard that is wrong without ever looking wrong. A day boundary off
 * by a few hours moves money between two days that both still add up, the
 * totals still reconcile against the year, and the only symptom is that
 * "today" disagrees with the shop at one in the morning — which is exactly
 * when this store trades.
 */

const DAY_MS = 86_400_000;

/**
 * The calendar label a moment falls on, in the given zone.
 *
 * `en-CA` because its short date format *is* `YYYY-MM-DD`; the locale is a
 * formatting detail and never reaches a reader.
 */
export function storeDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * The last `count` labels, oldest first, ending on `lastDay` inclusive.
 *
 * Stepped over UTC midnights rather than local ones: these are labels rather
 * than instants, and UTC has no daylight saving to skip a day over or repeat
 * one. Doing the same arithmetic in a zone that observes DST produces a
 * thirty-day window with twenty-nine distinct days in it twice a year.
 */
export function dayKeys(lastDay: string, count: number): string[] {
  const end = new Date(`${lastDay}T00:00:00Z`).getTime();
  return Array.from({ length: count }, (_unused, index) =>
    new Date(end - (count - 1 - index) * DAY_MS).toISOString().slice(0, 10),
  );
}
