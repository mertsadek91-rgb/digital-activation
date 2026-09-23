'use client';

import type { ProductCopy } from '@da/contracts';
import { countBodyWords, READINESS_RULES, SEO_LENGTH_GUIDE } from '@da/contracts';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api } from '../../lib/api';
import { RichTextEditor } from './rich-text-editor';

/**
 * The gate's own flattening, repeated for the live counter.
 *
 * `readiness.ts` strips the tags out of a richText block and counts what is
 * left; the editor is holding that same HTML in a textarea, so it strips the
 * same way and counts with the same shared function. Any other arithmetic and
 * the number beside the box disagrees with the number that decides the
 * publish, which is worse than showing no number at all.
 */
function bodyWords(html: string): number {
  return countBodyWords(html.replace(/<[^>]+>/g, ' '));
}

/**
 * A length against the rule it has to clear.
 *
 * The shortfall is the number, not the length: "37 more characters" is an
 * instruction, "83 characters" is a fact somebody then has to do arithmetic
 * on. The ceiling is mentioned only once it is passed, and as advice — the
 * gate has no maximum, the SERP does.
 */
export function Gauge({
  value,
  min,
  max,
  unit,
}: {
  value: number;
  min: number;
  /** Null where there is no ceiling worth mentioning — a long body still ranks. */
  max: number | null;
  unit: string;
}) {
  const t = useT('products');
  const short = min - value;

  return (
    <small>
      <span className={`pill ${short <= 0 ? 'pill-ready' : 'pill-blocked'}`}>
        {short <= 0 ? t('gaugeMet') : t('gaugeShort', { short, unit })}
      </span>{' '}
      {t('gaugeDetail', { value, unit, min })}
      {max !== null && value > max ? t('gaugeTooLong', { max, unit }) : ''}
    </small>
  );
}

/**
 * The SEO title, the meta description and the body — per locale.
 *
 * This form is the reason the publish gate is usable at all. 43 of the 101
 * legacy products shipped with no title and no description, the gate refuses
 * exactly that, and the panel had no box to type either one into: a refusal
 * nobody can act on is a refusal that gets switched off.
 *
 * The locale is the page's, not the form's. On the editor page one switch
 * changes the SEO copy, the description, the activation steps and the gate
 * together — three forms each with their own language menu was three ways to
 * be editing English while reading Arabic blockers.
 */
export function CopyForm({
  slug,
  locale,
  canWrite,
  onSaved,
  onError,
}: {
  slug: string;
  locale: 'ar' | 'en';
  canWrite: boolean;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const t = useT('products');
  const c = useT('common');
  const [loaded, setLoaded] = useState<ProductCopy | null>(null);
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [shortDesc, setShortDesc] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const take = useCallback((copy: ProductCopy) => {
    setLoaded(copy);
    setSeoTitle(copy.seoTitle);
    setSeoDescription(copy.seoDescription);
    setShortDesc(copy.shortDesc);
    setBody(copy.body);
  }, []);

  useEffect(() => {
    setLoaded(null);
    let cancelled = false;
    void api
      .productCopy(slug, locale)
      .then((copy) => {
        if (!cancelled) take(copy);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        onError(caught instanceof Error ? caught.message : t('copyLoadFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, locale, onError, take, t]);

  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const dirty =
    loaded !== null &&
    (seoTitle !== loaded.seoTitle ||
      seoDescription !== loaded.seoDescription ||
      shortDesc !== loaded.shortDesc ||
      (loaded.bodyEditable && body !== loaded.body));
  const disabled = loaded === null || !canWrite;

  return (
    <form
      className="paste-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!loaded) return;
        setBusy(true);
        void api
          .setProductCopy(slug, {
            locale,
            seoTitle,
            seoDescription,
            shortDesc,
            // Omitted when the body holds blocks this box cannot put back;
            // the API refuses a body in that case rather than flattening it.
            ...(loaded.bodyEditable ? { body } : {}),
          })
          .then((copy) => {
            take(copy);
            onSaved();
          })
          .catch((caught: unknown) => {
            onError(caught instanceof Error ? caught.message : t('copySaveFailed'));
          })
          .finally(() => setBusy(false));
      }}
    >
      <label className="grow">
        {t('copySeoTitle')}
        <input
          type="text"
          value={seoTitle}
          dir={dir}
          disabled={disabled}
          onChange={(event) => setSeoTitle(event.target.value)}
          placeholder={t('copySeoTitlePlaceholder')}
        />
        <Gauge
          value={seoTitle.trim().length}
          min={READINESS_RULES.seoTitleMinLength}
          max={SEO_LENGTH_GUIDE.seoTitleMax}
          unit={t('unitCharacters')}
        />
      </label>

      <label className="grow">
        {t('copySeoDescription')}
        <textarea
          value={seoDescription}
          rows={3}
          dir={dir}
          disabled={disabled}
          onChange={(event) => setSeoDescription(event.target.value)}
          placeholder={t('copySeoDescriptionPlaceholder')}
        />
        <Gauge
          value={seoDescription.trim().length}
          min={READINESS_RULES.seoDescriptionMinLength}
          max={SEO_LENGTH_GUIDE.seoDescriptionMax}
          unit={t('unitCharacters')}
        />
      </label>

      <label className="grow">
        {t('copyShortDesc')}
        <input
          type="text"
          value={shortDesc}
          dir={dir}
          disabled={disabled}
          onChange={(event) => setShortDesc(event.target.value)}
          placeholder={t('copyShortDescPlaceholder')}
        />
        <small>{t('copyShortDescHint')}</small>
      </label>

      <label className="grow">
        {t('copyBody')}
        <RichTextEditor
          value={body}
          dir={dir}
          disabled={disabled || !loaded?.bodyEditable}
          onChange={setBody}
        />
        {loaded && !loaded.bodyEditable ? (
          <small>{t('copyBodyLocked', { blocks: loaded.otherBlocks.join(', ') })}</small>
        ) : (
          <>
            <Gauge
              value={bodyWords(body)}
              min={READINESS_RULES.bodyMinWords}
              max={null}
              unit={t('unitWords')}
            />
            {/* HTML rather than a rich editor, because HTML is what is
                stored: every Arabic body in this catalog is one richText
                block of WooCommerce markup, and a plain-text box would have
                wiped its headings and lists on the first save. */}
            <small>{t('copyBodyHint')}</small>
          </>
        )}
      </label>

      {canWrite ? (
        <div className="terms-save">
          <button type="submit" disabled={busy || loaded === null || !dirty}>
            {busy ? c('busy') : c('save')}
          </button>
          {dirty ? (
            <>
              <button type="button" className="ghost" onClick={() => loaded && take(loaded)}>
                {c('cancel')}
              </button>
              <span className="meta-warn">{t('termsUnsaved')}</span>
            </>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
