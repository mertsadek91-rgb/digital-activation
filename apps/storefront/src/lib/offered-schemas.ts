/**
 * The schemas that always-present components parse their one read with (the
 * currency picker, the payment marks, the product page's social proof), in a
 * module of their own so they can be imported on use (see `lazy-clients.ts`)
 * and the bundler keeps only these from the contracts.
 */
export { offeredCurrenciesSchema, offeredPaymentSchema, socialProofSchema } from '@da/contracts';
