# Current-state audit (corrected)

**Task:** TASK-0004 under CR-0002 · **Date:** 2026-09-29 · **Commit:** `434fa1c`
(origin/main) · Supersedes the TASK-0003 audit of the same day.

**Method (read-only throughout):**

- Git: remote, branches, full-history search for legacy artefacts
- Code: grep and targeted reads
- Live checks: HTTP GETs to every project hostname
- Database: row counts and privilege checks through the `da_app` and `da_vault`
  roles

No secret, key, credential or backup content was read or reproduced. No
application code, schema, environment, Coolify setting, Git history or data was
changed.

Evidence labels:

- **[code]**: read at the cited line
- **[live]**: observed on the running hosts on 2026-09-29
- **[db]**: counted in the database the staging API serves
- **[inferred]**: reasoned, not observed

---

## 1. Executive summary

- **The project.** Digital Activation sells software licence keys. It is being
  rebuilt from WordPress/WooCommerce as a Node.js monorepo: a Next.js
  storefront, a Next.js admin panel, and a NestJS API on PostgreSQL and Redis.
- **The old WordPress site.** It is still the live public store on the apex,
  `digital-activation.com`, hosted at Hostinger (PHP 8.1) **[live]**. Its files
  in the main checkout under `Old Website/` are a backup and migration source.
  They are not part of the new application.
- **The new Node.js application.** It is on GitHub
  (`mertsadek91-rgb/digital-activation`) and deployed through Coolify. It runs as
  a test version: storefront on `new.digital-activation.com`, admin on
  `admin.digital-activation.com`, API on `api.digital-activation.com` **[live]**.
  API health, database and Redis all report up. Indexing is correctly blocked.
- **Migration.** The catalogue, pages, articles, media and redirects are
  migrated and serve on staging. Customers, orders and delivered keys are not,
  and the owner still has to decide whether they should be.
- **Production readiness.** The application works end to end on bank transfer.
  It is not production-ready: card payments are off, and there is no error
  tracking, no tested backup restore and no cutover runbook. Staging will become
  production in place (DEC-0011), so its demo data must be removed at cutover.
- **The previous CRITICAL finding.** It belongs to the **legacy WordPress site**
  and the **local backup**. It is not in Git, the new database, any build or any
  container. The new application is not at risk from it.

## 2. Actual architecture

```
                  Cloudflare (DNS + proxy for every hostname)
                                    │
   ┌──────────────────────────┬─────┴─────────────────────┬────────────────────────────┐
   │ digital-activation.com   │ new.digital-activation.com │ admin.digital-activation.com│
   │ LEGACY WordPress         │ storefront (Next.js 16)    │ admin (Next.js 16)          │
   │ Hostinger, PHP 8.1       │ Coolify :3000              │ Coolify :3001               │
   └──────────────────────────┴────────────┬──────────────┴──────────────┬─────────────┘
                                            │  https://api.digital-activation.com (CORS)
                                            ▼
                          api — NestJS 12 on Fastify, Coolify :4000
                          /v1/*, /health, /health/ready
                          9 cron sweeps in-process (@nestjs/schedule)
                          ├── PostgreSQL 18   public schema  ← role da_app
                          │                   vault schema   ← role da_vault only
                          ├── Redis 7         throttling, cart and session helpers
                          ├── AWS KMS         wraps vault data keys (KEK)
                          ├── Cloudflare R2   media, cdn.digital-activation.com
                          ├── Stripe          implemented, not enabled on staging
                          ├── Mail            SMTP / Resend / capture
                          └── WhatsApp Graph API, FX feed
                          jobs worker (workers/jobs): stub, pings Redis only
```

| Area     | Implementation                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime  | Node ≥ 22.12 (22.17 locally), pnpm 9.15, Turbo, TypeScript 6.0                                                                                   |
| Frontend | Next.js 16 App Router, React 19, Tailwind 4, next-intl (`ar` at `/`, `en` at `/en`); per-request nonce CSP                                       |
| Backend  | NestJS 12 on Fastify, zod contracts, OpenAPI                                                                                                     |
| Database | PostgreSQL through Prisma 7 with the pg driver adapter. 70 models in 9 schema files; 18 migrations, all applied to the staging database **[db]** |
| Auth     | Staff: Argon2id + mandatory TOTP, 15-minute JWT cookie, 30-day rotating refresh. Customers: 15-minute magic link, 12-hour session                |
| Vault    | AES-256-GCM per-row key wrapped by KMS. The app role has no access to the `vault` schema **[db]**, and the vault role cannot DELETE **[db]**     |
| Storage  | Cloudflare R2 through the S3 API                                                                                                                 |
| Jobs     | Cron sweeps inside the API; the BullMQ worker is a stub                                                                                          |
| Deploy   | Coolify builds from GitHub with per-app build and start commands (`docs/deployment.md` §3). No Dockerfile, no CD job                             |

## 3. Repository map

| Path                                                       | Class               | Purpose                                                                              |
| ---------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| `apps/storefront`                                          | CURRENT             | public store                                                                         |
| `apps/admin`                                               | CURRENT             | staff panel                                                                          |
| `apps/api`                                                 | CURRENT             | REST API, crons, vault, payments, mail                                               |
| `workers/jobs`                                             | CURRENT (stub)      | BullMQ worker; declares queues but has no processors                                 |
| `packages/db/prisma`                                       | CURRENT             | schema, migrations, role SQL                                                         |
| `packages/db/src`                                          | CURRENT             | the two Prisma clients                                                               |
| `packages/db/scripts/{import,legacy,media,seo}`            | MIGRATION           | one-off importers that read the WordPress XML export and tarball; dry-run by default |
| `packages/db/scripts/{seed,demo,staff,doctor,setup-roles}` | DEVOPS              | seeding, demo data, staff bootstrap, setup checks                                    |
| `packages/{contracts,seo,i18n,ui}`                         | CURRENT             | shared libraries                                                                     |
| `scripts/`                                                 | DEVOPS              | env check, secret generation, SMTP, tunnel, DB URLs                                  |
| `.github/workflows/ci.yml`                                 | DEVOPS              | CI (no deployment)                                                                   |
| `docker-compose.yml`                                       | DEVOPS              | local services only; not used by Coolify                                             |
| `docs/`                                                    | CURRENT             | plan and deployment runbook                                                          |
| `design-system/`                                           | CURRENT, stale      | generic template (BUG-0009)                                                          |
| `.agents/`                                                 | DEVOPS              | vendored agent skills                                                                |
| `project-management/`                                      | GOVERNANCE          | this tree                                                                            |
| `**/dist`, `.next`, `.turbo`, `packages/db/generated`      | GENERATED           | gitignored                                                                           |
| `Old Website/` (main checkout only)                        | LEGACY              | WordPress backup and migration source; untracked                                     |
| `.cache/` (main checkout only)                             | MIGRATION + scratch | extracted uploads, media output, captured mail, test scratch; untracked              |

## 4. GitHub state

- **Remote:** `https://github.com/mertsadek91-rgb/digital-activation.git`.
  Default branch `main`, at `434fa1c` (PR #6 merged).
- **Remote branches:** `main` plus five merged `claude/*` feature branches.
  There are 20+ local agent branches that were never pushed.
- **Tracked files:** 821. No `.sql` outside `packages/db/prisma`, no archives,
  no WordPress paths — in HEAD or in any branch's history
  (`git log --all --diff-filter=A`).
- **Uncommitted:** only this session's work: `project-management/`, four config
  edits and `.claude/launch.json`, on branch
  `claude/enterprise-multi-agent-governance-451ac4`.
- **CI:** format, typecheck, lint, test, OpenAPI; schema drift and integration
  tests against Postgres 18; Lighthouse; gitleaks and a legacy-artefact guard.
  **No deployment workflow.** Coolify deploys on its own trigger, which cannot
  be seen from the repository.

## 5. Coolify deployment state

| Resource    | Build (docs §3)                                         | Start                                | Port                  | Domain [live]                  | State [live]                                          |
| ----------- | ------------------------------------------------------- | ------------------------------------ | --------------------- | ------------------------------ | ----------------------------------------------------- |
| storefront  | `pnpm install … && pnpm db:generate && pnpm --filter …` | `pnpm --filter @da/storefront start` | 3000                  | `new.digital-activation.com`   | 200, noindex                                          |
| admin       | same                                                    | `… @da/admin start`                  | 3001                  | `admin.digital-activation.com` | 307 → `/queue`; `/login` 200; `x-robots-tag: noindex` |
| api         | same                                                    | `… @da/api start`                    | 4000                  | `api.digital-activation.com`   | `/health` ok; `/health/ready` database up, redis up   |
| jobs        | same                                                    | `… @da/jobs start`                   | —                     | —                              | unknown (no endpoint)                                 |
| Postgres    | Coolify resource                                        | —                                    | published port in use | —                              | up (18 migrations applied)                            |
| Redis       | Coolify resource                                        | —                                    | internal              | —                              | up                                                    |
| Meilisearch | Coolify resource (per docs)                             | —                                    | internal              | —                              | unknown; unused by code                               |

- **Environment values** (mail transport, KEK provider, salt, Stripe keys) live
  in Coolify and cannot be seen from the repository.
- **Observable on staging:** only `BANK_TRANSFER` is offered **[live]**; the CSP
  allows only the API and Stripe.
- **Health checks:** `/health` and `/health/ready` on the API only.

## 6. Domain inventory

| Domain                                       | Purpose                                          | Environment                            | Referenced in                                                                  | Class                                                            |
| -------------------------------------------- | ------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `digital-activation.com`                     | legacy store today; production storefront target | production (legacy) → production (new) | `packages/seo` `PRODUCTION_ORIGIN`, `.env.example`, CI Lighthouse, 74 URL refs | Legacy WordPress now **[live]**; Production target               |
| `www.digital-activation.com`                 | legacy alias                                     | production (legacy)                    | 1 ref                                                                          | Legacy WordPress                                                 |
| `new.digital-activation.com`                 | new storefront                                   | staging                                | `.env.example`, `layout.tsx`, `robots.ts`                                      | Staging **[live]**                                               |
| `admin.digital-activation.com`               | new admin                                        | staging now, production target         | `docs/deployment.md`                                                           | Current Node.js **[live]**                                       |
| `api.digital-activation.com`                 | new API                                          | staging now, production target         | `docs/deployment.md`, staging CSP                                              | Current Node.js **[live]**                                       |
| `cdn.digital-activation.com`                 | R2 media                                         | both                                   | `.env.example`, docs                                                           | Current Node.js (`/` returns 404, as expected for a bucket root) |
| `mail.digital-activation.com`                | marketing sender subdomain                       | production                             | `.env.example`, `mail.service.ts`                                              | Production target (DNS not checked)                              |
| `localhost:3000/3001/4000/7700/8025`         | local apps, Meilisearch, Mailpit                 | development                            | `.env.example`, compose                                                        | Development                                                      |
| `*.example.invalid`, `*.test`, `example.com` | test fixtures                                    | test                                   | tests, `db:demo`                                                               | Development                                                      |
| `da-git-main-xyz.vercel.app`                 | example in a comment                             | —                                      | 1 ref                                                                          | Unknown / illustrative                                           |

## 7. WordPress backup analysis

Everything below sits in the **main checkout only**, `D:\Cloude\digital-activation\`.
All of it is untracked and gitignored, and none of it has ever been in Git
history or in a build context.

| Item                                                     | What it is                                                                                                        | Read by code?                                                                           | Remaining value                                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `Old Website/Full Backup/…_da_main…sql.gz`               | full WordPress database dump (2026-09-08)                                                                         | **No code reads it**                                                                    | The **only** source of legacy customers, orders, delivered keys and credentials; reconciliation evidence                                 |
| `Old Website/Full Backup/…digital-activation-com…tar.gz` | full site archive: WP core, themes, plugins, uploads, `wp-config.php`                                             | `db:media` extracts `wp-content/uploads` from it (media/index.ts:170-257)               | Media already extracted to `.cache/uploads/` (1,364 files), which the script prefers. Also the only file-level backup of the legacy site |
| `Old Website/Backup XML …/WordPress.2026-09-09.xml`      | WXR export: 101 products, 15 pages, 7 posts, 7 coupons, 192 attachments, 572 comments. **No orders or customers** | `db:import`, `legacy/pages.ts`, `legacy/articles.ts`, `legacy/redirects.ts`, `db:media` | Re-running or regenerating catalogue, pages, articles and redirects. Contains reviewer PII in comments                                   |
| `Old Website/MD Files + Json + Desgin + Skill/`          | 11 design notes, 11 token files, 11 skill notes (duplicates)                                                      | No                                                                                      | historical reference only                                                                                                                |
| `Old Website/ScreenShuts/`                               | 13 screenshots of the old site                                                                                    | No                                                                                      | historical reference only                                                                                                                |
| `.cache/uploads/` (126 MB)                               | extracted `wp-content/uploads`                                                                                    | `db:media` cache                                                                        | needed only if media is re-imported                                                                                                      |
| `.cache/media-out/` (2.2 MB)                             | processed media and manifest                                                                                      | `db:media` output; wiped on re-run (line 613)                                           | none once R2 holds the files                                                                                                             |
| `.cache/mail/`                                           | captured development emails                                                                                       | written by the capture transport                                                        | none                                                                                                                                     |
| `.cache/*.txt`, `wh*.json`, `preview-token.txt`          | scratch from manual race and webhook tests                                                                        | **No code reads them**                                                                  | none. `preview-token.txt` may hold a preview token and `wh-header.txt` a test webhook signature, so treat them as secrets when deleting  |

**Deployed?** No. There is no Dockerfile. Coolify builds from GitHub, where none
of these files exist, and the storefront's `public/` holds only `brand/logo.webp`.

## 8. WordPress deletion recommendation — **B. WORDPRESS BACKUP PARTIALLY REQUIRED**

**KEEP (move into an encrypted archive; do not leave in the working tree):**

- **The SQL dump.** It is the only copy of legacy customers, orders and keys
  outside the live site. It is required until TASK-0043 decides the migration
  scope, and under options A or B until that import is done and reconciled.
  Under option C, keep it archived until the legacy site is retired.
- **The site tarball.** It is the only file-level backup of the legacy site, so
  it is the recovery asset if WordPress must be restored during or after
  cutover. It also contains `wp-config.php` with the legacy database
  credentials. Keep it archived, not in the repo folder, until at least 30 days
  after cutover.
- **The XML export.** Five import scripts read it. It is required until the
  staging redirect crawl (TASK-0042) passes and no re-import is planned.

**SAFE TO REMOVE NOW** (not read by any code, never tracked, never deployed):

- `Old Website/MD Files + Json + Desgin + Skill/`
- `Old Website/ScreenShuts/`
- `.cache/mail/`
- the `.cache` scratch files: `ae.txt`, `c1-3.txt`, `co.txt`, `md.txt`,
  `stranger.txt`, `race-*.txt`, `wh-header.txt`, `wh-payload.json`, `wh.json`,
  `preview-token.txt`

**REMOVE LATER** (once media is confirmed complete on R2):

- `.cache/uploads/`
- `.cache/media-out/`

## 9. Migration matrix

| Data                         | WordPress source                  | Node.js destination            | Migration code                    | Migrated?                                                                                               | Verified?                                                                        |
| ---------------------------- | --------------------------------- | ------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Products and variants        | XML (`product`)                   | Product, Variant, translations | `db:import`                       | **COMPLETE**: 101 variants, 105 LegacyMap rows; 71 published, 1 draft, 1 archived **[db]**              | Yes: 71 served by the staging API **[live]**                                     |
| Categories and brands        | XML taxonomy                      | Category, Brand                | `db:seed` + `db:import`           | **COMPLETE**: 16 categories, 17 brands **[db]**                                                         | Yes: 15 and 15 in the sitemap feed **[live]**                                    |
| Images and media             | tarball uploads + XML attachments | Asset, ProductMedia on R2      | `db:media`                        | **PARTIAL**: 52 assets and 53 product-media rows **[db]**; the script targets the 68 attachments in use | UNKNOWN: not counted against the 68                                              |
| Pages                        | XML (`page`)                      | Page (+versions)               | `legacy/pages.ts`                 | **COMPLETE** for the mapped legal pages; 8 pages **[db]**                                               | Partly: the English legal text does not exist                                    |
| Articles                     | XML (`post`)                      | Article                        | `legacy/articles.ts` + `db:blog*` | **COMPLETE**: 18 articles **[db]** (7 legacy + new)                                                     | Yes                                                                              |
| SEO metadata                 | XML meta + `seo/*` scripts        | translations, SeoSetting       | `db:seo`, `db:titles`, `db:faq` … | **COMPLETE** as a rewrite, not a copy                                                                   | Yes: publish gate                                                                |
| Redirects                    | XML URLs + LegacyMap              | Redirect                       | `legacy/redirects.ts`             | **COMPLETE**: 102 migration + 3 manual **[db]**                                                         | Sampled: 6 of 6 plus `/feed/` resolve **[live]**; full crawl pending (TASK-0042) |
| Coupons                      | XML (`shop_coupon`, 7)            | Promotion                      | none                              | **NOT STARTED** (1 promotion exists, created by hand)                                                   | —                                                                                |
| Customers                    | SQL dump only                     | Customer                       | none                              | **NOT STARTED**: 6 customers, 5 of them demo **[db]**                                                   | —                                                                                |
| Orders and payments          | SQL dump only                     | Order, Payment                 | none                              | **NOT STARTED**: 5 orders, 4 of them demo **[db]**                                                      | —                                                                                |
| Licence keys and credentials | SQL dump order notes              | vault LicenseKey               | none                              | **NOT STARTED**: 1 key in the vault, a test delivery **[db]**                                           | —                                                                                |
| Staff and admins             | WP users                          | StaffUser                      | `db:staff` (new accounts)         | **NOT REQUIRED**: new staff enrol fresh with TOTP; 1 staff user **[db]**                                | Yes                                                                              |
| Reviews                      | XML comments (572, 565 synthetic) | Review                         | none, by decision                 | **NOT REQUIRED** (DEC-0004 / plan)                                                                      | Yes: 4 reviews, all native                                                       |
| Settings                     | WP options                        | Setting                        | none                              | **NOT REQUIRED**: configured in the admin panel                                                         | —                                                                                |
| Email templates              | WooCommerce and plugin emails     | code templates                 | none                              | **NOT REQUIRED**: rewritten in `mail/`                                                                  | —                                                                                |

## 10. Current Node.js application audit

**Functional**

- Only bank transfer can be used on staging. Card payment is coded but not
  enabled. PayPal returns 503.
- An emailed order link can view the order but cannot start a card payment
  (BUG-0006, dormant until card payment is on).
- The English legal pages show Arabic text with a notice.

**Security** (all re-verified in the code)

| ID       | Severity | Finding                                                                          |
| -------- | -------- | -------------------------------------------------------------------------------- |
| BUG-0002 | MEDIUM   | the fingerprint salt is not enforced in production                               |
| BUG-0004 | MEDIUM   | refresh-token replay is refused but does not revoke the session                  |
| BUG-0005 | LOW      | deactivation and logout take up to 15 minutes to take effect                     |
| BUG-0003 | LOW      | the vault access log cascades on delete, but the database already refuses DELETE |
| BUG-0007 | LOW      | order links never expire; secrets are reused across purposes                     |

TASK-0015 (READONLY route scoping) is still an open review, not a finding.

**Architecture**

- BUG-0001 (HIGH, reliability): session advisory locks go through a pooled
  client. The nine sweeps, stranded-order redelivery among them, can skip
  silently. They are live on staging now.
- The BullMQ worker is a stub; all scheduled work runs inside the API.
- Checkout embeds Stripe directly, with no provider interface (DEC-0002 asked
  for one).
- Meilisearch is required at boot but unused (BUG-0008).

**Technical debt**

- Unused models (Loyalty, Campaign, Segment, Experiment, Invoice, Supplier and
  others).
- `design-system/MASTER.md` is stale (BUG-0009).
- The two performance budgets disagree (BUG-0010).
- The admin panel does not load Tajawal (BUG-0011).
- `deployment.md` has a stale number (BUG-0012).

**Missing**

- error tracking and alerting
- backup restore drill and PITR
- rollback and cutover runbook
- deploy configuration as code
- analytics
- frontend and E2E tests
- PayPal
- coupon, customer, order and key migration
- two-person bulk export

## 11. Re-evaluated security findings

| Finding                                                 | Previous interpretation   | Verified reality                                                                                                                                                                                                                               | Correct severity                                                                 | Action                                                                                                       |
| ------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Plaintext keys and credentials in order notes           | CRITICAL; project AT_RISK | **A. Live WP:** applies (inferred from the dump; site still live). **B. Local backup:** applies. **C. Git:** no, in all history. **D. New DB:** no (1 test key). **E. New runtime:** no code path. **F. Deployment:** not in the build context | A: HIGH (LEGACY_WORDPRESS), BUG-0014. B: MEDIUM (MIGRATION), BUG-0015. C–F: none | Owner hardens the WP admin until cutover; decide migration scope (TASK-0043); archive and encrypt the backup |
| Fingerprint salt unenforced                             | HIGH                      | True, but the column sits in a schema the app role cannot touch **[db]**                                                                                                                                                                       | MEDIUM                                                                           | TASK-0011                                                                                                    |
| KeyAccessLog cascade                                    | MEDIUM                    | FK cascades, but `da_vault` has no DELETE **[db]**                                                                                                                                                                                             | LOW                                                                              | TASK-0012                                                                                                    |
| Refresh replay                                          | MEDIUM                    | Confirmed                                                                                                                                                                                                                                      | MEDIUM                                                                           | TASK-0013                                                                                                    |
| Deactivated staff window                                | MEDIUM                    | Confirmed; 15 minutes, and revealing a key needs a step-up                                                                                                                                                                                     | LOW                                                                              | TASK-0014                                                                                                    |
| Emailed link cannot pay                                 | MEDIUM                    | Confirmed; no online method enabled                                                                                                                                                                                                            | LOW (MEDIUM once cards are on)                                                   | TASK-0017                                                                                                    |
| Order-link expiry and secret reuse                      | LOW                       | Confirmed                                                                                                                                                                                                                                      | LOW                                                                              | TASK-0018                                                                                                    |
| Advisory locks on the pool                              | HIGH                      | Confirmed in code; sweeps live on staging                                                                                                                                                                                                      | HIGH (reliability)                                                               | TASK-0010                                                                                                    |
| Staging becomes production in place, carrying demo data | not identified            | Confirmed **[live][db]**                                                                                                                                                                                                                       | MEDIUM (operations)                                                              | TASK-0044                                                                                                    |

## 12–13. Bugs and tasks

Every record carries a `reaudit` verdict and an `affected_system`; see the
dashboard or `ISSUE_INDEX.json` / `TASK_INDEX.json`.

## 14. Actual project phase

The evidence shows:

- development is largely complete
- catalogue and content migration are complete
- **staging is deployed and running** on Coolify under the final API and admin
  hostnames
- the transactional migration (customers, orders, keys) has not started
- the legacy site still holds the apex

**Phase: Staging / validation, before production cutover.** The next boundary
is the cutover: move the storefront from `new.` to the apex, and point DNS for
the apex from Hostinger to Coolify.

## 15. Production readiness

| Area           | State     | Evidence                                                                                 |
| -------------- | --------- | ---------------------------------------------------------------------------------------- |
| Application    | PARTIAL   | full flow works on bank transfer; a HIGH reliability bug (BUG-0001) is open              |
| Database       | READY     | 18 migrations applied, role isolation proven live, CI drift check                        |
| Security       | PARTIAL   | strong core; two MEDIUM and three LOW findings; salt unknown in Coolify                  |
| Payments       | NOT READY | bank transfer only; Stripe not enabled; PayPal not built                                 |
| Migration      | PARTIAL   | catalogue and content complete; customers, orders and keys undecided                     |
| SEO            | PARTIAL   | redirects sampled OK, staging noindexed, hreflang and sitemaps built; full crawl pending |
| Infrastructure | PARTIAL   | running on Coolify; config not in the repo; staging data to clear                        |
| Monitoring     | NOT READY | no error reporter installed; no alerting or uptime checks                                |
| Backup         | UNKNOWN   | the Coolify schedule is documented but not verified; no restore drill                    |
| Rollback       | NOT READY | no runbook (WordPress on Hostinger is the implicit fallback)                             |
| QA             | PARTIAL   | about 430 API unit tests and 2 integration suites in CI; no frontend or E2E tests        |

## 16. What is already working

Each of these was observed on staging or confirmed in the database:

- storefront (ar and en)
- admin panel with mandatory TOTP
- API with health checks
- catalogue of 71 published products
- category and brand pages
- blog
- cart and checkout on bank transfer
- manual payment confirmation
- licence vault with KMS envelope encryption and a working delivery (1 key
  delivered, 2 access-log rows)
- customer magic-link portal
- legacy redirects
- noindex protection on staging
- CI pipeline with a schema-drift check
- secret scanning with a legacy-artefact guard
- role isolation of the vault

## 17. Remaining work, in order

1. TASK-0010: fix the sweep locks (HIGH; live on staging).
2. Owner inputs: TASK-0043 (migration scope), CONSENSUS-0001 (payments),
   TASK-0011 (salt).
3. TASK-0031: error reporting and alerting.
4. TASK-0030: backup restore drill.
5. TASK-0042: full redirect crawl on staging.
6. TASK-0013, TASK-0012, TASK-0014: auth and vault hardening.
7. TASK-0021: payment provider interface and card payments (after
   CONSENSUS-0001).
8. TASK-0040 / TASK-0041: legacy data, if in scope.
9. TASK-0060: end-to-end test from card payment to key delivered.
10. TASK-0044 then TASK-0032: staging-to-production list and cutover runbook.
11. Cutover.

## 18. Decisions required from the owner

See PROJECT_STATUS.md.

## 19. Recommended next task

**TASK-0010.** It is the only open HIGH in the new application. It is live on
staging now, has no dependencies, and sits under the fulfilment path. Start by
writing an integration test against a local Postgres that proves or disproves
it; not against staging.

## 20. Files proposed for removal

| Path                                                                      | Purpose                          | Used?                 | Git tracked? | Deployed? | Safe to remove?                           | Reason                                                                                                |
| ------------------------------------------------------------------------- | -------------------------------- | --------------------- | ------------ | --------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `Old Website/MD Files + Json + Desgin + Skill/`                           | old design notes (duplicated)    | No                    | No           | No        | **Yes**                                   | not referenced; the new system uses `tokens.css`                                                      |
| `Old Website/ScreenShuts/`                                                | screenshots of the old site      | No                    | No           | No        | **Yes** (optionally archive)              | reference only                                                                                        |
| `.cache/mail/`                                                            | captured dev emails              | written, never read   | No           | No        | **Yes**                                   | regenerated on demand                                                                                 |
| `.cache/{ae,c1,c2,c3,co,md,stranger}.txt`, `race-*.txt`                   | test scratch                     | No                    | No           | No        | **Yes**                                   | not referenced by code                                                                                |
| `.cache/wh-header.txt`, `wh-payload.json`, `wh.json`, `preview-token.txt` | webhook and preview test scratch | No                    | No           | No        | **Yes**; treat as secrets (secure delete) | may hold a test signature or preview token                                                            |
| `.cache/media-out/`                                                       | media import output              | re-run only           | No           | No        | After media is verified on R2             | wiped by the script on re-run anyway                                                                  |
| `.cache/uploads/`                                                         | extracted uploads                | `db:media` cache      | No           | No        | After media is verified on R2             | tarball remains the source                                                                            |
| `Old Website/Backup XML …/WordPress.2026-09-09.xml`                       | WXR export                       | 5 scripts             | No           | No        | **Not yet**                               | until the redirect crawl passes and no re-import is planned                                           |
| `Old Website/Full Backup/…sql.gz`                                         | WP database dump                 | No code yet           | No           | No        | **No**                                    | only source of customers, orders and keys; archive encrypted                                          |
| `Old Website/Full Backup/…tar.gz`                                         | full WP site archive             | `db:media` (fallback) | No           | No        | **No**                                    | legacy disaster-recovery copy, holds `wp-config.php`; archive encrypted until ≥ 30 days after cutover |
