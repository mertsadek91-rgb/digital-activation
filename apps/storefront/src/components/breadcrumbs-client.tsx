'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { ChevronRightIcon } from './icons';

/**
 * The kit's `breadcrumb` for the client pages — the cart, the checkout, an
 * order and the account, which run in the browser because what they show is
 * behind a cookie. Same markup as the server `Breadcrumbs`, read through
 * `useTranslations` instead of `getTranslations`.
 */
export function ClientBreadcrumbs({ items }: { items: { name: string; href: string }[] }) {
  const tc = useTranslations('common');
  if (items.length === 0) return null;

  return (
    <nav aria-label={tc('breadcrumb')} className="breadcrumb">
      <ol>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.href}-${String(index)}`}>
              {index > 0 ? (
                <span className="icon-flip breadcrumb-sep" aria-hidden="true">
                  <ChevronRightIcon size={14} />
                </span>
              ) : null}
              {last ? (
                <span aria-current="page">{item.name}</span>
              ) : (
                <Link href={item.href}>{item.name}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
