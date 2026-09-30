---
paths:
  - "packages/db/**"
---

# Database (Prisma 7, PostgreSQL 18)

- The schema is split across `packages/db/prisma/schema/*.prisma` (9 files, 70 models, `public` + `vault`).
- The URL comes through `prisma.config.ts` and the pg driver adapter; `url`/`directUrl` in the datasource are not allowed in Prisma 7.
- **Migrations are forward-only and immutable once applied.** The guard blocks editing an existing `migration.sql`.
  - Create one with `pnpm db:migrate` (ask-gated: the `.env` database is live staging).
  - CI fails on schema drift.
- **Dropping or renaming a field:** a dependency analysis across API, admin, storefront, contracts, importers, exports and reports, a migration plan, and decision class `database_schema`. A destructive migration is `destructive_data`: owner approval.
- **Importers (`scripts/import`, `legacy`, `media`, `seo`)** are dry-run by default; `--apply` writes. They read `Old Website/` in the main checkout only, and never print note content.
- `id` and `updatedAt` are Prisma-level defaults. Raw SQL inserts must supply them.
- Load the `database-change` skill for the full procedure.
