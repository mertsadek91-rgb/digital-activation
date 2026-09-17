import Image from 'next/image';

import { BRAND } from '@da/ui';

/**
 * The shop's own logo, carried across from the store this replaces.
 *
 * The wordmark and the circuit-key are the one piece of this brand that cannot
 * be redrawn from first principles: a returning customer recognises it before
 * they read anything, and 69.6% of the old site's impressions land on a page
 * that has it in the corner.
 *
 * It is the original file, not a redraw. The largest the old site holds is
 * 200x86 — there is no SVG and no larger raster anywhere in the backup, and an
 * upscale of a 200px source adds bytes without adding detail, so none is
 * shipped. That sets a ceiling: displayed much above 150px wide it starts to
 * soften on a dense screen. Every size here stays under it.
 *
 * `alt` carries the shop's name rather than the word "logo", because a screen
 * reader announcing "logo" has told its listener nothing, and this image is the
 * link back to the home page.
 */
export function BrandLogo({
  locale,
  width = 150,
  priority = false,
}: {
  locale: string;
  /** CSS pixels. The source is 200px wide; going past it buys nothing. */
  width?: number;
  /** True only in the header, which is above the fold on every page. */
  priority?: boolean;
}) {
  const ar = locale !== 'en';
  const height = Math.round((width * 86) / 200);

  return (
    <Image
      src="/brand/logo.webp"
      alt={ar ? BRAND.nameAr : BRAND.nameEn}
      width={width}
      height={height}
      priority={priority}
      className="brand-logo"
    />
  );
}
