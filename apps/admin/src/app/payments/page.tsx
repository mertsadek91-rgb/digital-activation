'use client';

import type {
  I18nString,
  ManualPaymentProvider,
  ManualPaymentSetting,
  PaymentFieldSetting,
  PaymentMethodStatus,
  PaymentSettings,
  PaymentSettingsView,
  StaffMe,
} from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../../lib/api';
import { Nav } from '../nav';

/**
 * Where customer money is sent.
 *
 * The storefront offered "تحويل بنكي" from the day it shipped and the payment
 * step under it said "transfer the amount then attach proof" with no account
 * number anywhere on the page, because no code can invent an IBAN. This screen
 * is the answer: the details are written once here, and until one of them has a
 * value the method is not offered at the checkout at all. A button that opens a
 * page with nothing to transfer to loses the order and the trust with it.
 *
 * Fields are a list rather than fixed columns because the shape differs by
 * country and by asset — an IBAN and a swift code in the Emirates, an account
 * number and an IFSC elsewhere, a network and an address for USDT — and a form
 * with an "IBAN" box in a country that does not use one gets filled in wrong.
 */
const METHOD_NAMES: Record<ManualPaymentProvider, string> = {
  BANK_TRANSFER: 'التحويل البنكي',
  CRYPTO: 'العملات الرقمية',
};

const METHOD_HINTS: Record<ManualPaymentProvider, string> = {
  BANK_TRANSFER: 'مثال: اسم صاحب الحساب، اسم البنك، رقم الحساب، الآيبان، السويفت.',
  CRYPTO: 'مثال: العملة (USDT)، الشبكة (TRC-20)، عنوان المحفظة.',
};

const MANUAL: ManualPaymentProvider[] = ['BANK_TRANSFER', 'CRYPTO'];

export default function PaymentsPage() {
  const router = useRouter();
  const [me, setMe] = useState<StaffMe | null>(null);
  const [view, setView] = useState<PaymentSettingsView | null>(null);
  const [draft, setDraft] = useState<PaymentSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const loaded = await api.paymentMethods();
      setView(loaded);
      setDraft(loaded.settings);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : 'تعذّر تحميل طرق الدفع.');
    }
  }, [router]);

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

  if (!me) return <div className="admin-layout">…</div>;

  // Narrower than the redirect screen next door on purpose. Answering a dead
  // URL is content work; re-pointing every bank transfer the store takes is not.
  const canWrite = ['OWNER', 'ADMIN'].includes(me.role);

  function patch(provider: ManualPaymentProvider, next: ManualPaymentSetting): void {
    setDraft((current) => (current ? { ...current, [provider]: next } : current));
    setNote(null);
  }

  async function save(): Promise<void> {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      const saved = await api.savePaymentMethods(draft);
      setView(saved);
      setDraft(saved.settings);
      const offered = saved.methods.filter((method) => method.isOffered).length;
      setNote(`حُفظت. الطرق المعروضة على المتجر الآن: ${String(offered)}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر الحفظ.');
    } finally {
      setSaving(false);
    }
  }

  const statusOf = (provider: string): PaymentMethodStatus | undefined =>
    view?.methods.find((method) => method.provider === provider);

  return (
    <Nav me={me} current="payments" >

      <div className="queue-head">
        <h1>طرق الدفع</h1>
        <p className="who">
          {view
            ? `${String(view.methods.filter((method) => method.isOffered).length)} طريقة معروضة على المتجر`
            : '…'}
        </p>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}
      {!canWrite ? (
        <p className="notice">
          دورك <strong>{me.role}</strong> يسمح بالقراءة فقط. تعديل وجهة الأموال مقصور على المالك
          والمدير.
        </p>
      ) : null}

      <section className="vault-section">
        <h2>ما يراه المشتري الآن</h2>
        <p className="lede-sm">
          الطريقة غير المكتملة لا تُعرض في صفحة الدفع أصلاً؛ زرٌّ يفتح صفحة بلا رقم حساب أسوأ من
          طريقة غائبة.
        </p>
        <ul className="pay-status-list">
          {(view?.methods ?? []).map((method) => (
            <li key={method.provider}>
              <span className={`pill ${method.isOffered ? 'pill-ready' : 'pill-blocked'}`}>
                {method.isOffered ? 'تُعرض' : 'لا تُعرض'}
              </span>
              <strong>{labelFor(method.provider)}</strong>
              {method.blocker ? <span className="meta">{method.blocker}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      {draft
        ? MANUAL.map((provider) => (
            <MethodEditor
              key={provider}
              provider={provider}
              method={draft[provider]}
              status={statusOf(provider)}
              canWrite={canWrite}
              onChange={(next) => patch(provider, next)}
            />
          ))
        : null}

      {canWrite ? (
        <div className="pay-save">
          <button type="button" onClick={() => void save()} disabled={saving || !draft}>
            {saving ? '…' : 'احفظ الطريقتين'}
          </button>
          <span className="meta">
            يُسجَّل كل تعديل في سجلّ التدقيق باسم من قام به: هذه بيانات توجّه أموال العملاء.
          </span>
        </div>
      ) : null}
    </Nav>
  );
}

function MethodEditor({
  provider,
  method,
  status,
  canWrite,
  onChange,
}: {
  provider: ManualPaymentProvider;
  method: ManualPaymentSetting;
  status: PaymentMethodStatus | undefined;
  canWrite: boolean;
  onChange: (next: ManualPaymentSetting) => void;
}) {
  function setField(index: number, next: PaymentFieldSetting): void {
    onChange({
      ...method,
      fields: method.fields.map((field, at) => (at === index ? next : field)),
    });
  }

  return (
    <section className="vault-section">
      <h2>
        {METHOD_NAMES[provider]}{' '}
        {status ? (
          <span className={`pill ${status.isOffered ? 'pill-ready' : 'pill-blocked'}`}>
            {status.isOffered ? 'تُعرض' : 'لا تُعرض'}
          </span>
        ) : null}
      </h2>
      <p className="lede-sm">{METHOD_HINTS[provider]}</p>

      <label className="pay-enable">
        <input
          type="checkbox"
          checked={method.isEnabled}
          disabled={!canWrite}
          onChange={(event) => onChange({ ...method, isEnabled: event.target.checked })}
        />
        <span>اعرض هذه الطريقة في صفحة الدفع</span>
      </label>

      <div className="pay-grid">
        <LocalisedField
          title="سطر تمهيدي"
          hint="سطر واحد فوق الأرقام. يُترك فارغاً بلا ضرر."
          value={method.headline}
          disabled={!canWrite}
          onChange={(headline) => onChange({ ...method, headline })}
        />
        <LocalisedField
          title="ماذا يفعل بعد التحويل"
          hint="أين يُرسل إثبات الدفع. بدونه لا يعرف المشتري أن عليه إرساله."
          value={method.afterPaying}
          disabled={!canWrite}
          onChange={(afterPaying) => onChange({ ...method, afterPaying })}
        />
      </div>

      <h3 className="pay-fields-head">الحقول</h3>
      {method.fields.length === 0 ? (
        <p className="notice">لا حقول بعد، ولذلك لا تُعرض هذه الطريقة على المشتري.</p>
      ) : null}

      <div className="pay-fields">
        {method.fields.map((field, index) => (
          <div className="pay-field" key={index}>
            <label>
              الاسم (عربي)
              <input
                type="text"
                value={field.label.ar}
                disabled={!canWrite}
                placeholder="الآيبان"
                onChange={(event) =>
                  setField(index, { ...field, label: { ...field.label, ar: event.target.value } })
                }
              />
            </label>
            <label>
              الاسم (إنجليزي)
              <input
                type="text"
                value={field.label.en}
                disabled={!canWrite}
                dir="ltr"
                placeholder="IBAN"
                onChange={(event) =>
                  setField(index, { ...field, label: { ...field.label, en: event.target.value } })
                }
              />
            </label>
            <label className="grow">
              القيمة
              {/*
                LTR and monospace here as well as on the storefront. This is the
                box the number is pasted into, and a value that renders with its
                groups reordered gets proof-read as correct and saved wrong.
              */}
              <input
                type="text"
                className="pay-value-input"
                value={field.value}
                disabled={!canWrite}
                dir="ltr"
                onChange={(event) => setField(index, { ...field, value: event.target.value })}
              />
            </label>
            <label className="pay-copyable">
              <input
                type="checkbox"
                checked={field.copyable}
                disabled={!canWrite}
                onChange={(event) => setField(index, { ...field, copyable: event.target.checked })}
              />
              <span>يُنسخ حرفياً</span>
            </label>
            {canWrite ? (
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  onChange({ ...method, fields: method.fields.filter((_, at) => at !== index) })
                }
              >
                احذف
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {canWrite ? (
        <button
          type="button"
          className="ghost"
          disabled={method.fields.length >= 12}
          onClick={() =>
            onChange({
              ...method,
              // "Copied verbatim" by default: most of what goes here is an
              // account number or an address, and the rare descriptive line is
              // the one worth unticking.
              fields: [...method.fields, { label: { ar: '', en: '' }, value: '', copyable: true }],
            })
          }
        >
          أضف حقلاً
        </button>
      ) : null}
    </section>
  );
}

function LocalisedField({
  title,
  hint,
  value,
  disabled,
  onChange,
}: {
  title: string;
  hint: string;
  value: I18nString;
  disabled: boolean;
  onChange: (next: I18nString) => void;
}) {
  return (
    <div className="pay-localised">
      <p className="pay-localised-head">
        {title} <span className="meta">{hint}</span>
      </p>
      <label>
        عربي
        <textarea
          rows={2}
          value={value.ar}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, ar: event.target.value })}
        />
      </label>
      <label>
        إنجليزي
        {/*
          Left blank is a real answer, not an omission: the storefront falls
          back to the other language rather than showing an English shopper an
          empty panel where the bank details should be.
        */}
        <textarea
          rows={2}
          value={value.en}
          disabled={disabled}
          dir="ltr"
          onChange={(event) => onChange({ ...value, en: event.target.value })}
        />
      </label>
    </div>
  );
}

function labelFor(provider: string): string {
  if (provider === 'STRIPE') return 'البطاقة البنكية (Stripe)';
  if (provider === 'PAYPAL') return 'PayPal';
  if (provider === 'BANK_TRANSFER') return METHOD_NAMES.BANK_TRANSFER;
  if (provider === 'CRYPTO') return METHOD_NAMES.CRYPTO;
  return provider;
}
