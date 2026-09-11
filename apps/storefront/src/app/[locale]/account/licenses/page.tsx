'use client';

import type { CustomerMe, CustomerSecret, LicenceList, LicenceRow } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { AccountNav } from '../../../../components/account-nav';
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
 */
const STATE_AR: Record<LicenceRow['state'], string> = {
  PENDING: 'قيد التجهيز',
  AUTO_ASSIGNED: 'جاهز — يُرسَل الآن',
  MANUAL_QUEUE: 'قيد الطلب من المورّد',
  DELIVERED: 'تم التسليم',
  FAILED: 'تعذّر — فريقنا يتابعه',
};

const STATE_EN: Record<LicenceRow['state'], string> = {
  PENDING: 'Being prepared',
  AUTO_ASSIGNED: 'Ready — sending now',
  MANUAL_QUEUE: 'Being ordered from the supplier',
  DELIVERED: 'Delivered',
  FAILED: 'Failed — our team is on it',
};

export default function LicensesPage() {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const ar = (params.locale ?? 'ar') === 'ar';
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
        <h1>{ar ? 'تراخيصي' : 'My licences'}</h1>
        <p className="who" dir="ltr">
          {me.email}
        </p>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            void accountApi.signOut().then(() => router.replace(`${prefix}${ROUTES.account}`));
          }}
        >
          {ar ? 'خروج' : 'Sign out'}
        </button>
      </div>

      <AccountNav ar={ar} prefix={prefix} />

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="account-sent">{note}</p> : null}

      {list && list.rows.length === 0 ? (
        <p className="notice">
          {ar
            ? 'لا توجد تراخيص على هذا البريد بعد. إن كنت اشتريت ببريد آخر، ادخل به بدلاً من هذا.'
            : 'No licences on this address yet. If you ordered with a different email, sign in with that one instead.'}
        </p>
      ) : null}

      {list && list.waiting > 0 ? (
        <p className="notice notice-warn">
          {ar
            ? `${String(list.waiting)} بند قيد التجهيز. معظم منتجاتنا تُطلَب من المورّد بعد الدفع، وسيصلك البريد فور جهوزيته.`
            : `${String(list.waiting)} item being prepared. Most of our products are ordered from the supplier after payment; the email arrives as soon as it is ready.`}
        </p>
      ) : null}

      <ul className="licence-list">
        {(list?.rows ?? []).map((row) => (
          <LicenceCard
            key={row.orderItemId}
            row={row}
            ar={ar}
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
  ar,
  prefix,
  onError,
  onNote,
}: {
  row: LicenceRow;
  ar: boolean;
  prefix: string;
  onError: (message: string | null) => void;
  onNote: (message: string | null) => void;
}) {
  const [secrets, setSecrets] = useState<CustomerSecret[] | null>(null);
  const [busy, setBusy] = useState<'reveal' | 'resend' | null>(null);

  const states = ar ? STATE_AR : STATE_EN;
  const delivered = row.state === 'DELIVERED';

  async function reveal(): Promise<void> {
    setBusy('reveal');
    onError(null);
    onNote(null);
    try {
      setSecrets(await accountApi.reveal(row.orderItemId));
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : ar
            ? 'تعذّرت قراءة الترخيص.'
            : 'The licence could not be read.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function resend(): Promise<void> {
    setBusy('resend');
    onError(null);
    try {
      const result = await accountApi.resend(row.orderItemId);
      onNote(ar ? `أُرسلت الرسالة مرّة أخرى إلى ${result.to}` : `Sent again to ${result.to}`);
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : ar
            ? 'تعذّر إرسال الرسالة.'
            : 'The email could not be sent.',
      );
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
          {states[row.state]}
        </span>
      </div>

      <p className="licence-kind">
        {row.credentialKind === 'ACCOUNT_CREDENTIALS'
          ? ar
            ? 'يُسلَّم كاسم مستخدم وكلمة مرور'
            : 'Delivered as a username and password'
          : ar
            ? 'يُسلَّم كمفتاح تفعيل'
            : 'Delivered as an activation key'}
        {row.warrantyDays !== null ? (
          <span className="licence-warranty">
            {ar
              ? ` · الضمان ${String(row.warrantyDays)} يوماً من التسليم`
              : ` · ${String(row.warrantyDays)}-day warranty from delivery`}
          </span>
        ) : null}
      </p>

      {/* A deadline is not a secret, and it is the one thing that stops being
          fixable once it passes. */}
      {row.expiresAt ? (
        <p className="licence-deadline">
          {ar
            ? `يجب تفعيله قبل ${row.expiresAt.slice(0, 10)}`
            : `Must be activated before ${row.expiresAt.slice(0, 10)}`}
        </p>
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
              {busy === 'reveal' ? '…' : ar ? 'اعرض الترخيص' : 'Show the licence'}
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => setSecrets(null)}>
              {ar ? 'أخفِ' : 'Hide'}
            </button>
          )}

          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy !== null || !delivered}
            onClick={() => void resend()}
          >
            {busy === 'resend' ? '…' : ar ? 'أرسل الرسالة مرّة أخرى' : 'Email it to me again'}
          </button>
        </div>
      ) : null}

      {secrets !== null ? (
        <div className="licence-secret">
          {secrets.map((secret, index) => (
            <div key={index} className="licence-secret-block">
              {secret.kind === 'ACCOUNT_CREDENTIALS' ? (
                <>
                  <Field label={ar ? 'اسم المستخدم' : 'Username'} value={secret.username} ar={ar} />
                  <Field label={ar ? 'كلمة المرور' : 'Password'} value={secret.password} ar={ar} />
                </>
              ) : (
                <Field label={ar ? 'مفتاح التفعيل' : 'Activation key'} value={secret.key} ar={ar} />
              )}
            </div>
          ))}
          <p className="licence-warn">
            {ar
              ? 'لا تشارك هذه البيانات مع أحد. لا يمكن استبدالها إن استُخدمت من طرف آخر.'
              : 'Do not share this. It cannot be replaced if somebody else uses it.'}
          </p>
        </div>
      ) : null}

      {row.activationSteps.length > 0 ? (
        <details className="licence-how">
          <summary>{ar ? 'طريقة التفعيل' : 'How to activate'}</summary>
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
function Field({ label, value, ar }: { label: string; value: string | null; ar: boolean }) {
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
        {copied ? (ar ? 'نُسخ' : 'Copied') : ar ? 'نسخ' : 'Copy'}
      </button>
    </p>
  );
}
