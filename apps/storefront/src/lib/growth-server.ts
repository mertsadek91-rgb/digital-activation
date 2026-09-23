import { type PublicMarketing, publicMarketingSchema } from '@da/contracts';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * The storefront-visible marketing settings, for server components.
 *
 * Revalidated every minute: a feature switched on in the panel reaches the
 * product pages within that, and a failure reads as "everything off" rather
 * than as a broken page — marketing is never the reason a product 500s.
 */
export async function getPublicMarketing(): Promise<PublicMarketing | null> {
  try {
    const response = await fetch(new URL('/v1/marketing/public', API_URL), {
      next: { revalidate: 60 },
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const parsed = publicMarketingSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
