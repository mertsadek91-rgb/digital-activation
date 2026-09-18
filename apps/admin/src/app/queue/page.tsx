'use client';

import type { Queue, QueueRow, SecretInput, StaffMe } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api, ApiError } from '../../lib/api';
import { Nav } from '../nav';

/**
 * The supplier queue.
 *
 * This is the screen the business actually runs on. Most of the catalog is made
 * to order, so every sale arrives here as a line somebody has to buy from a
 * supplier and hand back — and until this page existed that work lived in a
 * state nothing ever left.
 *
 * Designed around the one minute it takes to work a row: read what was bought,
 * copy the activation email if there is one, place the supplier order in
 * another tab, paste the code back. So the activation email is on the row with
 * a copy button rather than a click away, and the paste box opens in place.
 *
 * Lateness is measured against the window the product page promised, not a
 * fixed number, and an overdue row is loud. A queue where everything looks the
 * same is a queue where the customer who waited longest keeps waiting.
 */
/**
 * The four refusals, and the label each is shown under.
 *
 * `value` is what reaches the API and the audit row, and it stays Arabic in
 * both languages on purpose: the reason is written into `fulfillment.failed`
 * beside every failure already recorded, and a log that switches language
 * depending on who happened to be signed in cannot be read down. The staff
 * member picks from a label they understand; the record keeps one vocabulary.
 */
const FAIL_REASONS = [
  { value: 'المورّد لا يملك المخزون', key: 'reasonNoStock' },
  { value: 'سعر المورّد تغيّر', key: 'reasonPriceChanged' },
  { value: 'بيانات التفعيل من العميل غير صحيحة', key: 'reasonBadCustomerDetails' },
  { value: 'المنتج أُوقف من الشركة المنتجة', key: 'reasonDiscontinued' },
] as const;

export default function QueuePage() {
  const router = useRouter();
  const t = useT('queue');
  const c = useT('common');
  const [me, setMe] = useState<StaffMe | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [includeDone, setIncludeDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setQueue(await api.queue(includeDone));
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [includeDone, router, t]);

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

  const canWork = me !== null && ['OWNER', 'ADMIN', 'FULFILLMENT'].includes(me.role);

  async function act(label: string, run: () => Promise<unknown>): Promise<void> {
    setError(null);
    setDone(null);
    try {
      await run();
      setDone(label);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : c('actionFailed'));
    }
  }

  const overdue =
    queue?.rows.filter((row) => row.overdue && row.state !== 'DELIVERED' && row.state !== 'FAILED')
      .length ?? 0;

  if (!me) return <div className="admin-layout">{c('loading')}</div>;

  return (
    <Nav me={me} current="queue" {...(queue ? { waiting: queue.waiting, overdue } : {})}>
      <div className="queue-head">
        <h1>{t('title')}</h1>
        <p className="who">
          {queue ? t.tp('waiting', queue.waiting) : c('loading')}
          {overdue > 0 ? (
            <strong className="overdue-count"> · {t('overdueCount', { count: overdue })}</strong>
          ) : null}
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={includeDone}
            onChange={(event) => setIncludeDone(event.target.checked)}
          />
          <span>{t('showSettled')}</span>
        </label>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {done ? <p className="ok-note">{done}</p> : null}
      {!canWork ? <p className="notice"> {t('roleCannotWork', { role: me.role })}</p> : null}

      {queue && queue.rows.length === 0 ? <p className="notice">{t('empty')}</p> : null}

      {/* A row per line waiting.
          It was a card each, ~290px tall to carry four facts, two to a row —
          six lines filled three screens. A queue is worked from the top down
          and the question at every row is the same: how long has this one been
          waiting against what it was promised. That is a column to run an eye
          down, not a figure buried in the third block of a card. */}
      {queue && queue.rows.length > 0 ? (
        <div className="table-scroll">
          <table className="admin-table queue-table">
            <thead>
              <tr>
                <th>{t('colOrder')}</th>
                <th>{t('colProduct')}</th>
                <th>{t('colState')}</th>
                <th>{t('colWait')}</th>
                <th>{t('colReceiptEmail')}</th>
                <th>{t('colActivationEmail')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(queue?.rows ?? []).map((row) => (
                <QueueRow
                  key={row.orderItemId}
                  row={row}
                  canWork={canWork}
                  onFulfil={(secret, cost) =>
                    void act(t('doneFulfilled', { sku: row.sku }), () =>
                      api.fulfil(row.orderItemId, secret, cost),
                    )
                  }
                  onDeliver={() =>
                    void act(t('doneDelivered', { sku: row.sku }), () =>
                      api.deliver(row.orderItemId),
                    )
                  }
                  onFail={(reason) =>
                    void act(t('doneFailed', { sku: row.sku }), () =>
                      api.failLine(row.orderItemId, reason),
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

/** Columns the drawer has to span. Kept beside the header it mirrors. */
const COLUMNS = 7;

function QueueRow({
  row,
  canWork,
  onFulfil,
  onDeliver,
  onFail,
}: {
  row: QueueRow;
  canWork: boolean;
  onFulfil: (secret: SecretInput, costUsd?: string) => void;
  onDeliver: () => void;
  onFail: (reason: string) => void;
}) {
  const t = useT('queue');
  const c = useT('common');
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  // Account lines. Kept beside `code` rather than reusing it: a password typed
  // into a field labelled "key" is the mistake this whole split exists to stop.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [cost, setCost] = useState('');
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState<string>(FAIL_REASONS[0].value);
  const [copied, setCopied] = useState<string | null>(null);

  const settled = row.state === 'DELIVERED' || row.state === 'FAILED';
  const isAccount = row.credentialKind === 'ACCOUNT_CREDENTIALS';

  async function copy(value: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // A blocked clipboard is not worth an error banner; the value is on
      // screen and selectable either way.
    }
  }

  return (
    <>
      <tr className={`queue-row${row.overdue ? ' is-overdue' : ''}${settled ? ' is-settled' : ''}`}>
        <td>
          <span className="order-number" dir="ltr">
            {row.orderNumber}
          </span>
        </td>

        <td className="queue-product-cell">
          <span className="queue-product" title={row.productName}>
            {row.productName}
            {row.qty > 1 ? <span className="meta"> × {row.qty}</span> : null}
          </span>
          <span className="line-sku" dir="ltr">
            {row.sku}
          </span>
        </td>

        <td>
          <span className={`pill ${statePill(row.state)}`}>{stateLabel(row.state, t)}</span>
          {row.overdue ? <span className="pill pill-blocked">{t('overduePill')}</span> : null}
        </td>

        {/* The one number this screen exists for: waited against promised. */}
        <td className={`queue-wait${row.overdue ? ' is-late' : ''}`}>
          <strong>{waitLabel(row.waitingSeconds, c)}</strong>
          <span className="meta">
            {t('promisedIn', { wait: waitLabel(row.deliverySlaSeconds, c) })}
          </span>
        </td>

        <td className="queue-mail">
          <span dir="ltr">{row.email}</span>
          <button type="button" className="linky" onClick={() => void copy(row.email, c('email'))}>
            {c('copy')}
          </button>
        </td>

        {/* The field a supplier order cannot be placed without. Always a cell,
            so the column stays readable down the page; a dash where the line
            does not need one. */}
        <td className="queue-mail">
          {row.requiresActivationEmail ? (
            <>
              <span dir="ltr">{row.activationEmail ?? t('noActivationEmail')}</span>
              {row.activationEmail ? (
                <button
                  type="button"
                  className="linky"
                  onClick={() => void copy(row.activationEmail ?? '', t('activationEmailLabel'))}
                >
                  {c('copy')}
                </button>
              ) : null}
            </>
          ) : (
            <span className="meta">—</span>
          )}
        </td>

        <td className="actions">
          {canWork && !settled ? (
            <>
              {row.hasKey ? (
                <button type="button" onClick={onDeliver}>
                  {t('sendKey')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(!open);
                    setFailing(false);
                  }}
                >
                  {open ? c('cancel') : isAccount ? t('accountDetails') : t('pasteCode')}
                </button>
              )}
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setFailing(!failing);
                  setOpen(false);
                }}
              >
                {t('markFailed')}
              </button>
            </>
          ) : null}
        </td>
      </tr>

      {copied ? (
        <tr className="queue-drawer">
          <td colSpan={COLUMNS}>
            <p className="ok-note">{c('copied', { label: copied })}</p>
          </td>
        </tr>
      ) : null}

      {open ? (
        <tr className="queue-drawer">
          <td colSpan={COLUMNS}>
            <form
              className="paste-form"
              onSubmit={(event) => {
                event.preventDefault();
                onFulfil(
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
                setOpen(false);
              }}
            >
              {/* Two shapes, because the supplier sends two. An account pasted into
              one box would have to be split by guesswork somewhere, and the
              guess would be wrong on the passwords that contain a colon. */}
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
                    {/* type=text on purpose: the person pasting it has to be able
                    to check it against what the supplier sent, and a masked
                    field is where a transposed character survives to the
                    customer. */}
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
                    // Nothing remembers this field. A browser that autofills a
                    // licence key into the next order is a licence sold twice.
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
                  isAccount
                    ? username.trim().length < 3 || password.trim().length < 4
                    : code.trim().length < 4
                }
              >
                {t('saveAndSend')}
              </button>
            </form>
          </td>
        </tr>
      ) : null}

      {failing ? (
        <tr className="queue-drawer">
          <td colSpan={COLUMNS}>
            <form
              className="paste-form"
              onSubmit={(event) => {
                event.preventDefault();
                onFail(reason);
                setFailing(false);
              }}
            >
              <label className="grow">
                {t('reasonLabel')}
                <select value={reason} onChange={(event) => setReason(event.target.value)}>
                  {FAIL_REASONS.map((entry) => (
                    <option key={entry.key} value={entry.value}>
                      {t(entry.key)}
                    </option>
                  ))}
                </select>
                <small>{t('failHint')}</small>
              </label>
              <button type="submit" className="ghost">
                {t('confirmFail')}
              </button>
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function stateLabel(state: QueueRow['state'], t: ReturnType<typeof useT<'queue'>>): string {
  switch (state) {
    case 'MANUAL_QUEUE':
      return t('stateManualQueue');
    case 'AUTO_ASSIGNED':
      return t('stateAutoAssigned');
    case 'DELIVERED':
      return t('stateDelivered');
    case 'FAILED':
      return t('stateFailed');
    default:
      return state;
  }
}

function statePill(state: QueueRow['state']): string {
  if (state === 'DELIVERED') return 'pill-published';
  if (state === 'FAILED') return 'pill-blocked';
  if (state === 'AUTO_ASSIGNED') return 'pill-ready';
  return 'pill-draft';
}

/**
 * A wait in the units a person reads, not seconds.
 *
 * The plural form comes from `Intl.PluralRules` rather than a one-or-many
 * check, which is what gives Arabic its dual back: two hours reads ساعتان
 * rather than the 2 ساعات the old ternary produced.
 */
function waitLabel(seconds: number, c: ReturnType<typeof useT<'common'>>): string {
  if (seconds < 60) return c('waitUnderMinute');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return c.tp('waitMinutes', minutes);
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return c.tp('waitHours', hours);
  return c.tp('waitDays', Math.floor(hours / 24));
}
