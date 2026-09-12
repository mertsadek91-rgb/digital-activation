import { NotFoundPage } from '../../components/not-found-page';

/**
 * The page at the end of a link that no longer works.
 *
 * Until this existed, every one of those rendered Next's built-in error
 * document: no `lang`, no `dir`, no way back — an English blank page on an
 * Arabic right-to-left store. Which would have been the first thing a great
 * many people saw. This store replaces one whose organic traffic is its
 * largest asset, and a migration's 404s are not visitors making mistakes: they
 * are links that were correct until the day of the cutover. The 96 generated
 * redirects cover every URL the WordPress export knew about, and nothing
 * covers the links other people published — an old forum post, a printed
 * invoice, a partner's page.
 *
 * So the page says the honest thing and then guesses at what was wanted, from
 * the path itself. The guess is worth more here than anywhere else on the
 * site: it is the difference between a visitor who bounces and one who finds
 * the product under its new slug.
 *
 * All of it lives in a client component, for a reason that is a property of
 * this app's routing rather than a preference — see `not-found-page.tsx`.
 */
export default function NotFound() {
  return <NotFoundPage />;
}
