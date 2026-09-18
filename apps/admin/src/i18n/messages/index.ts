import type { AdminLocale } from '../locale';

import { ar, type AdminMessages } from './ar';
import { en } from './en';

export type { AdminMessages };

/**
 * Both dictionaries, eagerly.
 *
 * The storefront loads its messages by dynamic import because a shopper only
 * ever wants one language and the other is dead weight on a page that has a
 * performance budget. This panel is a private tool behind a login, the two
 * dictionaries together are a few kilobytes, and loading both means the
 * switcher changes the language without a round trip.
 */
export const messages: Record<AdminLocale, AdminMessages> = { ar, en };
