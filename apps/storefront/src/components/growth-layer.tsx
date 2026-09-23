'use client';

import { useEffect } from 'react';

import { growthApi } from '../lib/growth-client';

import { WelcomeCapture } from './welcome-capture';

/**
 * The site-wide growth pieces, mounted once in the layout.
 *
 * `?ref=CODE` on any page is the same as `/r/CODE`: the code is handed to the
 * API, which keeps it in an httpOnly cookie until the visitor's cart has
 * something to discount. Read from `location` inside an effect rather than
 * `useSearchParams`, which would push every page up to a Suspense boundary
 * into client rendering for a parameter almost nobody carries.
 */
export function GrowthLayer({ locale }: { locale: string }) {
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('ref');
    if (code && /^[A-Za-z0-9]{4,16}$/.test(code)) void growthApi.visitReferral(code);
  }, []);

  return <WelcomeCapture locale={locale} />;
}
