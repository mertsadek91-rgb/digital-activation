'use client';

import { useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api } from '../../lib/api';

/**
 * The activation how-to, one step per line.
 *
 * This text is delivered twice: in the licence email, under the key, and on the
 * customer's own order page. So it is plain lines rather than a rich editor —
 * an email body cannot carry markup, and a step list that renders differently
 * in the two places is a step list nobody trusts.
 *
 * Per locale, because it is content. The Arabic list is what most customers
 * read; the English one is written separately rather than machine-translated,
 * which is the sort of thing that produces instructions nobody can follow.
 */
export function HowToForm({
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
  const [server, setServer] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setText(null);
    setServer(null);
    let cancelled = false;
    void api
      .activationSteps(slug, locale)
      .then((result) => {
        if (cancelled) return;
        const joined = result.steps.join('\n');
        setServer(joined);
        setText(joined);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        // A missing translation is a real answer, not a failure: the product
        // has no English row yet, and an empty box that cannot save is more
        // honest than a red banner.
        setServer('');
        setText('');
        onError(caught instanceof Error ? caught.message : t('howToLoadFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, locale, onError, t]);

  const lines = (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const dirty = text !== null && server !== null && text !== server;

  return (
    <form
      className="paste-form"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void api
          .setActivationSteps(slug, locale, lines)
          .then((saved) => {
            const joined = saved.steps.join('\n');
            setServer(joined);
            setText(joined);
            onSaved();
          })
          .catch((caught: unknown) => {
            onError(caught instanceof Error ? caught.message : t('howToSaveFailed'));
          })
          .finally(() => setBusy(false));
      }}
    >
      <label className="grow">
        {t('howToLabel')}
        <textarea
          value={text ?? ''}
          onChange={(event) => setText(event.target.value)}
          rows={6}
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
          disabled={text === null || !canWrite}
          placeholder={t('howToPlaceholder')}
        />
        <small>
          {lines.length > 0 ? t('howToStepCount', { count: lines.length }) : ''}
          {t('howToHint')}
        </small>
      </label>

      {canWrite ? (
        <div className="terms-save">
          <button type="submit" disabled={busy || text === null || !dirty}>
            {busy ? c('busy') : c('save')}
          </button>
          {dirty ? (
            <>
              <button type="button" className="ghost" onClick={() => setText(server)}>
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
