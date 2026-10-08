'use client';

import type { AdminOrderDetail, OrderKeysRow, SecretInput, StaffMe } from '@da/contracts';
import Link from 'next/link';
import { useState } from 'react';

import { useT } from '../../../i18n/provider';
import { api } from '../../../lib/api';
import { stamp } from '../order-shared';
import type { Notice } from './page';

/**
 * The lines, and what delivering each one takes.
 *
 * Built around the minute it takes to work a line: read what was bought,
 * place the supplier order in another tab, paste the code back. The paste
 * box opens under the line it belongs to, in the shape the supplier returns —
 * a key, or a username and a password — and the line is marked delivered
 * only when the email actually went out. Key states come from the vault by
 * id; the plaintext is never on this screen.
 */

type Line = AdminOrderDetail['lines'][number];

/**
 * The refusals, with the label each is shown under. `value` stays Arabic in
 * both languages on purpose: it is written into the audit beside every
 * failure already recorded, and a log that switches language by who was
 * signed in cannot be read down.
 */
const FAIL_REASONS = [
  { value: 'المورّد لا يملك المخزون', key: 'reasonNoStock' },
  { value: 'سعر المورّد تغيّر', key: 'reasonPriceChanged' },
  { value: 'بيانات التفعيل من العميل غير صحيحة', key: 'reasonBadCustomerDetails' },
  { value: 'المنتج أُوقف من الشركة المنتجة', key: 'reasonDiscontinued' },
] as const;

const STATE_PILL: Record<Line['fulfillmentState'], string> = {
  PENDING: 'pill-draft',
  AUTO_ASSIGNED: 'pill-warning',
  MANUAL_QUEUE: 'pill-warning',
  DELIVERED: 'pill-published',
  FAILED: 'pill-blocked',
};

const KEY_PILL: Record<OrderKeysRow['keys'][number]['state'], string> = {
  AVAILABLE: 'pill-draft',
  RESERVED: 'pill-warning',
  ASSIGNED: 'pill-info',
  DELIVERED: 'pill-published',
  REVOKED: 'pill-blocked',
  EXPIRED: 'pill-blocked',
};

export function LinesTab({
  detail,
  keys,
  me,
  onDone,
  onNotice,
}: {
  detail: AdminOrderDetail;
  keys: OrderKeysRow[] | null;
  me: StaffMe;
  onDone: () => Promise<void>;
  onNotice: (notice: Notice | null) => void;
}) {
  const t = useT('order');
  const c = useT('common');
  const canFulfil = ['OWNER', 'ADMIN', 'FULFILLMENT'].includes(me.role);
  const canResend = ['OWNER', 'ADMIN', 'SUPPORT', 'FULFILLMENT'].includes(me.role);
  const paid = !['PENDING_PAYMENT', 'CANCELLED', 'FAILED'].includes(detail.status);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(label: string, run: () => Promise<unknown>, id: string): Promise<void> {
    setBusy(id);
    onNotice(null);
    try {
      await run();
      onNotice({ kind: 'ok', text: label });
      await onDone();
    } catch (caught) {
      onNotice({
        kind: 'error',
        text: caught instanceof Error ? caught.message : c('actionFailed'),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="lines">
      {!canFulfil && paid && detail.waitingLines > 0 ? (
        <p className="notice">{t('roleCannotFulfil', { role: me.role })}</p>
      ) : null}
      <div className="table-scroll table-scroll--flat">
        <table className="lines-table">
          <thead>
            <tr>
              <th>{t('colProduct')}</th>
              <th className="num">{t('colQty')}</th>
              <th className="num">{t('colUnit')}</th>
              <th className="num">{t('colLineTotal')}</th>
              <th>{t('colFulfilment')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {detail.lines.map((line) => (
              <LineRow
                key={line.orderItemId}
                line={line}
                keys={keys?.find((row) => row.orderItemId === line.orderItemId) ?? null}
                keysKnown={keys !== null}
                orderNumber={detail.number}
                canFulfil={canFulfil && paid}
                canResend={canResend}
                busy={busy === line.orderItemId}
                onFulfil={(secret, cost) =>
                  act(
                    t('doneFulfilled', { sku: line.sku }),
                    () => api.fulfil(line.orderItemId, secret, cost),
                    line.orderItemId,
                  )
                }
                onDeliver={() =>
                  act(
                    t('doneDelivered', { sku: line.sku }),
                    () => api.deliver(line.orderItemId),
                    line.orderItemId,
                  )
                }
                onFail={(reason) =>
                  act(
                    t('doneFailed', { sku: line.sku }),
                    () => api.failLine(line.orderItemId, reason),
                    line.orderItemId,
                  )
                }
                onResend={() =>
                  act(
                    t('doneResent', { to: detail.email }),
                    () => api.resendLicence(detail.number, line.orderItemId),
                    line.orderItemId,
                  )
                }
              />
            ))}
          </tbody>
        </table>
      </div>
      {keys === null ? <p className="meta">{t('keysUnavailable')}</p> : null}
    </div>
  );
}

function LineRow({
  line,
  keys,
  keysKnown,
  canFulfil,
  canResend,
  busy,
  onFulfil,
  onDeliver,
  onFail,
  onResend,
}: {
  line: Line;
  keys: OrderKeysRow | null;
  keysKnown: boolean;
  orderNumber: string;
  canFulfil: boolean;
  canResend: boolean;
  busy: boolean;
  onFulfil: (secret: SecretInput, cost?: string) => Promise<void>;
  onDeliver: () => Promise<void>;
  onFail: (reason: string) => Promise<void>;
  onResend: () => Promise<void>;
}) {
  const t = useT('order');
  const [form, setForm] = useState<'paste' | 'fail' | null>(null);
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState<string>(FAIL_REASONS[0].value);

  const isAccount = line.credentialKind === 'ACCOUNT_CREDENTIALS';
  const delivered = line.fulfillmentState === 'DELIVERED';
  // A key bound in the vault but never sent is "reserved, not sent" whatever
  // the line's own state says: a pasted code whose email failed used to leave
  // the line in MANUAL_QUEUE beside an ASSIGNED key, offering "paste the code"
  // again (refused) instead of the send (BUG-0029). Fixed in the API; this
  // covers lines written before the fix.
  const keyBound = !delivered && (keys?.keys.some((key) => key.state === 'ASSIGNED') ?? false);
  const waiting =
    !keyBound && (line.fulfillmentState === 'MANUAL_QUEUE' || line.fulfillmentState === 'PENDING');
  const reserved = keyBound || line.fulfillmentState === 'AUTO_ASSIGNED';
  const shownState = keyBound ? 'AUTO_ASSIGNED' : line.fulfillmentState;

  return (
    <>
      <tr className={form ? 'is-open' : undefined}>
        <td className="lines-table__product">
          <strong>{line.productName}</strong>
          <span className="slug" dir="ltr">
            {line.sku}
          </span>
          {keysKnown ? (
            <span className="line-keys">
              {keys && keys.keys.length > 0 ? (
                keys.keys.map((key) => (
                  <span key={key.licenseKeyId} className={`pill ${KEY_PILL[key.state]}`}>
                    {t('keyState', { state: key.state })}
                  </span>
                ))
              ) : (
                <span className="meta">{t('noKeys')}</span>
              )}
            </span>
          ) : null}
        </td>
        <td className="num">{line.qty}</td>
        <td className="num" dir="ltr">
          ${line.unitPrice}
        </td>
        <td className="num" dir="ltr">
          <strong>${line.lineTotal}</strong>
        </td>
        <td>
          <span className={`pill ${STATE_PILL[shownState]}`}>{t(`stateLabel${shownState}`)}</span>
          {line.deliveredAt ? (
            <span className="meta lines-table__when">
              {t('deliveredOn', { at: stamp(line.deliveredAt) })}
            </span>
          ) : null}
          {delivered ? (
            <span className="meta lines-table__when">
              {line.expiresAt ? t('expiresOn', { at: line.expiresAt.slice(0, 10) }) : t('lifetime')}
            </span>
          ) : null}
        </td>
        <td className="actions">
          {/* Only a line with no key: the API refuses a paste on a bound line. */}
          {canFulfil && waiting ? (
            <button
              type="button"
              className={form === 'paste' ? 'is-active' : undefined}
              disabled={busy}
              onClick={() => setForm(form === 'paste' ? null : 'paste')}
            >
              {form === 'paste' ? t('cancel') : isAccount ? t('accountDetails') : t('pasteKey')}
            </button>
          ) : null}
          {canFulfil && reserved ? (
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => void onDeliver()}
            >
              {t('deliverNow')}
            </button>
          ) : null}
          {canFulfil && (waiting || reserved) ? (
            <button
              type="button"
              className={`ghost${form === 'fail' ? ' is-active' : ''}`}
              disabled={busy}
              onClick={() => setForm(form === 'fail' ? null : 'fail')}
            >
              {form === 'fail' ? t('cancel') : t('markFailed')}
            </button>
          ) : null}
          {canResend && delivered ? (
            <button type="button" className="ghost" disabled={busy} onClick={() => void onResend()}>
              {t('resendLicence')}
            </button>
          ) : null}
          {delivered ? (
            <Link href="/vault" className="as-button ghost">
              {t('openVault')}
            </Link>
          ) : null}
        </td>
      </tr>

      {form === 'paste' ? (
        <tr className="drawer">
          <td colSpan={6}>
            <form
              className="paste-form"
              onSubmit={(event) => {
                event.preventDefault();
                void onFulfil(
                  isAccount
                    ? {
                        kind: 'ACCOUNT_CREDENTIALS',
                        username: username.trim(),
                        password: password.trim(),
                      }
                    : { kind: 'ACTIVATION_KEY', key: code.trim() },
                  cost.trim() || undefined,
                );
                setCode('');
                setUsername('');
                setPassword('');
                setCost('');
                setForm(null);
              }}
            >
              {isAccount ? (
                <>
                  <label className="grow">
                    {t('usernameOrEmail')}
                    <input
                      type="text"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      dir="ltr"
                      required
                      minLength={3}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="account@example.com"
                    />
                  </label>
                  <label className="grow">
                    {t('accountPassword')}
                    <input
                      type="text"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      dir="ltr"
                      required
                      minLength={4}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t('accountPasswordPlaceholder')}
                    />
                    <small>{t('accountHint')}</small>
                  </label>
                </>
              ) : (
                <label className="grow">
                  {t('supplierCode')}
                  <textarea
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    rows={3}
                    dir="ltr"
                    required
                    minLength={4}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t('supplierCodePlaceholder')}
                  />
                  <small>{t('supplierCodeHint')}</small>
                </label>
              )}
              <label>
                {t('cost')}
                <input
                  type="text"
                  value={cost}
                  onChange={(event) => setCost(event.target.value)}
                  placeholder="42.00"
                  dir="ltr"
                  pattern="\d+(\.\d{1,2})?"
                />
              </label>
              <button
                type="submit"
                disabled={
                  busy ||
                  (isAccount
                    ? username.trim().length < 3 || password.trim().length < 4
                    : code.trim().length < 4)
                }
              >
                {t('saveAndSend')}
              </button>
            </form>
          </td>
        </tr>
      ) : null}

      {form === 'fail' ? (
        <tr className="drawer">
          <td colSpan={6}>
            <form
              className="paste-form"
              onSubmit={(event) => {
                event.preventDefault();
                void onFail(reason);
                setForm(null);
              }}
            >
              <label className="grow">
                {t('failReason')}
                <select value={reason} onChange={(event) => setReason(event.target.value)}>
                  {FAIL_REASONS.map((entry) => (
                    <option key={entry.key} value={entry.value}>
                      {t(entry.key)}
                    </option>
                  ))}
                </select>
                <small>{t('failHint')}</small>
              </label>
              <button type="submit" className="ghost" disabled={busy}>
                {t('confirmFail')}
              </button>
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}
