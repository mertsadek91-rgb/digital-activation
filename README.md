# Digital Activation

Rebuild of [digital-activation.com](https://digital-activation.com) — a store selling
software activation keys — off WordPress/WooCommerce onto Next.js and NestJS.

The full diagnosis and the phased plan live in [`docs/plan.html`](docs/plan.html).
The short version of _why_: over 178 days the legacy store earned **233 organic
clicks** (1.3/day), 69.6% of its impressions landed on a single page, and **not one
of its sixteen category pages ever received a single impression** — they were
missing from every sitemap. That is a structural problem, not a hosting one.

---

## Stack

| Layer          | Choice                                                  |
| -------------- | ------------------------------------------------------- |
| Storefront     | Next.js 16 App Router, React 19, Tailwind 4, next-intl  |
| Admin          | Next.js 16, RTL-first Arabic                            |
| API            | NestJS 12 on Fastify                                    |
| Database       | PostgreSQL 18, Prisma 7 (pg driver adapter)             |
| Cache / queues | Redis 7, BullMQ                                         |
| Search         | Meilisearch, with Arabic folding                        |
| Payments       | Stripe + PayPal, bank transfer / crypto as a fallback   |
| Locales        | `ar` at the root, `en` under `/en`, reciprocal hreflang |

TypeScript is pinned to **6.0.x**. TypeScript 7 is the new native compiler and
NestJS depends on `emitDecoratorMetadata`; that upgrade is a deliberate task,
not a drive-by.

## Layout

```
apps/
  storefront   public store            :3000
  admin        staff panel             :3001
  api          REST API + OpenAPI      :4000
packages/
  db           Prisma schema, two clients (app role + vault role)
  contracts    zod schemas — every Json column in the DB has a shape here
  seo          JSON-LD, hreflang, sitemaps, robots
  i18n         Arabic search folding, currency display
  ui           design tokens, performance budget
workers/
  jobs         BullMQ workers: key delivery, mail, cart recovery, FX, sitemaps
```

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm secrets:generate         # fills every empty secret with real randomness
pnpm env:check                # then fill in the rest, and verify
pnpm infra:up                 # postgres, redis, meilisearch, mailpit
pnpm db:migrate               # applies prisma/migrations
pnpm db:seed                  # currencies, groups, brands, category tree
pnpm db:doctor                # asserts the setup, including vault isolation
pnpm dev                      # all three apps + the worker
```

Mail goes to [Mailpit](http://localhost:8025) in development, so no real
customer can be emailed from a dev machine.

## The two things that are easy to get wrong

**1. The licence vault is a separate Postgres schema on a separate role.**

`vault.LicenseKey` holds the product itself: a leaked key cannot be recovered.
So `packages/db/prisma/init/01-roles.sql` creates three roles —

- `da` owns the database and is used only by `prisma migrate`
- `da_app` is the API's normal role and has **no grant on `vault` at all**
- `da_vault` reaches the vault and is injected only into the vault module

Keys are stored with envelope encryption (AES-256-GCM per-row DEK, wrapped by a
KEK in KMS), never logged, never returned by a list endpoint, and revealing one
requires a fresh TOTP challenge plus a `KeyAccessLog` row. Bulk export needs two
staff approvals. `KEK_PROVIDER=local` is refused in production.

Import `vaultPrisma` from `@da/db` **only** inside the vault module. The role
split is worth something exactly as long as that stays true.

**2. Structured data is built in one place.**

`packages/seo/src/jsonld.ts` is the only producer of JSON-LD, and `buildGraph`
throws in development if a page ends up with two `Product` entities. This is not
hypothetical tidiness — the legacy product page emitted two conflicting
`Product` blocks:

```
block A: price  9.90 USD, InStock
block B: price 36.36 USD, OutOfStock   ← and 36.36 was the AED figure
```

Google discards markup that contradicts itself, which is why the store emitted
rich data and received no rich results. The price handed to the builder is the
same `DisplayPrice` object the page renders, so the two cannot drift.

## Legacy data

`Old Website/` is **gitignored and must stay that way.** It contains a 346 MB site
tarball and a SQL dump whose `wp_comments` rows carry plaintext customer licence
keys and Office 365 and Adobe account passwords — staff used order notes as the
delivery mechanism. Treat it as a secret asset: encrypted at rest, destroyed
after the migration, and never pasted into an issue, a log or a screenshot.

The migration moves those values into the encrypted vault and then scrubs the
source rows. `LegacyMap` records every old id and URL so the 301 map can be
generated and a partial import can be safely re-run.

## Commands

| Command                        | What it does                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `pnpm dev`                     | every app and the worker in watch mode                                                                |
| `pnpm build`                   | build all                                                                                             |
| `pnpm typecheck`               | strict typecheck across the workspace                                                                 |
| `pnpm secrets:generate`        | generate the local secrets into .env; `--print` for a set to paste into Coolify                       |
| `pnpm env:check`               | diff .env against .env.example and flag unsafe values, without printing any                           |
| `pnpm db:validate`             | validate the Prisma schema                                                                            |
| `pnpm db:doctor`               | prove a real database is wired correctly, including that the vault is actually denied to the app role |
| `pnpm db:migrate`              | create and apply a migration                                                                          |
| `pnpm db:studio`               | Prisma Studio                                                                                         |
| `pnpm infra:up` / `infra:down` | local services                                                                                        |

Deploying to Coolify: see [`docs/deployment.md`](docs/deployment.md).

CI runs typecheck, lint, tests, a **schema-drift check** (committed migrations
must reproduce the schema exactly), Lighthouse CI against the performance budget,
and a secret scan that rejects any legacy backup artefact.
