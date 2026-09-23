import path from 'node:path';

import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';

// Next reads .env from the app directory, not the workspace root, so a monorepo
// app starts with no environment at all. Loading it here covers both the build
// and the running server, and keeps one .env for every app.
loadEnv({ path: path.join(import.meta.dirname, '..', '..', '.env'), quiet: true });
/**
 * What the panel's pages may load and talk to.
 *
 * The panel can change bank details and reveal licence keys, so a script that
 * got in — through a product body, say — must not be able to send anything
 * anywhere but the API. `connect-src` is the line that matters: the API and
 * nothing else. Scripts still allow 'unsafe-inline' because Next hydrates with
 * inline scripts; moving to nonces is the next step, and until then the rich
 * text is sanitised on the way into the editor as well as out of it.
 */
function contentSecurityPolicy(): string {
  const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const dev = process.env.NODE_ENV !== 'production';
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${new URL(api).origin}${dev ? ' ws:' : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
        ],
      },
    ];
  },
};

export default config;
