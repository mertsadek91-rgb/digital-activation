-- Supplier price sheet (CR-0004, TASK-0111/0112): the supplier's Google Sheet
-- read on a schedule into SupplierItem rows keyed by normalised product name,
-- every change logged in SupplierItemChange, and VariantSupplierLink saying
-- which of our variants is which sheet line. Variant.supplierOutOfStock carries
-- the sheet's strikethrough onto the storefront as "notify me".
--
-- Additive only: two enums, five new tables, one new column with a default
-- (false), so every existing variant stays exactly as buyable as it was.
-- Rollback (forward-only): a later migration that drops the tables and the
-- column; nothing outside them references them.
--
-- Generated offline with `prisma migrate diff --from-schema <HEAD schema>
-- --to-schema prisma/schema --script` (no database), then qualified with
-- "public". to match the other migrations.

-- CreateEnum
CREATE TYPE "public"."SupplierRounding" AS ENUM ('CENTS', 'END_99', 'WHOLE');

-- CreateEnum
CREATE TYPE "public"."SupplierChangeKind" AS ENUM ('ADDED', 'REMOVED', 'RETURNED', 'COST', 'STOCK', 'CATEGORY', 'WARRANTY', 'REMARKS');

-- AlterTable
ALTER TABLE "public"."Variant" ADD COLUMN     "supplierOutOfStock" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."SupplierSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "sheetGid" INTEGER NOT NULL DEFAULT 0,
    "markupPercent" DECIMAL(6,2) NOT NULL DEFAULT 50,
    "rounding" "public"."SupplierRounding" NOT NULL DEFAULT 'CENTS',
    "autoSync" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncError" TEXT,
    "sheetUpdatedLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplierSnapshot" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sheetUpdatedLabel" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT,
    "added" INTEGER NOT NULL DEFAULT 0,
    "changed" INTEGER NOT NULL DEFAULT 0,
    "removed" INTEGER NOT NULL DEFAULT 0,
    "stockSwitched" INTEGER NOT NULL DEFAULT 0,
    "triggeredById" TEXT,

    CONSTRAINT "SupplierSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplierItem" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "costUsd" DECIMAL(12,2),
    "priceText" TEXT,
    "warranty" TEXT,
    "remarks" TEXT,
    "outOfStock" BOOLEAN NOT NULL DEFAULT false,
    "partialStrike" BOOLEAN NOT NULL DEFAULT false,
    "wholesaleOnly" BOOLEAN NOT NULL DEFAULT false,
    "rowNumber" INTEGER,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "missingSince" TIMESTAMP(3),

    CONSTRAINT "SupplierItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplierItemChange" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "kind" "public"."SupplierChangeKind" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierItemChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VariantSupplierLink" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "markupPercent" DECIMAL(6,2),
    "followStock" BOOLEAN NOT NULL DEFAULT true,
    "lastAppliedCostUsd" DECIMAL(12,2),
    "lastAppliedPriceUsd" DECIMAL(12,2),
    "lastAppliedAt" TIMESTAMP(3),
    "linkedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantSupplierLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierSource_spreadsheetId_sheetGid_key" ON "public"."SupplierSource"("spreadsheetId", "sheetGid");

-- CreateIndex
CREATE INDEX "SupplierSnapshot_sourceId_fetchedAt_idx" ON "public"."SupplierSnapshot"("sourceId", "fetchedAt");

-- CreateIndex
CREATE INDEX "SupplierItem_sourceId_missingSince_idx" ON "public"."SupplierItem"("sourceId", "missingSince");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierItem_sourceId_nameKey_key" ON "public"."SupplierItem"("sourceId", "nameKey");

-- CreateIndex
CREATE INDEX "SupplierItemChange_itemId_createdAt_idx" ON "public"."SupplierItemChange"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierItemChange_snapshotId_idx" ON "public"."SupplierItemChange"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantSupplierLink_variantId_key" ON "public"."VariantSupplierLink"("variantId");

-- CreateIndex
CREATE INDEX "VariantSupplierLink_itemId_idx" ON "public"."VariantSupplierLink"("itemId");

-- AddForeignKey
ALTER TABLE "public"."SupplierSnapshot" ADD CONSTRAINT "SupplierSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "public"."SupplierSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierItem" ADD CONSTRAINT "SupplierItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "public"."SupplierSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierItemChange" ADD CONSTRAINT "SupplierItemChange_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."SupplierItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierItemChange" ADD CONSTRAINT "SupplierItemChange_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "public"."SupplierSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VariantSupplierLink" ADD CONSTRAINT "VariantSupplierLink_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "public"."Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VariantSupplierLink" ADD CONSTRAINT "VariantSupplierLink_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."SupplierItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
