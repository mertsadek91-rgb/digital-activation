import type { Prisma } from '@da/db';

/**
 * The activation how-to, out of a Json column, without trusting its shape.
 *
 * `ProductTranslation.activationSteps` is `[{ step, text }]` when the admin
 * wrote it and could be anything at all when it came from the legacy import.
 * Two callers need it — the licence email and the customer's own order page —
 * and neither may throw on a malformed row: a product with unreadable steps
 * should deliver with no steps, not fail to deliver.
 *
 * Shared rather than copied because the two must agree. An email that lists
 * three steps beside an order page that lists two is a support ticket.
 */
export function parseActivationSteps(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const steps: string[] = [];
  for (const entry of value) {
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      const text = (entry as Record<string, unknown>).text;
      if (typeof text === 'string' && text.trim().length > 0) steps.push(text.trim());
    } else if (typeof entry === 'string' && entry.trim().length > 0) {
      steps.push(entry.trim());
    }
  }
  return steps;
}
