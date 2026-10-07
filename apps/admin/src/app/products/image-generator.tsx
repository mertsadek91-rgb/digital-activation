'use client';

import type { ProductImages } from '@da/contracts';
import { useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { supplierAiApi } from '../../lib/supplier-api';
import { CardDesigner } from '../supplier/card-designer';
import '../supplier/supplier.css';

/**
 * The product card generator, on the product's own page: the same designer
 * the supplier screen has (brand colour or an uploaded logo, AI-proposed
 * words, the legacy card template), saved straight into this product's
 * images. Open from the start when the product has no image, which is the
 * case it exists for.
 */
export function ProductImageGenerator({
  slug,
  imageCount,
  onSaved,
}: {
  slug: string;
  imageCount: number;
  onSaved: (images: ProductImages) => void;
}) {
  const t = useT('products');
  // Decided once, on arrival: saving a card gives the product an image, and
  // the panel must not then snap shut over the "saved" note and the preview.
  const [initiallyOpen] = useState(imageCount === 0);
  // The designer asks the server for the brand's colour and logo when it
  // mounts, so it mounts only once somebody opens the panel.
  const [opened, setOpened] = useState(initiallyOpen);
  const [aiReady, setAiReady] = useState(false);

  useEffect(() => {
    if (!opened) return;
    let active = true;
    supplierAiApi
      .status()
      .then((status) => {
        if (active) setAiReady(status.configured && Boolean(status.model));
      })
      // Without AI the designer still draws a card from the brand's colour
      // and the product's name; only the "suggest words" button needs it.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [opened]);

  return (
    <details
      className="image-generator"
      open={initiallyOpen}
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary>
        <strong>{t('imageGenHeading')}</strong>
        {imageCount === 0 ? (
          <span className="pill pill-warning">{t('imageGenMissing')}</span>
        ) : null}
      </summary>
      <p className="lede-sm">{t('imageGenLede')}</p>
      {opened ? <CardDesigner slug={slug} aiReady={aiReady} onSaved={onSaved} embedded /> : null}
    </details>
  );
}
