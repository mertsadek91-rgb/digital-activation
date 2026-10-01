'use client';

import type { AdminFpOrderPayment, AdminOrderDetail, StaffMe } from '@da/contracts';
import { useState } from 'react';

import { useT } from '../../../i18n/provider';
import { api, ApiError } from '../../../lib/api';
import { fpErrorText } from '../../payments/fp-settings';
import {
  AMOUNT_PATTERN,
  FP_REFUND_KEYS,
  FP_REFUND_PILLS,
  FP_STATE_KEYS,
  STATUS_KEYS,
  stamp,
  toCents,
} from '../order-shared';
import type { Notice } from './page';

/**
 * The money: every payment row against the order, the processor's own view
 * of it when there is one, and the three acts that move it — confirming a
 * transfer, lifting a hold, refunding. OWNER and ADMIN only for those, as the
 * API insists: each one releases a key or returns money.
 */
export function PaymentTab({
  detail,
  me,
  onDone,
  onNotice,
}: {
  detail: AdminOrderDetail;
  me: StaffMe;
  onDone: () => Promise<void>;
  onNotice: (notice: Notice | null) => void;
}) {
  const t = useT('order');
  const o = useT('orders');
  const c = useT('common');
  const fpT = useT('finalProcessor');
  const canPay = ['OWNER', 'ADMIN'].includes(me.role);

  const [form, setForm] = useState<'confirm' | 'release' | 'refund' | null>(null);
  const [provider, setProvider] = useState<'BANK_TRANSFER' | 'CRYPTO'>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [releaseReason, setReleaseReason] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [refundResult, setRefundResult] = useState<string | null>(null);

  const risky = detail.riskLevel === 'HIGH' || detail.riskLevel === 'BLOCKED';
  const awaiting = detail.status === 'PENDING_PAYMENT';
  const held =
    detail.status === 'PAYMENT_REVIEW' ||
    (risky && (detail.status === 'PAID' || detail.status === 'FULFILLING'));
  const refundable = [
    'PAID',
    'PAYMENT_REVIEW',
    'FULFILLING',
    'FULFILLED',
    'COMPLETED',
    'PARTIALLY_REFUNDED',
  ].includes(detail.status);
  const paidThroughFp = detail.payments.some(
    (payment) => payment.provider === 'FINAL_PROCESSOR' && payment.state === 'SUCCEEDED',
  );
  const fp = detail.finalProcessor;

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
    !sending &&
    amountProblem === null &&
    (!paidThroughFp || fp !== null);

  async function run(label: string, action: () => Promise<unknown>): Promise<void> {
    setSending(true);
    onNotice(null);
    try {
      await action();
      onNotice({ kind: 'ok', text: label });
      setForm(null);
      await onDone();
    } catch (caught) {
      onNotice({
        kind: 'error',
        text: caught instanceof Error ? caught.message : c('actionFailed'),
      });
    } finally {
      setSending(false);
    }
  }

  async function submitRefund(): Promise<void> {
    setSending(true);
    onNotice(null);
    setRefundResult(null);
    try {
      const result = await api.refundOrder(
        detail.number,
        refundReason.trim(),
        paidThroughFp && amountText !== '' ? amountText : undefined,
      );
      setRefundResult(
        result.via === 'final_processor' && result.refund
          ? t('refundResultFp', {
              amount: result.refund.amountUsd,
              status: t(FP_REFUND_KEYS[result.refund.status]),
            })
          : t('refundResultOther', { status: o(STATUS_KEYS[result.status]) }),
      );
      setRefundReason('');
      setRefundAmount('');
      await onDone();
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : null;
      const text =
        fpErrorText(fpT, code) ?? (caught instanceof Error ? caught.message : t('refundFailed'));
      onNotice({ kind: 'error', text: code ? `${text} (${code})` : text });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="payment">
      <h3 className="card__subtitle">{t('paymentsHeading')}</h3>
      {detail.payments.length === 0 ? (
        <p className="meta">{t('noPayments')}</p>
      ) : (
        <div className="table-scroll table-scroll--flat">
          <table className="payments-table">
            <thead>
              <tr>
                <th>{t('colProvider')}</th>
                <th>{t('colState')}</th>
                <th>{t('colReference')}</th>
                <th className="num">{t('colAmount')}</th>
                <th>{t('colWhen')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.payments.map((payment, index) => (
                <tr key={index}>
                  <td>
                    {t(`provider${payment.provider}`)}
                    {payment.testMode ? (
                      <span className="pill pill-draft payments-table__test">{t('testBadge')}</span>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className={`pill ${
                        payment.state === 'SUCCEEDED'
                          ? 'pill-published'
                          : payment.state === 'FAILED' || payment.state === 'CANCELLED'
                            ? 'pill-blocked'
                            : 'pill-draft'
                      }`}
                    >
                      {payment.state}
                    </span>
                  </td>
                  <td>{payment.reference ? <code dir="ltr">{payment.reference}</code> : '—'}</td>
                  <td className="num" dir="ltr">
                    {payment.amount} {payment.currency}
                  </td>
                  <td dir="ltr" className="meta">
                    {stamp(payment.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fp ? <FpPanel fp={fp} /> : null}

      <h3 className="card__subtitle">{t('actionsHeading')}</h3>
      {!canPay ? (
        <p className="notice">{t('roleCannotPay', { role: me.role })}</p>
      ) : !awaiting && !held && !refundable ? (
        <p className="meta">{t('noPaymentActions')}</p>
      ) : (
        <div className="action-row">
          {awaiting ? (
            <button
              type="button"
              className={form === 'confirm' ? 'is-active' : undefined}
              onClick={() => setForm(form === 'confirm' ? null : 'confirm')}
            >
              {form === 'confirm' ? t('cancel') : t('confirmPayment')}
            </button>
          ) : null}
          {held ? (
            <button
              type="button"
              className={form === 'release' ? 'is-active' : undefined}
              onClick={() => setForm(form === 'release' ? null : 'release')}
            >
              {form === 'release' ? t('cancel') : t('releaseHold')}
            </button>
          ) : null}
          {refundable ? (
            <button
              type="button"
              className={`ghost${form === 'refund' ? ' is-active' : ''}`}
              onClick={() => {
                setForm(form === 'refund' ? null : 'refund');
                setRefundResult(null);
              }}
            >
              {form === 'refund' ? t('cancel') : t('refund')}
            </button>
          ) : null}
        </div>
      )}

      {form === 'confirm' ? (
        <form
          className="paste-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(t('donePaymentConfirmed'), () =>
              api.confirmPayment(detail.number, provider, reference.trim()),
            ).then(() => setReference(''));
          }}
        >
          <p className="lede-sm">{t('confirmLede')}</p>
          <label>
            {t('methodLabel')}
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as 'BANK_TRANSFER' | 'CRYPTO')}
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
            />
            <small>{t('referenceHint')}</small>
          </label>
          <button type="submit" disabled={sending || reference.trim().length < 3}>
            {t('confirmAndRelease')}
          </button>
        </form>
      ) : null}

      {form === 'release' ? (
        <form
          className="paste-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(t('doneHoldReleased'), () =>
              api.releaseHold(detail.number, releaseReason.trim()),
            ).then(() => setReleaseReason(''));
          }}
        >
          <p className="lede-sm">{t('releaseLede')}</p>
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
          </label>
          <button type="submit" disabled={sending || releaseReason.trim().length < 3}>
            {t('releaseAndDeliver')}
          </button>
        </form>
      ) : null}

      {form === 'refund' ? (
        <form
          className="paste-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (refundReady) void submitRefund();
          }}
        >
          <p className="lede-sm">{t('refundLede')}</p>
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
              <p className="meta">{t('refundLoadingCap')}</p>
            )
          ) : null}
          <button type="submit" disabled={!refundReady}>
            {sending ? t('refundSending') : t('refundConfirm')}
          </button>
          {refundResult ? (
            <p className="ok-note" role="status">
              {refundResult}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

/**
 * The Final Processor payment behind an order: its id at the processor,
 * whether it was a sandbox payment, and every refund against it — those made
 * here and those made in the processor's own admin, which arrive by webhook.
 */
function FpPanel({ fp }: { fp: AdminFpOrderPayment }) {
  const t = useT('order');

  return (
    <div className="fp-order-panel">
      <h3 className="card__subtitle">
        {t('fpHeading')}{' '}
        <span className={`pill ${fp.testMode ? 'pill-draft' : 'pill-published'}`}>
          {fp.testMode ? t('fpTest') : t('fpLive')}
        </span>
      </h3>
      {fp.testMode ? <p className="meta-warn">{t('fpTestNote')}</p> : null}
      <dl className="kv">
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
        <dd dir="ltr">{fp.paidAt ? stamp(fp.paidAt) : t('fpNotPaid')}</dd>
        <dt>{t('fpCharged')}</dt>
        <dd dir="ltr">${fp.amountUsd}</dd>
        <dt>{t('fpRefunded')}</dt>
        <dd dir="ltr">${fp.refundedUsd}</dd>
        <dt>{t('fpRefundable')}</dt>
        <dd dir="ltr">${fp.refundableUsd}</dd>
      </dl>

      <h4 className="fp-subhead">{t('fpRefundsHeading', { count: fp.refunds.length })}</h4>
      {fp.refunds.length === 0 ? (
        <p className="meta">{t('fpNoRefunds')}</p>
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
                  {stamp(refund.createdAt)}
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
