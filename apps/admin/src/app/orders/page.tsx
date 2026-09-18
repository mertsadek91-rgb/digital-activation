'use client';

import type { AdminOrderDetail, AdminOrderList, AdminOrderRow, StaffMe } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
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
const STATUS_KEYS = {
  PENDING_PAYMENT: 'statusPendingPayment',
  PAYMENT_REVIEW: 'statusPaymentReview',
  PAID: 'statusPaid',
  FULFILLING: 'statusFulfilling',
  FULFILLED: 'statusFulfilled',
  COMPLETED: 'statusCompleted',
  CANCELLED: 'statusCancelled',
  REFUNDED: 'statusRefunded',
  PARTIALLY_REFUNDED: 'statusPartiallyRefunded',
  FAILED: 'statusFailed',
} as const satisfies Record<AdminOrderRow['status'], string>;

const FILTERS = [
  { key: 'awaiting-payment', label: 'filterAwaitingPayment' },
  { key: 'in-review', label: 'filterInReview' },
  { key: 'paid', label: 'filterPaid' },
  { key: 'done', label: 'filterDone' },
  { key: 'all', label: 'filterAll' },
] as const;

export default function OrdersPage() {
  const router = useRouter();
  const t = useT('orders');
  const c = useT('common');
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
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [filter, query, router, t]);

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

  if (!me) return <div className="admin-layout">{c('loading')}</div>;

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
      setError(caught instanceof Error ? caught.message : c('actionFailed'));
    }
  }

  return (
    <Nav me={me} current="orders">
      <div className="queue-head">
        <h1>{t('title')}</h1>
        <p className="who">
          {data ? t('summary', { count: data.counts.all, paid: data.counts.paid }) : c('loading')}
          {data && data.counts.awaitingPayment > 0 ? (
            <strong className="overdue-count">
              {' '}
              · {t('awaitingPayment', { count: data.counts.awaitingPayment })}
            </strong>
          ) : null}
        </p>
      </div>

      <div className="store-bar">
        <nav className="sorts" aria-label={c('filter')}>
          {FILTERS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`tab${filter === entry.key ? ' is-active' : ''}`}
              onClick={() => setFilter(entry.key)}
            >
              {t(entry.label)}
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
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
          />
          <button type="submit" className="ghost">
            {c('search')}
          </button>
        </form>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}

      {data && data.rows.length === 0 ? <p className="notice">{t('empty')}</p> : null}

      {/* A row per order.
          It was a card per order in a single narrow column: one order filled a
          screen, the number sat at the top and the total three lines below it,
          and the left half of the page was empty. Orders are compared — by
          date, by amount, by who is waiting — and comparison is what a column
          of cards makes impossible. Every field is a column now, in the same
          place on every row whether it has a value or not, so the eye can run
          down one of them. The detail opens underneath the row it belongs to. */}
      {data && data.rows.length > 0 ? (
        <div className="table-scroll">
          <table className="admin-table orders-table">
            <thead>
              <tr>
                <th>{t('colOrder')}</th>
                <th>{t('colStatus')}</th>
                <th>{t('colCustomer')}</th>
                <th className="num">{t('colItems')}</th>
                <th className="num">{t('colTotal')}</th>
                <th>{t('colDate')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((row) => (
                <OrderRow
                  key={row.number}
                  row={row}
                  canConfirm={canConfirm}
                  canResend={canResend}
                  onConfirm={(provider, reference) =>
                    void act(t('donePaymentConfirmed', { number: row.number }), () =>
                      api.confirmPayment(row.number, provider, reference),
                    )
                  }
                  onNote={(body) =>
                    void act(t('doneNoteAdded', { number: row.number }), () =>
                      api.addOrderNote(row.number, body),
                    )
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Nav>
  );
}

/** The number of columns the detail row has to span. Kept beside the header. */
const COLUMNS = 7;

function OrderRow({
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
  const t = useT('orders');
  const c = useT('common');
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
      setDetailError(caught instanceof Error ? caught.message : t('detailFailed'));
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
      setDetailError(caught instanceof Error ? caught.message : t('resendFailed'));
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
    <>
      <tr className={`order-row${risky ? ' is-risky' : ''}${open ? ' is-open' : ''}`}>
        <td>
          <span className="order-number" dir="ltr">
            {row.number}
          </span>
        </td>

        <td>
          <span className={`pill ${statusPill(row.status)}`}>{t(STATUS_KEYS[row.status])}</span>
          {risky ? (
            <span className="pill pill-blocked">{t('riskPill', { level: row.riskLevel })}</span>
          ) : null}
          {row.waitingLines > 0 && !awaiting ? (
            <span className="pill pill-draft">
              {t('inFulfilment', { count: row.waitingLines })}
            </span>
          ) : null}
        </td>

        <td className="order-customer">
          {row.customerName ? <strong>{row.customerName}</strong> : null}
          <span dir="ltr">{row.email}</span>
        </td>

        <td className="num">{row.itemCount}</td>

        <td className="num order-total" dir="ltr">
          ${row.totalUsd}
        </td>

        <td className="order-date" dir="ltr">
          {row.placedAt.slice(0, 16).replace('T', ' ')}
        </td>

        <td className="actions">
          {awaiting && canConfirm ? (
            <button
              type="button"
              className={confirming ? 'ghost is-active' : undefined}
              onClick={() => {
                setConfirming(!confirming);
                setNoting(false);
              }}
            >
              {confirming ? c('cancel') : t('confirmPayment')}
            </button>
          ) : null}
          <button
            type="button"
            className={`ghost${noting ? ' is-active' : ''}`}
            onClick={() => {
              setNoting(!noting);
              setConfirming(false);
            }}
          >
            {t('noteButton')}
          </button>
          <button
            type="button"
            className={`ghost${open ? ' is-active' : ''}`}
            aria-expanded={open}
            onClick={() => void toggle()}
          >
            {open ? c('hide') : c('details')}
          </button>
        </td>
      </tr>

      {confirming ? (
        <tr className="order-drawer">
          <td colSpan={COLUMNS}>
            <form
              className="paste-form order-action-form"
              onSubmit={(event) => {
                event.preventDefault();
                onConfirm(provider, reference.trim());
                setReference('');
                setConfirming(false);
              }}
            >
              <label>
                {t('methodLabel')}
                <select
                  value={provider}
                  onChange={(event) =>
                    setProvider(event.target.value as 'BANK_TRANSFER' | 'CRYPTO')
                  }
                >
                  <option value="BANK_TRANSFER">{t('methodBankTransfer')}</option>
                  <option value="CRYPTO">{t('methodCrypto')}</option>
                </select>
              </label>
              <label className="grow">
                {t('referenceLabel')}
                <input
                  type="text"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  dir="ltr"
                  required
                  minLength={3}
                  placeholder={t('referencePlaceholder')}
                />{' '}
                <small>{t('referenceHint')}</small>
              </label>
              <button type="submit" disabled={reference.trim().length < 3}>
                {t('confirmAndRelease')}
              </button>
            </form>
          </td>
        </tr>
      ) : null}

      {noting ? (
        <tr className="order-drawer">
          <td colSpan={COLUMNS}>
            <form
              className="paste-form order-action-form"
              onSubmit={(event) => {
                event.preventDefault();
                onNote(body.trim());
                setBody('');
                setNoting(false);
              }}
            >
              <label className="grow">
                {t('internalNote')}
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={3}
                  required
                  minLength={2}
                  placeholder={t('internalNotePlaceholder')}
                />
                <small>{t('internalNoteHint')}</small>
              </label>
              <button type="submit" disabled={body.trim().length < 2}>
                {t('addNote')}
              </button>
            </form>
          </td>
        </tr>
      ) : null}

      {open ? (
        <tr className="order-drawer">
          <td colSpan={COLUMNS}>
            <div className="order-detail">
              {detailError ? <p className="error">{detailError}</p> : null}
              {resent ? (
                <p className="ok-note" dir="ltr">
                  {resent}
                </p>
              ) : null}
              {!detail && !detailError ? (
                <p className="meta loading-box">{t('loadingDetail')}</p>
              ) : null}

              {detail ? (
                <>
                  {/* Moved out of the row.
                      Eight columns did not fit beside the sidebar, and this was
                      the one that is detail rather than scan-data: it is empty
                      on most orders, the status column already says whether
                      payment is outstanding, and the part worth reading — the
                      provider's reference, against a bank statement — needs
                      more room than a cell in a list can give it. */}
                  {row.payments.length > 0 ? (
                    <div className="detail-section">
                      <h3 className="detail-heading">
                        {t('paymentsHeading', { count: row.payments.length })}
                      </h3>
                      <ul className="order-payments-list">
                        {row.payments.map((payment, index) => (
                          <li key={index} dir="ltr">
                            <span className="order-payment-tag">
                              {payment.provider} · {payment.state}
                              {payment.reference ? ` (${payment.reference})` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="detail-section">
                    <h3 className="detail-heading">
                      {t('linesHeading', { count: detail.lines.length })}
                    </h3>
                    <ul className="order-items-list">
                      {detail.lines.map((line) => (
                        <li key={line.orderItemId} className="order-item-card">
                          <div className="order-item-desc">
                            <div className="order-item-header">
                              <span className="order-item-name">{line.productName}</span>
                              {line.qty > 1 ? (
                                <span className="item-qty-tag">×{line.qty}</span>
                              ) : null}
                            </div>
                            <div className="order-item-meta">
                              <span className="item-sku-tag" dir="ltr">
                                {line.sku}
                              </span>
                              <span
                                className={`pill item-state-pill pill-${line.fulfillmentState.toLowerCase()}`}
                              >
                                {line.fulfillmentState}
                              </span>
                              {line.deliveredAt ? (
                                <span className="item-deliv-date">
                                  {' '}
                                  {t('deliveredOn', {
                                    at: line.deliveredAt.slice(0, 16).replace('T', ' '),
                                  })}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          {canResend && line.fulfillmentState === 'DELIVERED' ? (
                            <button
                              type="button"
                              className="ghost btn-resend"
                              disabled={busy !== null}
                              onClick={() => void resend(line.orderItemId)}
                            >
                              {busy === line.orderItemId ? c('loading') : t('resendLicence')}
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="detail-section">
                    <h3 className="detail-heading">
                      {t('mailHeading', { count: detail.emails.length })}
                    </h3>
                    {detail.emails.length === 0 ? (
                      <p className="meta empty-state-text">{t('noMailYet')}</p>
                    ) : (
                      <ul className="order-mails-list">
                        {detail.emails.map((mail, index) => (
                          <li
                            key={index}
                            className={`order-mail-item ${(mail.error ?? mail.bouncedAt) ? 'is-bad' : ''}`}
                          >
                            <div className="mail-primary">
                              <span className="mail-template" dir="ltr">
                                {mail.template}
                              </span>
                              <span className="mail-to" dir="ltr">
                                {mail.to}
                              </span>
                              <span className="mail-date">
                                {mail.sentAt.slice(0, 16).replace('T', ' ')}
                              </span>
                            </div>
                            <span
                              className={`pill mail-status ${mail.error || mail.bouncedAt ? 'pill-blocked' : 'pill-published'}`}
                            >
                              {' '}
                              {mail.error ??
                                (mail.bouncedAt
                                  ? t('mailBounced')
                                  : mail.deliveredAt
                                    ? t('mailDelivered')
                                    : t('mailSent'))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {detail.notes.length > 0 ? (
                    <div className="detail-section">
                      <h3 className="detail-heading">
                        {t('notesHeading', { count: detail.notes.length })}
                      </h3>
                      <ul className="order-notes-list">
                        {detail.notes.map((note) => (
                          <li key={note.id} className="order-note-item">
                            <p className="note-text">{note.body}</p>
                            <div className="note-meta-row">
                              <span className="note-author">
                                {note.author ?? t('unknownAuthor')}
                              </span>
                              <span>·</span>
                              <span className="note-date">
                                {note.createdAt.slice(0, 16).replace('T', ' ')}
                              </span>
                              {note.isCustomerVisible ? (
                                <span className="pill pill-published">
                                  {t('noteCustomerVisible')}
                                </span>
                              ) : (
                                <span className="pill pill-draft">{t('noteInternal')}</span>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {detail.activationEmail ? (
                    <div className="order-activation-banner">
                      <span>{t('activationEmail')}</span>
                      <strong dir="ltr">{detail.activationEmail}</strong>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
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
