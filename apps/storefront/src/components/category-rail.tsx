import { ROUTES } from '@da/contracts';
import { Link } from './link';

import { isArabic } from '../i18n/locale';

/**
 * Every shelf in the shop, on every page of the catalog — as the kit's row of
 * chips above the grid (`04_Inner_Pages/*\/catalog`), not a sidebar.
 *
 * A collection page here used to list its own children and nothing else, so
 * reaching a sibling shelf — Office from Windows — meant going back to the
 * store index first. The row answers that on every width: one line of pills
 * that scrolls sideways where it does not fit, the current shelf filled in.
 *
 * Counts are shown because they are real and they change the decision: a shelf
 * with one product on it is worth knowing about before the click.
 */
export function CategoryRail({
  categories,
  current,
  locale,
  title,
  hrefFor = ROUTES.collection,
  allHref,
  allLabel,
}: {
  categories: { slug: string; name: string; productCount: number }[];
  /** The shelf being looked at, so the row says where you are. */
  current?: string;
  locale: string;
  title: string;
  /**
   * How a slug becomes a path. The brand hub is the same list of shelves with
   * the same counts and the same "where am I" rule, differing only in what a
   * row points at.
   */
  hrefFor?: (slug: string) => string;
  /** The "all" chip, when the page has somewhere wider to go. */
  allHref?: string;
  allLabel?: string;
}) {
  if (categories.length === 0) return null;
  const prefix = isArabic(locale) ? '' : `/${locale}`;

  return (
    <nav className="cat-chips" aria-label={title}>
      <ul>
        {allHref && allLabel ? (
          <li>
            <Link
              href={allHref}
              className={`chip${current ? '' : ' is-active'}`}
              aria-current={current ? undefined : 'page'}
            >
              {allLabel}
            </Link>
          </li>
        ) : null}
        {categories.map((category) => {
          const active = category.slug === current;
          return (
            <li key={category.slug}>
              <Link
                href={`${prefix}${hrefFor(category.slug)}`}
                className={`chip${active ? ' is-active' : ''}`}
                // The current page is still a link — it is the heading of the
                // list as much as a destination — but it says so.
                aria-current={active ? 'page' : undefined}
              >
                <span>{category.name}</span>
                <span className="chip-count">{category.productCount}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
