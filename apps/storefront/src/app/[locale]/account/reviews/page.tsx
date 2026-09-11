'use client';

import type { CustomerMe, OwnReview, ReviewableLine, ReviewableList } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

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
 * help page.
 */
const STATUS_AR: Record<OwnReview['status'], string> = {
  PENDING: 'بانتظار المراجعة',
  APPROVED: 'منشور',
  REJECTED: 'لم يُنشَر',
};

const STATUS_EN: Record<OwnReview['status'], string> = {
  PENDING: 'Waiting to be read',
  APPROVED: 'Published',
  REJECTED: 'Not published',
};

export default function AccountReviewsPage() {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const ar = (params.locale ?? 'ar') === 'ar';
  const prefix = ar ? '' : `/${params.locale ?? 'en'}`;

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
        <h1>{ar ? 'تقييماتي' : 'My reviews'}</h1>
        <p className="who" dir="ltr">
          {me.email}
        </p>
        <Link className="btn btn-ghost" href={`${prefix}${ROUTES.licenses}`}>
          {ar ? 'تراخيصي' : 'My licences'}
        </Link>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="account-sent">{note}</p> : null}

      {list && list.rows.length === 0 ? (
        <p className="notice">
          {ar
            ? 'لا شيء لتقييمه بعد. التقييم يُكتب على بند تمّ تسليمه فعلاً، ولا يُكتب بغير ذلك.'
            : 'Nothing to review yet. A review is written against a line that was actually delivered, and never any other way.'}
        </p>
      ) : null}

      {list && list.awaiting > 0 ? (
        <p className="notice">
          {ar
            ? `${String(list.awaiting)} بند لم تكتب رأيك فيه بعد. لا ننشر أيّ تقييم قبل مراجعته، ولا نعطي خصماً مقابله.`
            : `${String(list.awaiting)} item you have not written about yet. Nothing is published before a person reads it, and we never trade a discount for a review.`}
        </p>
      ) : null}

      <ul className="licence-list">
        {(list?.rows ?? []).map((row) => (
          <ReviewCard
            key={row.orderItemId}
            row={row}
            ar={ar}
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
  ar,
  prefix,
  onDone,
  onError,
}: {
  row: ReviewableLine;
  ar: boolean;
  prefix: string;
  onDone: (message: string) => void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(row.review?.rating ?? 5);
  const [title, setTitle] = useState(row.review?.title ?? '');
  const [body, setBody] = useState(row.review?.body ?? '');
  const [busy, setBusy] = useState(false);

  const statuses = ar ? STATUS_AR : STATUS_EN;
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
        onDone(ar ? 'حُفظ التعديل.' : 'Your changes are saved.');
      } else {
        await accountApi.submitReview(row.orderItemId, {
          rating,
          ...(title.trim().length > 0 ? { title: title.trim() } : {}),
          body: body.trim(),
          locale: ar ? 'ar' : 'en',
        });
        onDone(
          ar
            ? 'وصلنا تقييمك. يُنشر بعد أن يقرأه أحدنا.'
            : 'We have your review. It is published once somebody has read it.',
        );
      }
      setOpen(false);
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : ar
            ? 'تعذّر حفظ التقييم.'
            : 'The review could not be saved.',
      );
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
              {ar ? 'سُلّم في ' : 'Delivered '}
              {row.deliveredAt.slice(0, 10)}
            </span>
          </p>
        </div>
        {existing ? (
          <span
            className={`pill ${existing.status === 'APPROVED' ? 'pill-published' : 'pill-draft'}`}
          >
            {statuses[existing.status]}
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
              <p className="review-reply-who">{ar ? 'ردّ المتجر' : 'Reply from the store'}</p>
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
            <span>{ar ? 'التقييم' : 'Rating'}</span>
            <select value={rating} onChange={(event) => setRating(Number(event.target.value))}>
              {[5, 4, 3, 2, 1].map((value) => (
                <option key={value} value={value}>
                  {'★'.repeat(value).padEnd(5, '☆')} — {value}/5
                </option>
              ))}
            </select>
          </label>

          <label className="account-field">
            <span>{ar ? 'عنوان (اختياري)' : 'Title (optional)'}</span>
            <input
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              dir="auto"
            />
          </label>

          <label className="account-field">
            <span>{ar ? 'رأيك' : 'Your review'}</span>
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
            {ar
              ? 'يُنشر بعد أن يقرأه أحدنا، ويمكنك تعديله حتى ذلك الحين. إن كان المفتاح لم يعمل فالدعم أسرع من التقييم.'
              : 'It is published once somebody has read it, and you can change it until then. If a key did not work, support will fix that faster than a review will.'}
          </p>

          <div className="licence-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || body.trim().length < 10}
            >
              {busy ? '…' : ar ? 'أرسل' : 'Send'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              {ar ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </form>
      ) : (
        <div className="licence-actions">
          {existing === null || existing.editable ? (
            <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
              {existing === null
                ? ar
                  ? 'اكتب رأيك'
                  : 'Write a review'
                : ar
                  ? 'عدّل تقييمك'
                  : 'Edit your review'}
            </button>
          ) : (
            <p className="account-hint">
              {ar
                ? 'تمّت مراجعة هذا التقييم، فلم يعد قابلاً للتعديل.'
                : 'This review has been moderated, so it can no longer be changed.'}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
