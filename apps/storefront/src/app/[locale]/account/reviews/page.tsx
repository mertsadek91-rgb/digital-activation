'use client';

import type { CustomerMe, ReviewableLine, ReviewableList } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { isArabic, resolveLocale } from '../../../../i18n/locale';
import { accountApi, AccountError } from '../../../../lib/account-client';

/**
 * تقييماتي — where a review is actually written.
 *
 * The page exists because the review invitation has to land somewhere, and
 * because the rule the whole feature rests on is only visible from here: the
 * list is the customer's own delivered lines, and there is no other way in.
 * No "write a review" button on the product page, no form for a visitor, no
 * field anywhere that names a product. A person who did not buy it has nothing
 * on this page to submit.
 *
 * Two things are said plainly rather than left implied, because both change
 * what somebody writes. Nothing is published on submission — a review that
 * appeared instantly and was then removed by a moderator is worse than one
 * that was honest about the wait. And a review can be corrected only while it
 * is still pending, which is why the state is on every card rather than in a
 * help page. The state's wording is `accountReviews.status.<status>`.
 */

export default function AccountReviewsPage() {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const t = useTranslations('account');
  const tr = useTranslations('accountReviews');
  const prefix = isArabic(params.locale) ? '' : `/${params.locale ?? 'en'}`;

  const [me, setMe] = useState<CustomerMe | null>(null);
  const [list, setList] = useState<ReviewableList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await accountApi.reviewable());
    } catch (caught) {
      if (caught instanceof AccountError && caught.status === 401) {
        router.replace(`${prefix}${ROUTES.account}`);
        return;
      }
      setError(caught instanceof Error ? caught.message : null);
    }
  }, [router, prefix]);

  useEffect(() => {
    void (async () => {
      try {
        setMe(await accountApi.me());
      } catch {
        router.replace(`${prefix}${ROUTES.account}`);
      }
    })();
  }, [router, prefix]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (!me) {
    return (
      <main className="shell account-shell">
        <p className="notice">…</p>
      </main>
    );
  }

  return (
    <main className="shell account-shell">
      <div className="account-head">
        <h1>{t('myReviews')}</h1>
        <p className="who" dir="ltr">
          {me.email}
        </p>
        <Link className="btn btn-ghost" href={`${prefix}${ROUTES.licenses}`}>
          {t('myLicences')}
        </Link>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="account-sent">{note}</p> : null}

      {list && list.rows.length === 0 ? (
        <p className="notice">{tr('none')}</p>
      ) : null}

      {list && list.awaiting > 0 ? (
        <p className="notice">
          {tr('awaiting', { count: list.awaiting })}
        </p>
      ) : null}

      <ul className="licence-list">
        {(list?.rows ?? []).map((row) => (
          <ReviewCard
            key={row.orderItemId}
            row={row}
            locale={resolveLocale(params.locale)}
            prefix={prefix}
            onDone={(message) => {
              setNote(message);
              void load();
            }}
            onError={setError}
          />
        ))}
      </ul>
    </main>
  );
}

function ReviewCard({
  row,
  locale,
  prefix,
  onDone,
  onError,
}: {
  row: ReviewableLine;
  locale: 'ar' | 'en';
  prefix: string;
  onDone: (message: string) => void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(row.review?.rating ?? 5);
  const [title, setTitle] = useState(row.review?.title ?? '');
  const [body, setBody] = useState(row.review?.body ?? '');
  const [busy, setBusy] = useState(false);
  const tr = useTranslations('accountReviews');
  const trv = useTranslations('reviews');

  const existing = row.review;

  async function save(): Promise<void> {
    setBusy(true);
    onError(null);
    try {
      if (existing) {
        await accountApi.editReview(row.orderItemId, {
          rating,
          title: title.trim().length > 0 ? title.trim() : null,
          body: body.trim(),
        });
        onDone(tr('saved'));
      } else {
        await accountApi.submitReview(row.orderItemId, {
          rating,
          ...(title.trim().length > 0 ? { title: title.trim() } : {}),
          body: body.trim(),
          locale,
        });
        onDone(tr('received'));
      }
      setOpen(false);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : tr('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="licence-card">
      <div className="licence-head">
        <div>
          <Link href={`${prefix}${ROUTES.product(row.productSlug)}`} className="licence-name">
            {row.productName}
          </Link>
          <p className="licence-meta">
            <span dir="ltr">{row.orderNumber}</span>
            <span>
              {' · '}
              {tr('delivered', { date: row.deliveredAt.slice(0, 10) })}
            </span>
          </p>
        </div>
        {existing ? (
          <span
            className={`pill ${existing.status === 'APPROVED' ? 'pill-published' : 'pill-draft'}`}
          >
            {tr(`status.${existing.status}`)}
          </span>
        ) : null}
      </div>

      {existing && !open ? (
        <>
          <p className="licence-kind">
            {'★'.repeat(existing.rating).padEnd(5, '☆')}
            {existing.title ? ` — ${existing.title}` : ''}
          </p>
          <p className="review-body" dir="auto">
            {existing.body}
          </p>
          {existing.storeReply ? (
            <div className="review-reply">
              <p className="review-reply-who">{trv('storeReply')}</p>
              <p dir="auto">{existing.storeReply}</p>
            </div>
          ) : null}
        </>
      ) : null}

      {open ? (
        <form
          className="review-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="account-field">
            <span>{tr('rating')}</span>
            <select value={rating} onChange={(event) => setRating(Number(event.target.value))}>
              {[5, 4, 3, 2, 1].map((value) => (
                <option key={value} value={value}>
                  {'★'.repeat(value).padEnd(5, '☆')} — {value}/5
                </option>
              ))}
            </select>
          </label>

          <label className="account-field">
            <span>{tr('titleLabel')}</span>
            <input
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              dir="auto"
            />
          </label>

          <label className="account-field">
            <span>{tr('body')}</span>
            <textarea
              value={body}
              rows={5}
              maxLength={4000}
              onChange={(event) => setBody(event.target.value)}
              dir="auto"
            />
          </label>

          {/* Said before the button, not after it. Somebody who expects their
              words on the page immediately and does not see them there assumes
              the form failed and writes the same review again. */}
          <p className="account-hint">
            {tr('hint')}
          </p>

          <div className="licence-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || body.trim().length < 10}
            >
              {busy ? '…' : tr('send')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              {tr('cancel')}
            </button>
          </div>
        </form>
      ) : (
        <div className="licence-actions">
          {existing === null || existing.editable ? (
            <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
              {existing === null
                ? tr('write')
                : tr('edit')}
            </button>
          ) : (
            <p className="account-hint">
              {tr('moderated')}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
