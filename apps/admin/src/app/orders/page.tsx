'use client';

import type { AdminOrderList, AdminOrderRow, StaffMe } from '@da/contracts';
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
  onConfirm,
  onNote,
}: {
  row: AdminOrderRow;
  canConfirm: boolean;
  onConfirm: (provider: 'BANK_TRANSFER' | 'CRYPTO', reference: string) => void;
  onNote: (body: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [noting, setNoting] = useState(false);
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
