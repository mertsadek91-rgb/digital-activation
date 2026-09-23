import { createNavigation } from 'next-intl/navigation';

import { routing } from './routing';

/**
 * Locale-aware navigation, for the one place that needs it: switching
 * language. `usePathname` here returns the path without its locale prefix, and
 * `Link` with a `locale` puts the right one back — so `/en/store/x` and
 * `/store/x` swap for each other instead of both landing on the home page.
 *
 * Everything else keeps building hrefs by hand with a prefix, as it always has.
 */
export const { Link, usePathname } = createNavigation(routing);
