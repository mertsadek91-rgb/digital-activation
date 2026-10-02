import crypto from 'node:crypto';

/**
 * The keys behind the links the store emails: an order page, a cart restore.
 *
 * Until TASK-0018 these were HMACs under JWT_ACCESS_SECRET — the key that also
 * signs staff sessions. Sharing it meant a leaked link key and a leaked session
 * key were the same incident, and rotating one retired the other. They now have
 * their own LINK_SIGNING_SECRET.
 *
 * Unset, the API still boots: the link key is then derived from the access
 * secret under a label of its own, and the boot logs a warning (`main.ts`).
 * That is no weaker than before — the same secret, domain-separated — and the
 * alternative, refusing to start, would take checkout and licence delivery down
 * on the next deploy until the owner has added a variable in Coolify.
 *
 * The transition. Links emailed before this change were signed with the access
 * secret in the v1 format, and order ones never expired. They are still
 * accepted until LEGACY_LINK_CUTOFF and refused from then on; after it the
 * customer signs in with the emailed sign-in link, or staff resend the message
 * (which mints a fresh link). The same window covers links signed with the
 * derived fallback key, so adding LINK_SIGNING_SECRET does not break the links
 * sent while it was missing.
 *
 * Why 2026-11-15: a new order link lives 30 days, and the release carrying this
 * is due within two weeks of 2026-10-02. The cutoff gives every link sent up to
 * the release at least the 30 days a new link gets. If the release slips past
 * 2026-10-16, move the cutoff with it (here and in docs/deployment.md).
 */
export const LEGACY_LINK_CUTOFF = new Date('2026-11-15T00:00:00Z');

const FALLBACK_LABEL = 'da:link-signing:fallback:v1';

function accessSecret(): string | null {
  return process.env.JWT_ACCESS_SECRET || null;
}

function derivedFromAccess(): string | null {
  const access = accessSecret();
  if (!access) return null;
  return crypto.createHmac('sha256', access).update(FALLBACK_LABEL).digest('base64url');
}

/**
 * LINK_SIGNING_SECRET as set, or undefined when blank: env validation drops a
 * whitespace-only value, so signing must not treat it as a key either.
 */
function configuredLinkSecret(): string | undefined {
  const value = process.env.LINK_SIGNING_SECRET;
  return value && value.trim() !== '' ? value : undefined;
}

/** True when LINK_SIGNING_SECRET is unset and links are signed with the derived fallback. */
export function linkSecretIsFallback(): boolean {
  return !configuredLinkSecret();
}

/** The key new links are signed with. */
export function linkSigningSecret(): string {
  const value = configuredLinkSecret() ?? derivedFromAccess();
  if (!value) {
    throw new Error(
      'LINK_SIGNING_SECRET (or JWT_ACCESS_SECRET) is required to sign emailed links.',
    );
  }
  return value;
}

/**
 * Keys that new-format (v2) links are also accepted under, until the cutoff:
 * the derived fallback, once a real LINK_SIGNING_SECRET has replaced it.
 */
export function transitionalLinkSecrets(now: Date): string[] {
  if (now.getTime() >= LEGACY_LINK_CUTOFF.getTime()) return [];
  if (linkSecretIsFallback()) return [];
  const derived = derivedFromAccess();
  return derived ? [derived] : [];
}

/** The key v1 links were signed with, while they are still accepted; null after the cutoff. */
export function legacyLinkSecret(now: Date): string | null {
  if (now.getTime() >= LEGACY_LINK_CUTOFF.getTime()) return null;
  return accessSecret();
}

/**
 * Keys a link that must never stop working is accepted under, with no cutoff:
 * the unsubscribe link (`subscriptions/newsletter-link.ts`). `v2` holds the
 * derived fallback once a real LINK_SIGNING_SECRET has replaced it; `v1` is the
 * access secret the pre-TASK-0018 links were signed with. Every other link is
 * refused under these at LEGACY_LINK_CUTOFF; this one is not.
 */
export function retiredLinkSecrets(): { v2: string[]; v1: string | null } {
  const derived = linkSecretIsFallback() ? null : derivedFromAccess();
  return { v2: derived ? [derived] : [], v1: accessSecret() };
}

/** Constant-time string equality; unequal lengths are simply unequal. */
export function safeEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
