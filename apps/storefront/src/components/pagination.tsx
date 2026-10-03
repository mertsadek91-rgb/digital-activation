import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { ChevronRightIcon } from './icons';

/**
 * The kit's `pagination`: previous, the page numbers, next — 44px squares,
 * the current one filled with the brand colour.
 *
 * Links, not buttons: every page is a URL, which is what `rel="prev"` and
 * `rel="next"` and a crawler need. Up to five numbers are shown, centred on
 * the current page; the first and the last are always reachable through the
 * chevrons. The whole row runs left to right in both languages, as the kit
 * draws it, so "1 2 3" never reads backwards.
 */
export async function Pagination({
  page,
  lastPage,
  hrefFor,
}: {
  page: number;
  lastPage: number;
  /** The URL of a given page, with the listing's filters and sort kept. */
  hrefFor: (page: number) => string;
}) {
  if (lastPage <= 1) return null;
  const t = await getTranslations('catalog');

  const window = 5;
  const start = Math.max(1, Math.min(page - Math.floor(window / 2), lastPage - window + 1));
  const end = Math.min(lastPage, start + window - 1);
  const numbers: number[] = [];
  for (let n = start; n <= end; n += 1) numbers.push(n);

  return (
    <nav className="pagination" aria-label={t('pagination')}>
      {page > 1 ? (
        <Link
          href={hrefFor(page - 1)}
          rel="prev"
          className="pagination-step"
          aria-label={t('previous')}
        >
          <span className="pagination-prev" aria-hidden="true">
            <ChevronRightIcon />
          </span>
        </Link>
      ) : (
        <span className="pagination-step is-disabled" aria-hidden="true">
          <span className="pagination-prev">
            <ChevronRightIcon />
          </span>
        </span>
      )}

      {numbers.map((n) =>
        n === page ? (
          <span key={n} className="pagination-page is-active" aria-current="page">
            {n}
          </span>
        ) : (
          <Link
            key={n}
            href={hrefFor(n)}
            className="pagination-page"
            aria-label={t('pageOf', { page: String(n), last: String(lastPage) })}
          >
            {n}
          </Link>
        ),
      )}

      {page < lastPage ? (
        <Link
          href={hrefFor(page + 1)}
          rel="next"
          className="pagination-step"
          aria-label={t('next')}
        >
          <span aria-hidden="true">
            <ChevronRightIcon />
          </span>
        </Link>
      ) : (
        <span className="pagination-step is-disabled" aria-hidden="true">
          <ChevronRightIcon />
        </span>
      )}
    </nav>
  );
}
