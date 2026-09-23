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
  type OfferSuggestionContext,
  type OfferSuggestions,
  type Order,
  type OrderSuggestions,
  type PaymentSession,
  cartRestoreResultSchema,
  cartSchema,
  checkoutSchema,
  offerSuggestionsSchema,
  orderSchema,
  orderSuggestionsSchema,
  paymentSessionSchema,
} from '@da/contracts';
import type { z } from 'zod';

import { browserCurrency } from './currency';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class CartError extends Error {
  constructor(
    message: string,
    readonly status: number,
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
  const url = new URL(`/v1${path}`, API);
  url.searchParams.set('locale', init?.locale ?? 'ar');
  // The shopper's chosen currency unless a caller names one. The API labels
  // the result with the currency it actually used.
  url.searchParams.set('currency', init?.currency ?? browserCurrency());

  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...init?.headers },
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const record = (payload ?? {}) as Record<string, unknown>;
    throw new CartError(
      typeof record.message === 'string' ? record.message : 'تعذّر الاتصال بالخدمة.',
      response.status,
    );
  }

  // Parsed against the same schema the API built it from, so a shape change
  // surfaces here with a readable path rather than as `undefined` three
  // components deep in a checkout.
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new CartError('استجابة غير متوقّعة من الخدمة.', 500);
  }
  return parsed.data;
}

interface Options {
  locale: string;
  currency?: string;
}

/**
 * How the header hears about a change.
 *
 * The cart badge lives in a client component that is a sibling of the page, not
 * an ancestor or a descendant, so neither props nor `router.refresh()` can
 * reach it — refresh re-renders server components, and the header's effect
 * depends on the pathname, which does not change when you add to the cart from
 * a product page. The result was a shopper adding an item and watching the
 * header stay empty.
 *
 * A DOM event is the smallest thing that works here: one dispatch, one
 * listener, no store and no context threaded through a tree that spans the
 * server/client boundary.
 */
export const CART_EVENT = 'da:cart';

export interface CartEventDetail {
  cart: Cart;
}

/**
 * A shopper's own add-to-cart, as distinct from any other cart change — what
 * the "goes well with" dialog opens on. Only `cartApi.add` sends it: a
 * suggestion added from the dialog or the cart page must not open the dialog
 * again on top of itself.
 */
export const CART_ADDED_EVENT = 'da:cart-added';

export interface CartAddedDetail {
  cart: Cart;
  variantId: string;
}

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

  pay: (
    number: string,
    provider: 'STRIPE' | 'PAYPAL' | 'BANK_TRANSFER' | 'CRYPTO',
    options: Options,
  ): Promise<PaymentSession> =>
    request(`/orders/${encodeURIComponent(number)}/pay`, paymentSessionSchema, {
      ...options,
      method: 'POST',
      body: JSON.stringify({ provider }),
    }),
};
