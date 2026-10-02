# Project knowledge base

Facts about how the system is built, as of `434fa1c` (2026-09-29). For _why_,
see `docs/plan.html` and `decisions/`. For _what is wrong with it_, see
[CURRENT_STATE_AUDIT.md](CURRENT_STATE_AUDIT.md).

## Business context

- **Product:** software activation keys (Windows, Office, ESET, McAfee, Adobe …)
  delivered digitally, sold primarily to Arabic-speaking buyers.
- **Entity:** Turkish (TR34, Istanbul). Stripe acceptance for it is unconfirmed
  (plan's top risk; CONSENSUS-0001).
- **Why the rebuild:** 233 organic clicks in 178 days, 69.6% of impressions on
  one page, 16 category pages never indexed, a manual-only payment gateway and a
  31.9% cancellation rate, two contradictory Product JSON-LD blocks per page.
- **Release 1** = replace WordPress: catalogue, store, checkout, vault, portal,
  admin, SEO foundation, migration, cutover. **Release 2** = marketing engine.
  **Phase 3** = growth content.

## Users and roles

| Who             | How they authenticate                                                                       | Where enforced                    |
| --------------- | ------------------------------------------------------------------------------------------- | --------------------------------- |
| Visitor / buyer | anonymous cart cookie                                                                       | controller checks                 |
| Customer        | passwordless magic link (15 min, single use) → `da_customer` 12 h                           | `require()` in account controller |
| Staff           | email + Argon2id password + mandatory TOTP → `da_access` JWT 15 min + rotating refresh 30 d | `StaffGuard` + `@Roles`           |

Staff roles: `OWNER` (always passes), `ADMIN`, `CATALOG`, `MARKETING`,
`SUPPORT`, `FULFILLMENT`, `READONLY`. There is no finer permission model.
Vault reveal: ADMIN only, fresh TOTP within 15 min, throttled, logged first.

## Modules (API)

Account · Admin · Auth · Cart · Catalog · Checkout · Content · Fulfillment ·
Mail · Marketing · MarketingSignals · Media · Offers · Prisma · Retention ·
Reviews · Subscriptions · Vault · Whatsapp · Infra (+ Growth, Sales via
imports). All under `/v1` except `/health` and `/health/ready`.

## Scheduled work (inside the API)

| Job               | Schedule       | Purpose                                    |
| ----------------- | -------------- | ------------------------------------------ |
| fx-refresh        | 03:00          | exchange rates (open.er-api.com default)   |
| expire-drafts     | hourly         | expire abandoned draft orders              |
| stranded-orders   | every 5 min    | re-deliver paid orders stuck in fulfilment |
| referral-sweep    | 04:00          | referral rewards after refund window       |
| referral-expiry   | 05:00          | expire referral rewards                    |
| cart-recovery     | every 10 min   | abandoned-cart ladder                      |
| renewal-reminders | 10:00 store tz | subscription renewal reminders             |
| review-invites    | hourly         | verified-buyer review invitations          |
| back-in-stock     | every 10 min   | stock alerts                               |

Each guards itself with a Postgres advisory lock — see BUG-0001.

## Data model (70 models, 9 schema files)

- **Catalog:** Brand, Category, Product (+Translation), Variant, Tag, relations, Asset/AssetAlt/ProductMedia
- **Inventory:** InventoryLevel, StockReservation, StockMovement, Supplier
- **Vault (`vault` schema):** LicenseKey, KeyAccessLog
- **Customers/staff:** Customer, CustomerGroup, CustomerAddress, CustomerLoginToken, CustomerSession, StaffUser, StaffSession, AuditLog (hash chain)
- **Orders/payments:** Cart, CartItem, CartRecoveryEvent, Order, OrderItem, OrderNote, OrderStatusEvent, Payment, Refund, Invoice, Currency, FxRate
- **Marketing:** Promotion(+Usage), Segment, Campaign, Review, ReviewInvite, Loyalty\*, Referral(+Redemption), PushSubscription, NotificationLog, WhatsappInbound, StockAlert, RenewalReminder
- **Content/SEO:** Page(+Version), Article, Author, Navigation, Redirect, ContactMessage, NotFoundLog, SeoSetting, Experiment
- **System/legacy:** Setting, WebhookEvent, IdempotencyKey, LegacyMap

DB roles: `da` (owner, migrations only) · `da_app` (API, **no grant on vault**) ·
`da_vault` (vault module only).

## Integrations

Stripe (implemented, optional) · PayPal (not built) · bank transfer / crypto
(manual confirm by OWNER/ADMIN) · AWS KMS (vault KEK) · Cloudflare R2 via S3 API
· SMTP / Resend / capture mail (capture refused in production) · WhatsApp Graph
API v21 · FX feed. (Meilisearch removed 2026-10-02, DEC-0009.)

## Storefront

Routes under `[locale]`: home, store, store/[slug], collections/[slug],
brands/[slug], blog, blog/[slug], search, cart, checkout, orders/[number],
account (orders, licenses, reviews, referral, for-you), contact,
golden-warranty, newsletter confirm/unsubscribe, r/[code], and a catch-all for
legal/editorial pages and legacy redirects. Sitemap index + five section
sitemaps, robots, manifest. Middleware is `src/proxy.ts` (Next 16 name).

## Design system

`packages/ui/src/tokens.css` (Tailwind 4 `@theme`) is authoritative: brand teal
`#148576`, amber `#faa21b` for offers only, Tajawal (400/500/700/800) + IBM Plex
Mono, a 15 px spacing grid, 44 px touch targets, reduced-motion respected.
`design-system/digital-activation/MASTER.md` is a stale generic template —
ignore it (BUG-0009).

## SEO

`/` Arabic, `/en` English, `x-default = ar`. Per-page canonical; filtered
listings noindex; non-apex hosts noindex; AI crawlers welcomed in robots.
WordPress sitemap and feed URLs 301 in `next.config.ts`; ~180 legacy URLs map
through the database (308, BUG-0013).

## Analytics

None. The CSP allows only the API and Stripe; Lighthouse enforces zero
third-party requests. Any analytics must be first-party (TASK-0050).

## Infrastructure

**Live state, 2026-09-29 (CR-0002):** staging runs on Coolify. Storefront `new.`, admin `admin.`, API `api.digital-activation.com`, with Postgres and Redis up. The apex is still the legacy WordPress site on Hostinger. This one environment becomes production in place (DEC-0011).

Coolify: storefront :3000, admin :3001, api :4000, jobs worker; Postgres 18,
Redis 7 on the internal network. Migrations run as a release
command. `pnpm db:doctor` is the pre-DNS gate. Locally, Postgres is a remote
host reached through `.env`, not Docker.

## Known limitations

See the INCOMPLETE table in the audit. The ones that gate cutover: legacy key
migration + scrub, customer/order import, payments line-up, restore drill,
observability, rollback runbook.

## Critical dependencies

- Stripe entity acceptance → payment line-up → checkout scope.
- CONSENSUS-0002 → TASK-0040 → cutover rehearsal (TASK-0042) → cutover.
- TASK-0010 (sweep locks) before any decision on moving jobs to the worker.
