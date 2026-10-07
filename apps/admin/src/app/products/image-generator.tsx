'use client';

import { useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { supplierAiApi } from '../../lib/supplier-api';
import { CardDesigner } from '../supplier/card-designer';
import '../supplier/supplier.css';

/**
 * The product card generator, on the product's own page: the same designer
 * the supplier screen has (brand colour or an uploaded logo, AI-proposed
 * words, the legacy card template), saved straight into this product's
 * images. Open from the start when the product has no image yet, which is
 * the case it exists for.
 */
export function ProductImageGenerator({
  slug,
  imageCount,
  onSaved,
}: {
  slug: string;
  imageCount: number;
  onSaved: () => void;
}) {
  const t = useT('products');
  const [aiReady, setAiReady] = useState(false);

  useEffect(() => {
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
  }, []);

  return (
    <details className="image-generator" open={imageCount === 0}>
      <summary>
        <strong>{t('imageGenHeading')}</strong>
        {imageCount === 0 ? (
          <span className="pill pill-warning">{t('imageGenMissing')}</span>
        ) : null}
      </summary>
      <p className="lede-sm">{t('imageGenLede')}</p>
      <CardDesigner slug={slug} aiReady={aiReady} onSaved={onSaved} />
    </details>
  );
}
