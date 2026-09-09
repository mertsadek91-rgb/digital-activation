import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

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
