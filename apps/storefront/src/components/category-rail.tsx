import { ROUTES } from '@da/contracts';
import Link from 'next/link';

import { CategoryMark } from './icons';

/**
 * Every shelf in the shop, on every page of the catalog.
 *
 * The store this replaces keeps a category list down the side of its catalog
 * pages, and it is the one piece of its navigation this build had not carried
 * over. What it costs to be without: a collection page here listed its own
 * children and nothing else, so reaching a sibling shelf — Office from Windows
 * — meant going back to the store index first. Ten categories hold stock and
 * the only place all ten appeared together was a menu behind a button.
 *
 * A rail at desktop width and the horizontal strip it replaces below that. On a
 * phone a fixed sidebar is a column of links pushing the products it is meant
 * to help you find off the screen.
 *
 * Counts are shown because they are real and they change the decision: a shelf
 * with one product on it is worth knowing about before the click, and this
 * catalog has one of those.
 */
export function CategoryRail({
  categories,
  current,
  locale,
  title,
}: {
  categories: { slug: string; name: string; productCount: number }[];
  /** The shelf being looked at, so the rail says where you are. */
  current?: string;
  locale: string;
  title: string;
}) {
  if (categories.length === 0) return null;
  const prefix = locale === 'en' ? `/${locale}` : '';

  return (
    <nav className="cat-rail" aria-label={title}>
      <h2 className="cat-rail-head">{title}</h2>
      <ul>
        {categories.map((category) => {
          const active = category.slug === current;
          return (
            <li key={category.slug}>
              <Link
                href={`${prefix}${ROUTES.collection(category.slug)}`}
                className={active ? 'is-current' : undefined}
                // The current page is still a link — it is the heading of the
                // list as much as a destination — but it says so.
                aria-current={active ? 'page' : undefined}
              >
                <CategoryMark slug={category.slug} size={20} />
                <span className="cat-rail-name">{category.name}</span>
                <span className="cat-rail-count">{category.productCount}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
