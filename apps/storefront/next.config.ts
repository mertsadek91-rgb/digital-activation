import path from 'node:path';

import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';

// Next reads .env from the app directory, not the workspace root, so a monorepo
// app starts with no environment at all. Loading it here covers both the build
// and the running server, and keeps one .env for every app.
loadEnv({ path: path.join(import.meta.dirname, '..', '..', '.env'), quiet: true });

import createNextIntlPlugin from 'next-intl/plugin';
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,
  // Everything the browser downloads is accounted for. The performance budget
  // in @da/ui is enforced by Lighthouse CI, and this is the build-side half.
  poweredByHeader: false,
  images: {
    formats: ['image/avif', 'image/webp'],
    // Media is served from the R2 bucket's custom domain. Next/Image refuses to
    // optimise a remote host that is not listed here, and the failure is a
    // broken image rather than an error, so it is easy to miss.
    remotePatterns: process.env.S3_PUBLIC_BASE_URL
      ? [
          {
            protocol: 'https',
            hostname: new URL(process.env.S3_PUBLIC_BASE_URL).hostname,
          },
        ]
      : [],
  },
  experimental: {
    optimizePackageImports: ['@da/ui', '@da/seo', '@da/i18n'],
  },
  /**
   * WordPress's machine-readable URLs, which no content row stands behind.
   *
   * Yoast's sitemap files are still what Search Console was given, and every
   * feed reader subscribed to the old blog polls `/feed` — so they are asked
   * for constantly and deserve a real answer rather than a 404 each time.
   * They are fixed shapes, not content, which is why they live here and not
   * in the database map the catch-all consults (`lib/gone.ts`): that map is
   * generated from the WordPress export's posts and pages, and none of these
   * were ever a post or a page. Config redirects also run before the
   * middleware, and the `.xml` ones never reach it anyway — its matcher skips
   * any path with a file extension.
   *
   * A literal 301 rather than `permanent: true` (308): some feed readers and
   * older crawlers only follow the codes they were written against.
   */
  async redirects() {
    const sitemaps = [
      '/sitemap_index.xml',
      '/product-sitemap.xml',
      '/page-sitemap.xml',
      '/post-sitemap.xml',
      '/product_cat-sitemap.xml',
    ];
    return [
      ...sitemaps.map((source) => ({
        source,
        destination: '/sitemap.xml',
        statusCode: 301 as const,
      })),
      // `/feed` itself and every per-post, per-category and comments feed
      // (`/<anything>/feed`). The blog is the closest thing to what a feed
      // reader wanted.
      { source: '/feed', destination: '/blog', statusCode: 301 as const },
      { source: '/:path*/feed', destination: '/blog', statusCode: 301 as const },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default withNextIntl(config);
