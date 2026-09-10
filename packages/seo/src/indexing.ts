/**
 * Indexing policy.
 *
 * The store is being rebuilt on `new.digital-activation.com` while the legacy
 * WordPress site still serves the apex. Both will hold near-identical content,
 * and if Google indexes the staging host the damage is real and lasting:
 * duplicate content across two hostnames competing with each other, and after
 * the cutover a subdomain that stays indexed and siphons from the apex it was
 * supposed to replace.
 *
 * So indexing is not a setting somebody remembers to flip. It is derived: the
 * site is indexable only when it is actually being served from the production
 * origin. A staging host, a preview deployment and localhost all fall through
 * to noindex without anyone deciding anything.
 *
 * At cutover, `NEXT_PUBLIC_SITE_URL` becomes the apex and indexing switches on
 * by itself. Nothing else has to change.
 */

/** The one origin allowed to be indexed. */
export const PRODUCTION_ORIGIN = 'https://digital-activation.com';

export interface IndexingPolicy {
  index: boolean;
  /** Why, so a build log or a debug panel can say it out loud. */
  reason: string;
}

export function indexingPolicy(siteUrl: string | undefined): IndexingPolicy {
  if (!siteUrl) {
    return { index: false, reason: 'NEXT_PUBLIC_SITE_URL is not set' };
  }

  let origin: string;
  try {
    origin = new URL(siteUrl).origin;
  } catch {
    return { index: false, reason: `NEXT_PUBLIC_SITE_URL is not a valid URL: ${siteUrl}` };
  }

  if (origin !== PRODUCTION_ORIGIN) {
    return {
      index: false,
      reason: `serving from ${origin}, not ${PRODUCTION_ORIGIN}`,
    };
  }

  // A deliberate brake, for the window between the cutover and being ready to
  // be found. Absent or anything but "false" means indexing is allowed.
  if (process.env.SEO_BLOCK_INDEXING === 'true') {
    return { index: false, reason: 'SEO_BLOCK_INDEXING=true' };
  }

  return { index: true, reason: `serving from ${PRODUCTION_ORIGIN}` };
}

/** Convenience for Next's `metadata.robots`. */
export function robotsMeta(siteUrl: string | undefined): {
  index: boolean;
  follow: boolean;
  nocache?: boolean;
  googleBot: { index: boolean; follow: boolean };
} {
  const policy = indexingPolicy(siteUrl);

  if (!policy.index) {
    return {
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false },
    };
  }

  return { index: true, follow: true, googleBot: { index: true, follow: true } };
}
