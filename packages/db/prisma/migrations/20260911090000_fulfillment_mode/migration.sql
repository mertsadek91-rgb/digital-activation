-- Most of this catalog is made to order. The licence is bought from a supplier
-- after the customer pays, because a code's validity starts when it is
-- purchased, because some activations bind to the customer's own email and
-- cannot be stocked at all, because some carry only a seven-day supplier
-- warranty, and because the expensive, rarely ordered lines would tie up money
-- in stock that does not turn over.
--
-- Without this column the software had the wrong model: it treated every
-- variant as stock-backed, so 67 of 72 products read "out of stock" when they
-- were never out of stock — they were made to order — and the cart refused to
-- sell any of them.
CREATE TYPE "public"."FulfillmentMode" AS ENUM ('FROM_STOCK', 'ON_DEMAND', 'MANUAL_SETUP');

ALTER TABLE "public"."Variant"
  ADD COLUMN "fulfillmentMode" "public"."FulfillmentMode" NOT NULL DEFAULT 'ON_DEMAND',
  ADD COLUMN "requiresActivationEmail" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "warrantyDays" INTEGER;

-- A stocked line must actually have somewhere to count stock, and an on-demand
-- line must not be holding any.
ALTER TABLE "public"."Variant"
  ADD CONSTRAINT "Variant_warranty_days_positive"
  CHECK ("warrantyDays" IS NULL OR "warrantyDays" > 0);

-- The nine variants the owner really stocks are the ones WooCommerce was
-- managing stock for; the import sets them. Everything already imported was
-- imported under the wrong assumption, so it starts as ON_DEMAND, which is
-- both the default and the truth for 91 of the 101 legacy rows.
