'use client';

/**
 * Cart and checkout, from the browser.
 *
 * The rest of the storefront talks to the API from the server, which is right
 * for the catalog: it caches, it keeps the API off the public internet, and the
 * pages are identical for everyone. The cart cannot work that way. It is
 * identified by an httpOnly cookie the API sets, so the request has to come
 * from the browser that holds it — `credentials: 'include'`, and the API and
 * the storefront on the same registrable domain so a SameSite=strict cookie
 * still travels.
 *
 * Nothing here is cached. A cart read from a cache is a cart that lies about
 * what is in it.
 */
import {
  type Cart,
  type CartRestoreResult,
  type Checkout,
  type FpPaymentStatus,
  type OfferSuggestionContext,
  type OfferSuggestions,
  type Order,
  type OrderSuggestions,
  type PaymentSession,
  type StartPayment,
  cartRestoreResultSchema,
  cartSchema,
  checkoutSchema,
  fpPaymentStatusSchema,
  offerSuggestionsSchema,
  orderSchema,
  orderSuggestionsSchema,
  paymentSessionSchema,
} from '@da/contracts';
import type { z } from 'zod';

import {
  CART_ADDED_EVENT,
  CART_EVENT,
  type CartAddedDetail,
  type CartEventDetail,
} from './cart-events';
import { browserCurrency } from './currency';
import { serviceErrorMessage } from './service-errors';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Why a Final Processor payment could not start, when the API says (A.6).
 * `order_changed` means the draft was closed: re-run `POST /checkout`.
 */
export type PaymentRefusal = 'unavailable' | 'retry' | 'order_changed';

const REFUSALS: readonly string[] = ['unavailable', 'retry', 'order_changed'];

export class CartError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: PaymentRefusal | null = null,
  ) {
    super(message);
    this.name = 'CartError';
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit & { locale: string; currency?: string },
): Promise<T> {
  const locale = init?.locale ?? 'ar';
  const url = new URL(`/v1${path}`, API);
  url.searchParams.set('locale', locale);
  // The shopper's chosen currency unless a caller names one. The API labels
  // the result with the currency it actually used.
  url.searchParams.set('currency', init?.currency ?? browserCurrency());

  // The content type only when there is content. On a GET it is a header the
  // CORS rules do not list as simple, so every read of the cart cost a
  // preflight round trip before the request itself — one more request on
  // every page, and two on the cart (TASK-0101).
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const record = (payload ?? {}) as Record<string, unknown>;
    const reason =
      typeof record.reason === 'string' && REFUSALS.includes(record.reason)
        ? (record.reason as PaymentRefusal)
        : null;
    throw new CartError(
      typeof record.message === 'string'
        ? record.message
        : serviceErrorMessage('unreachable', locale),
      response.status,
      reason,
    );
  }

  // Parsed against the same schema the API built it from, so a shape change
  // surfaces here with a readable path rather than as `undefined` three
  // components deep in a checkout.
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new CartError(serviceErrorMessage('unexpected', locale), 500);
  }
  return parsed.data;
}

interface Options {
  locale: string;
  currency?: string;
}

export {
  CART_ADDED_EVENT,
  CART_EVENT,
  type CartAddedDetail,
  type CartEventDetail,
} from './cart-events';

function announceAdded(variantId: string): (cart: Cart) => Cart {
  return (cart) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<CartAddedDetail>(CART_ADDED_EVENT, { detail: { cart, variantId } }),
      );
    }
    return cart;
  };
}

function announce(cart: Cart): Cart {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<CartEventDetail>(CART_EVENT, { detail: { cart } }));
  }
  return cart;
}

export const cartApi = {
  get: (options: Options): Promise<Cart> => request('/cart', cartSchema, { ...options }),

  add: (variantId: string, qty: number, options: Options): Promise<Cart> =>
    request('/cart/items', cartSchema, {
      ...options,
      method: 'POST',
      body: JSON.stringify({ variantId, qty }),
    })
      .then(announce)
      .then(announceAdded(variantId)),

  /** A one-click add from a suggestion: announced to the header, not to the dialog. */
  addSuggestion: (variantId: string, options: Options): Promise<Cart> =>
    request('/cart/items', cartSchema, {
      ...options,
      method: 'POST',
      body: JSON.stringify({ variantId, qty: 1 }),
    }).then(announce),

  /** "Goes well with" cards for these products. Public: slugs in, cards out. */
  suggestions: (
    slugs: string[],
    context: OfferSuggestionContext,
    options: Options,
  ): Promise<OfferSuggestions> =>
    request(
      `/offers/suggestions?products=${encodeURIComponent(slugs.join(','))}&context=${context}`,
      offerSuggestionsSchema,
      options,
    ),

  /** "Complete your setup" for a paid order, with the order's link key. */
  orderSuggestions: (
    number: string,
    options: Options & { key?: string | null },
  ): Promise<OrderSuggestions> => {
    const { key, ...rest } = options;
    const query = key ? `?key=${encodeURIComponent(key)}` : '';
    return request(
      `/offers/orders/${encodeURIComponent(number)}${query}`,
      orderSuggestionsSchema,
      rest,
    );
  },

  addCrossSell: (variantId: string, options: Options): Promise<Cart> =>
    request('/cart/items', cartSchema, {
      ...options,
      method: 'POST',
      body: JSON.stringify({ variantId, qty: 1, fromCrossSell: true }),
    }).then(announce),

  setQty: (variantId: string, qty: number, options: Options): Promise<Cart> =>
    request(`/cart/items/${encodeURIComponent(variantId)}`, cartSchema, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify({ qty }),
    }).then(announce),

  applyCoupon: (code: string, options: Options): Promise<Cart> =>
    request('/cart/coupon', cartSchema, {
      ...options,
      method: 'POST',
      body: JSON.stringify({ code }),
    }).then(announce),

  removeCoupon: (options: Options): Promise<Cart> =>
    request('/cart/coupon', cartSchema, { ...options, method: 'DELETE' }).then(announce),

  /**
   * Opens the cart a recovery email points at in this browser. The API sets
   * the cookie; `restored` is false when the link had expired or its cart was
   * already paid for, and the cart returned is then the one this browser had.
   */
  restore: (token: string, options: Options): Promise<CartRestoreResult> =>
    request('/cart/restore', cartRestoreResultSchema, {
      ...options,
      method: 'POST',
      body: JSON.stringify({ token }),
    }).then((result) => {
      announce(result.cart);
      return result;
    }),

  startCheckout: (
    body: {
      email: string;
      name?: string;
      country?: string;
      activationEmail?: string;
      marketingOptIn: boolean;
      whatsappPhone?: string;
      whatsappOptIn: boolean;
    },
    options: Options,
  ): Promise<Checkout> =>
    request('/checkout', checkoutSchema, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * `key` is the signed one the order emails carry. With it the page opens on
   * any device; without it the API wants this browser's cart or a signed-in
   * customer.
   */
  order: (number: string, options: Options & { key?: string | null }): Promise<Order> => {
    const { key, ...rest } = options;
    const query = key ? `?key=${encodeURIComponent(key)}` : '';
    return request(`/orders/${encodeURIComponent(number)}${query}`, orderSchema, rest);
  },

  /**
   * Starts a payment. Never carries an amount or a currency — the API reads
   * those off the order. `method` is the Final Processor method, and only that.
   */
  pay: (number: string, body: StartPayment, options: Options): Promise<PaymentSession> =>
    request(`/orders/${encodeURIComponent(number)}/pay`, paymentSessionSchema, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * Whether a Final Processor order is paid, as the server confirms it — the
   * return page's only source. The `fp_result` on that page's URL is never sent.
   */
  finalProcessorStatus: (number: string, options: Options): Promise<FpPaymentStatus> =>
    request(
      `/checkout/final-processor/status/${encodeURIComponent(number)}`,
      fpPaymentStatusSchema,
      options,
    ),
};
