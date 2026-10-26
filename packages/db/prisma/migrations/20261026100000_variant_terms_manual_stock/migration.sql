-- Supplier linking and product terms (TASK-0134):
--   * LicensePeriodUnit gains UNSPECIFIED, for a product that states no term.
--   * Variant.deviceCount becomes nullable: null means the product states no
--     device count (0 keeps meaning unlimited).
--   * Variant.manualOutOfStock (+ manualOutOfStockAt): a person marked the
--     variant out of stock on the supplier linking page; it feeds
--     supplierOutOfStock.
--
-- Additive only: a new enum value, a relaxed NOT NULL and a new column with a
-- default (false). Every existing row keeps its value and stays as buyable as
-- it was. Rollback (forward-only): a later migration that converts UNSPECIFIED
-- terms to LIFETIME (value null), which the older code accepts, sets null device
-- counts back to 1 and restores NOT NULL, and drops the two columns; the enum value
-- stays (Postgres cannot drop one) and is simply unused.

-- AlterEnum
ALTER TYPE "public"."LicensePeriodUnit" ADD VALUE 'UNSPECIFIED';

-- AlterTable
ALTER TABLE "public"."Variant" ALTER COLUMN "deviceCount" DROP NOT NULL;
ALTER TABLE "public"."Variant" ADD COLUMN "manualOutOfStock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "manualOutOfStockAt" TIMESTAMP(3);
