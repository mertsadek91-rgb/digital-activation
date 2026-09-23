import type { CatalogFacets } from '@da/contracts';
import Form from 'next/form';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { type FormatT, formatPlatform, formatWholeAmount } from '../lib/format';
import {
  type ListingFilters,
  type ListingSort,
  type ListingState,
  LISTING_SORTS,
  NO_FILTERS,
  filterCount,
  isFiltered,
  listingHref,
  visibleOptions,
  without,
} from '../lib/listing';

import { FilterDrawer } from './filter-drawer';

/**
 * The catalogue's filters, sort and active-filter chips, shared by the store,
 * collection and brand pages.
 *
 * Everything here is a link or a GET form, so every state is a URL that works
 * with JavaScript switched off and that a shopper can share; the drawer adds
 * behaviour on top and nothing else. `path` carries the locale prefix already.
 */

type FiltersT = Awaited<ReturnType<typeof getTranslations<'filters'>>>;

function priceLabel(band: CatalogFacets['price'][number], t: FiltersT): string {
  const min = formatWholeAmount(band.min, band.currency);
  if (band.max === null) return t('priceOver', { min });
  const max = formatWholeAmount(band.max, band.currency);
  if (band.minUsd === 0) return t('priceUnder', { max });
  return t('priceBetween', { min, max });
}

/**
 * Whether a group is worth showing.
 *
 * Selected: always, or it could not be unticked. Otherwise only when one of
 * its options would narrow the list — every product here is a Windows product
 * on some shelves, and a "Windows (12)" box over twelve results is a box that
 * does nothing.
 */
function worthShowing(options: readonly { count: number }[], total: number, selected: boolean) {
  return selected || options.some((option) => option.count > 0 && option.count < total);
}

export async function ListingFilterPanel({
  facets,
  state,
  path,
  total,
}: {
  facets: CatalogFacets;
  state: ListingState;
  path: string;
  total: number;
}) {
  const t = await getTranslations('filters');
  const tf: FormatT = await getTranslations('format');
  const f = state.filters;

  const brands = visibleOptions(facets.brand, (o) => f.brand.includes(o.value));
  const platforms = visibleOptions(facets.platform, (o) => f.platform.includes(o.value));
  const terms = visibleOptions(facets.term, (o) => f.term.includes(o.value));
  const devices = visibleOptions(facets.devices, (o) => f.devices.includes(o.value));
  const prices = visibleOptions(facets.price, (o) => f.price === o.key);

  const groups: { key: string; legend: string; body: ReactNode }[] = [];

  const checkboxes = <T extends { value: string; count: number }>(
    name: keyof ListingFilters,
    options: readonly T[],
    selected: readonly string[],
    label: (option: T) => string,
  ) => (
    <ul>
      {options.map((option) => (
        <li key={option.value}>
          <label>
            <input
              type="checkbox"
              name={name}
              value={option.value}
              defaultChecked={selected.includes(option.value)}
            />
            <span className="filter-label">{label(option)}</span>
            <span className="filter-count">{option.count}</span>
          </label>
        </li>
      ))}
    </ul>
  );

  if (worthShowing(brands, total, f.brand.length > 0)) {
    groups.push({
      key: 'brand',
      legend: t('brand'),
      body: checkboxes('brand', brands, f.brand, (o) => o.label),
    });
  }
  if (worthShowing(platforms, total, f.platform.length > 0)) {
    groups.push({
      key: 'platform',
      legend: t('platform'),
      body: checkboxes('platform', platforms, f.platform, (o) => formatPlatform(o.value, tf)),
    });
  }
  if (worthShowing(terms, total, f.term.length > 0)) {
    groups.push({
      key: 'term',
      legend: t('term'),
      body: checkboxes('term', terms, f.term, (o) => t(`termOption.${o.value}`)),
    });
  }
  if (worthShowing(devices, total, f.devices.length > 0)) {
    groups.push({
      key: 'devices',
      legend: t('devices'),
      body: checkboxes('devices', devices, f.devices, (o) => t(`devicesOption.${o.value}`)),
    });
  }
  if (worthShowing(prices, total, f.price !== null)) {
    const currency = facets.price[0]?.currency ?? 'USD';
    groups.push({
      key: 'price',
      legend: t('price'),
      body: (
        <>
          <ul>
            <li>
              <label>
                {/* Empty value rather than no name: a radio group cannot be
                    unticked, so "any" has to be one of its options. */}
                <input type="radio" name="price" value="" defaultChecked={f.price === null} />
                <span className="filter-label">{t('priceAny')}</span>
              </label>
            </li>
            {prices.map((band) => (
              <li key={band.key}>
                <label>
                  <input
                    type="radio"
                    name="price"
                    value={band.key}
                    defaultChecked={f.price === band.key}
                  />
                  <span className="filter-label">{priceLabel(band, t)}</span>
                  <span className="filter-count">{band.count}</span>
                </label>
              </li>
            ))}
          </ul>
          {currency !== 'USD' ? <p className="filter-note">{t('priceNote')}</p> : null}
        </>
      ),
    });
  }

  const inStock = worthShowing([{ count: facets.inStock }], total, f.inStock);
  const onSale = worthShowing([{ count: facets.onSale }], total, f.onSale);
  if (inStock || onSale) {
    groups.push({
      key: 'availability',
      legend: t('availability'),
      body: (
        <ul>
          {inStock ? (
            <li>
              <label>
                <input type="checkbox" name="inStock" value="1" defaultChecked={f.inStock} />
                <span className="filter-label">{t('inStock')}</span>
                <span className="filter-count">{facets.inStock}</span>
              </label>
            </li>
          ) : null}
          {onSale ? (
            <li>
              <label>
                <input type="checkbox" name="onSale" value="1" defaultChecked={f.onSale} />
                <span className="filter-label">{t('onSale')}</span>
                <span className="filter-count">{facets.onSale}</span>
              </label>
            </li>
          ) : null}
        </ul>
      ),
    });
  }

  // Nothing to choose between on this shelf, and nothing chosen: no panel.
  if (groups.length === 0) return null;

  return (
    <FilterDrawer
      id="filters"
      buttonLabel={t('button', { count: filterCount(f) })}
      title={t('title')}
      closeLabel={t('close')}
    >
      {/* `scroll={false}`: ticking a box on the sidebar should not throw the
          shopper back to the top of the page they are looking at. */}
      {/* Keyed by the URL: the boxes are uncontrolled (`defaultChecked`), so
          after a chip or "clear all" navigates, a remount is what makes the
          ticks match the page rather than the last thing clicked. */}
      <Form key={listingHref(path, state)} action={path} scroll={false} className="filter-form">
        {state.sort !== 'position' ? <input type="hidden" name="sort" value={state.sort} /> : null}
        {groups.map((group) => (
          <fieldset key={group.key} className="filter-group">
            <legend>{group.legend}</legend>
            {group.body}
          </fieldset>
        ))}
        <div className="filter-actions">
          <button type="submit" className="btn btn-primary">
            {t('apply')}
          </button>
          {isFiltered(f) ? (
            <Link href={listingHref(path, state, { filters: NO_FILTERS })}>{t('clearAll')}</Link>
          ) : null}
        </div>
      </Form>
    </FilterDrawer>
  );
}

/** The selections, each removable on its own, and a way out of all of them. */
export async function ListingChips({
  facets,
  state,
  path,
}: {
  facets: CatalogFacets | null;
  state: ListingState;
  path: string;
}) {
  const f = state.filters;
  if (!isFiltered(f)) return null;
  const t = await getTranslations('filters');
  const tf: FormatT = await getTranslations('format');

  const chips: { key: string; label: string; next: ListingFilters }[] = [
    ...f.brand.map((slug) => ({
      key: `brand:${slug}`,
      label: facets?.brand.find((o) => o.value === slug)?.label ?? slug,
      next: without(f, 'brand', slug),
    })),
    ...f.platform.map((value) => ({
      key: `platform:${value}`,
      label: formatPlatform(value, tf),
      next: without(f, 'platform', value),
    })),
    ...f.term.map((value) => ({
      key: `term:${value}`,
      label: t(`termOption.${value}`),
      next: without(f, 'term', value),
    })),
    ...f.devices.map((value) => ({
      key: `devices:${value}`,
      label: t(`devicesOption.${value}`),
      next: without(f, 'devices', value),
    })),
  ];
  const band = facets?.price.find((o) => o.key === f.price);
  if (f.price) {
    chips.push({
      key: 'price',
      label: band ? priceLabel(band, t) : t('price'),
      next: without(f, 'price'),
    });
  }
  if (f.inStock) chips.push({ key: 'inStock', label: t('inStock'), next: without(f, 'inStock') });
  if (f.onSale) chips.push({ key: 'onSale', label: t('onSale'), next: without(f, 'onSale') });

  return (
    <nav className="filter-chips" aria-label={t('active')}>
      <ul>
        {chips.map((chip) => (
          <li key={chip.key}>
            <Link
              href={listingHref(path, state, { filters: chip.next })}
              aria-label={t('remove', { label: chip.label })}
            >
              <span>{chip.label}</span>
              <span aria-hidden="true">×</span>
            </Link>
          </li>
        ))}
        <li>
          <Link
            className="filter-chips-clear"
            href={listingHref(path, state, { filters: NO_FILTERS })}
          >
            {t('clearAll')}
          </Link>
        </li>
      </ul>
    </nav>
  );
}

/**
 * The sort links. Links, not a `<select>`: each order is a real URL and needs
 * no JavaScript. The filters ride along, the page goes back to 1.
 */
export async function ListingSorts({
  state,
  path,
  positionLabel,
}: {
  state: ListingState;
  path: string;
  /** What the default order is on this page: "most popular" or "featured". */
  positionLabel: string;
}) {
  const t = await getTranslations('filters');
  const tk = await getTranslations('catalog');
  const ts = await getTranslations('store');
  const labels: Record<ListingSort, string> = {
    position: positionLabel,
    newest: ts('sortNewest'),
    'price-asc': t('sortPriceAsc'),
    'price-desc': t('sortPriceDesc'),
  };

  return (
    <nav className="sorts" aria-label={tk('sort')}>
      {LISTING_SORTS.map((option) => (
        <Link
          key={option}
          href={listingHref(path, state, { sort: option })}
          className={option === state.sort ? 'is-active' : undefined}
          aria-current={option === state.sort ? 'true' : undefined}
        >
          {labels[option]}
        </Link>
      ))}
    </nav>
  );
}

/** What an empty filtered result says, with the way back. */
export async function ListingNoResults({ state, path }: { state: ListingState; path: string }) {
  const t = await getTranslations('filters');
  return (
    <div className="empty">
      <p>
        <strong>{t('noResults')}</strong> {t('noResultsHint')}
      </p>
      <Link href={listingHref(path, state, { filters: NO_FILTERS })}>{t('clearAll')}</Link>
    </div>
  );
}
