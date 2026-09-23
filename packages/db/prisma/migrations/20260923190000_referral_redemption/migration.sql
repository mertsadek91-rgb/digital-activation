-- Referral redemptions: one row per referred friend's cart, from the minted
-- single-use friend code to the referrer's reward.
--
-- Additive only (a new enum and a new table), so it is safe to apply on a
-- live database. Generated offline with `prisma migrate diff`; not applied.

-- CreateEnum
CREATE TYPE "public"."ReferralRedemptionStatus" AS ENUM ('ISSUED', 'PENDING', 'REWARDED', 'VOID');

-- CreateTable
CREATE TABLE "public"."ReferralRedemption" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "status" "public"."ReferralRedemptionStatus" NOT NULL DEFAULT 'ISSUED',
    "promotionId" TEXT NOT NULL,
    "cartId" TEXT,
    "orderId" TEXT,
    "friendEmail" TEXT,
    "friendCustomerId" TEXT,
    "friendDiscountUsd" DECIMAL(12,2),
    "paidAt" TIMESTAMP(3),
    "rewardUsd" DECIMAL(12,2),
    "rewardPromotionId" TEXT,
    "rewardedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "flags" TEXT[],
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralRedemption_promotionId_key" ON "public"."ReferralRedemption"("promotionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralRedemption_cartId_key" ON "public"."ReferralRedemption"("cartId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralRedemption_orderId_key" ON "public"."ReferralRedemption"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralRedemption_rewardPromotionId_key" ON "public"."ReferralRedemption"("rewardPromotionId");

-- CreateIndex
CREATE INDEX "ReferralRedemption_referralId_status_idx" ON "public"."ReferralRedemption"("referralId", "status");

-- CreateIndex
CREATE INDEX "ReferralRedemption_status_paidAt_idx" ON "public"."ReferralRedemption"("status", "paidAt");

-- AddForeignKey
ALTER TABLE "public"."ReferralRedemption" ADD CONSTRAINT "ReferralRedemption_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "public"."Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReferralRedemption" ADD CONSTRAINT "ReferralRedemption_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "public"."Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReferralRedemption" ADD CONSTRAINT "ReferralRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
