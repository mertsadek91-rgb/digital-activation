'use client';

import type {
  OfferCatalogOptions,
  OfferStats,
  SalePreview,
  SeasonalSale,
  SeasonalSettings,
} from '@da/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAdminLocale, useT } from '../../../i18n/provider';
import { api, ApiError } from '../../../lib/api';
import { offersApi } from '../../../lib/offers-api';
import { messageOf, useStaff } from '../../content/shared';
import { Nav } from '../../nav';
import { OfferStatsPanel } from '../offer-stats';
import { MARKETING_ROLES } from '../page';
import { fromZonedInput, toZonedInput } from '../zoned-time';

import '../offers-admin.css';

type Phase = 'scheduled' | 'live' | 'ended';

function phaseOf(sale: SeasonalSale, now: number): Phase {
  if (new Date(sale.endsAt).getTime() <= now) return 'ended';
  if (new Date(sale.startsAt).getTime() <= now) return 'live';
  return 'scheduled';
}

/** A sale that still matters and would show a discount without its licence number. */
function missingLicence(sale: SeasonalSale, now: number): boolean {
  return sale.percent > 0 && sale.licenceNumber.trim() === '' && phaseOf(sale, now) !== 'ended';
}

/**
 * التخفيضات الموسمية — scheduled sales.
 *
 * A sale lowers the price itself, everywhere the price shows, between its
 * start and end in the store's time zone; the real current price is the
 * struck-through one, and it comes back when the sale ends — cart lines added
 * during the sale included. The one save this screen refuses is switching
 * sales on while a running or upcoming sale has no discount licence number:
 * a price reduction shown in Saudi Arabia needs one beside it.
 */
export default function SeasonalPage() {
  const router = useRouter();
  const me = useStaff();
  const t = useT('marketingSeasonal');
  const c = useT('common');
  const locale = useAdminLocale();

  const [form, setForm] = useState<SeasonalSettings | null>(null);
  const [options, setOptions] = useState<OfferCatalogOptions | null>(null);
  const [stats, setStats] = useState<OfferStats | null>(null);
  const [editing, setEditing] = useState<SeasonalSale | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = Date.now();

  const load = useCallback(async () => {
    try {
      const [settings, catalog] = await Promise.all([api.marketingSettings(), offersApi.options()]);
      setForm(settings.seasonal);
      setOptions(catalog);
      setError(null);
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

  if (!me) return <div className="admin-layout">{c('loading')}</div>;
  if (!MARKETING_ROLES.includes(me.role)) {
    return (
      <Nav me={me} current="marketing">
        <p className="notice">{t('noAccess')}</p>
      </Nav>
    );
  }

  const unlicensed = form?.sales.filter((sale) => missingLicence(sale, now)) ?? [];
  const nameOf = (sale: SeasonalSale): string =>
    (locale === 'en' ? sale.name.en : sale.name.ar) || sale.name.ar || sale.name.en || sale.id;

  /** Saves the whole document; the only way sales reach the store. */
  async function persist(next: SeasonalSettings): Promise<boolean> {
    if (next.enabled && next.sales.some((sale) => missingLicence(sale, Date.now()))) {
      setError(t('licenceBlocksEnable'));
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      setForm(await api.setMarketingSettings('seasonal', next));
      setSaved(true);
      return true;
    } catch (caught) {
      setError(messageOf(caught, c('actionFailed')));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const timeZone = options?.timeZone ?? 'Asia/Riyadh';

  return (
    <Nav me={me} current="marketing">
      <div className="queue-head">
        <p className="who">
          <Link href="/marketing">{t('back')}</Link>
        </p>
        <h1>{t('title')}</h1>
        <p className="who">{t('lede')}</p>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {stats ? <OfferStatsPanel stats={stats} show={['sale']} /> : null}

      {form && options ? (
        <>
          {unlicensed.length > 0 ? (
            <p className="offers-alarm" role="alert">
              {t('licenceMissingList', { names: unlicensed.map(nameOf).join('، ') })}
            </p>
          ) : null}

          <div className="offers-section">
            <label className="check">
              <input
                type="checkbox"
                checked={form.enabled}
                disabled={busy || (!form.enabled && unlicensed.length > 0)}
                onChange={(event) => void persist({ ...form, enabled: event.target.checked })}
              />
              <span>{t('enabled')}</span>
            </label>
            <p className="lede-sm">{t('enabledHint', { zone: timeZone })}</p>
            {saved ? <span className="ok-note">{t('saved')}</span> : null}
          </div>

          <section className="offers-section">
            <h2>{t('listTitle')}</h2>
            {form.sales.length === 0 ? <p className="notice">{t('none')}</p> : null}
            <ul className="offers-rows">
              {[...form.sales]
                .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
                .map((sale) => {
                  const phase = phaseOf(sale, now);
                  return (
                    <li key={sale.id} className="offers-sale">
                      <div>
                        <strong>{nameOf(sale)}</strong>{' '}
                        <span
                          className={`pill ${phase === 'live' ? 'pill-published' : phase === 'ended' ? 'pill-draft' : 'pill-ready'}`}
                        >
                          {t(phase)}
                        </span>
                        <p className="lede-sm" dir="ltr">
                          {toZonedInput(sale.startsAt, timeZone).replace('T', ' ')} →{' '}
                          {toZonedInput(sale.endsAt, timeZone).replace('T', ' ')} ({timeZone})
                        </p>
                        <p className="lede-sm">
                          {t('summary', {
                            percent: sale.percent,
                            scope:
                              sale.productIds.length === 0 && sale.categoryIds.length === 0
                                ? t('scopeAll')
                                : t('scopeCount', {
                                    products: sale.productIds.length,
                                    categories: sale.categoryIds.length,
                                  }),
                          })}
                        </p>
                        {missingLicence(sale, now) ? (
                          <p className="offers-alarm">{t('licenceMissing')}</p>
                        ) : null}
                      </div>
                      <div className="actions">
                        <button type="button" className="ghost" onClick={() => setEditing(sale)}>
                          {c('edit')}
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm(t('confirmDelete', { name: nameOf(sale) }))) return;
                            void persist({
                              ...form,
                              sales: form.sales.filter((entry) => entry.id !== sale.id),
                            });
                          }}
                        >
                          {c('delete')}
                        </button>
                      </div>
                    </li>
                  );
                })}
            </ul>
            {editing === null ? (
              <button type="button" onClick={() => setEditing(blankSale())}>
                {t('add')}
              </button>
            ) : null}
          </section>

          {editing ? (
            <SaleEditor
              key={editing.id}
              sale={editing}
              options={options}
              timeZone={timeZone}
              busy={busy}
              onCancel={() => setEditing(null)}
              onSave={async (sale) => {
                const exists = form.sales.some((entry) => entry.id === sale.id);
                const ok = await persist({
                  ...form,
                  sales: exists
                    ? form.sales.map((entry) => (entry.id === sale.id ? sale : entry))
                    : [...form.sales, sale],
                });
                if (ok) setEditing(null);
              }}
            />
          ) : null}
        </>
      ) : null}
    </Nav>
  );
}

function blankSale(): SeasonalSale {
  const start = new Date();
  start.setUTCHours(start.getUTCHours() + 24, 0, 0, 0);
  const end = new Date(start.getTime() + 7 * 24 * 3600 * 1000);
  return {
    id: `sale-${Date.now().toString(36)}`,
    name: { ar: '', en: '' },
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    percent: 10,
    productIds: [],
    categoryIds: [],
    licenceNumber: '',
    showCountdown: false,
  };
}

function SaleEditor({
  sale,
  options,
  timeZone,
  busy,
  onCancel,
  onSave,
}: {
  sale: SeasonalSale;
  options: OfferCatalogOptions;
  timeZone: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (sale: SeasonalSale) => Promise<void>;
}) {
  const t = useT('marketingSeasonal');
  const c = useT('common');
  const locale = useAdminLocale();
  const [draft, setDraft] = useState(sale);
  const [starts, setStarts] = useState(toZonedInput(sale.startsAt, timeZone));
  const [ends, setEnds] = useState(toZonedInput(sale.endsAt, timeZone));
  const [scope, setScope] = useState<'all' | 'categories' | 'products'>(
    sale.productIds.length > 0 ? 'products' : sale.categoryIds.length > 0 ? 'categories' : 'all',
  );
  const [filter, setFilter] = useState('');
  const [preview, setPreview] = useState<SalePreview | null>(null);

  const startsIso = fromZonedInput(starts, timeZone);
  const endsIso = fromZonedInput(ends, timeZone);
  const badDates = !startsIso || !endsIso || endsIso <= startsIso;
  const noLicence = draft.percent > 0 && draft.licenceNumber.trim() === '';

  const productIds = scope === 'products' ? draft.productIds : [];
  const categoryIds = scope === 'categories' ? draft.categoryIds : [];
  const scopeKey = `${scope}|${productIds.join(',')}|${categoryIds.join(',')}`;

  // The count comes from the API's own matcher, so it is the number the
  // storefront will price — categories include everything beneath them.
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      offersApi.salePreview({ productIds, categoryIds }).then(
        (result) => {
          if (live) setPreview(result);
        },
        () => {
          if (live) setPreview(null);
        },
      );
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // Keyed on the scope's contents rather than on the arrays, which are new every render.
  }, [scopeKey]);

  const label = (entry: { nameAr: string; nameEn: string | null }): string =>
    (locale === 'en' ? entry.nameEn : null) ?? entry.nameAr;
  const needle = filter.trim().toLowerCase();
  const matches = (entry: { slug: string; nameAr: string; nameEn: string | null }): boolean =>
    !needle ||
    entry.slug.includes(needle) ||
    entry.nameAr.toLowerCase().includes(needle) ||
    (entry.nameEn ?? '').toLowerCase().includes(needle);

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];

  const categoryDepth = useMemo(() => {
    const parent = new Map(options.categories.map((entry) => [entry.id, entry.parentId]));
    return (id: string): number => {
      let depth = 0;
      let at = parent.get(id) ?? null;
      while (at && depth < 6) {
        depth += 1;
        at = parent.get(at) ?? null;
      }
      return depth;
    };
  }, [options]);

  return (
    <form
      className="offers-section offers-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (badDates || !startsIso || !endsIso) return;
        void onSave({
          ...draft,
          startsAt: startsIso,
          endsAt: endsIso,
          productIds,
          categoryIds,
        });
      }}
    >
      <h2>{t('editorTitle')}</h2>

      <div className="promo-form">
        <label className="field">
          <span>{t('nameAr')}</span>
          <input
            value={draft.name.ar}
            maxLength={500}
            onChange={(event) =>
              setDraft({ ...draft, name: { ...draft.name, ar: event.target.value } })
            }
          />
        </label>
        <label className="field">
          <span>{t('nameEn')}</span>
          <input
            dir="ltr"
            value={draft.name.en}
            maxLength={500}
            onChange={(event) =>
              setDraft({ ...draft, name: { ...draft.name, en: event.target.value } })
            }
          />
        </label>
        <label className="field">
          <span>{t('startsAt', { zone: timeZone })}</span>
          <input
            type="datetime-local"
            value={starts}
            onChange={(event) => setStarts(event.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('endsAt', { zone: timeZone })}</span>
          <input
            type="datetime-local"
            value={ends}
            onChange={(event) => setEnds(event.target.value)}
          />
          {badDates ? <small className="bad">{t('badDates')}</small> : null}
        </label>
        <label className="field">
          <span>{t('percent')}</span>
          <input
            type="number"
            min={0}
            max={90}
            step="0.5"
            dir="ltr"
            value={draft.percent}
            onChange={(event) => setDraft({ ...draft, percent: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span>{t('licenceNumber')}</span>
          <input
            dir="ltr"
            value={draft.licenceNumber}
            maxLength={100}
            onChange={(event) => setDraft({ ...draft, licenceNumber: event.target.value })}
          />
          <small className={noLicence ? 'bad' : undefined}>
            {noLicence ? t('licenceMissing') : t('licenceHint')}
          </small>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.showCountdown}
            onChange={(event) => setDraft({ ...draft, showCountdown: event.target.checked })}
          />
          <span>{t('showCountdown')}</span>
        </label>
      </div>

      <fieldset className="offers-scope">
        <legend>{t('scope')}</legend>
        {(['all', 'categories', 'products'] as const).map((value) => (
          <label key={value} className="check">
            <input
              type="radio"
              name="scope"
              checked={scope === value}
              onChange={() => setScope(value)}
            />
            <span>
              {t(
                value === 'all'
                  ? 'scopeAll'
                  : value === 'categories'
                    ? 'scopeCategories'
                    : 'scopeProducts',
              )}
            </span>
          </label>
        ))}

        {scope !== 'all' ? (
          <label className="field offers-filter">
            <span>{t('filter')}</span>
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
        ) : null}

        {scope === 'categories' ? (
          <ul className="offers-picks">
            {options.categories.filter(matches).map((category) => (
              <li
                key={category.id}
                style={{ paddingInlineStart: `${String(categoryDepth(category.id) * 16)}px` }}
              >
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.categoryIds.includes(category.id)}
                    onChange={() =>
                      setDraft({ ...draft, categoryIds: toggle(draft.categoryIds, category.id) })
                    }
                  />
                  <span>{label(category)}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}

        {scope === 'products' ? (
          <ul className="offers-picks">
            {options.products.filter(matches).map((product) => (
              <li key={product.id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.productIds.includes(product.id)}
                    onChange={() =>
                      setDraft({ ...draft, productIds: toggle(draft.productIds, product.id) })
                    }
                  />
                  <span>
                    {label(product)}
                    {product.status !== 'PUBLISHED' ? ` (${product.status})` : ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="lede-sm">
          {preview ? t('previewCount', { products: preview.products, of: preview.of }) : '…'}
        </p>
        {preview && preview.products === 0 ? (
          <p className="offers-alarm">{t('previewEmpty')}</p>
        ) : null}
      </fieldset>

      <div className="actions">
        <button type="submit" disabled={busy || badDates}>
          {busy ? c('busy') : c('save')}
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          {c('cancel')}
        </button>
      </div>
    </form>
  );
}
