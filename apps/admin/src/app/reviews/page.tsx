'use client';

import type { AdminReviewList, AdminReviewRow, ReviewStatus, StaffMe } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../../lib/api';
import { Nav } from '../nav';

/**
 * التقييمات — the moderation queue.
 *
 * The screen exists because of one number: the legacy store carried 565
 * reviews written by a plugin, and deleting them is one of the few changes the
 * owner authorised on the old site. Every row here came from a delivered order
 * line belonging to the person who wrote it — the database will not hold one
 * that did not — so the decision on this page is never "is this real", it is
 * "is this publishable". Spam carrying a link, a support problem written into
 * the wrong box, a key that failed and needs answering rather than printing.
 *
 * Which is why rejecting is as ordinary an outcome as approving, and why
 * neither can touch the words. There is no edit field on this screen. A store
 * that can rewrite a review it dislikes has the same review system the old one
 * had, with extra steps.
 *
 * The reply box is the interesting half. A bad review answered in public is
 * worth more than a bad review quietly refused, and it is the only thing here
 * that adds text to a published page.
 */
const STATUS_LABELS: Record<ReviewStatus, string> = {
  PENDING: 'بانتظار المراجعة',
  APPROVED: 'منشورة',
  REJECTED: 'مرفوضة',
};

const STATUS_TONE: Record<ReviewStatus, string> = {
  PENDING: 'pill-draft',
  APPROVED: 'pill-published',
  REJECTED: 'pill-blocked',
};

export default function ReviewsPage() {
  const router = useRouter();
  const [me, setMe] = useState<StaffMe | null>(null);
  const [status, setStatus] = useState<ReviewStatus>('PENDING');
  const [list, setList] = useState<AdminReviewList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api.reviews(status));
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : 'تعذّر تحميل التقييمات.');
    }
  }, [status, router]);

  useEffect(() => {
    void (async () => {
      try {
        const staff = await api.me();
        if (staff.mustChangePassword) {
          router.push('/password');
          return;
        }
        setMe(staff);
      } catch {
        router.push('/login');
      }
    })();
  }, [router]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (!me) return <div className="admin-layout">…</div>;

  const canWork = ['OWNER', 'ADMIN', 'SUPPORT'].includes(me.role);

  async function moderate(row: AdminReviewRow, next: 'APPROVED' | 'REJECTED'): Promise<void> {
    setError(null);
    try {
      const result = await api.moderateReview(row.id, next);
      setNote(
        next === 'APPROVED'
          ? `نُشر تقييم ${row.productName} — متوسّط المنتج الآن ${result.ratingAvg} من ${String(result.ratingCount)}`
          : `رُفض تقييم ${row.productName}`,
      );
      // Reloaded rather than patched in place: approving a review rewrites the
      // product's average and moves the row out of this list, and the counts
      // in the header change with it.
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر تنفيذ القرار.');
    }
  }

  async function reply(row: AdminReviewRow, body: string): Promise<void> {
    setError(null);
    try {
      await api.replyToReview(row.id, body);
      setNote(`أُضيف ردّ المتجر على تقييم ${row.productName}`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر حفظ الردّ.');
    }
  }

  return (
    <Nav me={me} current="reviews" {...(list ? { reviewsPending: list.counts.pending } : {})} >

      <div className="queue-head">
        <h1>التقييمات</h1>
        <p className="who">
          {list ? `${String(list.counts.pending)} تقييماً بانتظار المراجعة` : '…'}
        </p>
      </div>

      <div className="chips">
        {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`chip${status === value ? ' is-active' : ''}`}
            onClick={() => setStatus(value)}
          >
            {STATUS_LABELS[value]}
            {list ? (
              <span className="chip-count">
                {value === 'PENDING'
                  ? list.counts.pending
                  : value === 'APPROVED'
                    ? list.counts.approved
                    : list.counts.rejected}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}
      {!canWork ? (
        <p className="notice">
          دورك <strong>{me.role}</strong> يسمح بالقراءة دون نشر التقييمات أو رفضها.
        </p>
      ) : null}

      {list && list.rows.length === 0 ? (
        <p className="notice">
          {status === 'PENDING'
            ? 'لا تقييمات تنتظر المراجعة.'
            : 'لا شيء في هذه القائمة. التقييمات تأتي من بنود مُسلَّمة فقط، ولا يُنشأ أيّ تقييم بغير ذلك.'}
        </p>
      ) : null}

      {/* A row per review.
          Moderation is a judgement made across reviews — this rating against
          that one, this buyer's history against another's — and a card each
          put one decision on a screen. The rating and the buyer are columns;
          the review text opens under its own row. */}
      {list && list.rows.length > 0 ? (
        <div className="table-scroll">
          <table className="admin-table reviews-table">
            <thead>
              <tr>
                <th>الحالة</th>
                <th className="num">التقييم</th>
                <th>المنتج</th>
                <th>المشتري</th>
                <th>التاريخ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(list?.rows ?? []).map((row) => (
                <ReviewRow
                  key={row.id}
                  row={row}
                  canWork={canWork}
                  onModerate={(next) => void moderate(row, next)}
                  onReply={(body) => void reply(row, body)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Nav>
  );
}

/** Columns the drawer spans. */
const COLUMNS = 6;

function ReviewRow({
  row,
  canWork,
  onModerate,
  onReply,
}: {
  row: AdminReviewRow;
  canWork: boolean;
  onModerate: (status: 'APPROVED' | 'REJECTED') => void;
  onReply: (body: string) => void;
}) {
  const [draft, setDraft] = useState(row.storeReply ?? '');
  const [replying, setReplying] = useState(false);
  /**
   * Whether the review text is showing.
   *
   * Closed. It was open for anything still pending, on the theory that a
   * review nobody has read should not have to be asked for — but the pending
   * tab is the tab this screen opens on, so every row was open and the screen
   * was the column of cards it had just stopped being. The rating, the product
   * and the buyer are on the row; the words are one click away.
   */
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr className={`review-row${row.status === 'PENDING' ? '' : ' is-settled'}`}>
        <td>
          <span className={`pill ${STATUS_TONE[row.status]}`}>{STATUS_LABELS[row.status]}</span>
        </td>

        {/* The rating as a number as well as stars: five identical glyphs are
            hard to count at a glance and impossible to read aloud. */}
        <td className="num review-rating">
          <span aria-hidden="true">{'★'.repeat(row.rating).padEnd(5, '☆')}</span>
          <span className="meta">{row.rating}/5</span>
        </td>

        <td className="review-product">
          <strong title={row.productName}>{row.productName}</strong>
          <span className="slug" dir="ltr">
            {row.productSlug}
          </span>
        </td>

        <td className="queue-mail">
          {row.customerName ? <strong>{row.customerName}</strong> : null}
          <span dir="ltr">{row.customerEmail}</span>
          <span className="meta" dir="ltr">
            {row.orderNumber}
          </span>
        </td>

        <td className="order-date" dir="ltr">
          {row.createdAt.slice(0, 16).replace('T', ' ')}
        </td>

        <td className="actions">
          <button
            type="button"
            className={`ghost${open ? ' is-active' : ''}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? 'أخفِ' : 'اقرأ'}
          </button>
          {canWork ? (
            <>
              {row.status !== 'APPROVED' ? (
                <button type="button" onClick={() => onModerate('APPROVED')}>
                  انشر
                </button>
              ) : null}
              {row.status !== 'REJECTED' ? (
                <button type="button" className="ghost" onClick={() => onModerate('REJECTED')}>
                  ارفض
                </button>
              ) : null}
            </>
          ) : null}
        </td>
      </tr>

      {open ? (
        <tr className="review-drawer">
          <td colSpan={COLUMNS}>
            {row.title ? <p className="review-title">{row.title}</p> : null}
            <p className="message-body" dir={row.locale === 'en' ? 'ltr' : 'rtl'}>
              {row.body}
            </p>
            {row.deliveredAt ? (
              <p className="meta">سُلّم في {row.deliveredAt.slice(0, 10)}</p>
            ) : null}

            {row.storeReply ? (
              <p className="message-body" dir="auto">
                ردّ المتجر: {row.storeReply}
              </p>
            ) : null}

            {canWork && !replying ? (
              <button type="button" className="ghost" onClick={() => setReplying(true)}>
                {row.storeReply ? 'عدّل الردّ' : 'ردّ المتجر'}
              </button>
            ) : null}

            {replying ? (
              <form
                className="paste-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (draft.trim().length < 2) return;
                  onReply(draft.trim());
                  setReplying(false);
                }}
              >
                <label className="grow">
                  <span>ردّ المتجر — يُنشر تحت التقييم كما هو</span>
                  <textarea
                    value={draft}
                    rows={3}
                    onChange={(event) => setDraft(event.target.value)}
                    dir="rtl"
                  />
                </label>
                <div className="queue-actions">
                  <button type="submit">احفظ الردّ</button>
                  <button type="button" className="ghost" onClick={() => setReplying(false)}>
                    إلغاء
                  </button>
                </div>
              </form>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}
