/**
 * Shared contracts. One definition per shape, consumed by the API, the
 * storefront and the admin.
 *
 * Every `Json` column in the Prisma schema has its shape defined here — a Json
 * column with no schema is how the legacy store ended up with three different
 * spellings of the same licence period ("سنة واحدة", "سنة واحد", "سنة كاملة").
 */
export * from './primitives.js';
export * from './blocks.js';
export * from './account.js';
export * from './admin.js';
export * from './catalog.js';
export * from './catalog-create.js';
export * from './taxonomy.js';
export * from './catalog-edit.js';
export * from './for-you.js';
export * from './product-content.js';
export * from './cart.js';
export * from './checkout.js';
export * from './content.js';
export * from './fulfillment.js';
export * from './media.js';
export * from './promotion.js';
export * from './review.js';
export * from './seo.js';
