-- Product agent (CR-0007, TASK-0136): batches of products the AI rewrites, or
-- supplier lines it turns into new products, worked one at a time by a worker
-- inside the API with a pause between products. AgentItem keeps each
-- product's log, outcome and, for a rewrite, a snapshot of what it replaced
-- so it can be undone.
--
-- Additive only: three enums and two new tables; nothing existing changes and
-- nothing outside the two tables references them. Rollback (forward-only): a
-- later migration that drops both tables and the three enums.
--
-- Generated offline with `prisma migrate diff --from-schema <HEAD schema>
-- --to-schema prisma/schema --script` (no database), then qualified with
-- "public". to match the other migrations.
-- CreateEnum
CREATE TYPE "public"."AgentBatchKind" AS ENUM ('REWRITE', 'CREATE');

-- CreateEnum
CREATE TYPE "public"."AgentBatchStatus" AS ENUM ('RUNNING', 'PAUSED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."AgentItemStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED', 'CANCELLED', 'REVERTED');

-- CreateTable
CREATE TABLE "public"."AgentBatch" (
    "id" TEXT NOT NULL,
    "kind" "public"."AgentBatchKind" NOT NULL,
    "status" "public"."AgentBatchStatus" NOT NULL DEFAULT 'RUNNING',
    "options" JSONB NOT NULL,
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 90,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AgentItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "public"."AgentItemStatus" NOT NULL DEFAULT 'QUEUED',
    "label" TEXT NOT NULL,
    "productId" TEXT,
    "productSlug" TEXT,
    "supplierItemId" TEXT,
    "step" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "log" JSONB NOT NULL DEFAULT '[]',
    "snapshot" JSONB,
    "result" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentBatch_status_nextRunAt_idx" ON "public"."AgentBatch"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "AgentItem_batchId_status_position_idx" ON "public"."AgentItem"("batchId", "status", "position");

-- CreateIndex
CREATE INDEX "AgentItem_status_heartbeatAt_idx" ON "public"."AgentItem"("status", "heartbeatAt");

-- CreateIndex
CREATE INDEX "AgentItem_productId_idx" ON "public"."AgentItem"("productId");

-- CreateIndex
CREATE INDEX "AgentItem_supplierItemId_idx" ON "public"."AgentItem"("supplierItemId");

-- AddForeignKey
ALTER TABLE "public"."AgentItem" ADD CONSTRAINT "AgentItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "public"."AgentBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

