---
name: database-change
description: Procedure for any Prisma schema / migration / data change in this repo — impact across consumers, additive-first migrations, the vault role split, drift check, and never touching the live staging database casually. Use before editing packages/db/prisma or writing a data script.
---

# Database change

**Decision class:** `database_schema`. Destructive changes are `destructive_data`, which
needs owner approval. **Level:** L4 at minimum. The router adds `database-architect`.

1. **Map every consumer.** For each touched model or field, `git grep` it across:
   - `apps/api`, `apps/admin`, `apps/storefront`
   - `packages/contracts`
   - `packages/db/scripts` (importers, doctor, seed, demo)
   - `workers`

   Also check exports and reports.
2. **Prefer additive changes.** Add a column or table, backfill it, switch the readers, and
   drop in a later release. Never rename in one step.
3. **The vault:** vault tables live in schema `vault`. Grants come from
   `packages/db/prisma/init/roles.prod.sql` and `scripts/setup-roles.ts`:
   - `da_app` has no access
   - `da_vault` has no DELETE

   A vault change must keep both. Prove it with `pnpm db:doctor`.
4. **Write a new migration.** Never edit an applied one; the guard blocks it. Generate it
   against a **disposable** Postgres (the `docker-compose.yml` service, or CI's service). The
   `.env` database is live staging.
5. **Verify:**
   - `pnpm db:validate`
   - the CI schema-drift check
   - `pnpm --filter @da/api test:int` against a disposable database
   - importers still dry-run cleanly
6. **Data scripts:**
   - dry-run by default, `--apply` to write
   - idempotent (LegacyMap)
   - print counts only, never row content, especially anything from legacy order notes
7. **Record the migration plan and rollback** (for forward-only schemas this is a
   compensating migration) in the task, then request `database-architect` + `qa-lead`
   reviews (skill `independent-review`).
