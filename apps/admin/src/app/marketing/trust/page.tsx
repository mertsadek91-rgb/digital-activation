'use client';

import type { TrustSettings } from '@da/contracts';

import { useT } from '../../../i18n/provider';
import {
  LocalizedField,
  SaveBar,
  SignalsFrame,
  Toggle,
  useFeatureSettings,
} from '../signals-shared';

/**
 * Where a Maroof link may point. Checked here so the mistake is caught while
 * typing; the storefront also refuses anything that is not https, because a
 * link in the footer of every page is the last place for a `javascript:` URL.
 */
function maroofProblem(url: string): 'invalid' | 'notHttps' | 'notMaroof' | null {
  if (url === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'invalid';
  }
  if (parsed.protocol !== 'https:') return 'notHttps';
  // A warning, not a refusal: Maroof has moved domains before.
  if (!/(^|\.)maroof\.sa$/i.test(parsed.hostname)) return 'notMaroof';
  return null;
}

/**
 * الثقة والضمان — the store's guarantee, delivery promise and registration.
 *
 * Every line the storefront shows from this screen is text somebody here
 * typed; nothing has a default wording. That is deliberate: a trust claim the
 * store did not write ("official partner", "certified") is a claim nobody at
 * the store can stand behind.
 */
export default function TrustSettingsPage() {
  const t = useT('marketingTrust');
  const s = useT('marketingSignals');
  const { me, allowed, draft, setDraft, dirty, save, saving, error, note } =
    useFeatureSettings('trust');

  const set = (patch: Partial<TrustSettings>) => {
    if (draft) setDraft({ ...draft, ...patch });
  };

  const maroof = draft ? maroofProblem(draft.maroofUrl.trim()) : null;
  const invalid =
    maroof === 'invalid' ? t('maroofInvalid') : maroof === 'notHttps' ? t('maroofNotHttps') : null;

  return (
    <SignalsFrame
      me={me}
      allowed={allowed}
      title={t('title')}
      lede={t('lede')}
      error={error}
      note={note}
      saveBar={
        draft ? (
          <SaveBar dirty={dirty} saving={saving} invalid={invalid} onSave={() => void save()} />
        ) : null
      }
    >
      {draft ? (
        <div className="signals-layout">
          <div className="signals-form">
            <section className="vault-section">
              <Toggle
                label={s('enabled')}
                hint={t('enabledHint')}
                checked={draft.enabled}
                onChange={(enabled) => set({ enabled })}
              />
              <Toggle
                label={t('showOnProduct')}
                checked={draft.showOnProduct}
                onChange={(showOnProduct) => set({ showOnProduct })}
              />
              <Toggle
                label={t('showOnCheckout')}
                checked={draft.showOnCheckout}
                onChange={(showOnCheckout) => set({ showOnCheckout })}
              />
            </section>

            <section className="vault-section">
              <h2>{t('copyHeading')}</h2>
              <p className="lede-sm">{t('copyLede')}</p>
              <div className="pay-grid">
                <LocalizedField
                  title={t('guarantee')}
                  hint={t('guaranteeHint')}
                  value={draft.guarantee}
                  onChange={(guarantee) => set({ guarantee })}
                />
                <LocalizedField
                  title={t('instantDelivery')}
                  hint={t('instantDeliveryHint')}
                  value={draft.instantDeliveryText}
                  onChange={(instantDeliveryText) => set({ instantDeliveryText })}
                />
              </div>
            </section>

            <section className="vault-section">
              <h2>{t('registrationHeading')}</h2>
              <p className="lede-sm">{t('registrationLede')}</p>
              <div className="signals-fields">
                <label className="signals-text">
                  <span>{t('commercialRegistration')}</span>
                  <input
                    type="text"
                    dir="ltr"
                    maxLength={100}
                    value={draft.commercialRegistration}
                    onChange={(event) => set({ commercialRegistration: event.target.value })}
                  />
                </label>
                <label className="signals-text">
                  <span>{t('vatNumber')}</span>
                  <input
                    type="text"
                    dir="ltr"
                    maxLength={100}
                    value={draft.vatNumber}
                    onChange={(event) => set({ vatNumber: event.target.value })}
                  />
                </label>
                <label className="signals-text signals-wide">
                  <span>{t('maroofUrl')}</span>
                  <input
                    type="url"
                    dir="ltr"
                    placeholder="https://maroof.sa/…"
                    value={draft.maroofUrl}
                    aria-invalid={invalid !== null}
                    onChange={(event) => set({ maroofUrl: event.target.value })}
                  />
                  {maroof === 'notMaroof' ? (
                    <span className="meta meta-warn">{t('maroofNotMaroof')}</span>
                  ) : maroof ? (
                    <span className="meta meta-warn">{invalid}</span>
                  ) : (
                    <span className="meta">{t('maroofHint')}</span>
                  )}
                </label>
              </div>
            </section>
          </div>

          <aside className="signals-preview" aria-label={s('preview')}>
            <h2>{s('preview')}</h2>
            {!draft.enabled ? <p className="notice">{t('previewOff')}</p> : null}
            <TrustPreview settings={draft} lang="ar" />
            <TrustPreview settings={draft} lang="en" />
          </aside>
        </div>
      ) : null}
    </SignalsFrame>
  );
}

/**
 * The product-page block as a shopper in one language would see it.
 *
 * Mirrors the storefront's rules rather than its markup: a language with no
 * text shows no line (there is no fallback to the other language), and the
 * registration line appears only with something in it.
 */
function TrustPreview({ settings, lang }: { settings: TrustSettings; lang: 'ar' | 'en' }) {
  const t = useT('marketingTrust');
  const guarantee = settings.guarantee[lang].trim();
  const instant = settings.instantDeliveryText[lang].trim();
  // The storefront's own labels, in the previewed language whatever language
  // this panel is in — copied from its `trustSignals` messages.
  const labels =
    lang === 'ar'
      ? {
          guarantee: t('sfGuaranteeAr'),
          delivery: t('sfDeliveryAr'),
          cr: t('sfCrAr'),
          vat: t('sfVatAr'),
          maroof: t('sfMaroofAr'),
        }
      : {
          guarantee: t('sfGuaranteeEn'),
          delivery: t('sfDeliveryEn'),
          cr: t('sfCrEn'),
          vat: t('sfVatEn'),
          maroof: t('sfMaroofEn'),
        };
  const registration =
    settings.commercialRegistration.trim() ||
    settings.vatNumber.trim() ||
    settings.maroofUrl.trim();

  return (
    <div className="signals-preview-card" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
      <p className="signals-preview-lang">
        {lang === 'ar' ? t('previewArabic') : t('previewEnglish')}
      </p>
      {!settings.showOnProduct ? <p className="meta">{t('previewHiddenOnProduct')}</p> : null}
      {guarantee ? (
        <div className="signals-preview-row">
          <strong>{labels.guarantee}</strong>
          <p>{guarantee}</p>
        </div>
      ) : (
        <p className="meta">{t('previewNoGuarantee')}</p>
      )}
      <div className="signals-preview-row">
        <strong>{labels.delivery}</strong>
        <p>{instant || <span className="meta">{t('previewNoInstant')}</span>}</p>
        <span className="meta">{t('previewDeliveryNote')}</span>
      </div>
      {registration ? (
        <p className="signals-preview-registration">
          {settings.commercialRegistration.trim() ? (
            <span>
              {labels.cr}: <bdi dir="ltr">{settings.commercialRegistration.trim()}</bdi>
            </span>
          ) : null}
          {settings.vatNumber.trim() ? (
            <span>
              {labels.vat}: <bdi dir="ltr">{settings.vatNumber.trim()}</bdi>
            </span>
          ) : null}
          {settings.maroofUrl.trim() ? <span className="signals-link">{labels.maroof}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
