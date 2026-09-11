/**
 * Shared i18n helpers.
 *
 * Price conversion used to live here too, as a second implementation of the
 * rounding rules that the API already applies in `catalog/pricing.ts`. The two
 * disagreed — this one read `nearest_9` as "round down to the next 9 and floor
 * at zero", which priced anything converting below five units at 0.00 — and
 * nothing imported it, so the disagreement was waiting for whoever wired it up
 * first. One implementation, in the service that owns the money.
 */
export * from './arabic.js';
