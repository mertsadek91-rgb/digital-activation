-- ProductMedia already carries a unique index over
--   ("productId", "assetId", "variantId")
-- which reads as "one row per image per product per variant". It is not that.
-- Postgres treats NULLs as distinct in a unique index, and a product-level
-- image is exactly the row whose "variantId" is NULL — so the constraint
-- covers only variant-scoped images and lets the same product-level image be
-- inserted again and again.
--
-- That is not theoretical: the media import writes one product-level row per
-- image, so a second run would have attached every image a second time and the
-- product gallery would show the same box shot twice.
--
-- A partial index over the two columns that are never null closes it, in the
-- same shape as Variant_one_default_per_product and the other partial uniques
-- in the initial migration.
CREATE UNIQUE INDEX "ProductMedia_product_asset_unique_when_no_variant"
  ON "public"."ProductMedia" ("productId", "assetId")
  WHERE "variantId" IS NULL;
