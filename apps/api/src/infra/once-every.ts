/**
 * A gate that opens at most once per interval.
 *
 * For warnings about a dependency being down: the condition is true for every
 * request while it lasts, and a log line per request buries whatever else is
 * happening in the same minute — including the moment it recovers.
 */
export function onceEvery(intervalMs: number, now: () => number = Date.now): () => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const at = now();
    if (at - last < intervalMs) return false;
    last = at;
    return true;
  };
}
