-- WhatsApp as a second channel for cart recovery and renewal reminders.
--
-- Customer gains the number and its own consent pair: WhatsApp consent is
-- separate from email consent, and STOP on WhatsApp clears the opt-in and
-- stamps the opt-out, like the email unsubscribe does. Indexed by number,
-- because an inbound STOP identifies a sender by phone, not by customer id.
--
-- NotificationLog keeps the provider's message id (unique, so a status
-- callback delivered twice lands on one row) and the furthest delivery state.
--
-- RenewalReminder records the channel a reminder went out on; the unique
-- (orderItemId, offsetDays) index still means one reminder per offset, on
-- whichever channel.
--
-- WhatsappInbound is the idempotency record for inbound messages: Meta
-- redelivers webhooks, and a STOP handled twice would confirm twice.

-- AlterTable
ALTER TABLE "public"."Customer" ADD COLUMN     "whatsappOptInAt" TIMESTAMP(3),
ADD COLUMN     "whatsappOptOutAt" TIMESTAMP(3),
ADD COLUMN     "whatsappPhone" TEXT;

-- AlterTable
ALTER TABLE "public"."NotificationLog" ADD COLUMN     "deliveryStatus" TEXT,
ADD COLUMN     "providerMessageId" TEXT;

-- AlterTable
ALTER TABLE "public"."RenewalReminder" ADD COLUMN     "channel" "public"."NotificationChannel" NOT NULL DEFAULT 'EMAIL';

-- CreateTable
CREATE TABLE "public"."WhatsappInbound" (
    "id" TEXT NOT NULL,
    "fromPhone" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappInbound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsappInbound_receivedAt_idx" ON "public"."WhatsappInbound"("receivedAt");

-- CreateIndex
CREATE INDEX "Customer_whatsappPhone_idx" ON "public"."Customer"("whatsappPhone");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_providerMessageId_key" ON "public"."NotificationLog"("providerMessageId");
