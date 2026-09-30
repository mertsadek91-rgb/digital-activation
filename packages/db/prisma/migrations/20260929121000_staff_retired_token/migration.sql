-- Staff refresh-token replay detection, second shape (TASK-0013 / BUG-0004).
--
-- Additive only (one new table), so it is safe to apply on a live database.
-- Every hash a session rotates away from is kept, not only the last one as
-- 20260929120000 did: an attacker controls how many rotations happen between
-- the theft and the victim's next refresh. Existing sessions are covered from
-- their next rotation. Rows go with their session.
-- Generated offline with `prisma migrate diff`; not applied.

-- CreateTable
CREATE TABLE "public"."StaffRetiredToken" (
    "hash" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "retiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffRetiredToken_pkey" PRIMARY KEY ("hash")
);

-- CreateIndex
CREATE INDEX "StaffRetiredToken_sessionId_idx" ON "public"."StaffRetiredToken"("sessionId");

-- AddForeignKey
ALTER TABLE "public"."StaffRetiredToken" ADD CONSTRAINT "StaffRetiredToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."StaffSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
