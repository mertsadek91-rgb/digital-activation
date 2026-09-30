'use client';

import type {
  AdminFpOrderPayment,
  AdminOrderDetail,
  AdminOrderEvent,
  AdminOrderList,
  AdminOrderRow,
  FpRefundStatus,
  RefundOrderResult,
} from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useStaff } from '../../lib/use-staff';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api, ApiError } from '../../lib/api';
import { Nav } from '../nav';
import { fpErrorText } from '../payments/fp-settings';

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

const ACTOR_KEYS = {
  SYSTEM: 'actorSystem',
  STAFF: 'actorStaff',
  PROVIDER: 'actorProvider',
} as const satisfies Record<AdminOrderEvent['actorType'], string>;

const FP_REFUND_KEYS = {
  PENDING: 'fpRefundPENDING',
  SUCCEEDED: 'fpRefundSUCCEEDED',
  FAILED: 'fpRefundFAILED',
} as const satisfies Record<FpRefundStatus, string>;

const FP_STATE_KEYS = {
  REQUIRES_ACTION: 'fpStateREQUIRES_ACTION',
  PROCESSING: 'fpStatePROCESSING',
  SUCCEEDED: 'fpStateSUCCEEDED',
  FAILED: 'fpStateFAILED',
  CANCELLED: 'fpStateCANCELLED',
  REFUNDED: 'fpStateREFUNDED',
} as const;

const FP_REFUND_PILLS = {
  PENDING: 'pill-draft',
  SUCCEEDED: 'pill-published',
  FAILED: 'pill-blocked',
} as const satisfies Record<FpRefundStatus, string>;

/** The same shape the API accepts for a refund amount: USD, two decimals at most. */
const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * A decimal USD string as whole cents. A third decimal (the money type allows
 * one) is dropped, which only ever lowers the cap it is compared against.
 */
function toCents(value: string): number {
  const [whole = '0', fraction = ''] = value.replace(/^-/, '').split('.');
  return Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
}

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
  const me = useStaff();
  const [data, setData] = useState<AdminOrderList | null>(null);
  const [filter, setFilter] = useState('awaiting-payment');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');

  const load = useCallback(async () => {
    try {
      setData(
        await api.orders(filter === 'all' ? undefined : filter, query.trim() || undefined, page),
      );
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [filter, query, page, router, t]);

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
              onClick={() => {
                setFilter(entry.key);
                setPage(1);
              }}
            >
              {t(entry.label)}
            </button>
          ))}
        </nav>

        <form
          className="lookup-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (page !== 1) setPage(1);
            else void load();
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

      {/* The export, for the people the API lets have it. It follows the
          status tab that is open, so the file is the list on screen over a
          date range rather than a second set of filters to get right. */}
      {canConfirm ? (
        <form
          className="lookup-form"
          onSubmit={(event) => {
            event.preventDefault();
            void act(t('exportCsv'), () =>
              api.exportOrders({
                from: exportFrom,
                to: exportTo,
                status: filter === 'all' ? undefined : filter,
              }),
            );
          }}
        >
          <label>
            {t('exportFrom')}{' '}
            <input
              type="date"
              value={exportFrom}
              onChange={(event) => setExportFrom(event.target.value)}
            />
          </label>
          <label>
            {t('exportTo')}{' '}
            <input
              type="date"
              value={exportTo}
              onChange={(event) => setExportTo(event.target.value)}
            />
          </label>
          <button type="submit" className="ghost">
            {t('exportCsv')}
          </button>
          <small className="meta">{t('exportHint')}</small>
        </form>
      ) : null}

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
                  onRelease={(reason) =>
                    void act(t('doneHoldReleased', { number: row.number }), () =>
                      api.releaseHold(row.number, reason),
                    )
                  }
                  onRefund={async (reason, amount) => {
                    setError(null);
                    setNote(null);
                    // Errors are thrown back to the row, which shows them
                    // beside the form they belong to.
                    const result = await api.refundOrder(row.number, reason, amount);
                    setNote(t('doneRefunded', { number: row.number }));
                    void load();
                    return result;
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data && (data.page > 1 || data.hasMore) ? (
        <nav className="pager" aria-label={t('pagerLabel')}>
          <button
            type="button"
            className="ghost"
            disabled={data.page <= 1}
            onClick={() => setPage(data.page - 1)}
          >
            {t('pagePrev')}
          </button>
          <span>{t('pageNumber', { page: data.page })}</span>
          <button
            type="button"
            className="ghost"
            disabled={!data.hasMore}
            onClick={() => setPage(data.page + 1)}
          >
            {t('pageNext')}
          </button>
        </nav>
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
  onRelease,
  onRefund,
}: {
  row: AdminOrderRow;
  canConfirm: boolean;
  canResend: boolean;
  onConfirm: (provider: 'BANK_TRANSFER' | 'CRYPTO', reference: string) => void;
  onNote: (body: string) => void;
  onRelease: (reason: string) => void;
  onRefund: (reason: string, amount?: string) => Promise<RefundOrderResult>;
}) {
  const t = useT('orders');
  const c = useT('common');
  const fpT = useT('finalProcessor');
  const [confirming, setConfirming] = useState(false);
  const [noting, setNoting] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [releaseReason, setReleaseReason] = useState('');
  const [refunding, setRefunding] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundSending, setRefundSending] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundResult, setRefundResult] = useState<string | null>(null);
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
  // The same test the API applies: a paid order stopped by a rule, or a paid
  // order whose risk level blocks delivery.
  const held =
    row.status === 'PAYMENT_REVIEW' ||
    (risky && (row.status === 'PAID' || row.status === 'FULFILLING'));
  // Anything the money has arrived for and not already gone back from.
  const refundable = [
    'PAID',
    'PAYMENT_REVIEW',
    'FULFILLING',
    'FULFILLED',
    'COMPLETED',
    'PARTIALLY_REFUNDED',
  ].includes(row.status);
  // The payment the API refunds is the order's succeeded one. A Final
  // Processor payment can be refunded in part; everything else in full only.
  const paidThroughFp = row.payments.some(
    (payment) => payment.provider === 'FINAL_PROCESSOR' && payment.state === 'SUCCEEDED',
  );
  const fp = detail?.finalProcessor ?? null;

  /*
   * The amount box, checked against the cap the API applies: what was paid,
   * less refunds that succeeded or are still pending. Empty means the whole
   * remaining balance, so an empty box is valid whenever anything remains.
   */
  const capCents = fp ? toCents(fp.refundableUsd) : null;
  const amountText = refundAmount.trim();
  let amountProblem: string | null = null;
  if (paidThroughFp && fp && capCents !== null) {
    if (capCents <= 0) amountProblem = t('refundNothingLeft');
    else if (amountText !== '' && !AMOUNT_PATTERN.test(amountText))
      amountProblem = t('refundAmountInvalid');
    else if (amountText !== '' && toCents(amountText) <= 0) amountProblem = t('refundAmountZero');
    else if (amountText !== '' && toCents(amountText) > capCents)
      amountProblem = t('refundAmountTooHigh', { max: fp.refundableUsd });
  }
  const refundReady =
    refundReason.trim().length >= 3 &&
    !refundSending &&
    amountProblem === null &&
    (!paidThroughFp || fp !== null);

  function openRefund(): void {
    const next = !refunding;
    setRefunding(next);
    setRefundError(null);
    setRefundResult(null);
    setReleasing(false);
    setConfirming(false);
    setNoting(false);
    // The cap lives on the detail; fetch it now rather than on submit.
    if (next && paidThroughFp && !detail) void loadDetail();
  }

  async function submitRefund(): Promise<void> {
    setRefundSending(true);
    setRefundError(null);
    setRefundResult(null);
    try {
      const result = await onRefund(
        refundReason.trim(),
        paidThroughFp && amountText !== '' ? amountText : undefined,
      );
      setRefundResult(
        result.via === 'final_processor' && result.refund
          ? t('refundResultFp', {
              amount: result.refund.amountUsd,
              status: t(FP_REFUND_KEYS[result.refund.status]),
            })
          : t('refundResultOther', { status: t(STATUS_KEYS[result.status]) }),
      );
      setRefundReason('');
      setRefundAmount('');
      // The refunds list and the cap both changed.
      if (paidThroughFp || detail) await loadDetail();
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : null;
      // Admins see the code as well as the sentence (A.6).
      const text =
        fpErrorText(fpT, code) ?? (caught instanceof Error ? caught.message : t('refundFailed'));
      setRefundError(code ? `${text} (${code})` : text);
    } finally {
      setRefundSending(false);
    }
  }

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
          {held && canConfirm ? (
            <button
              type="button"
              className={releasing ? 'ghost is-active' : undefined}
              onClick={() => {
                setReleasing(!releasing);
                setConfirming(false);
                setNoting(false);
              }}
            >
              {releasing ? c('cancel') : t('releaseHold')}
            </button>
          ) : null}
          {refundable && canConfirm ? (
            <button
              type="button"
              className={`ghost${refunding ? ' is-active' : ''}`}
              onClick={openRefund}
            >
              {refunding ? (refundResult ? c('hide') : c('cancel')) : t('refund')}
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

      {refunding ? (
        <tr className="order-drawer">
          <td colSpan={COLUMNS}>
            <form
              className="paste-form order-action-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (refundReady) void submitRefund();
              }}
            >
              <label className="grow">
                {t('refundReasonLabel')}
                <textarea
                  value={refundReason}
                  onChange={(event) => setRefundReason(event.target.value)}
                  rows={2}
                  required
                  minLength={3}
                  placeholder={t('refundReasonPlaceholder')}
                />
                <small>{paidThroughFp ? t('refundFpHint') : t('refundReasonHint')}</small>
              </label>

              {/* Only for Final Processor: every other provider refunds in
                  full, and the API refuses an amount for them. */}
              {paidThroughFp ? (
                fp ? (
                  <label className="refund-amount">
                    {t('refundAmountLabel')}
                    <input
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      value={refundAmount}
                      onChange={(event) => setRefundAmount(event.target.value)}
                      placeholder={fp.refundableUsd}
                      aria-invalid={amountProblem !== null}
                      disabled={capCents !== null && capCents <= 0}
                    />
                    <small className={amountProblem ? 'warn' : undefined}>
                      {amountProblem ?? t('refundAmountHint', { max: fp.refundableUsd })}
                    </small>
                  </label>
                ) : (
                  <p className="meta">{detailError ?? t('refundLoadingCap')}</p>
                )
              ) : null}

              <button type="submit" disabled={!refundReady}>
                {refundSending ? t('refundSending') : t('refundConfirm')}
              </button>
            </form>
            {refundError ? <p className="error">{refundError}</p> : null}
            {refundResult ? (
              <p className="ok-note" role="status">
                {refundResult}
              </p>
            ) : null}
          </td>
        </tr>
      ) : null}

      {releasing ? (
        <tr className="order-drawer">
          <td colSpan={COLUMNS}>
            <form
              className="paste-form order-action-form"
              onSubmit={(event) => {
                event.preventDefault();
                onRelease(releaseReason.trim());
                setReleaseReason('');
                setReleasing(false);
              }}
            >
              <label className="grow">
                {t('releaseReasonLabel')}
                <textarea
                  value={releaseReason}
                  onChange={(event) => setReleaseReason(event.target.value)}
                  rows={2}
                  required
                  minLength={3}
                  placeholder={t('releaseReasonPlaceholder')}
                />
                <small>{t('releaseReasonHint')}</small>
              </label>
              <button type="submit" disabled={releaseReason.trim().length < 3}>
                {t('releaseAndDeliver')}
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
                            {payment.testMode ? (
                              <span className="pill pill-draft">{t('paymentTestBadge')}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {detail.finalProcessor ? <FpPanel fp={detail.finalProcessor} /> : null}

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

                  {/* How the order got to where it is, and who moved it.
                      Placed first as its own entry, from the order row, so an
                      order from before history was recorded still has a start;
                      the status events follow oldest first, as a story reads. */}
                  <div className="detail-section">
                    <h3 className="detail-heading">{t('historyHeading')}</h3>
                    <ol className="order-notes-list order-history">
                      <li className="order-note-item">
                        <p className="note-text">{t('historyPlaced')}</p>
                        <div className="note-meta-row">
                          <span className="note-date" dir="ltr">
                            {row.placedAt.slice(0, 16).replace('T', ' ')}
                          </span>
                        </div>
                      </li>
                      {detail.history.map((event) => (
                        <li key={event.id} className="order-note-item">
                          <p className="note-text">
                            {event.from ? `${t(STATUS_KEYS[event.from])} → ` : ''}
                            <strong>{t(STATUS_KEYS[event.to])}</strong>
                          </p>
                          {event.reason ? <p className="meta">{event.reason}</p> : null}
                          <div className="note-meta-row">
                            <span className="note-author">
                              {t(ACTOR_KEYS[event.actorType])}
                              {event.actor ? (
                                <>
                                  {' · '}
                                  <span dir="ltr">{event.actor}</span>
                                </>
                              ) : null}
                            </span>
                            <span>·</span>
                            <span className="note-date" dir="ltr">
                              {event.createdAt.slice(0, 16).replace('T', ' ')}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ol>
                    {detail.history.length === 0 && row.status !== 'PENDING_PAYMENT' ? (
                      <p className="meta empty-state-text">{t('historyNotRecorded')}</p>
                    ) : null}
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

/**
 * The Final Processor payment behind an order (B.4): its id at the processor,
 * whether it was a sandbox payment, and every refund against it — those made
 * here and those made in the processor's own admin, which arrive by webhook.
 */
function FpPanel({ fp }: { fp: AdminFpOrderPayment }) {
  const t = useT('orders');

  return (
    <div className="detail-section fp-order-panel">
      <h3 className="detail-heading">
        {t('fpHeading')}{' '}
        <span className={`pill ${fp.testMode ? 'pill-draft' : 'pill-ready'}`}>
          {fp.testMode ? t('fpTest') : t('fpLive')}
        </span>
      </h3>
      {fp.testMode ? <p className="meta meta-warn">{t('fpTestNote')}</p> : null}
      <dl className="customer-facts">
        <dt>{t('fpPaymentId')}</dt>
        <dd>
          <code dir="ltr">{fp.paymentId ?? '—'}</code>
        </dd>
        <dt>{t('fpState')}</dt>
        <dd>
          {Object.hasOwn(FP_STATE_KEYS, fp.state)
            ? t(FP_STATE_KEYS[fp.state as keyof typeof FP_STATE_KEYS])
            : fp.state}
        </dd>
        <dt>{t('fpPaidAt')}</dt>
        <dd dir="ltr">{fp.paidAt ? fp.paidAt.slice(0, 16).replace('T', ' ') : t('fpNotPaid')}</dd>
        <dt>{t('fpCharged')}</dt>
        <dd dir="ltr">${fp.amountUsd}</dd>
        <dt>{t('fpRefunded')}</dt>
        <dd dir="ltr">${fp.refundedUsd}</dd>
        <dt>{t('fpRefundable')}</dt>
        <dd dir="ltr">${fp.refundableUsd}</dd>
      </dl>

      <h4 className="fp-subhead">{t('fpRefundsHeading', { count: fp.refunds.length })}</h4>
      {fp.refunds.length === 0 ? (
        <p className="meta empty-state-text">{t('fpNoRefunds')}</p>
      ) : (
        <ul className="order-notes-list">
          {fp.refunds.map((refund) => (
            <li key={refund.id} className="order-note-item">
              <p className="note-text">
                <strong dir="ltr">${refund.amountUsd}</strong>{' '}
                <span className={`pill ${FP_REFUND_PILLS[refund.status]}`}>
                  {t(FP_REFUND_KEYS[refund.status])}
                </span>
                {refund.failureCode ? (
                  <span className="meta" dir="ltr">
                    {' '}
                    {t('fpRefundFailureCode', { code: refund.failureCode })}
                  </span>
                ) : null}
              </p>
              {refund.reason ? <p className="meta">{refund.reason}</p> : null}
              <div className="note-meta-row">
                <span className="note-date" dir="ltr">
                  {refund.createdAt.slice(0, 16).replace('T', ' ')}
                </span>
                {refund.refundId ? (
                  <>
                    <span>·</span>
                    <code dir="ltr">{refund.refundId}</code>
                  </>
                ) : null}
                {refund.refundRef === null ? (
                  <>
                    <span>·</span>
                    <span>{t('fpRefundOutside')}</span>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
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
