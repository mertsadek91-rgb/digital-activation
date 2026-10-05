import type { Cart } from '@da/contracts';

/*
 * The cart's DOM events, in a module of their own so that a component which
 * only listens (the header badge, the bottom bar, the added dialog) does not
 * import the cart client — and with it every cart and checkout schema and
 * zod itself — into the bundle every page loads (TASK-0101). The client
 * itself is loaded on use, through `lib/lazy-clients.ts`.
 */

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
