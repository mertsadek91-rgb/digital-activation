import type * as CartModule from './cart-client';
import type * as GrowthModule from './growth-client';
import type * as OfferedModule from './offered-schemas';

/**
 * The browser clients that validate with zod, loaded on first use.
 *
 * The layout's always-present components (the header badge, the bottom bar,
 * the added dialog, the welcome window, the payment marks, the currency
 * picker) each read one small thing from the API after the page is up. They
 * used to import their clients statically, so every page shipped the cart,
 * checkout and marketing schemas and zod with them: a 49 KB chunk that
 * Lighthouse counts against the first paint on a phone (TASK-0101). Loaded
 * from an effect, the same clients and the same schemas arrive after the
 * page has painted, and the responses are still parsed exactly as before.
 *
 * Each import is cached by the bundler, so calling these twice costs nothing.
 */
export const loadCartApi = (): Promise<typeof CartModule.cartApi> =>
  import('./cart-client').then((module) => module.cartApi);

/**
 * The message for a failed cart call: the API's own words when it sent some
 * (a `CartError`), the caller's fallback otherwise. Async because the error
 * class lives in the cart client, which is loaded on use.
 */
export async function cartErrorMessage(caught: unknown, fallback: string): Promise<string> {
  try {
    const { CartError } = await import('./cart-client');
    return caught instanceof CartError ? caught.message : fallback;
  } catch {
    return fallback;
  }
}

export const loadGrowthClient = (): Promise<typeof GrowthModule> => import('./growth-client');

export const loadOfferedSchemas = (): Promise<typeof OfferedModule> => import('./offered-schemas');
