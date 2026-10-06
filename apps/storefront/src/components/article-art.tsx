import type { ArticleCard } from '@da/contracts';
import Image from 'next/image';

import { BookIcon } from './icons';

/**
 * The picture at the top of an article card (TASK-0121): the article image
 * when one was uploaded, the book icon when not.
 *
 * The image is decorative here — the card's title sits next to it inside the
 * same link — so its alt is empty rather than a second reading of the title.
 */
export function ArticleArt({
  hero,
  iconSize,
  sizes,
}: {
  hero: ArticleCard['hero'];
  iconSize: number;
  sizes: string;
}) {
  if (!hero) {
    return (
      <span className="article-art" aria-hidden="true">
        <BookIcon size={iconSize} />
      </span>
    );
  }
  return (
    <span className="article-art has-image">
      <Image src={hero.url} alt="" fill sizes={sizes} />
    </span>
  );
}
