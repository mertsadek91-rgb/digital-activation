-- Payments outlive the orders they paid for, charges keep their third
-- decimal, and a TOTP code works once.
--
-- Payment -> Order and Refund -> Payment were ON DELETE CASCADE, so deleting an
-- order silently deleted the record of money that moved. RESTRICT makes that
-- delete fail instead; the demo cleanup already removes payments first.
--
-- amountCharged was DECIMAL(12,2) while KWD, BHD, OMR and JOD are charged in
-- thousandths; widening is lossless for every existing row.
--
-- totpLastStep holds the last accepted TOTP time step per staff account, so a
-- code cannot be replayed inside its validity window.

-- DropForeignKey
ALTER TABLE "public"."Payment" DROP CONSTRAINT "Payment_orderId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Refund" DROP CONSTRAINT "Refund_paymentId_fkey";

-- AlterTable
ALTER TABLE "public"."StaffUser" ADD COLUMN "totpLastStep" INTEGER;

-- AlterTable
ALTER TABLE "public"."Payment" ALTER COLUMN "amountCharged" SET DATA TYPE DECIMAL(14,3);

-- AddForeignKey
ALTER TABLE "public"."Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
