import type { MetadataRoute } from 'next';

import { indexingPolicy, NOINDEX_PREFIXES_ROBOTS, robotsTxtRules } from '../lib/seo';

/**
 * robots.txt is generated, not a static file, because the answer depends on
 * which host is serving. While the rebuild lives on new.digital-activation.com
 * and the legacy site still holds the apex, this returns a blanket disallow —
 * two near-identical sites competing in the index would cost more than the
 * staging convenience is worth.
 */
export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const policy = indexingPolicy(siteUrl);

  if (!policy.index) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  return {
    rules: robotsTxtRules(),
    sitemap: new URL('/sitemap.xml', siteUrl).toString(),
    host: siteUrl,
  };
}

export { NOINDEX_PREFIXES_ROBOTS };
