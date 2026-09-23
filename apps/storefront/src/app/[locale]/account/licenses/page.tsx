'use client';

import type { CustomerMe, CustomerSecret, LicenceList, LicenceRow } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { AccountNav } from '../../../../components/account-nav';
import { isArabic } from '../../../../i18n/locale';
import { accountApi, AccountError } from '../../../../lib/account-client';

/**
 * تراخيصي — everything this customer has bought, and how to use it.
 *
 * The page exists for one moment: the licence email is gone and the key is
 * needed now. Until it existed the only answer was "write to support", and
 * that answer costs a member of staff reading a key out of the vault by hand —
 * the act this whole system is built to make rare.
 *
 * Three decisions shape what is on screen:
 *
 *   - No secret is on the page when it loads. A key comes out one line at a
 *     time, on a click, and each read is written to the vault's access log. A
 *     page that rendered every key at once would put one glance over a
 *     shoulder between a customer and their whole purchase history.
 *   - "Email it to me again" sits beside "show it", because for most people
 *     that is the better answer: it puts the key back where they expect it and
 *     shows it to nobody on the way.
 *   - Lines that are still being prepared are listed, not hidden. Most of this
 *     catalog is ordered from a supplier after payment, so "not here yet" is
 *     the normal state for the first few hours — and an empty page is exactly
 *     what a customer does not need after paying.
 *
 * A line's state reads from `licences.state`, which says "ready — sending
 * now" where the order pages' `format.lineState` says "key assigned": on this
 * page the next thing the customer sees is the email, so it says so.
 */

export default function LicensesPage() {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const tl = useTranslations('licences');
  const ar = isArabic(params.locale);
  const prefix = ar ? '' : `/${params.locale ?? 'en'}`;

  const [me, setMe] = useState<CustomerMe | null>(null);
  const [list, setList] = useState<LicenceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await accountApi.licences());
    } catch (caught) {
      if (caught instanceof AccountError && caught.status === 401) {
        router.replace(`${prefix}${ROUTES.account}`);
        return;
      }
      setError(caught instanceof Error ? caught.message : null);
    }
  }, [router, prefix]);

  useEffect(() => {
    void (async () => {
      try {
        setMe(await accountApi.me());
      } catch {
        // Not signed in, or the twelve hours are up. Straight back to the one
        // page that can fix it rather than an error the visitor cannot act on.
        router.replace(`${prefix}${ROUTES.account}`);
      }
    })();
  }, [router, prefix]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (!me) {
    return (
      <main className="shell account-shell">
        <p className="notice">…</p>
      </main>
    );
  }

  return (
    <main className="shell account-shell">
      <div className="account-head">
        <h1>{t('myLicences')}</h1>
        <p className="who" dir="ltr">
          {me.email}
        </p>
        {/* The only entry point to the review page other than the invitation
            email, and a customer who has lost the email still has this. */}
        <Link className="btn btn-ghost" href={`${prefix}${ROUTES.accountReviews}`}>
          {t('myReviews')}
        </Link>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            void accountApi.signOut().then(() => router.replace(`${prefix}${ROUTES.account}`));
          }}
        >
          {tc('signOut')}
        </button>
      </div>

      <AccountNav prefix={prefix} />

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="account-sent">{note}</p> : null}

      {list && list.rows.length === 0 ? <p className="notice">{tl('none')}</p> : null}

      {list && list.waiting > 0 ? (
        <p className="notice notice-warn">{tl('waiting', { count: list.waiting })}</p>
      ) : null}

      <ul className="licence-list">
        {(list?.rows ?? []).map((row) => (
          <LicenceCard
            key={row.orderItemId}
            row={row}
            prefix={prefix}
            onError={setError}
            onNote={setNote}
          />
        ))}
      </ul>
    </main>
  );
}

function LicenceCard({
  row,
  prefix,
  onError,
  onNote,
}: {
  row: LicenceRow;
  prefix: string;
  onError: (message: string | null) => void;
  onNote: (message: string | null) => void;
}) {
  const [secrets, setSecrets] = useState<CustomerSecret[] | null>(null);
  const [busy, setBusy] = useState<'reveal' | 'resend' | null>(null);
  const tl = useTranslations('licences');

  const delivered = row.state === 'DELIVERED';

  async function reveal(): Promise<void> {
    setBusy('reveal');
    onError(null);
    onNote(null);
    try {
      setSecrets(await accountApi.reveal(row.orderItemId));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : tl('readFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function resend(): Promise<void> {
    setBusy('resend');
    onError(null);
    try {
      const result = await accountApi.resend(row.orderItemId);
      onNote(tl('resent', { to: result.to }));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : tl('resendFailed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className={`licence-card${delivered ? '' : ' is-waiting'}`}>
      <div className="licence-head">
        <div>
          <Link href={`${prefix}${ROUTES.product(row.productSlug)}`} className="licence-name">
            {row.productName}
          </Link>
          <p className="licence-meta">
            <span dir="ltr">{row.orderNumber}</span>
            {row.qty > 1 ? <span> · ×{row.qty}</span> : null}
            <span>
              {' · '}
              {(row.deliveredAt ?? row.placedAt).slice(0, 10)}
            </span>
          </p>
        </div>
        <span className={`pill ${delivered ? 'pill-published' : 'pill-draft'}`}>
          {tl(`state.${row.state}`)}
        </span>
      </div>

      <p className="licence-kind">
        {row.credentialKind === 'ACCOUNT_CREDENTIALS'
          ? tl('deliveredAsAccount')
          : tl('deliveredAsKey')}
        {row.warrantyDays !== null ? (
          <span className="licence-warranty">
            {` · ${tl('warranty', { days: row.warrantyDays })}`}
          </span>
        ) : null}
      </p>

      {/* A deadline is not a secret, and it is the one thing that stops being
          fixable once it passes. */}
      {row.expiresAt ? (
        <p className="licence-deadline">{tl('deadline', { date: row.expiresAt.slice(0, 10) })}</p>
      ) : null}

      {row.hasSecret ? (
        <div className="licence-actions">
          {secrets === null ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy !== null}
              onClick={() => void reveal()}
            >
              {busy === 'reveal' ? '…' : tl('reveal')}
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => setSecrets(null)}>
              {tl('hide')}
            </button>
          )}

          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy !== null || !delivered}
            onClick={() => void resend()}
          >
            {busy === 'resend' ? '…' : tl('resend')}
          </button>
        </div>
      ) : null}

      {secrets !== null ? (
        <div className="licence-secret">
          {secrets.map((secret, index) => (
            <div key={index} className="licence-secret-block">
              {secret.kind === 'ACCOUNT_CREDENTIALS' ? (
                <>
                  <Field label={tl('username')} value={secret.username} />
                  <Field label={tl('password')} value={secret.password} />
                </>
              ) : (
                <Field label={tl('key')} value={secret.key} />
              )}
            </div>
          ))}
          <p className="licence-warn">{tl('doNotShare')}</p>
        </div>
      ) : null}

      {row.activationSteps.length > 0 ? (
        <details className="licence-how">
          <summary>{tl('howToActivate')}</summary>
          <ol>
            {row.activationSteps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </details>
      ) : null}
    </li>
  );
}

/**
 * One labelled value with a copy button.
 *
 * Copying matters more than it looks: the alternative is a customer
 * transcribing a 25-character key by hand into an activation dialog that locks
 * after a few wrong attempts.
 */
function Field({ label, value }: { label: string; value: string | null }) {
  const tl = useTranslations('licences');
  const [copied, setCopied] = useState(false);

  return (
    <p className="licence-field">
      <span className="licence-field-label">{label}</span>
      <strong dir="ltr">{value}</strong>
      <button
        type="button"
        className="linky"
        onClick={() => {
          void navigator.clipboard
            .writeText(value ?? '')
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            // A blocked clipboard is not worth an error: the value is on screen
            // and selectable either way.
            .catch(() => undefined);
        }}
      >
        {copied ? tl('copied') : tl('copy')}
      </button>
    </p>
  );
}
