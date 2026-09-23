-- Price sort for the storefront catalogue.
--
-- A product's price is the cheapest of its published variants, and Postgres
-- cannot ORDER BY that without an aggregate join Prisma cannot express, so the
-- minimum is denormalised onto Product. From here on `refreshProductPrice` in
-- `@da/db` keeps it correct on every write that touches a variant's price or
-- status; this migration only fills it for the rows that already exist.

-- AlterTable
ALTER TABLE "public"."Product" ADD COLUMN "minPriceUsd" DECIMAL(12,2);

-- Backfill. Idempotent: it recomputes from the variants rather than reading
-- the column it writes, so running it twice (or again after a partial apply)
-- lands on the same values. A product with no published variant gets NULL,
-- which the catalog sorts last.
UPDATE "public"."Product" AS p
SET "minPriceUsd" = (
  SELECT MIN(v."priceUsd")
  FROM "public"."Variant" AS v
  WHERE v."productId" = p."id" AND v."status" = 'PUBLISHED'
);
