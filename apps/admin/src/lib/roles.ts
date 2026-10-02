import type { StaffMe } from '@da/contracts';

type Role = StaffMe['role'];

/**
 * Which panel screens a role is offered (TASK-0095).
 *
 * The API is the enforcement point: StaffGuard refuses these routes whatever
 * the panel shows. This only keeps the panel from offering READONLY a link or
 * a page whose every request would come back 403. Since the owner's decision
 * of 2026-10-02 READONLY reads the catalogue and the redirect map, nothing
 * else, so this is an allowlist rather than a list of exceptions.
 */
const READONLY_SCREENS: ReadonlySet<string> = new Set(['products', 'categories', 'redirects']);

export function canOpen(role: Role, screen: string): boolean {
  return role !== 'READONLY' || READONLY_SCREENS.has(screen);
}

/** Where a role lands when it opens a screen it is not offered. */
export const FALLBACK_SCREEN = '/products';

/**
 * Who may read a product's terms (`costUsd` among them) and its SEO copy: the
 * API serves both to OWNER, ADMIN and CATALOG only.
 */
export function canReadProductTerms(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'CATALOG';
}
