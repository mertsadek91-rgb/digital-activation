/**
 * When a licence runs out.
 *
 * Shared by the account's "for you" page, which shows upcoming renewals, and
 * the renewal reminder sweep, which emails about them. Two copies of this
 * arithmetic would, sooner or later, tell a customer two different dates.
 */

export type LicencePeriodUnit = 'DAY' | 'MONTH' | 'YEAR' | 'LIFETIME';

/**
 * The end of a licence term.
 *
 * Calendar arithmetic, not 365 days, and clamped to the end of a short month:
 * a month from 31 January is 28 (or 29) February and a year from 29 February
 * is 28 February, where a bare `setMonth` would roll into March. A customer
 * told their licence ends on the wrong day by one is a customer who writes in.
 */
export function addTerm(from: Date, unit: LicencePeriodUnit, value: number): Date {
  const end = new Date(from);
  if (unit === 'DAY') {
    end.setUTCDate(end.getUTCDate() + value);
    return end;
  }
  if (unit === 'LIFETIME') return end;

  const months = unit === 'MONTH' ? value : value * 12;
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}

const UNITS = new Set<LicencePeriodUnit>(['DAY', 'MONTH', 'YEAR', 'LIFETIME']);

/**
 * The term a bought line was sold with.
 *
 * The order line's snapshot first — the term the customer paid for, which a
 * later edit to the variant must not change — and the variant's current term
 * only for lines written before snapshots existed (the migrated orders).
 */
export function termOf(
  snapshot: unknown,
  fallback: { unit: LicencePeriodUnit; value: number | null } | null,
): { unit: LicencePeriodUnit; value: number | null } | null {
  if (snapshot && typeof snapshot === 'object') {
    const record = snapshot as Record<string, unknown>;
    const unit = record.licensePeriodUnit;
    const value = record.licensePeriodValue;
    if (typeof unit === 'string' && UNITS.has(unit as LicencePeriodUnit)) {
      return {
        unit: unit as LicencePeriodUnit,
        value: typeof value === 'number' && Number.isFinite(value) ? value : null,
      };
    }
  }
  return fallback;
}

/**
 * When a delivered line's licence ends, or null for one that does not.
 *
 * The term starts at delivery, not at payment: most of this catalog is made to
 * order, and the store's promise is that the clock starts when the key arrives.
 */
export function licenceExpiry(
  deliveredAt: Date,
  term: { unit: LicencePeriodUnit; value: number | null } | null,
): Date | null {
  if (!term || term.unit === 'LIFETIME' || term.value === null || term.value <= 0) return null;
  return addTerm(deliveredAt, term.unit, term.value);
}
