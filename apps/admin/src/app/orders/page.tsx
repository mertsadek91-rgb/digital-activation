'use client';

import type { AdminOrderDetail, AdminOrderList, AdminOrderRow, StaffMe } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../../lib/api';
import { Nav } from '../nav';

/**
 * Orders.
 *
 * The screen a shop cannot be run without, and the last one missing. One thing
 * on it could not be done anywhere at all until now: confirming a payment that
 * arrived outside the store. The storefront offers a bank transfer, tells the
 * customer a person will check, and there was nobody who could say the money
 * had come — which made the only working payment path a Stripe account that
 * does not exist yet.
 *
 * So the filter that opens first is "awaiting payment". Everything else on the
 * screen is there to answer the question that confirmation raises: is this
 * order what it claims to be? The email, the customer's history, the risk
 * level and every payment row against it are on the card, because the decision
 * is made from those and not from a total.
 */
const STATUS_LABELS: Record<AdminOrderRow['status'], string> = {
  PENDING_PAYMENT: 'بانتظار الدفع',
  PAYMENT_REVIEW: 'قيد مراجعة الدفع',
  PAID: 'مدفوع',
  FULFILLING: 'قيد التجهيز',
  FULFILLED: 'تم التجهيز',
  COMPLETED: 'مكتمل',
  CANCELLED: 'ملغى',
  REFUNDED: 'مُسترَد',
  PARTIALLY_REFUNDED: 'مُسترَد جزئياً',
  FAILED: 'فشل',
};

const FILTERS: { key: string; label: string }[] = [
  { key: 'awaiting-payment', label: 'بانتظار الدفع' },
  { key: 'in-review', label: 'قيد المراجعة' },
  { key: 'paid', label: 'مدفوعة' },
  { key: 'done', label: 'منتهية' },
  { key: 'all', label: 'الكل' },
];

export default function OrdersPage() {
  const router = useRouter();
  const [me, setMe] = useState<StaffMe | null>(null);
  const [data, setData] = useState<AdminOrderList | null>(null);
  const [filter, setFilter] = useState('awaiting-payment');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.orders(filter === 'all' ? undefined : filter, query.trim() || undefined));
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : 'تعذّر تحميل الطلبات.');
    }
  }, [filter, query, router]);

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

  if (!me) return <main className="shell">…</main>;

  const canConfirm = ['OWNER', 'ADMIN'].includes(me.role);
  // Wider than confirming on purpose: re-sending a licence is what the person
  // answering the message needs to do, and the API agrees.
  const canResend = ['OWNER', 'ADMIN', 'SUPPORT', 'FULFILLMENT'].includes(me.role);

  async function act(label: string, run: () => Promise<unknown>): Promise<void> {
    setError(null);
    setNote(null);
    try {
      await run();
      setNote(label);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر تنفيذ الإجراء.');
    }
  }

  return (
    <main className="shell">
      <Nav me={me} current="orders" />

      <div className="queue-head">
        <h1>الطلبات</h1>
        <p className="who">
          {data ? `${String(data.counts.all)} طلباً · ${String(data.counts.paid)} مدفوع` : '…'}
          {data && data.counts.awaitingPayment > 0 ? (
            <strong className="overdue-count">
              {' '}
              · {data.counts.awaitingPayment} بانتظار الدفع
            </strong>
          ) : null}
        </p>
      </div>

      <div className="store-bar">
        <nav className="sorts" aria-label="تصفية">
          {FILTERS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`tab${filter === entry.key ? ' is-active' : ''}`}
              onClick={() => setFilter(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <form
          className="lookup-form"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="رقم الطلب أو البريد"
            aria-label="ابحث في الطلبات"
          />
          <button type="submit" className="ghost">
            ابحث
          </button>
        </form>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}

      {data && data.rows.length === 0 ? <p className="notice">لا طلبات في هذا التصنيف.</p> : null}

      <ul className="queue-list">
        {(data?.rows ?? []).map((row) => (
          <OrderCard
            key={row.number}
            row={row}
            canConfirm={canConfirm}
            canResend={canResend}
            onConfirm={(provider, reference) =>
              void act(`أُكّد دفع ${row.number}`, () =>
                api.confirmPayment(row.number, provider, reference),
              )
            }
            onNote={(body) =>
              void act(`أُضيفت ملاحظة على ${row.number}`, () => api.addOrderNote(row.number, body))
            }
          />
        ))}
      </ul>
    </main>
  );
}

function OrderCard({
  row,
  canConfirm,
  canResend,
  onConfirm,
  onNote,
}: {
  row: AdminOrderRow;
  canConfirm: boolean;
  canResend: boolean;
  onConfirm: (provider: 'BANK_TRANSFER' | 'CRYPTO', reference: string) => void;
  onNote: (body: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [noting, setNoting] = useState(false);
  /**
   * The rest of the order, loaded when somebody asks for it.
   *
   * Not with the list: the list is the whole screen and pulling every order's
   * lines, notes and mail log into it would be dozens of queries to draw rows
   * nobody has looked at. Loaded once per card and kept, so closing and
   * reopening does not fetch again — except after a re-send, which changes
   * what the mail log says.
   */
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [resent, setResent] = useState<string | null>(null);

  async function loadDetail(): Promise<void> {
    setDetailError(null);
    try {
      setDetail(await api.order(row.number));
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : 'تعذّر تحميل تفاصيل الطلب.');
    }
  }

  async function toggle(): Promise<void> {
    const next = !open;
    setOpen(next);
    if (next && !detail) await loadDetail();
  }

  async function resend(orderItemId: string): Promise<void> {
    setBusy(orderItemId);
    setDetailError(null);
    setResent(null);
    try {
      const result = await api.resendLicence(row.number, orderItemId);
      setResent(result.to);
      // The mail log just gained a row, and it is the evidence somebody came
      // here for.
      await loadDetail();
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : 'تعذّر إرسال الرسالة.');
    } finally {
      setBusy(null);
    }
  }
  const [provider, setProvider] = useState<'BANK_TRANSFER' | 'CRYPTO'>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [body, setBody] = useState('');

  const awaiting = row.status === 'PENDING_PAYMENT';
  const risky = row.riskLevel === 'HIGH' || row.riskLevel === 'BLOCKED';

  return (
    <li className={`queue-card${risky ? ' is-overdue' : ''}`}>
      <div className="queue-card-main">
        <p className="queue-order">
          <span dir="ltr">{row.number}</span>
          <span className={`pill ${statusPill(row.status)}`}>{STATUS_LABELS[row.status]}</span>
          {risky ? <span className="pill pill-blocked">مخاطرة {row.riskLevel}</span> : null}
          {row.waitingLines > 0 && !awaiting ? (
            <span className="meta">{row.waitingLines} بند قيد التجهيز</span>
          ) : null}
        </p>

        <p className="queue-product">
          ${row.totalUsd}
          <span className="meta">
            {' '}
            · {row.itemCount} بند · {row.placedAt.slice(0, 16).replace('T', ' ')}
          </span>
        </p>

        <dl className="queue-meta">
          <div>
            <dt>العميل</dt>
            <dd dir="ltr">
              {row.customerName ? `${row.customerName} · ` : ''}
              {row.email}
            </dd>
          </div>
          {row.payments.length > 0 ? (
            <div>
              <dt>المدفوعات</dt>
              <dd dir="ltr">
                {row.payments.map((payment, index) => (
                  <span key={index} className="slug">
                    {payment.provider} {payment.state} {payment.reference ?? '—'}
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="queue-actions">
        {/* Only where it applies. A confirm button on a paid order is a button
            whose only outcome is an error message. */}
        {awaiting && canConfirm ? (
          <button type="button" className="btn-primary" onClick={() => setConfirming(!confirming)}>
            {confirming ? 'إلغاء' : 'أكّد استلام المبلغ'}
          </button>
        ) : null}
        <button type="button" className="ghost" onClick={() => setNoting(!noting)}>
          ملاحظة
        </button>
        <button type="button" className="ghost" onClick={() => void toggle()}>
          {open ? 'أخفِ التفاصيل' : 'التفاصيل'}
        </button>
      </div>

      {confirming ? (
        <form
          className="paste-form"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm(provider, reference.trim());
            setReference('');
            setConfirming(false);
          }}
        >
          <label>
            الطريقة
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as 'BANK_TRANSFER' | 'CRYPTO')}
            >
              <option value="BANK_TRANSFER">تحويل بنكي</option>
              <option value="CRYPTO">عملة رقمية</option>
            </select>
          </label>
          <label className="grow">
            المرجع
            <input
              type="text"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              dir="ltr"
              required
              minLength={3}
              placeholder="رقم العملية في كشف الحساب"
            />
            <small>
              يُفرج عن الطلب فوراً ويبدأ التجهيز — ومفتاح من المخزون يُرسَل للعميل. المرجع هو ما
              يربط هذا التأكيد بكشف حسابك لاحقاً، فاكتبه كما هو.
            </small>
          </label>
          <button type="submit" disabled={reference.trim().length < 3}>
            أكّد وأفرِج
          </button>
        </form>
      ) : null}

      {noting ? (
        <form
          className="paste-form"
          onSubmit={(event) => {
            event.preventDefault();
            onNote(body.trim());
            setBody('');
            setNoting(false);
          }}
        >
          <label className="grow">
            ملاحظة داخلية
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={3}
              required
              minLength={2}
              placeholder="ما اتُّفق عليه مع العميل"
            />
            {/* The one rule about notes, where somebody would otherwise break
                it: the legacy store delivered keys this way. */}
            <small>لا تكتب هنا مفتاحاً أو كلمة مرور. التسليم يتم من الخزنة وحدها.</small>
          </label>
          <button type="submit" disabled={body.trim().length < 2}>
            أضِف
          </button>
        </form>
      ) : null}

      {open ? (
        <div className="order-detail">
          {detailError ? <p className="error">{detailError}</p> : null}
          {resent ? (
            <p className="ok-note" dir="ltr">
              {resent}
            </p>
          ) : null}
          {!detail && !detailError ? <p className="meta">…</p> : null}

          {detail ? (
            <>
              <h3>البنود</h3>
              <ul className="line-list">
                {detail.lines.map((line) => (
                  <li key={line.orderItemId}>
                    <div>
                      <p className="slug" dir="ltr">
                        {line.sku}
                      </p>
                      <p className="meta">
                        {line.productName}
                        {line.qty > 1 ? ` · ×${String(line.qty)}` : ''} · {line.fulfillmentState}
                        {line.deliveredAt
                          ? ` · ${line.deliveredAt.slice(0, 16).replace('T', ' ')}`
                          : ''}
                      </p>
                    </div>
                    {/* Only on a delivered line. On anything else the API
                        refuses, and a button whose only outcome is an error is
                        worse than no button. */}
                    {canResend && line.fulfillmentState === 'DELIVERED' ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void resend(line.orderItemId)}
                      >
                        {busy === line.orderItemId ? '…' : 'أعِد إرسال الترخيص'}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>

              {/*
                The half of "لم يصلني المفتاح" that is answerable without
                touching the vault: whether the message went out, where, and
                whether it failed.
              */}
              <h3>الرسائل</h3>
              {detail.emails.length === 0 ? (
                <p className="meta">لم تُرسَل أي رسالة على هذا الطلب بعد.</p>
              ) : (
                <ul className="mail-log">
                  {detail.emails.map((mail, index) => (
                    <li
                      key={index}
                      className={(mail.error ?? mail.bouncedAt) ? 'is-bad' : undefined}
                    >
                      <span className="slug" dir="ltr">
                        {mail.template}
                      </span>
                      <span dir="ltr">{mail.to}</span>
                      <span className="meta">{mail.sentAt.slice(0, 16).replace('T', ' ')}</span>
                      <span className="meta">
                        {mail.error ??
                          (mail.bouncedAt ? 'ارتدّت' : mail.deliveredAt ? 'وصلت' : 'أُرسلت')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {detail.notes.length > 0 ? (
                <>
                  <h3>الملاحظات</h3>
                  <ul className="note-list">
                    {detail.notes.map((note) => (
                      <li key={note.id}>
                        <p>{note.body}</p>
                        <p className="meta">
                          {note.author ?? 'غير معروف'} ·{' '}
                          {note.createdAt.slice(0, 16).replace('T', ' ')}
                          {note.isCustomerVisible ? ' · ظاهرة للعميل' : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {detail.activationEmail ? (
                <p className="meta">
                  بريد التفعيل: <span dir="ltr">{detail.activationEmail}</span>
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function statusPill(status: AdminOrderRow['status']): string {
  switch (status) {
    case 'PENDING_PAYMENT':
      return 'pill-draft';
    case 'PAYMENT_REVIEW':
      return 'pill-blocked';
    case 'PAID':
    case 'FULFILLING':
      return 'pill-ready';
    case 'FULFILLED':
    case 'COMPLETED':
      return 'pill-published';
    default:
      return 'pill-blocked';
  }
}
