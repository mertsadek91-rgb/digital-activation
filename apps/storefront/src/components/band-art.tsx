import Image from 'next/image';

import type { FamilyArt } from '../lib/family-art';

/**
 * A family's illustration at the end of the page band, as the kit's category
 * banner places it (TASK-0109). Decorative: the heading beside it names the
 * category, so the image has an empty alt.
 *
 * The art box is 256px wide on a desktop and 112px on a phone, and `sizes`
 * says so, so the served candidate is never wider than what is drawn (the
 * Lighthouse responsive-images rule).
 */
export function BandArt({ art }: { art: FamilyArt }) {
  return (
    <div className="band-art" aria-hidden="true">
      <Image
        src={art.src}
        alt=""
        width={art.width}
        height={art.height}
        sizes="(max-width: 767px) 112px, 256px"
        priority
      />
    </div>
  );
}
