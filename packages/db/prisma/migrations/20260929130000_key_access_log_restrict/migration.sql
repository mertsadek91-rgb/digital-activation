-- The key access log must outlive the key it records (TASK-0012 / BUG-0003).
--
-- KeyAccessLog -> LicenseKey was ON DELETE CASCADE, so deleting a key erased
-- the evidence of who had seen it. RESTRICT makes such a delete fail instead.
-- No code path deletes a LicenseKey; db-doctor's `WHERE false` privilege probe
-- deletes nothing, so it is unaffected.
--
-- Swaps one constraint. No rows change, and every existing row already
-- satisfies it. Wrapped in a transaction so the table is never without the
-- foreign key between the two statements. Generated offline with
-- `prisma migrate diff`; not applied.

BEGIN;

-- DropForeignKey
ALTER TABLE "vault"."KeyAccessLog" DROP CONSTRAINT "KeyAccessLog_licenseKeyId_fkey";

-- AddForeignKey
ALTER TABLE "vault"."KeyAccessLog" ADD CONSTRAINT "KeyAccessLog_licenseKeyId_fkey" FOREIGN KEY ("licenseKeyId") REFERENCES "vault"."LicenseKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
