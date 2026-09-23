-- Basket-size offers: the seasonal sale that priced a cart line (so its price
-- can lapse when the sale ends), and which offers an order used. Both
-- nullable and additive; existing rows need no backfill.

-- AlterTable
ALTER TABLE "public"."CartItem" ADD COLUMN     "saleEndsAt" TIMESTAMP(3),
ADD COLUMN     "saleId" TEXT;

-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "offerSnapshot" JSONB;
