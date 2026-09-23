-- Order status history: one row per status change, with who made it.
--
-- Additive only (a new enum and a new table), so it is safe to apply on a
-- live database. Orders placed before it have no history rows; the panel
-- starts their timeline at `placedAt`. Generated offline with
-- `prisma migrate diff`; not applied.

-- CreateEnum
CREATE TYPE "public"."OrderEventActor" AS ENUM ('SYSTEM', 'STAFF', 'PROVIDER');

-- CreateTable
CREATE TABLE "public"."OrderStatusEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "from" "public"."OrderStatus",
    "to" "public"."OrderStatus" NOT NULL,
    "actorType" "public"."OrderEventActor" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderStatusEvent_orderId_createdAt_idx" ON "public"."OrderStatusEvent"("orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
