'use client';

import type { CreateProductLink, ProductLinks } from '@da/contracts';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api } from '../../lib/api';

/**
 * What is shown alongside this product.
 *
 * `ProductRelation` has existed since the first migration and has never held a
 * row. That is why the checkout's cross-sell falls back to guessing from what
 * is in the cart, and why the account page's "used alongside" reason is
 * written, translated, and has never once been shown to anybody.
 *
 * Four kinds, and only one of them does anything beyond navigation:
 * `CROSS_SELL` is what the checkout offers and the only kind that carries a
 * discount. The form says so rather than presenting four equal choices.
 */

const KINDS = ['RELATED', 'CROSS_SELL', 'UPGRADE', 'ACCESSORY'] as const;

export function LinksForm({
  slug,
  canWrite,
  onError,
}: {
  slug: string;
  canWrite: boolean;
  onError: (message: string) => void;
}) {
  const t = useT('products');
  const c = useT('common');
  const [data, setData] = useState<ProductLinks | null>(null);
  const [busy, setBusy] = useState(false);
  const [targetSlug, setTargetSlug] = useState('');
  const [kind, setKind] = useState<CreateProductLink['kind']>('RELATED');
  const [discount, setDiscount] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.productLinks(slug));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : c('actionFailed'));
    }
  }, [slug, onError, c]);

  useEffect(() => {
    void load();
  }, [load]);

  async function write(action: () => Promise<ProductLinks>): Promise<void> {
    setBusy(true);
    try {
      setData(await action());
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : c('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p className="meta">{c('loading')}</p>;

  const crossSell = kind === 'CROSS_SELL';

  return (
    <div className="links-form">
      <h3>{t('linksHeading')}</h3>
      <p className="lede-sm">{t('linksLede')}</p>

      {data.links.length === 0 ? (
        <p className="notice">{t('linksEmpty')}</p>
      ) : (
        <ul className="link-list">
          {data.links.map((link) => (
            <li key={link.id} className="link-row">
              <span className={`pill ${link.kind === 'CROSS_SELL' ? 'pill-ready' : 'pill-draft'}`}>
                {t(`kind_${link.kind}`)}
              </span>
              <div className="link-what">
                <strong>{link.targetName}</strong>
                <span className="slug" dir="ltr">
                  {link.targetSlug}
                </span>
                {/* A link to a draft is a link to a 404, and the person who
                    made it is the only one who can notice. */}
                {link.targetPublished ? null : (
                  <span className="meta-warn">{t('linkUnpublished')}</span>
                )}
              </div>
              {link.bundleDiscountPercent ? (
                <span className="link-discount">−{link.bundleDiscountPercent}%</span>
              ) : null}
              {canWrite ? (
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => void write(() => api.removeProductLink(link.id))}
                >
                  {c('delete')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <div className="link-add">
          <label className="grow">
            <span>{t('linkTarget')}</span>
            <input
              id={`link-target-${slug}`}
              type="text"
              dir="ltr"
              placeholder="windows-11-pro"
              value={targetSlug}
              onChange={(event) => setTargetSlug(event.target.value)}
            />
          </label>
          <label>
            <span>{t('linkKind')}</span>
            <select
              id={`link-kind-${slug}`}
              value={kind}
              onChange={(event) => {
                const next = event.target.value as CreateProductLink['kind'];
                setKind(next);
                // A discount on anything but a cross-sell is refused by the
                // server; clearing it here means the refusal never happens.
                if (next !== 'CROSS_SELL') setDiscount('');
              }}
            >
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`kind_${value}`)}
                </option>
              ))}
            </select>
          </label>
          {crossSell ? (
            <label>
              <span>{t('linkDiscount')}</span>
              <input
                id={`link-discount-${slug}`}
                type="text"
                inputMode="decimal"
                dir="ltr"
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
              />
              <small>{t('linkDiscountHint')}</small>
            </label>
          ) : null}
          <button
            type="button"
            disabled={busy || targetSlug.trim().length < 2}
            onClick={() =>
              void write(async () => {
                const next = await api.addProductLink(slug, {
                  targetSlug: targetSlug.trim(),
                  kind,
                  bundleDiscountPercent: discount.trim(),
                });
                setTargetSlug('');
                setDiscount('');
                return next;
              })
            }
          >
            {t('addLink')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
