'use client';

import type { OfferCatalogOptions, OfferSettings, OfferStats } from '@da/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAdminLocale, useT } from '../../../i18n/provider';
import { api, ApiError } from '../../../lib/api';
import { offersApi } from '../../../lib/offers-api';
import { messageOf, useStaff } from '../../content/shared';
import { Nav } from '../../nav';
import { MARKETING_ROLES } from '../page';
import { OfferStatsPanel } from '../offer-stats';

import '../offers-admin.css';

const MAX_TIERS = 5;
const MAX_SUGGESTIONS = 4;

type Pair = OfferSettings['pairs'][number];

/**
 * العروض — volume tiers, "goes well with" pairs, and where suggestions show.
 *
 * Saved as one document through the shared marketing settings route, which
 * validates it against `offerSettingsSchema` and audits the change. The
 * stacking rule is stated on the screen because it is the thing somebody
 * setting a 15% tier next to a 20% coupon needs to know: a cart gets the
 * single largest of the coupon, the tier and the pair discount, never two.
 */
export default function OffersPage() {
  const router = useRouter();
  const me = useStaff();
  const t = useT('marketingOffers');
  const c = useT('common');
  const locale = useAdminLocale();

  const [form, setForm] = useState<OfferSettings | null>(null);
  const [options, setOptions] = useState<OfferCatalogOptions | null>(null);
  const [stats, setStats] = useState<OfferStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const [settings, catalog] = await Promise.all([api.marketingSettings(), offersApi.options()]);
      setForm(settings.offers);
      setOptions(catalog);
      setError(null);
      // The figures are a nicety beside the form; the form must not wait on them.
      offersApi.stats().then(setStats, () => setStats(null));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(messageOf(caught, c('actionFailed')));
    }
  }, [router, c]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  const nameOf = useMemo(() => {
    const names = new Map<string, string>();
    for (const product of options?.products ?? []) {
      names.set(product.id, (locale === 'en' ? product.nameEn : null) ?? product.nameAr);
    }
    return (id: string) => names.get(id) ?? id;
  }, [options, locale]);

  const productChoices = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (options?.products ?? [])
      .filter(
        (product) =>
          !needle ||
          product.slug.includes(needle) ||
          product.nameAr.toLowerCase().includes(needle) ||
          (product.nameEn ?? '').toLowerCase().includes(needle),
      )
      .map((product) => ({ id: product.id, label: nameOf(product.id), status: product.status }));
  }, [options, filter, nameOf]);

  if (!me) return <div className="admin-layout">{c('loading')}</div>;
  if (!MARKETING_ROLES.includes(me.role)) {
    return (
      <Nav me={me} current="marketing">
        <p className="notice">{t('noAccess')}</p>
      </Nav>
    );
  }

  const update = (patch: Partial<OfferSettings>): void => {
    setSaved(false);
    setForm((current) => (current ? { ...current, ...patch } : current));
  };
  const setPair = (index: number, patch: Partial<Pair>): void => {
    if (!form) return;
    update({ pairs: form.pairs.map((pair, at) => (at === index ? { ...pair, ...patch } : pair)) });
  };

  const discounting =
    form !== null &&
    (form.volumeTiers.some((tier) => tier.percent > 0) ||
      form.pairs.some((pair) => pair.discountPercent > 0));
  const licenceMissing = discounting && form.volumeLicenceNumber.trim() === '';
  // Turning a discount on without its licence number is the one save refused here.
  const blocked = form !== null && form.enabled && licenceMissing;

  async function save(): Promise<void> {
    if (!form || blocked) return;
    setBusy(true);
    setError(null);
    try {
      // Empty rows are dropped rather than sent to fail validation.
      const clean: OfferSettings = {
        ...form,
        pairs: form.pairs
          .map((pair) => ({
            ...pair,
            suggestProductIds: pair.suggestProductIds.filter(
              (id) => id !== '' && id !== pair.productId,
            ),
          }))
          .filter((pair) => pair.productId !== '' && pair.suggestProductIds.length > 0),
      };
      setForm(await api.setMarketingSettings('offers', clean));
      setSaved(true);
    } catch (caught) {
      setError(messageOf(caught, c('actionFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Nav me={me} current="marketing">
      <div className="queue-head">
        <p className="who">
          <Link href="/marketing">{t('back')}</Link>
        </p>
        <h1>{t('title')}</h1>
        <p className="who">{t('lede')}</p>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {stats ? <OfferStatsPanel stats={stats} show={['volume', 'pair']} /> : null}

      {form && options ? (
        <form
          className="offers-admin"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="check">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => update({ enabled: event.target.checked })}
            />
            <span>{t('enabled')}</span>
          </label>

          <p className="notice">{t('stackingRule')}</p>

          {licenceMissing ? (
            <p className="offers-alarm" role="alert">
              {form.enabled ? t('licenceRequiredOn') : t('licenceRequired')}
            </p>
          ) : null}

          {/* --- volume tiers ------------------------------------------------ */}
          <section className="offers-section">
            <h2>{t('tiersTitle')}</h2>
            <p className="lede-sm">{t('tiersLede')}</p>
            {form.volumeTiers.length === 0 ? <p className="notice">{t('noTiers')}</p> : null}
            <ul className="offers-rows">
              {form.volumeTiers.map((tier, index) => (
                <li key={index} className="promo-form">
                  <label className="field">
                    <span>{t('minItems')}</span>
                    <input
                      type="number"
                      min={2}
                      max={100}
                      dir="ltr"
                      value={tier.minItems}
                      onChange={(event) =>
                        update({
                          volumeTiers: form.volumeTiers.map((entry, at) =>
                            at === index
                              ? { ...entry, minItems: Number(event.target.value) }
                              : entry,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t('percent')}</span>
                    <input
                      type="number"
                      min={0}
                      max={90}
                      step="0.5"
                      dir="ltr"
                      value={tier.percent}
                      onChange={(event) =>
                        update({
                          volumeTiers: form.volumeTiers.map((entry, at) =>
                            at === index
                              ? { ...entry, percent: Number(event.target.value) }
                              : entry,
                          ),
                        })
                      }
                    />
                  </label>
                  <div className="actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        update({ volumeTiers: form.volumeTiers.filter((_, at) => at !== index) })
                      }
                    >
                      {c('delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {form.volumeTiers.length < MAX_TIERS ? (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  const top = Math.max(1, ...form.volumeTiers.map((tier) => tier.minItems));
                  update({
                    volumeTiers: [
                      ...form.volumeTiers,
                      { minItems: Math.min(100, top + 1), percent: 5 },
                    ],
                  });
                }}
              >
                {t('addTier')}
              </button>
            ) : null}

            <div className="promo-form">
              <label className="field">
                <span>{t('licenceNumber')}</span>
                <input
                  dir="ltr"
                  value={form.volumeLicenceNumber}
                  maxLength={100}
                  onChange={(event) => update({ volumeLicenceNumber: event.target.value })}
                />
                <small className={licenceMissing ? 'bad' : undefined}>{t('licenceHint')}</small>
              </label>
            </div>
          </section>

          {/* --- pairs ------------------------------------------------------- */}
          <section className="offers-section">
            <h2>{t('pairsTitle')}</h2>
            <p className="lede-sm">{t('pairsLede')}</p>
            <label className="field offers-filter">
              <span>{t('filterProducts')}</span>
              <input
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
            {form.pairs.length === 0 ? <p className="notice">{t('noPairs')}</p> : null}
            <ul className="offers-rows">
              {form.pairs.map((pair, index) => (
                <li key={index} className="offers-pair">
                  <label className="field">
                    <span>{t('pairProduct')}</span>
                    <ProductSelect
                      value={pair.productId}
                      choices={productChoices}
                      nameOf={nameOf}
                      placeholder={t('pickProduct')}
                      onChange={(id) => setPair(index, { productId: id })}
                    />
                  </label>
                  <div className="field">
                    <span>{t('pairSuggests')}</span>
                    {pair.suggestProductIds.map((id, at) => (
                      <div key={at} className="offers-inline">
                        <ProductSelect
                          value={id}
                          choices={productChoices}
                          nameOf={nameOf}
                          placeholder={t('pickProduct')}
                          onChange={(next) =>
                            setPair(index, {
                              suggestProductIds: pair.suggestProductIds.map((entry, k) =>
                                k === at ? next : entry,
                              ),
                            })
                          }
                        />
                        <button
                          type="button"
                          className="ghost"
                          onClick={() =>
                            setPair(index, {
                              suggestProductIds: pair.suggestProductIds.filter((_, k) => k !== at),
                            })
                          }
                        >
                          {c('delete')}
                        </button>
                      </div>
                    ))}
                    {pair.suggestProductIds.length < MAX_SUGGESTIONS ? (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() =>
                          setPair(index, { suggestProductIds: [...pair.suggestProductIds, ''] })
                        }
                      >
                        {t('addSuggestion')}
                      </button>
                    ) : null}
                  </div>
                  <label className="field">
                    <span>{t('pairPercent')}</span>
                    <input
                      type="number"
                      min={0}
                      max={90}
                      step="0.5"
                      dir="ltr"
                      value={pair.discountPercent}
                      onChange={(event) =>
                        setPair(index, { discountPercent: Number(event.target.value) })
                      }
                    />
                    <small>{t('pairPercentHint')}</small>
                  </label>
                  <div className="actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => update({ pairs: form.pairs.filter((_, at) => at !== index) })}
                    >
                      {t('removePair')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="ghost"
              onClick={() =>
                update({
                  pairs: [
                    ...form.pairs,
                    { productId: '', suggestProductIds: [''], discountPercent: 0 },
                  ],
                })
              }
            >
              {t('addPair')}
            </button>
          </section>

          {/* --- where ------------------------------------------------------- */}
          <section className="offers-section">
            <h2>{t('whereTitle')}</h2>
            {(
              [
                ['showAfterAddToCart', 'showAfterAdd'],
                ['showInCart', 'showInCart'],
                ['showOnConfirmation', 'showOnConfirmation'],
                ['showProgressBar', 'showProgressBar'],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="check">
                <input
                  type="checkbox"
                  checked={form[field]}
                  onChange={(event) => update({ [field]: event.target.checked })}
                />
                <span>{t(label)}</span>
              </label>
            ))}
          </section>

          <div className="actions">
            <button type="submit" disabled={busy || blocked}>
              {busy ? c('busy') : c('save')}
            </button>
            {saved ? <span className="ok-note">{t('saved')}</span> : null}
          </div>
        </form>
      ) : null}
    </Nav>
  );
}

function ProductSelect({
  value,
  choices,
  nameOf,
  placeholder,
  onChange,
}: {
  value: string;
  choices: { id: string; label: string; status: string }[];
  nameOf: (id: string) => string;
  placeholder: string;
  onChange: (id: string) => void;
}) {
  // The chosen product stays listed even when the filter would hide it, so a
  // filter never looks as if it cleared a saved choice.
  const listed =
    value && !choices.some((choice) => choice.id === value)
      ? [{ id: value, label: nameOf(value), status: '' }, ...choices]
      : choices;
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {listed.map((choice) => (
        <option key={choice.id} value={choice.id}>
          {choice.status && choice.status !== 'PUBLISHED'
            ? `${choice.label} (${choice.status})`
            : choice.label}
        </option>
      ))}
    </select>
  );
}
