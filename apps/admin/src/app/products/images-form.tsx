'use client';

import type { ProductImage, ProductImages } from '@da/contracts';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api } from '../../lib/api';

/**
 * Product images, in the panel.
 *
 * Until this existed the only route into the catalog for a picture was a
 * script that read the WordPress backup — which is why twenty of seventy-two
 * products have none, and why nobody could fix that: there was no second way,
 * and there was never going to be a second WordPress backup.
 *
 * The resize happens here, in the browser, before anything is sent. A press-kit
 * PNG is commonly 8 MB and the catalog stores a 1600px WebP of about 300 kB, so
 * uploading the original would spend twenty-five times the bandwidth to throw
 * the difference away on the server. The server re-encodes what it receives
 * regardless — that is the security boundary, and this is only a kindness to
 * the network.
 */

/** The long edge the server also uses, so the browser does its work once. */
const MAX_EDGE = 1600;

/** Refused before a canvas is created, with a reason rather than a stall. */
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

/**
 * Resizes and re-encodes a picture to a `data:` URL.
 *
 * `createImageBitmap` rather than an `<img>` and a load event: it decodes off
 * the main thread, and on a 20-megapixel photograph that is the difference
 * between a moment and a visibly frozen panel.
 *
 * Quality steps down until the result fits. The server's ceiling is what
 * Fastify's body limit leaves after base64, and a picture that arrives one
 * kilobyte over that is refused for a reason no one in the panel can act on —
 * so it is settled here, where the encoder is.
 */
async function toDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no-canvas');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  for (const quality of [0.85, 0.7, 0.55]) {
    const url = canvas.toDataURL('image/webp', quality);
    // The cap the server enforces, in base64 characters rather than bytes,
    // because that is what the request body actually carries.
    if (url.length <= 1_900_000) return url;
  }
  throw new Error('too-big');
}

export function ImagesForm({
  slug,
  canWrite,
  onChanged,
  onError,
}: {
  slug: string;
  canWrite: boolean;
  /** Fired after any write, so the row's readiness counters refresh. */
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const t = useT('products');
  const c = useT('common');
  const [data, setData] = useState<ProductImages | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.productImages(slug));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : c('actionFailed'));
    }
  }, [slug, onError, c]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Every write returns the whole list, so the server's answer is the state. */
  async function write(action: () => Promise<ProductImages>): Promise<void> {
    setBusy(true);
    try {
      setData(await action());
      onChanged();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : c('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function add(files: FileList | File[]): Promise<void> {
    const images = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (images.length !== Array.from(files).length) onError(t('imageNotImage'));
    if (images.length === 0) return;

    setBusy(true);
    try {
      let next = data;
      // One at a time, in the order they were dropped: position comes from the
      // rows that already exist, so two in flight would race for the same one.
      for (const file of images) {
        if (file.size > MAX_SOURCE_BYTES) {
          onError(t('imageTooBig'));
          continue;
        }
        let dataUrl: string;
        try {
          dataUrl = await toDataUrl(file);
        } catch {
          onError(t('imageTooBig'));
          continue;
        }
        next = await api.uploadProductImage(slug, { dataUrl, filename: file.name });
      }
      if (next) setData(next);
      onChanged();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : c('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  /** Moves one picture by swapping it with its neighbour, then sends the order. */
  function move(index: number, by: -1 | 1): void {
    if (!data) return;
    const ids = data.images.map((image) => image.id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    const moved = ids[index];
    const displaced = ids[target];
    if (!moved || !displaced) return;
    ids[index] = displaced;
    ids[target] = moved;
    void write(() => api.reorderProductImages(slug, ids));
  }

  if (!data) return <p className="meta">{c('loading')}</p>;

  return (
    <div className="images-form">
      <h3>{t('imagesHeading')}</h3>
      <p className="lede-sm">{t('imagesLede')}</p>

      {data.uploadBlocked ? (
        <p className="error">{data.uploadBlocked}</p>
      ) : canWrite ? (
        <div
          className={`image-drop${dragging ? ' is-over' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void add(event.dataTransfer.files);
          }}
        >
          <span>{busy ? t('imagesBusy') : t('imagesDrop')}</span>
          {busy ? null : (
            <button type="button" className="linky" onClick={() => picker.current?.click()}>
              {t('imagesPick')}
            </button>
          )}
          <input
            id={`image-picker-${slug}`}
            ref={picker}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files) void add(event.target.files);
              event.target.value = '';
            }}
          />
        </div>
      ) : null}

      {data.images.length === 0 ? (
        <p className="notice">{t('imagesEmpty')}</p>
      ) : (
        <ul className="image-list">
          {data.images.map((image, index) => (
            <ImageRow
              key={image.id}
              image={image}
              variants={data.variants}
              canWrite={canWrite && !busy}
              first={index === 0}
              last={index === data.images.length - 1}
              onMakeHero={() => void write(() => api.patchProductImage(image.id, { isHero: true }))}
              onAlt={(alt) => void write(() => api.patchProductImage(image.id, { alt }))}
              onVariant={(variantId) =>
                void write(() => api.patchProductImage(image.id, { variantId }))
              }
              onUp={() => move(index, -1)}
              onDown={() => move(index, 1)}
              onRemove={() => void write(() => api.removeProductImage(image.id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ImageRow({
  image,
  variants,
  canWrite,
  first,
  last,
  onMakeHero,
  onAlt,
  onVariant,
  onUp,
  onDown,
  onRemove,
}: {
  image: ProductImage;
  variants: { id: string; sku: string }[];
  canWrite: boolean;
  first: boolean;
  last: boolean;
  onMakeHero: () => void;
  onAlt: (alt: { ar: string; en: string }) => void;
  onVariant: (variantId: string | null) => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  const t = useT('products');
  const [ar, setAr] = useState(image.alt.ar);
  const [en, setEn] = useState(image.alt.en);

  // The server's copy wins when it changes underneath — a reorder or a hero
  // change re-renders every row, and a draft typed here must survive that
  // while a value edited elsewhere must not be overwritten by a stale one.
  useEffect(() => {
    setAr(image.alt.ar);
    setEn(image.alt.en);
  }, [image.alt.ar, image.alt.en]);

  const dirty = ar !== image.alt.ar || en !== image.alt.en;
  const missingAlt = image.alt.ar.trim() === '' || image.alt.en.trim() === '';

  return (
    <li className={`image-item${image.isHero ? ' is-hero' : ''}`}>
      <div className="image-thumb">
        {/* `unoptimized`: these are already 1600px WebP written by this app,
            and putting the panel's optimiser in front of the CDN would pay
            twice to make them no smaller. */}
        <Image
          src={image.url}
          alt={image.alt.ar || image.alt.en || image.id}
          width={120}
          height={120}
          unoptimized
        />
        {image.isHero ? <span className="pill pill-ready">{t('imageHero')}</span> : null}
      </div>

      <div className="image-body">
        <p className="meta">
          {t('imageMeta', {
            width: image.width ?? 0,
            height: image.height ?? 0,
            kb: Math.round(image.bytes / 1024),
          })}
          {missingAlt ? <span className="warn"> · {t('imageAltMissing')}</span> : null}
        </p>

        <div className="image-alts">
          <label>
            <span>{t('imageAltAr')}</span>
            <input
              id={`alt-ar-${image.id}`}
              type="text"
              value={ar}
              dir="rtl"
              disabled={!canWrite}
              onChange={(event) => setAr(event.target.value)}
            />
          </label>
          <label>
            <span>{t('imageAltEn')}</span>
            <input
              id={`alt-en-${image.id}`}
              type="text"
              value={en}
              dir="ltr"
              disabled={!canWrite}
              onChange={(event) => setEn(event.target.value)}
            />
          </label>
        </div>
        <small>{t('imageAltHint')}</small>

        {variants.length > 1 ? (
          <label className="image-variant">
            <span>{t('imageForVariant')}</span>
            <select
              id={`variant-${image.id}`}
              value={image.variantId ?? ''}
              disabled={!canWrite}
              onChange={(event) => onVariant(event.target.value === '' ? null : event.target.value)}
            >
              <option value="">{t('imageAllVariants')}</option>
              {variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.sku}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {image.usedByProducts > 1 ? (
          <p className="meta-warn">{t('imageSharedNote', { count: image.usedByProducts })}</p>
        ) : null}

        {canWrite ? (
          <div className="image-actions">
            {dirty ? (
              <button type="button" onClick={() => onAlt({ ar, en })}>
                {t('imageSaveAlt')}
              </button>
            ) : null}
            {image.isHero ? null : (
              <button type="button" className="ghost" onClick={onMakeHero}>
                {t('imageMakeHero')}
              </button>
            )}
            <button type="button" className="ghost" onClick={onUp} disabled={first}>
              {t('imageMoveUp')}
            </button>
            <button type="button" className="ghost" onClick={onDown} disabled={last}>
              {t('imageMoveDown')}
            </button>
            <button type="button" className="ghost" onClick={onRemove}>
              {image.usedByProducts > 1 ? t('imageDeleteShared') : t('imageDelete')}
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
