'use client';

import type { AdminProductList, AdminProductRow, StaffMe } from '@da/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api, ApiError } from '../../lib/api';
import { Nav } from '../nav';
import { NewProductForm } from './new-product-form';

/**
 * Product list.
 *
 * A tool rather than a document, so the summary comes before the detail: the
 * count chips at the top are also the filters, because "39 blocked" is only
 * useful if one click shows which 39.
 *
 * State is encoded in shape as well as in number — a status pill, a blocker
 * count, a zero-stock cell — so what needs attention reads at a glance instead
 * of having to be counted.
 *
 * Each row has one button, and it opens the product's own page. The row used
 * to carry eight — copy, steps, images, description, terms, identity, links,
 * stock — each unfolding a drawer under it inside the table, one at a time.
 * Editing a product meant finding the right button out of eight, and the
 * table was seventy rows of buttons. Everything those drawers held is now on
 * one page per product, all of it open at once.
 */
const FILTERS = [
  { key: 'all', label: 'filterAll' },
  { key: 'draft', label: 'filterDraft' },
  /**
   * The chip this screen was missing.
   *
   * "محجوبة" answers what needs work. Nothing answered what needs a decision —
   * and the catalog was sitting on 30 drafts that were priced, described,
   * categorised and imaged, with the publish gate ready to accept every one of
   * them. Two products were live out of 73. That is not a content problem and
   * the panel was not saying it was anything at all.
   */
  { key: 'ready', label: 'filterReady' },
  { key: 'published', label: 'filterPublished' },
  { key: 'out-of-stock', label: 'filterOutOfStock' },
  { key: 'blocked', label: 'filterBlocked' },
] as const;

/**
 * The editor's address for a product.
 *
 * Not exported: Next treats every named export of a `page.tsx` as a route
 * option and refuses the build over one it does not know.
 */
function productHref(slug: string): string {
  return `/products/${encodeURIComponent(slug)}`;
}

export default function ProductsPage() {
  const router = useRouter();
  const t = useT('products');
  const c = useT('common');
  const [me, setMe] = useState<StaffMe | null>(null);
  const [data, setData] = useState<AdminProductList | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  /**
   * Which language the gate is being read in.
   *
   * Not cosmetic. The gate is assessed per locale and this screen sent `ar` and
   * only `ar`, so the one thing it could never tell you is the thing that is
   * actually true of this catalog: all 73 English translations are missing both
   * SEO fields. Switching here changes the blocker counts and what bulk
   * publishing is refused for, together — a gate that disagreed with the
   * screen it is drawn on would be worse than no gate.
   */
  const [locale, setLocale] = useState<'ar' | 'en'>('ar');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.products({ status: filter, q: query || undefined, locale }));
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [filter, query, locale, router, t]);

  useEffect(() => {
    void (async () => {
      try {
        const staff = await api.me();
        // Nothing else on this page would load anyway: the API refuses every
        // route while the account is on its generated password.
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

  const canWrite = me !== null && ['OWNER', 'ADMIN', 'CATALOG'].includes(me.role);

  /**
   * Publish every draft the gate would accept, one call at a time.
   *
   * Sequential rather than batched, and through the same endpoint the single
   * button uses, so each product passes the gate on its own and each one writes
   * its own audit row. A bulk endpoint would be faster and would also be a
   * second publish path that could disagree with the first about what "ready"
   * means — which is the class of bug that puts a product with no price on a
   * live shop.
   *
   * Confirmed by name and number first. This is the one control on the panel
   * that changes what the shop sells, for many products at once, and it is not
   * something to discover by clicking.
   */
  async function publishReady() {
    const rows = (data?.rows ?? []).filter((row) => row.status === 'DRAFT' && row.blockers === 0);
    if (rows.length === 0) return;
    if (
      !window.confirm(
        [
          t('bulkConfirmHead', { count: rows.length }),
          '',
          ...rows.slice(0, 8).map((row) => `· ${row.nameAr}`),
          ...(rows.length > 8 ? [t('bulkConfirmMore', { count: rows.length - 8 })] : []),
          '',
          t('bulkConfirmTail'),
        ].join('\n'),
      )
    ) {
      return;
    }

    setBulk({ done: 0, total: rows.length });
    setError(null);
    const failed: string[] = [];
    for (const [index, row] of rows.entries()) {
      try {
        await api.setStatus(row.slug, 'PUBLISHED', locale);
      } catch (caught) {
        // One refusal does not stop the rest: the gate is per product, and
        // stopping would leave the run half done with no record of where.
        failed.push(
          caught instanceof ApiError && caught.blockers.length > 0
            ? `${row.slug} (${caught.blockers.join(', ')})`
            : row.slug,
        );
      }
      setBulk({ done: index + 1, total: rows.length });
    }
    setBulk(null);
    if (failed.length > 0) {
      setError(t('bulkFailed', { count: failed.length, slugs: failed.slice(0, 5).join(' · ') }));
    }
    await load();
  }

  if (!me) return <div className="admin-layout">{c('loading')}</div>;

  return (
    <Nav me={me} current="products">
      <div className="queue-head">
        <h1>{t('title')}</h1>
        {/* OWNER and ADMIN only: adding a row to the catalog is not the same
            decision as correcting a price on one already there. */}
        {['OWNER', 'ADMIN'].includes(me.role) && !adding ? (
          <button type="button" onClick={() => setAdding(true)}>
            {t('newProduct')}
          </button>
        ) : null}
      </div>

      {adding ? (
        <NewProductForm
          // Straight to the new product's page: the six fields here make it
          // exist, and everything that makes it sellable is written there.
          onCreated={(slug) => router.push(productHref(slug))}
          onError={setError}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      <nav className="chips">
        {FILTERS.map((entry) => {
          const count = data
            ? entry.key === 'all'
              ? data.counts.all
              : entry.key === 'draft'
                ? data.counts.draft
                : entry.key === 'ready'
                  ? data.counts.ready
                  : entry.key === 'published'
                    ? data.counts.published
                    : entry.key === 'out-of-stock'
                      ? data.counts.outOfStock
                      : data.counts.blocked
            : null;

          return (
            <button
              key={entry.key}
              type="button"
              className={`chip${filter === entry.key ? ' is-active' : ''}`}
              onClick={() => setFilter(entry.key)}
            >
              {t(entry.label)}
              {count === null ? null : <span className="chip-count">{count}</span>}
            </button>
          );
        })}

        <input
          type="search"
          value={query}
          placeholder={t('searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
          className="search"
        />

        <div className="locale-switch" role="group" aria-label={t('readinessLocaleLabel')}>
          {(['ar', 'en'] as const).map((code) => (
            <button
              key={code}
              type="button"
              className={`chip${locale === code ? ' is-active' : ''}`}
              aria-pressed={locale === code}
              onClick={() => setLocale(code)}
            >
              {code === 'ar' ? t('localeArabic') : t('localeEnglish')}
            </button>
          ))}
        </div>
      </nav>

      {error ? <p className="error">{error}</p> : null}

      {!canWrite ? <p className="notice">{t('roleReadonly', { role: me.role })}</p> : null}

      {/* Offered only on the list it acts on, so what it will publish is what
          is on screen. */}
      {canWrite && filter === 'ready' && (data?.counts.ready ?? 0) > 0 ? (
        <div className="bulk-bar">
          <p>{t('bulkReadyLede', { count: data?.counts.ready ?? 0 })}</p>
          <button type="button" disabled={bulk !== null} onClick={() => void publishReady()}>
            {bulk === null
              ? t('bulkPublishAll')
              : t('bulkPublishing', { done: bulk.done, total: bulk.total })}
          </button>
        </div>
      ) : null}

      <div className="table-scroll">
        <table className="admin-table products-table">
          <thead>
            <tr>
              <th>{t('colProduct')}</th>
              <th>{t('colStatus')}</th>
              <th className="num">{t('colVariants')}</th>
              <th className="num">{t('colStock')}</th>
              <th className="num">{t('colFrom')}</th>
              <th>{t('colReadiness')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((row) => (
              <ProductRow key={row.slug} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      {data && data.rows.length === 0 ? <p className="notice">{t('noResults')}</p> : null}
      {data ? (
        <p className="foot">{t('shownOfTotal', { shown: data.rows.length, total: data.total })}</p>
      ) : null}
    </Nav>
  );
}

function ProductRow({ row }: { row: AdminProductRow }) {
  const t = useT('products');
  const c = useT('common');
  const href = productHref(row.slug);

  return (
    <tr className={row.status === 'PUBLISHED' ? 'is-live' : undefined}>
      <td>
        {/* The name is the link as well as the button at the end of the row:
            the thing being opened is the thing to click on. */}
        <Link href={href} className="name-link">
          <span className="name" title={row.nameAr}>
            {row.nameAr}
          </span>
        </Link>
        <span className="slug" dir="ltr">
          {row.slug}
        </span>
        {row.brand ? <span className="meta">{row.brand}</span> : null}
      </td>
      <td>
        <span className={`pill pill-${row.status.toLowerCase()}`}>
          {row.status === 'PUBLISHED'
            ? t('statusPublished')
            : row.status === 'DRAFT'
              ? t('statusDraft')
              : row.status}
        </span>
      </td>
      <td className="num">{row.variantCount}</td>
      {/* A dash, not a zero. Most of this catalog is made to order, and a
          zero in a stock column reads as sold out. */}
      <td className={`num${row.stock === 0 ? ' is-zero' : ''}`}>
        {row.stock === null ? <span className="meta">{t('onDemand')}</span> : row.stock}
      </td>
      <td className="num">{row.priceFromUsd ? `$${row.priceFromUsd}` : '—'}</td>
      <td>
        {/* The pill opens the editor at its readiness section, where every
            blocker links to the field that clears it. */}
        <Link href={`${href}#section-readiness`} className="readiness-link">
          {row.blockers > 0 ? (
            <span className="pill pill-blocked">{t('blockerPill', { count: row.blockers })}</span>
          ) : (
            <span className="pill pill-ready">{t('readyPill')}</span>
          )}{' '}
          {row.warnings > 0 ? (
            <span className="warn">{t('warningCount', { count: row.warnings })}</span>
          ) : null}
        </Link>
        {/* The two zeros worth seeing from the list: no picture, and no
            activation steps. Both are a support ticket waiting to happen. */}
        {row.imageCount === 0 || row.activationSteps.ar === 0 ? (
          <span className="row-gaps">
            {row.imageCount === 0 ? <span className="warn">{t('gapNoImages')}</span> : null}
            {row.activationSteps.ar === 0 ? <span className="warn">{t('gapNoSteps')}</span> : null}
          </span>
        ) : null}
      </td>
      <td className="actions">
        <Link href={href} className="button-link">
          {c('edit')}
        </Link>
      </td>
    </tr>
  );
}
