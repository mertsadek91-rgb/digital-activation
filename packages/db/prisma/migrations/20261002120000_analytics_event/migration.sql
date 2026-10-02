-- First-party analytics (TASK-0096): one table for the browsing half of the
-- funnel — product, category and cart views and WhatsApp clicks — fed by the
-- storefront's server. The commerce half already lives in Cart, Order,
-- OrderStatusEvent and Payment and is not copied here.
--
-- Additive only: a new enum, a new table, two indexes. No personal data: no
-- email, name or IP column; `visitorId` is a daily-rotating keyed hash and
-- `referrerHost` is a host, never a URL. Rows are pruned after 13 months by
-- the API's AnalyticsPruneService.
--
-- Rollback (forward-only): a later migration that drops the table and enum;
-- nothing else references them.
--
-- Generated offline with `prisma migrate diff --from-schema <HEAD schema>
-- --to-schema prisma/schema --script` (no database, no shadow database), then
-- qualified with "public". to match the other migrations.

-- CreateEnum
CREATE TYPE "public"."AnalyticsEventType" AS ENUM ('PRODUCT_VIEW', 'CATEGORY_VIEW', 'WHATSAPP_CLICK', 'CART_VIEW');

-- CreateTable
CREATE TABLE "public"."AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "type" "public"."AnalyticsEventType" NOT NULL,
    "path" TEXT NOT NULL,
    "productId" TEXT,
    "categoryId" TEXT,
    "placement" TEXT,
    "locale" "public"."Locale" NOT NULL,
    "referrerHost" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "visitorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsEvent_type_createdAt_idx" ON "public"."AnalyticsEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "public"."AnalyticsEvent"("createdAt");
