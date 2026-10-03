import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { ChevronRightIcon } from './icons';

/**
 * The kit's `breadcrumb`: muted text, a chevron between the steps that points
 * the way the text runs, the current page last and not a link.
 *
 * `hrefs` arrive with the locale prefix already applied; the component only
 * draws them.
 */
export async function Breadcrumbs({ items }: { items: { name: string; href: string }[] }) {
  const tc = await getTranslations('common');
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
