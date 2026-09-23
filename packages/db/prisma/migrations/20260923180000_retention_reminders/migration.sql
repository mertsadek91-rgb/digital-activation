-- Renewal reminders and abandoned-cart recovery: what was sent, and what was
-- deliberately not sent.
--
-- CartRecoveryEvent.heldOut marks a step that was due for a cart in the
-- measured holdout and was not sent, so the ladder's lift is measured against
-- carts left alone rather than assumed.
--
-- RenewalReminder is one row per (licence line, reminder offset). The unique
-- index is the idempotency guard for the daily sweep. Plain id columns, no
-- foreign keys: the table is a log, and adding relations would mean new
-- fields on Order/Customer/Promotion for no query that needs them.

-- AlterTable
ALTER TABLE "public"."CartRecoveryEvent" ADD COLUMN     "heldOut" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."RenewalReminder" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customerId" TEXT,
    "email" TEXT NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "heldOut" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "promotionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenewalReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RenewalReminder_createdAt_idx" ON "public"."RenewalReminder"("createdAt");

-- CreateIndex
CREATE INDEX "RenewalReminder_email_idx" ON "public"."RenewalReminder"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RenewalReminder_orderItemId_offsetDays_key" ON "public"."RenewalReminder"("orderItemId", "offsetDays");
