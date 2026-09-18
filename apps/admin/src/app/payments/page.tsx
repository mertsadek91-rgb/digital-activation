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

import { useT } from '../../i18n/provider';
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
const METHOD_NAME_KEYS = {
  BANK_TRANSFER: 'methodBankTransfer',
  CRYPTO: 'methodCrypto',
} as const satisfies Record<ManualPaymentProvider, string>;

const METHOD_HINT_KEYS = {
  BANK_TRANSFER: 'hintBankTransfer',
  CRYPTO: 'hintCrypto',
} as const satisfies Record<ManualPaymentProvider, string>;

const MANUAL: ManualPaymentProvider[] = ['BANK_TRANSFER', 'CRYPTO'];

export default function PaymentsPage() {
  const router = useRouter();
  const t = useT('payments');
  const c = useT('common');
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
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [router, t]);

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

  if (!me) return <div className="admin-layout">{c('loading')}</div>;

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
      setNote(t('saved', { count: offered }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const statusOf = (provider: string): PaymentMethodStatus | undefined =>
    view?.methods.find((method) => method.provider === provider);

  /*
   * Whether the form differs from what is stored.
   *
   * Compared as JSON rather than tracked with a flag: every edit on this page
   * replaces the draft wholesale, so a flag would have to be set in six
   * handlers and cleared in two, and the one place it was forgotten would be a
   * bar that never appears. The object is a handful of strings.
   */
  const dirty = draft !== null && view !== null && JSON.stringify(draft) !== JSON.stringify(view.settings);

  return (
    <Nav me={me} current="payments">
      <div className="queue-head">
        <h1>{t('title')}</h1>
        <p className="who">
          {' '}
          {view
            ? t('offeredCount', {
                count: view.methods.filter((method) => method.isOffered).length,
              })
            : c('loading')}
        </p>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}
      {!canWrite ? <p className="notice"> {t('roleReadonly', { role: me.role })}</p> : null}

      <section className="vault-section">
        <h2>{t('shopperHeading')}</h2>
        <p className="lede-sm"> {t('shopperLede')}</p>
        <ul className="pay-status-list">
          {(view?.methods ?? []).map((method) => (
            <li key={method.provider}>
              <span className={`pill ${method.isOffered ? 'pill-ready' : 'pill-blocked'}`}>
                {' '}
                {method.isOffered ? t('offered') : t('notOffered')}
              </span>
              <strong>{labelFor(method.provider, t)}</strong>
              {method.blocker ? <span className="meta">{method.blocker}</span> : null}
              {/* A method can be live and still not workable. The screen used to
                  fall silent the moment it went green, so "offered" and "offered
                  with enough detail to actually pay" looked identical. */}
              {method.warning ? <span className="meta meta-warn">{method.warning}</span> : null}
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

      {/*
        The save bar sticks to the bottom of the screen once anything is
        edited.

        It used to sit at the end of the document, which on this page is 2,100
        pixels down — the bank fields are at the top, and the only button that
        keeps them is a thousand pixels below the fold, past an entire second
        payment method the shop does not use. The first person to fill the form
        in filled it in correctly, navigated away, and lost all of it, with
        nothing on screen having suggested there was anything to lose.

        So it follows the reader, and it only appears when there is something
        to save: a permanent bar is furniture, one that arrives when the form
        is dirty is the notice that the form is dirty.
      */}
      {canWrite ? (
        <div className={`pay-save${dirty ? ' is-dirty' : ''}`}>
          <button type="button" onClick={() => void save()} disabled={saving || !draft || !dirty}>
            {saving ? c('loading') : t('saveBoth')}
          </button>
          <span className="meta">{dirty ? t('unsaved') : t('auditNote')}</span>
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
  const t = useT('payments');
  const c = useT('common');

  function setField(index: number, next: PaymentFieldSetting): void {
    onChange({
      ...method,
      fields: method.fields.map((field, at) => (at === index ? next : field)),
    });
  }

  return (
    <section className="vault-section">
      <h2>
        {' '}
        {t(METHOD_NAME_KEYS[provider])}{' '}
        {status ? (
          <span className={`pill ${status.isOffered ? 'pill-ready' : 'pill-blocked'}`}>
            {' '}
            {status.isOffered ? t('offered') : t('notOffered')}
          </span>
        ) : null}
      </h2>
      <p className="lede-sm">{t(METHOD_HINT_KEYS[provider])}</p>

      <label className="pay-enable">
        <input
          type="checkbox"
          checked={method.isEnabled}
          disabled={!canWrite}
          onChange={(event) => onChange({ ...method, isEnabled: event.target.checked })}
        />
        <span>{t('enableMethod')}</span>
      </label>

      <div className="pay-grid">
        <LocalisedField
          title={t('headlineTitle')}
          hint={t('headlineHint')}
          value={method.headline}
          disabled={!canWrite}
          onChange={(headline) => onChange({ ...method, headline })}
        />
        <LocalisedField
          title={t('afterPayingTitle')}
          hint={t('afterPayingHint')}
          value={method.afterPaying}
          disabled={!canWrite}
          onChange={(afterPaying) => onChange({ ...method, afterPaying })}
        />
      </div>

      <h3 className="pay-fields-head">{t('fieldsHeading')}</h3>
      {/*
        Spelled out, because the column headings alone were not enough.
        "الاسم" beside "القيمة" reads as "the name" — and the first owner to fill
        this in typed their own name into it, leaving a shopper looking at
        "Mert: AE51…" where the heading should have said "الآيبان". The heading
        is a caption for the box beneath it, not the thing being captioned.

        Composed from five keys rather than one string carrying <strong> tags,
        so the emphasis survives translation without the message having to be
        set as HTML. The two languages put the words in the same order.
      */}
      <p className="pay-fields-hint">
        {t('fieldsHintLead')}
        <strong>{t('fieldsHintLabelWord')}</strong>
        {t('fieldsHintJoin')}
        <strong>{t('fieldsHintValueWord')}</strong>
        {t('fieldsHintTail')}
      </p>
      {method.fields.length === 0 ? <p className="notice">{t('noFields')}</p> : null}

      <div className="pay-fields">
        {method.fields.map((field, index) => (
          <div className="pay-field" key={index}>
            <label>
              {t('fieldLabelAr')}
              <input
                type="text"
                value={field.label.ar}
                disabled={!canWrite}
                placeholder={t('fieldLabelArPlaceholder')}
                onChange={(event) =>
                  setField(index, { ...field, label: { ...field.label, ar: event.target.value } })
                }
              />
            </label>
            <label>
              {t('fieldLabelEn')}
              <input
                type="text"
                value={field.label.en}
                disabled={!canWrite}
                dir="ltr"
                placeholder={t('fieldLabelEnPlaceholder')}
                onChange={(event) =>
                  setField(index, { ...field, label: { ...field.label, en: event.target.value } })
                }
              />
            </label>
            <label className="grow">
              {t('fieldValue')}
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
              <span>{t('fieldCopyable')}</span>
            </label>
            {canWrite ? (
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  onChange({ ...method, fields: method.fields.filter((_, at) => at !== index) })
                }
              >
                {c('delete')}
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
          {t('addField')}
        </button>
      ) : null}

      <ShopperPreview method={method} />
    </section>
  );
}

/**
 * The same block the shopper is shown at checkout, drawn from the boxes above.
 *
 * Added because none of the wording on this screen caught the mistake it was
 * built to prevent: an owner typed their own name into the heading column and
 * saved a payment instruction reading "Mert: AE51…". Every label here was
 * technically accurate and the result was still wrong, which is the point at
 * which a form should stop explaining itself and start showing its output.
 *
 * Arabic, because that is what almost every shopper on this store reads, and
 * the value is `dir="ltr"` for the same reason it is in the editor — an account
 * number whose groups reorder gets proof-read as correct.
 */
function ShopperPreview({ method }: { method: ManualPaymentSetting }) {
  const t = useT('payments');
  const usable = method.fields.filter(
    (field) =>
      field.value.trim() !== '' && (field.label.ar.trim() !== '' || field.label.en.trim() !== ''),
  );
  if (usable.length === 0) return null;

  return (
    <div className="pay-preview">
      <h4>{t('previewHeading')}</h4>
      {method.headline.ar.trim() || method.headline.en.trim() ? (
        <p className="pay-preview-headline">
          {method.headline.ar.trim() || method.headline.en.trim()}
        </p>
      ) : null}
      <dl>
        {usable.map((field, index) => (
          <div key={index}>
            <dt>{field.label.ar.trim() || field.label.en.trim()}</dt>
            <dd dir="ltr">{field.value}</dd>
          </div>
        ))}
      </dl>
      {method.afterPaying.ar.trim() || method.afterPaying.en.trim() ? (
        <p className="pay-preview-after">
          {method.afterPaying.ar.trim() || method.afterPaying.en.trim()}
        </p>
      ) : null}
    </div>
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
  const t = useT('payments');

  return (
    <div className="pay-localised">
      <p className="pay-localised-head">
        {title} <span className="meta">{hint}</span>
      </p>
      <label>
        {t('localeArabic')}
        <textarea
          rows={2}
          value={value.ar}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, ar: event.target.value })}
        />
      </label>
      <label>
        {t('localeEnglish')}
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

function labelFor(provider: string, t: ReturnType<typeof useT<'payments'>>): string {
  if (provider === 'STRIPE') return t('methodStripe');
  // Not translated: PayPal is the brand's own name in both languages.
  if (provider === 'PAYPAL') return 'PayPal';
  if (provider === 'BANK_TRANSFER') return t('methodBankTransfer');
  if (provider === 'CRYPTO') return t('methodCrypto');
  return provider;
}
