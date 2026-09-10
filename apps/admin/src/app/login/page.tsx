'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api, ApiError } from '../../lib/api';

/**
 * Staff sign-in.
 *
 * Three states, because TOTP is mandatory rather than offered: password, then
 * either a code or a first-time enrolment. An admin session can reveal a
 * licence key — the product itself, and unrecoverable once leaked — so an
 * account without an authenticator is walked through setting one up instead of
 * being let in.
 */
type Stage =
  | { kind: 'password' }
  | { kind: 'code' }
  | { kind: 'enroll'; secret: string; otpauthUrl: string; qrDataUrl: string };

export default function LoginPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      if (stage.kind === 'enroll') {
        const enrolled = await api.enroll(email, password, totp);
        router.push(enrolled.staff.mustChangePassword ? '/password' : '/products');
        return;
      }

      const result = await api.login(email, password, stage.kind === 'code' ? totp : undefined);

      if (result.outcome === 'ok') {
        router.push(result.staff.mustChangePassword ? '/password' : '/products');
      } else if (result.outcome === 'totp_required') {
        setStage({ kind: 'code' });
      } else {
        setStage({
          kind: 'enroll',
          secret: result.secret,
          otpauthUrl: result.otpauthUrl,
          qrDataUrl: result.qrDataUrl,
        });
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر الاتصال بالخدمة.');
      if (stage.kind === 'code') setTotp('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        className="auth-card"
      >
        <h1>لوحة إدارة التفعيل الرقمي</h1>

        {stage.kind === 'password' ? (
          <>
            <label>
              البريد الإلكتروني
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                required
                dir="ltr"
              />
            </label>
            <label>
              كلمة المرور
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                dir="ltr"
              />
            </label>
          </>
        ) : null}

        {stage.kind === 'enroll' ? (
          <div className="enroll">
            <p className="enroll-lede">
              هذا الحساب لا يملك مصادقة ثنائية بعد. امسح الرمز بتطبيق المصادقة، ثم أدخل الرمز الأول
              لإكمال التسجيل.
            </p>
            {/* A plain img, not next/image: a data: URI has nothing to
                optimise, and the image loader would only carry the secret
                through another hop. */}
            <img
              className="enroll-qr"
              src={stage.qrDataUrl}
              alt="رمز QR لإعداد المصادقة الثنائية"
            />
            <p className="enroll-hint">أو أدخل هذا المفتاح يدوياً:</p>
            <p className="enroll-secret" dir="ltr">
              {stage.secret}
            </p>
          </div>
        ) : null}

        {stage.kind !== 'password' ? (
          <label>
            رمز المصادقة
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={totp}
              onChange={(event) => setTotp(event.target.value.replace(/\D/g, ''))}
              autoComplete="one-time-code"
              required
              dir="ltr"
              className="code-input"
              autoFocus
            />
          </label>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        <button type="submit" disabled={busy}>
          {busy
            ? '...'
            : stage.kind === 'password'
              ? 'متابعة'
              : stage.kind === 'enroll'
                ? 'إكمال التسجيل'
                : 'تسجيل الدخول'}
        </button>
      </form>
    </main>
  );
}
