'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { ProductGlyph } from './icons';

/**
 * The product picture and its thumbnails.
 *
 * The thumbnails were pictures of buttons: a row of images that looked
 * clickable and did nothing, so the second screenshot of a product was only
 * ever seen at 68 pixels. They are buttons now, and choosing one swaps the
 * main image.
 *
 * The first image is still the server-rendered, `priority` main image, so the
 * LCP element is unchanged for the visitor who never touches a thumbnail.
 */
export function ProductGallery({
  images,
  slug,
  name,
}: {
  images: { url: string; alt: string }[];
  slug: string;
  name: string;
}) {
  const t = useTranslations('product');
  const [index, setIndex] = useState(0);
  const main = images[index] ?? images[0];

  return (
    <>
      <div className="gallery">
        {main ? (
          <Image
            key={main.url}
            src={main.url}
            alt={main.alt}
            fill
            priority={index === 0}
            sizes="(max-width: 900px) 100vw, 480px"
          />
        ) : (
          /* A drawing rather than the words "no image yet", which on a live
             shop reads as broken rather than as absent. */
          <ProductGlyph slug={slug} label={name} />
        )}
      </div>

      {images.length > 1 ? (
        <div
          className="gallery-thumbs"
          role="group"
          aria-label={t('moreImages')}
        >
          {images.map((img, idx) => (
            <button
              key={img.url}
              type="button"
              className="thumb-item"
              aria-pressed={idx === index}
              aria-label={t('showImage', {
                index: String(idx + 1),
                total: String(images.length),
              })}
              onClick={() => setIndex(idx)}
            >
              <Image src={img.url} alt="" width={68} height={68} />
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
