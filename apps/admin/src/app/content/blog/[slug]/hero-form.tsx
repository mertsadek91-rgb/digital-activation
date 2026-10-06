'use client';

import type { AdminArticle } from '@da/contracts';
import { useEffect, useState } from 'react';

import { useT } from '../../../../i18n/provider';
import { api } from '../../../../lib/api';

/** The longest edge the browser sends; the server re-encodes to WebP ≤1600 px anyway. */
const MAX_EDGE = 1600;

/**
 * The article image (CR-0006): one picture for both languages of the post,
 * with alt text in each. It is the article page's lead picture, its share
 * image (og:image) and the image in its Article structured data.
 *
 * The picture is shrunk in the browser before it is sent — the request body
 * is capped at 2 MiB — and processed again by the server.
 */
export function ArticleHeroForm({
  post,
  canWrite,
  onChanged,
  onError,
}: {
  post: AdminArticle;
  canWrite: boolean;
  onChanged: (post: AdminArticle) => void;
  onError: (message: string) => void;
}) {
  const t = useT('content');
  const c = useT('common');
  const hero = post.hero ?? null;
  const [altAr, setAltAr] = useState(hero?.altAr ?? '');
  const [altEn, setAltEn] = useState(hero?.altEn ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAltAr(post.hero?.altAr ?? '');
    setAltEn(post.hero?.altEn ?? '');
  }, [post.hero?.altAr, post.hero?.altEn]);

  async function upload(file: File): Promise<void> {
    setBusy(true);
    try {
      const dataUrl = await shrink(file);
      const saved = await api.setArticleHero(post.slug, {
        dataUrl,
        alt: { ar: altAr || post.ar.title, en: altEn || post.en.title },
      });
      onChanged(saved);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : c('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    try {
      onChanged(await api.removeArticleHero(post.slug));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : c('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="article-hero-form">
      {hero ? (
        <img className="article-hero-preview" src={hero.url} alt={hero.altAr || hero.altEn} />
      ) : (
        <p className="notice">{t('heroNone')}</p>
      )}
      <div className="paste-form">
        <label className="grow">
          {t('heroAltAr')}
          <input
            dir="rtl"
            value={altAr}
            disabled={!canWrite || busy}
            placeholder={post.ar.title}
            onChange={(event) => setAltAr(event.target.value)}
          />
        </label>
        <label className="grow">
          {t('heroAltEn')}
          <input
            dir="ltr"
            value={altEn}
            disabled={!canWrite || busy}
            placeholder={post.en.title}
            onChange={(event) => setAltEn(event.target.value)}
          />
        </label>
        <small>{t('heroHint')}</small>
      </div>
      {canWrite ? (
        <div className="terms-save">
          <label className="button">
            {busy ? c('busy') : hero ? t('heroReplace') : t('heroUpload')}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="visually-hidden"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void upload(file);
              }}
            />
          </label>
          {hero ? (
            <button type="button" className="ghost" disabled={busy} onClick={() => void remove()}>
              {t('heroRemove')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A picture as a WebP data URL no larger than MAX_EDGE on its longest side. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas unavailable');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/webp', 0.86);
}
