-- Final Processor payments, the rest of the shape (the enum value and the two
-- tables came in 20260930111620_payment_method_config).
--
-- Additive, apart from one index swap on a table nothing has written to yet:
--  - Payment.testMode: a sandbox payment, as the processor reports it.
--  - Payment.refundedUsd: refunded so far, as the provider last reported it.
--  - Refund.status (existing rows are refunds that happened: SUCCEEDED),
--    Refund.refundRef (our idempotency key), Refund.failureCode.
--  - Refund.providerRef becomes unique, so a refund reported twice is recorded
--    once. Existing rows are keyed per Stripe charge (applyRefund updates the
--    row it finds), so no duplicates are expected; if this index fails, list
--    them with: SELECT "providerRef", count(*) FROM "public"."Refund"
--    WHERE "providerRef" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
--  - PaymentWebhookLog.eventId stops being unique: a duplicate delivery is its
--    own log row ("duplicate"). Idempotency is WebhookEvent's unique key.
-- Generated offline with `prisma migrate diff` against a disposable database.

-- CreateEnum
CREATE TYPE "public"."RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- DropIndex
DROP INDEX "public"."PaymentWebhookLog_eventId_key";

-- AlterTable
ALTER TABLE "public"."Payment" ADD COLUMN     "refundedUsd" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "testMode" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."Refund" ADD COLUMN     "failureCode" TEXT,
ADD COLUMN     "refundRef" TEXT,
ADD COLUMN     "status" "public"."RefundStatus" NOT NULL DEFAULT 'SUCCEEDED';

-- CreateIndex
CREATE INDEX "PaymentWebhookLog_createdAt_idx" ON "public"."PaymentWebhookLog"("createdAt");

-- CreateIndex
CREATE INDEX "PaymentWebhookLog_eventId_idx" ON "public"."PaymentWebhookLog"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_providerRef_key" ON "public"."Refund"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_refundRef_key" ON "public"."Refund"("refundRef");
