import type { MetadataRoute } from 'next';

import { BRAND } from '@da/ui';

/**
 * The web app manifest.
 *
 * What decides whether "add to home screen" produces the store's name and mark
 * or a blank square labelled with a URL. That matters more here than it would
 * on a desktop-first shop: this catalog sells to the Gulf, where the phone is
 * the browser, and a returning customer checking whether their licence has
 * arrived is exactly the person who pins a store.
 *
 * `dir` and `lang` are Arabic because the root of this site is Arabic —
 * English lives under `/en`, so a manifest fetched from `/manifest.webmanifest`
 * is describing the Arabic store. The installed name is the Arabic one for the
 * same reason.
 *
 * `start_url` is `/` rather than a deep link: somebody who installed the store
 * is opening it to browse or to check an order, and both begin at the top.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.nameAr,
    short_name: BRAND.nameAr,
    description: 'مفاتيح وتراخيص أصلية، تصل على بريدك.',
    lang: 'ar',
    dir: 'rtl',
    start_url: '/',
    // Standalone rather than fullscreen: this is a shop, and a shop that hides
    // the address bar asks to be trusted with a card number while removing the
    // one thing a person checks before typing one.
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#148576',
    icons: [
      {
        src: '/icon.svg',
        // A single vector covers every density the manifest would otherwise
        // want four raster files for.
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
