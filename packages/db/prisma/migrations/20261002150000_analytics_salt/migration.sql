-- Analytics visitor salt (TASK-0097): one random 32-byte salt per UTC day,
-- replacing the visitor-id key derived from JWT_ACCESS_SECRET. The API
-- creates the day's row on first use (INSERT ... ON CONFLICT DO NOTHING via
-- createMany skipDuplicates, then a read) and AnalyticsPruneService deletes
-- every salt older than the current UTC day, which makes past visitor ids
-- irreversible.
--
-- Additive only: one new table, no change to existing rows. Rollback
-- (forward-only): a later migration that drops the table; nothing references it.
--
-- Generated offline with `prisma migrate diff --from-schema <HEAD schema>
-- --to-schema prisma/schema --script` (no database, no shadow database), then
-- qualified with "public". to match the other migrations.

-- CreateTable
CREATE TABLE "public"."AnalyticsSalt" (
    "day" DATE NOT NULL,
    "salt" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSalt_pkey" PRIMARY KEY ("day")
);
