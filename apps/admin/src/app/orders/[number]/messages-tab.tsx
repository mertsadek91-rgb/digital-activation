'use client';

import type { AdminOrderDetail, OrderMessageKind, StaffMe } from '@da/contracts';
import { useState } from 'react';

import { useT } from '../../../i18n/provider';
import { api } from '../../../lib/api';
import { Icon, type IconName } from '../../icons';
import { stamp } from '../order-shared';
import type { Notice } from './page';

/**
 * Writing to the customer, and the record of everything already sent.
 *
 * Five ready-made messages rather than a blank editor: each is something the
 * store already knows how to say, so a support agent cannot be talked into
 * sending what the store would not. The one free-form message is plain text
 * under the store's frame. Each button says what it costs before it is
 * pressed — "paid orders only", "needs marketing consent" — and is disabled
 * when the order cannot carry it, with the reason beside it.
 */

const SKIPPED_KEYS = {
  guest_order: 'skippedGuestOrder',
  already_invited: 'skippedAlreadyInvited',
  already_reviewed: 'skippedAlreadyReviewed',
  nothing_delivered: 'skippedNothingDelivered',
  no_term: 'skippedNoTerm',
  not_paid: 'skippedNotPaid',
} as const;

export function MessagesTab({
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
  const c = useT('common');
  const canMessage = ['OWNER', 'ADMIN', 'SUPPORT'].includes(me.role);
  const canOffer = ['OWNER', 'ADMIN'].includes(me.role);

  const [open, setOpen] = useState<OrderMessageKind | null>(null);
  const [sending, setSending] = useState<OrderMessageKind | null>(null);
  const [percent, setPercent] = useState('10');
  const [validDays, setValidDays] = useState('14');
  const [offerNote, setOfferNote] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  // The same statuses the API accepts a receipt for: money in, not gone back.
  const paid =
    detail.paidAt !== null &&
    ['PAID', 'FULFILLING', 'FULFILLED', 'COMPLETED'].includes(detail.status);
  const hasAccount = detail.customer !== null;
  const delivered = detail.lines.some((line) => line.fulfillmentState === 'DELIVERED');
  const hasTerm = detail.lines.some((line) => line.expiresAt !== null);
  const consent = detail.customer?.marketingEmail === 'OPTED_IN';

  const kinds: {
    kind: OrderMessageKind;
    icon: IconName;
    label: string;
    hint: string;
    enabled: boolean;
    why: string | null;
    hasForm: boolean;
  }[] = [
    {
      kind: 'payment_received',
      icon: 'money',
      label: t('msgPaymentReceived'),
      hint: t('msgPaymentReceivedHint'),
      enabled: paid,
      why: paid ? null : t('skippedNotPaid'),
      hasForm: false,
    },
    {
      kind: 'review_request',
      icon: 'reviews',
      label: t('msgReviewRequest'),
      hint: t('msgReviewRequestHint'),
      enabled: hasAccount && delivered,
      why: !hasAccount ? t('skippedGuestOrder') : !delivered ? t('skippedNothingDelivered') : null,
      hasForm: false,
    },
    {
      kind: 'renewal_reminder',
      icon: 'refresh',
      label: t('msgRenewal'),
      hint: t('msgRenewalHint'),
      enabled: hasTerm,
      why: hasTerm ? null : t('skippedNoTerm'),
      hasForm: false,
    },
    {
      kind: 'offer',
      icon: 'promotions',
      label: t('msgOffer'),
      hint: t('msgOfferHint'),
      enabled: consent && canOffer,
      why: !canOffer ? t('offerRoleOnly') : consent ? null : t('consentRequired'),
      hasForm: true,
    },
    {
      kind: 'custom',
      icon: 'messages',
      label: t('msgCustom'),
      hint: t('msgCustomHint'),
      enabled: true,
      why: null,
      hasForm: true,
    },
  ];

  async function send(kind: OrderMessageKind): Promise<void> {
    setSending(kind);
    onNotice(null);
    try {
      const result = await api.sendOrderMessage(detail.number, {
        kind,
        ...(kind === 'offer'
          ? {
              percent: Number(percent),
              validDays: Number(validDays),
              ...(offerNote.trim() ? { body: offerNote.trim() } : {}),
            }
          : {}),
        ...(kind === 'custom' ? { subject: subject.trim(), body: body.trim() } : {}),
      });
      if (result.sent) {
        onNotice({
          kind: 'ok',
          text:
            result.code !== null
              ? t('sentWithCode', { to: result.to, code: result.code })
              : t('sentTo', { template: result.template, to: result.to }),
        });
        setOpen(null);
        if (kind === 'custom') {
          setSubject('');
          setBody('');
        }
        if (kind === 'offer') setOfferNote('');
        await onDone();
      } else {
        onNotice({
          kind: 'error',
          text: result.skipped ? t(SKIPPED_KEYS[result.skipped]) : t('sendFailed'),
        });
      }
    } catch (caught) {
      onNotice({
        kind: 'error',
        text: caught instanceof Error ? caught.message : c('actionFailed'),
      });
    } finally {
      setSending(null);
    }
  }

  const phone = detail.customer?.whatsappPhone ?? detail.customer?.phone ?? null;
  const waDigits = phone ? phone.replace(/\D/g, '') : '';

  return (
    <div className="messages">
      <h3 className="card__subtitle">{t('composeHeading')}</h3>
      <p className="lede-sm">{t('composeLede')}</p>
      {!canMessage ? <p className="notice">{t('roleCannotMessage', { role: me.role })}</p> : null}

      <div className="compose-grid">
        {kinds.map((entry) => (
          <div
            key={entry.kind}
            className={`compose-card${open === entry.kind ? ' is-open' : ''}${entry.enabled ? '' : ' is-disabled'}`}
          >
            <span className="compose-card__icon">
              <Icon name={entry.icon} />
            </span>
            <div className="compose-card__body">
              <strong>{entry.label}</strong>
              <p className="meta" id={`why-${entry.kind}`}>
                {entry.why ?? entry.hint}
              </p>
            </div>
            <button
              type="button"
              className={entry.hasForm ? 'ghost btn-sm' : 'btn-sm'}
              aria-describedby={`why-${entry.kind}`}
              disabled={!canMessage || !entry.enabled || sending !== null}
              onClick={() => {
                if (entry.hasForm) setOpen(open === entry.kind ? null : entry.kind);
                else void send(entry.kind);
              }}
            >
              {sending === entry.kind
                ? t('sending')
                : entry.hasForm
                  ? open === entry.kind
                    ? t('cancel')
                    : entry.label
                  : t('send')}
            </button>
          </div>
        ))}
        {waDigits ? (
          <div className="compose-card">
            <span className="compose-card__icon">
              <Icon name="user" />
            </span>
            <div className="compose-card__body">
              <strong>{t('whatsappChat')}</strong>
              <p className="meta">{t('whatsappChatHint')}</p>
            </div>
            <a
              className="as-button ghost btn-sm"
              href={`https://wa.me/${waDigits}?text=${encodeURIComponent(detail.number)}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t('openWhatsapp')}
            </a>
          </div>
        ) : null}
      </div>

      {open === 'offer' ? (
        <form
          className="paste-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send('offer');
          }}
        >
          <label>
            {t('offerPercent')}
            <input
              type="number"
              min={1}
              max={90}
              value={percent}
              onChange={(event) => setPercent(event.target.value)}
              dir="ltr"
              required
            />
          </label>
          <label>
            {t('offerDays')}
            <input
              type="number"
              min={1}
              max={90}
              value={validDays}
              onChange={(event) => setValidDays(event.target.value)}
              dir="ltr"
              required
            />
          </label>
          <label className="grow">
            {t('offerNote')}
            <input
              type="text"
              value={offerNote}
              onChange={(event) => setOfferNote(event.target.value)}
              maxLength={300}
              placeholder={t('offerNotePlaceholder')}
            />
          </label>
          <button
            type="submit"
            disabled={
              sending !== null ||
              !(Number(percent) >= 1 && Number(percent) <= 90) ||
              !(Number(validDays) >= 1 && Number(validDays) <= 90)
            }
          >
            {sending === 'offer' ? t('sending') : t('send')}
          </button>
        </form>
      ) : null}

      {open === 'custom' ? (
        <form
          className="paste-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send('custom');
          }}
        >
          <label className="grow">
            {t('customSubject')}
            <input
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              required
              minLength={2}
              maxLength={150}
            />
          </label>
          <label className="grow">
            {t('customBody')}
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={6}
              required
              minLength={2}
              maxLength={4000}
              placeholder={t('customBodyPlaceholder')}
            />
            <small>{t('msgCustomHint')}</small>
          </label>
          <button
            type="submit"
            disabled={sending !== null || subject.trim().length < 2 || body.trim().length < 2}
          >
            {sending === 'custom' ? t('sending') : t('send')}
          </button>
        </form>
      ) : null}

      <h3 className="card__subtitle">{t('messagesHeading')}</h3>
      {detail.emails.length === 0 ? (
        <p className="meta">{t('noMailYet')}</p>
      ) : (
        <ul className="mail-log">
          {detail.emails.map((mail, index) => {
            const bad = Boolean(mail.error ?? mail.bouncedAt);
            return (
              <li key={index} className={`mail-log__item${bad ? ' is-bad' : ''}`}>
                <span
                  className={`mail-log__dot ${bad ? 'is-bad' : mail.deliveredAt ? 'is-ok' : ''}`}
                />
                <div className="mail-log__body">
                  <code dir="ltr">{mail.template}</code>
                  <span className="meta" dir="ltr">
                    {mail.to}
                  </span>
                </div>
                <span className={`pill ${bad ? 'pill-blocked' : 'pill-published'}`}>
                  {mail.error ??
                    (mail.bouncedAt
                      ? t('mailBounced')
                      : mail.deliveredAt
                        ? t('mailDelivered')
                        : t('mailSent'))}
                </span>
                <span className="meta" dir="ltr">
                  {stamp(mail.sentAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
