'use client';

import { ROUTES } from '@da/contracts';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { accountApi, AccountError } from '../../../lib/account-client';

/**
 * Sign in to see your own licences.
 *
 * One field and no password. Every order here is a guest order, and the
 * licence was emailed to this address in the first place — so control of the
 * address is exactly the bar that already handed the key over. Saying that out
 * loud on the page matters as much as implementing it: a store that sells
 * activation keys and asks for no password looks broken unless it explains why.
 *
 * The same page handles the click from the email. The token arrives as a query
 * parameter, is traded for a session cookie, and is then stripped from the URL
 * with `replace` so it does not sit in history, in a bookmark, or in the
 * referrer of the next request.
 *
 * `useSearchParams` lives behind a Suspense boundary because reading the URL
 * forces everything up to the nearest one to render on the client; without it
 * the whole route is that boundary.
 */
export default function AccountPage() {
  return (
    <Suspense fallback={<main className="shell account-shell" />}>
      <AccountEntry />
    </Suspense>
  );
}

function AccountEntry() {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const search = useSearchParams();
  const token = search.get('token');

  const ar = (params.locale ?? 'ar') === 'ar';
  const prefix = ar ? '' : `/${params.locale ?? 'en'}`;

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(token !== null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    void (async () => {
      try {
        await accountApi.exchange(token);
        if (cancelled) return;
        // `replace`, not `push`: the token must not be reachable with Back.
        router.replace(`${prefix}${ROUTES.licenses}`);
      } catch (caught) {
        if (cancelled) return;
        setExchanging(false);
        setError(
          caught instanceof AccountError
            ? caught.message
            : ar
              ? 'تعذّر استخدام هذا الرابط.'
              : 'That link could not be used.',
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, router, prefix, ar]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await accountApi.requestLink(email.trim(), ar ? 'ar' : 'en');
      setSent(true);
    } catch (caught) {
      setError(
        caught instanceof AccountError
          ? caught.message
          : ar
            ? 'تعذّر إرسال الرابط. حاول بعد قليل.'
            : 'The link could not be sent. Try again shortly.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (exchanging) {
    return (
      <main className="shell account-shell">
        <p className="notice">{ar ? 'جارٍ تسجيل الدخول…' : 'Signing you in…'}</p>
      </main>
    );
  }

  return (
    <main className="shell account-shell">
      <h1>{ar ? 'تراخيصي' : 'My licences'}</h1>

      {sent ? (
        <div className="account-card">
          <p className="account-sent">
            {ar
              ? 'أرسلنا رابط الدخول إلى بريدك. يعمل لمرّة واحدة ولمدّة ربع ساعة.'
              : 'We emailed you a sign-in link. It works once and for fifteen minutes.'}
          </p>
          {/* Said plainly, because the alternative is a customer who waits for
              an email that was never going to arrive. */}
          <p className="account-hint">
            {ar
              ? 'إن لم تصلك الرسالة، فالسبب الأغلب أن هذا البريد لم يُشتَر به من قبل. تحقّق من البريد المستخدم في الطلب، ومن مجلّد الرسائل غير المرغوبة.'
              : 'If nothing arrives, the likeliest reason is that no order was placed with this address. Check the email you used on the order, and your spam folder.'}
          </p>
          <button type="button" className="btn btn-ghost" onClick={() => setSent(false)}>
            {ar ? 'استخدم بريداً آخر' : 'Use a different address'}
          </button>
        </div>
      ) : (
        <form
          className="account-card"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <p className="lede">
            {ar
              ? 'أدخل البريد الذي استخدمته في الطلب. سنرسل إليه رابط دخول — لا كلمة مرور.'
              : 'Enter the email you used on your order. We will send it a sign-in link — no password.'}
          </p>

          <label className="account-field">
            {ar ? 'البريد الإلكتروني' : 'Email'}
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              dir="ltr"
              placeholder="you@example.com"
            />
          </label>

          {error ? <p className="error">{error}</p> : null}

          <button type="submit" className="btn btn-primary" disabled={busy || email.length < 5}>
            {busy ? '…' : ar ? 'أرسل رابط الدخول' : 'Send the link'}
          </button>

          {/* Why there is no password field. Without this the page reads as
              unfinished, and a customer who expects a password assumes they
              are on the wrong site. */}
          <p className="account-hint">
            {ar
              ? 'لا نستخدم كلمات مرور لهذه الصفحة: مفتاحك أُرسل إلى بريدك أصلاً، فمن يملك البريد يملك المفتاح — ولا فائدة من كلمة مرور إضافية تُسرَق.'
              : 'This page uses no password: your key was emailed to that address in the first place, so whoever controls the mailbox already has it. A password would only be one more secret to steal.'}
          </p>
        </form>
      )}
    </main>
  );
}
