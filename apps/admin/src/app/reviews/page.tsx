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

      <ul className="queue-list">
        {(list?.rows ?? []).map((row) => (
          <ReviewCard
            key={row.id}
            row={row}
            canWork={canWork}
            onModerate={(next) => void moderate(row, next)}
            onReply={(body) => void reply(row, body)}
          />
        ))}
      </ul>
    </Nav>
  );
}

function ReviewCard({
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

  return (
    <li className={`queue-card${row.status === 'PENDING' ? '' : ' is-settled'}`}>
      <div className="queue-card-main">
        <p className="queue-order">
          <span className={`pill ${STATUS_TONE[row.status]}`}>{STATUS_LABELS[row.status]}</span>
          {/* The rating as a number as well as stars: five identical glyphs
              are hard to count at a glance and impossible to read aloud. */}
          <span className="pill pill-ready">
            {'★'.repeat(row.rating).padEnd(5, '☆')} {row.rating}/5
          </span>
          <span className="meta">{row.createdAt.slice(0, 16).replace('T', ' ')}</span>
        </p>

        <p className="queue-product">
          {row.productName}
          <span className="meta"> — {row.productSlug}</span>
        </p>

        <dl className="queue-meta">
          <div>
            <dt>الطلب</dt>
            <dd dir="ltr">{row.orderNumber}</dd>
          </div>
          <div>
            <dt>المشتري</dt>
            <dd dir="ltr">
              {row.customerName ? `${row.customerName} · ` : ''}
              {row.customerEmail}
            </dd>
          </div>
          <div>
            {/* Always set in practice — a review cannot exist without a
                delivered line — and shown because it is the fact the whole
                feature rests on. */}
            <dt>سُلّم في</dt>
            <dd>{row.deliveredAt ? row.deliveredAt.slice(0, 10) : '—'}</dd>
          </div>
        </dl>

        {row.title ? <p className="queue-product">{row.title}</p> : null}

        <p className="message-body" dir={row.locale === 'en' ? 'ltr' : 'rtl'}>
          {row.body}
        </p>

        {row.storeReply ? (
          <p className="message-body" dir="auto">
            ردّ المتجر: {row.storeReply}
          </p>
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
      </div>

      {canWork ? (
        <div className="queue-actions">
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
          {!replying ? (
            <button type="button" className="ghost" onClick={() => setReplying(true)}>
              {row.storeReply ? 'عدّل الردّ' : 'ردّ المتجر'}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
