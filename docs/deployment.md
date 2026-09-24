# Deployment — Coolify

Three application containers, three backing services, one Postgres with two
schemas and three roles.

```
digital-activation.com        →  storefront   (Next.js, port 3000)
admin.digital-activation.com  →  admin        (Next.js, port 3001)
api.digital-activation.com    →  api          (NestJS,  port 4000)
                                 jobs         (worker, no public port)

postgres 18 · redis 7 · meilisearch      (internal network only)
```

Only the three web containers get a public domain. Postgres, Redis, Meilisearch
and the worker stay on Coolify's internal network with no published port.

---

## 1. Postgres

Create a **PostgreSQL 18** resource in Coolify (`postgres:18-alpine`). Nothing
else on this list can be done first. The local docker-compose runs the same
major version, so a behaviour difference cannot hide between the two.

Coolify generates a database name, a user and a password. That user is the
database owner — it is used **only** for migrations, never by the running
application.

Then create the vault schema and the two application roles once:

```bash
pnpm secrets:generate     # if the two role passwords are not in .env yet
pnpm db:roles             # creates the vault schema and both roles
```

`db:roles` connects as the owner via `DATABASE_URL_MIGRATE` and needs no `psql`
on PATH, which Windows machines generally do not have. It is idempotent, so
re-running it after a restore or a password rotation is safe, and it refuses to
report success if `da_app` ends up with USAGE on the vault.

Use the two generated passwords to build `DATABASE_URL` and
`DATABASE_URL_VAULT`. They are generated in the base64url alphabet, so they
need no percent-encoding in a connection string.

`prisma/init/roles.prod.sql` does the same work in plain SQL, for applying by
hand on a server that has `psql`. Keep the two in step.

### Three connection strings, on purpose

| Variable               | Role                 | Used by                                   | Reaches `vault`          |
| ---------------------- | -------------------- | ----------------------------------------- | ------------------------ |
| `DATABASE_URL_MIGRATE` | Coolify's owner user | `prisma migrate deploy` only              | yes (it creates it)      |
| `DATABASE_URL`         | `da_app`             | the whole API, the storefront, the worker | **no — denied**          |
| `DATABASE_URL_VAULT`   | `da_vault`           | the API's licence-vault module only       | yes, but cannot `DELETE` |

`vault.LicenseKey` holds the product itself and a leaked key cannot be recalled,
so the role the API runs as is given no grant on that schema at all. An
injection or a careless handler in ordinary application code then cannot read
one — the protection is in the database, not in the code's good manners.

### Two things that will bite

**Percent-encode the password.** Coolify passwords routinely contain `@`, `/`,
`:`, `#` or `+`, all of which are structural characters in a URL. Pasted raw,
the connection string parses into nonsense and the error message will not tell
you why. `@` → `%40`, `/` → `%2F`, `:` → `%3A`, `#` → `%23`, `+` → `%2B`,
space → `%20`. `pnpm db:doctor` reports this specifically.

**Use the internal hostname for the apps.** Inside Coolify's network the host is
the service name, and TLS is unnecessary:

```
postgresql://da_app:<encoded>@<service-name>:5432/<db>?schema=public&sslmode=disable
```

### Reaching it from a laptop, without exposing it

Nothing outside Coolify legitimately needs Postgres, Redis or Meilisearch: the
API, the worker and the storefront all run inside that network, and a
development machine runs its own stack via `pnpm infra:up`. So none of the three
gets a public port.

Two cases do need reaching it from a laptop: the first migration, before any
application is deployed to run it, and developing against the real services
rather than a local Docker stack. Neither needs a public port.

Bind each resource to the server's loopback interface — in Ports Mappings:

```
127.0.0.1:5432:5432     postgres
127.0.0.1:6379:6379     redis
127.0.0.1:7700:7700     meilisearch
```

That makes them reachable from the VPS itself and nowhere else. Then:

```bash
pnpm tunnel
```

which forwards all three to the same ports locally over SSH. It needs
`TUNNEL_SSH_HOST` in `.env`.

The reason to prefer this over a published port is not only exposure. Every URL
in `.env` stays on `localhost`, so **the same file works whether you are
tunnelled to Coolify or running `pnpm infra:up` locally** — there is no
configuration to remember to change at deploy time, which is exactly where that
kind of thing gets forgotten.

Once the API is deployed, migrations run as its release command from inside the
network and the tunnel stops being needed at all.

**Do not put a pooler in front of it yet.** At this volume the API's own pool is
ample, and PgBouncer in transaction mode adds prepared-statement failure modes
that are not worth debugging for no gain. Revisit when concurrency justifies it.

### Backups

Enable Coolify's scheduled backup on the Postgres resource, daily, to an
S3-compatible target — not to the same server's disk. Verify a restore once
before the cutover, because an unverified backup is a belief rather than a
backup.

## 2. Redis and Meilisearch

Both as Coolify resources, **internal only** — no published port, no domain.

Redis carries BullMQ: licence delivery, transactional mail, the abandoned-cart
ladder, FX refresh, sitemap regeneration. Enable persistence (`appendonly yes`)
so a restart does not drop queued key deliveries.

Meilisearch needs a master key, which the app reads as `MEILI_MASTER_KEY`. Two
reasons it must not have a public domain: the master key grants full read and
write on the index, and Coolify's generated `*.sslip.io` domain serves plain
HTTP, which would put that key on the wire in cleartext on every request.
`pnpm env:check` fails on both conditions.

If client-side instant search is ever wanted, that is a different arrangement,
not a relaxation of this one: expose Meilisearch over HTTPS with a **search-only
key**, and keep the master key server-side. Until then search goes through the
API, which is also where Arabic folding has to happen.

## 3. Applications

Four resources from the same Git repository, each with a different build and
start command:

| Resource   | Build                                                                                      | Start                                | Port |
| ---------- | ------------------------------------------------------------------------------------------ | ------------------------------------ | ---- |
| storefront | `pnpm install --frozen-lockfile && pnpm db:generate && pnpm --filter @da/storefront build` | `pnpm --filter @da/storefront start` | 3000 |
| admin      | same, `--filter @da/admin`                                                                 | `pnpm --filter @da/admin start`      | 3001 |
| api        | same, `--filter @da/api`                                                                   | `pnpm --filter @da/api start`        | 4000 |
| jobs       | same, `--filter @da/jobs`                                                                  | `pnpm --filter @da/jobs start`       | —    |

`pnpm db:generate` must run before any build: the Prisma client is generated,
not committed.

Health checks: `GET /health` and `GET /health/ready` on the API. The readiness
probe round-trips the database and answers **503** when it cannot, so a
database outage takes the replica out of rotation rather than producing a
stream of 500s. Point the proxy's health check at `/health/ready`.

It also pings Redis and reports it, but Redis being down is **not** a 503: the
replica keeps serving with per-process rate limits, and the body says
`{"status":"degraded","database":"up","redis":"down"}`. Alert on that body if
you want to hear about it; do not make the proxy act on it.

### Behind the proxy

`TRUST_PROXY_HOPS` (default `1`) is how many proxies sit in front of the API.
The API believes that many entries from the right of `X-Forwarded-For` and no
more, which is what keeps a client from choosing the address the rate limits
and the audit log see. One hop is Coolify's proxy; set `2` if a CDN (e.g.
Cloudflare) is in front as well. Getting it wrong in the low direction makes
every request look like the proxy's address; in the high direction it lets a
client spoof its IP.

### Rate limits and Redis

Rate-limit counters live in Redis (`REDIS_URL`, the same instance BullMQ uses),
so every API replica counts against the same limit. **Redis is required before
running more than one API replica**: without it each replica counts on its own
and the effective limit is multiplied by the replica count.

Redis is not required to boot or serve. If it is unreachable at startup, or a
command fails or takes over 500 ms, that request is counted in the process's
own memory instead — failing open, because refusing every login and checkout
while the counter is down would be worse than a temporarily looser limit. A
warning is logged at most once a minute while this lasts, and the shared
counters resume by themselves when Redis comes back.

### `INTERNAL_API_KEY` — per-visitor limits on server-rendered calls

The storefront renders pages on its own server, so two API routes it calls for
every visitor — `GET /v1/catalog/search` and `POST /v1/content/not-found` —
arrive from the storefront's address, and a per-IP limit would count the whole
shop as one person.

Set `INTERNAL_API_KEY` to the **same value on the API and the storefront**
resources (32+ characters; `pnpm secrets:generate --print` includes one). The storefront then sends
it as `x-da-internal` together with the visitor's address in `x-da-client-ip`
(taken from `X-Forwarded-For` using the same `TRUST_PROXY_HOPS`), and the API
counts that address — search at 60 a minute, 404 reports at 30. The forwarded
address is believed only when the key matches (compared in constant time), so
nobody else can choose the address they are counted as.

Without the key those two routes are **not rate-limited at all** — the previous
behaviour. With the key on the API but missing from the storefront, every
shopper shares one limit and search starts failing under load: set both, or
neither. The key is a secret: API and storefront resources only, never a
`NEXT_PUBLIC_` variable.

### Logs

The API writes one JSON object per line to stdout (pino): a line per request
(`req`, `res`, `responseTime`) plus whatever the code logs, each carrying the
request's id. `LOG_LEVEL` sets the threshold. Pretty-printed output is for
`NODE_ENV=development` only, and only when `pino-pretty` (a devDependency) is
installed.

- **Request id**: a well-formed incoming `X-Request-Id` is kept, otherwise a
  UUID is generated; either way it is returned as `X-Request-Id` on the
  response and appears as `req.id` on every line of that request.
- **Redacted**: `authorization`, `cookie`, `x-da-internal` and `set-cookie`
  headers; any `password`, `token`, `secret` or `key` field up to three levels
  deep; `code` in request data (not `err.code`, which is a diagnostic);
  credential query parameters (`token`, `code`, `key`, `preview`, `email`, …)
  in the logged URL. Email addresses in messages are masked to `s***@domain`.
- Health probes are not logged.

### Error reporting

Every 5xx — an unexpected exception, a 5xx `HttpException`, or a Prisma error
the API does not map to a 4xx — is passed to an `ErrorReporter`
(`apps/api/src/infra/error-reporter.ts`). The default reports nowhere; the
error is still logged. `SENTRY_DSN` is the switch for Sentry, but
`@sentry/node` is **not installed yet**, so setting it alone only logs a warning
at boot. To turn it on:

```bash
pnpm --filter @da/api add @sentry/node
```

then set `SENTRY_DSN` on the API resource and redeploy. The adapter loads the
package by name at runtime, so no code change is needed. Events carry the
status, method, route pattern and request id — no URL, body or user data,
since an order URL or a reveal response carries a licence key. Pending events
are flushed on shutdown.

### Content Security Policy

The storefront and the admin each set their CSP in `src/proxy.ts` (Next 16's
name for middleware), not in `next.config.ts`, because it carries a fresh
nonce per response. Next reads the nonce back out of the request header and
stamps it on its own scripts; nothing in the pages handles it.

- `script-src 'self' 'nonce-…' 'strict-dynamic'` — no `'unsafe-inline'`. An
  injected `<script>` or `onerror=` attribute does not run. `'strict-dynamic'`
  lets a trusted script load others, which is how Stripe.js arrives (the
  storefront also lists `js.stripe.com` for browsers without CSP3).
- `style-src 'unsafe-inline'` stays: React writes `style` attributes and
  Stripe Elements injects styles, and a nonce cannot cover an attribute.
- `connect-src` is `'self'`, the API origin (`NEXT_PUBLIC_API_URL`) and, on
  the storefront, `api.stripe.com`. `frame-ancestors 'none'`,
  `object-src 'none'`, `base-uri` (`'self'` storefront, `'none'` admin).
- JSON-LD (`application/ld+json`) needs no nonce. It is a data block, so the
  browser never runs it and CSP never checks it.

**Every page renders per request.** A prerendered page has no nonce, so its
scripts would be refused. The storefront's root layout awaits `connection()`.
In practice that changes only the root 404. The home page and the rest of
`[locale]` already rendered per request because they read the currency
cookie. `revalidate` on the home page still caches the API responses behind
it, but not the full page. Do not put a CDN full-page cache in front of either
app: a cached page's nonce no longer matches the header sent with it.

When adding a third party, add its origins in `proxy.ts`. A `<Script>` it
needs must take `nonce={(await headers()).get('x-nonce')}`. Check the browser
console for `Content Security Policy` errors before shipping.

### Scheduled jobs in the API

These run inside the API process and each takes a Postgres advisory lock, so
more than one replica is safe:

| Job                 | Every      | What it does                                                                          |
| ------------------- | ---------- | ------------------------------------------------------------------------------------- |
| `stranded-orders`   | 5 minutes  | fulfils PAID orders still holding PENDING lines 5+ minutes after payment              |
| `back-in-stock`     | 10 minutes | emails people waiting on a stocked variant once keys are available                    |
| `expire-drafts`     | hour       | cancels PENDING_PAYMENT drafts older than 14 days with no succeeded payment           |
| `review-invites`    | hour       | day-3 and day-10 review requests, 09:00–20:00 store time                              |
| `fx-refresh`        | day, 03:00 | writes exchange rates from `FX_RATES_URL`; a move over 20% is held back and logged    |
| `renewal-reminders` | day, 10:00 | renewal emails before a time-limited licence expires (settings: Marketing → Renewals) |
| `cart-recovery`     | 10 minutes | the abandoned-cart ladder, outside quiet hours (Marketing → Abandoned carts)          |
| `referral-sweep`    | day, 04:00 | records referred orders and pays referrers once the refund window has passed          |

Because of these, **never point a development API at the production
database**: the sweeps would fulfil real orders and email real customers.

Migrations run as a **release command, not on container start** — three
replicas booting at once must not race each other:

```bash
pnpm --filter @da/db migrate:deploy
```

## 4. Verify before pointing DNS

```bash
pnpm db:doctor
```

It connects with all three strings and asserts, rather than assumes:

- server version ≥ 16 and UTF8 encoding (Arabic content needs it)
- both schemas present, migrations applied, none half-finished
- 64 tables
- **`da_app` is denied `vault.LicenseKey`** — if this line ever says `FAIL`,
  the vault is open and nothing else on this page matters
- `da_vault` can read the vault but cannot `DELETE` from it

Non-zero exit on any failure, so it can gate the deploy.

## 5. AWS KMS — the vault key

Decided 2026-09-09. The KEK is the single key that unwraps every licence key in
the vault, so it must not be recoverable from the machine that holds the
ciphertext. `validateEnv` refuses to boot in production with any other provider.

One key and one narrowly-scoped user:

1. **KMS → Create key** — symmetric, `ENCRYPT_DECRYPT`, in the region nearest
   the Coolify host. Give it the alias `alias/digital-activation-vault`.
   Enable automatic annual rotation.
2. **IAM → Create user**, programmatic access only, with this inline policy and
   nothing else. The resource is the one key ARN; a wildcard here would undo the
   point of the exercise.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:GenerateDataKey",
        "kms:DescribeKey"
      ],
      "Resource": "arn:aws:kms:<region>:<account>:key/<key-id>"
    }
  ]
}
```

3. Fill `AWS_KMS_KEY_ID`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY` — **scoped to the API resource only.** The storefront
   and the admin never touch the vault and must not carry these.

Cost is roughly $1/month for the key plus $0.03 per 10,000 requests. At this
order volume the request charge is pennies: a data key is wrapped once per
imported licence and unwrapped once per delivery, not once per page view.

`kekVersion` on every row records which generation wrapped it, so a rotation
re-wraps incrementally instead of forcing a re-encrypt of the whole vault.

### Staff TOTP secrets use the same KEK

Staff TOTP secrets are sealed the same way as a licence. Each one gets its own
data key, and the configured KEK provider (KMS in production) wraps that key.
The whole envelope sits in the existing `StaffUser.totpSecret` column, with a
`TOTP` + format-version header. There is no schema change.

Rows written before this release were encrypted directly under
`KEK_LOCAL_BASE64`. They still open. Each one is re-sealed under KMS the next
time its owner enters a correct code (sign-in, enrolment confirmation or
step-up). A row wrapped by an older `VAULT_KEY_VERSION` is re-sealed the same way.
So:

1. **Leave `KEK_LOCAL_BASE64` set on the API** after deploying this release.
   Without it, any staff member who has not signed in since cannot be
   verified.
2. Once every enrolled staff member has signed in once, remove it. To check,
   every non-null `totpSecret` should start with the bytes `TOTP`:
   `SELECT email FROM "StaffUser" WHERE "totpSecret" IS NOT NULL AND substring("totpSecret" from 1 for 4) <> 'TOTP'::bytea;`
   should return no rows. Anyone still listed can instead be re-run through
   the create-staff script, which issues a new password and re-enrols TOTP.

## 6. Cloudflare R2 — media

Decided 2026-09-09. S3-compatible with no egress fees, and images are the
largest outbound cost in a store. Keeping them off the server disk also means a
redeploy or a host migration cannot lose them.

1. Create the bucket `digital-activation-media`.
2. Create an **R2 API token** scoped to _Object Read & Write_ on that bucket.
3. Bind a **custom domain** — `cdn.digital-activation.com`. The `r2.dev`
   development URL is rate-limited and not meant for production traffic.
4. Fill `S3_ENDPOINT` (`https://<account-id>.r2.cloudflarestorage.com`),
   `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION=auto`,
   `S3_PUBLIC_BASE_URL=https://cdn.digital-activation.com`.

`S3_ENDPOINT` is the account endpoint and nothing more. The bucket's _S3 API_
field in the dashboard shows that endpoint with the bucket name appended, and
copying it whole doubles the segment: under `forcePathStyle` the SDK adds the
bucket itself from `S3_BUCKET`, so every request goes to
`/digital-activation-media/digital-activation-media/...` and fails as
`NoSuchBucket` — naming a bucket that plainly does exist.

The storefront reads `S3_PUBLIC_BASE_URL` at build time to allowlist that
hostname for `next/image`. Miss it and images silently fail to optimise rather
than erroring, which is easy not to notice. If the value carries a path it needs
a trailing slash — object keys resolve against it as relative URLs, so
`.../media` drops the segment and every image 404s from the bucket root.

Public read access is also required, and it is not the API token's job: the
token lets this project write, the custom domain lets browsers read. Binding
the domain under R2 → the bucket → Settings → Custom Domains is what makes the
objects reachable; a bucket with a token and no public domain uploads fine and
serves nothing.

### Loading the media

Once those five values are set:

```
pnpm db:media              # report only
pnpm db:media -- --apply   # upload, then record
```

The dry run extracts `wp-content/uploads` out of the site tarball into
`.cache/`, converts every image, writes the results and a `manifest.json` to
`.cache/media-out/` for inspection, and touches neither R2 nor the database.
`--apply` does the same work, refuses up front if a credential is missing, and
verifies each object with a `HeadObject` before recording it.

Keys are the SHA-256 of the converted bytes, so re-running is idempotent: the
same image lands on the same key, and a partial unique index stops a product
collecting the same picture twice.

## 7. Payment secrets

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYPAL_CLIENT_SECRET` — API
resource only, for the same reason as the KMS credentials.

`JWT_ACCESS_SECRET` must be generated (`pnpm secrets:generate`); production
refuses to start with a value that looks like the `.env.example` placeholder.
It also signs the order links in emails and the newsletter confirmation
links, so rotating it retires those links (customers can still sign in).

### The Stripe webhook

Endpoint: `https://<api-host>/v1/webhooks/stripe`. Subscribe to exactly these
events — the handler acts on them and acknowledges anything else:

| Event                           | Effect                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `payment_intent.succeeded`      | order paid (amount and currency checked against the order), then fulfilled      |
| `payment_intent.payment_failed` | the attempt is recorded as FAILED with Stripe's reason                          |
| `charge.refunded`               | order REFUNDED / PARTIALLY_REFUNDED, a Refund row, a note naming delivered keys |
| `charge.dispute.created`        | order risk set to BLOCKED; no further key is delivered                          |

Every event is logged in `WebhookEvent` before it is acted on. A delivery that
fails is answered non-2xx and processed again on Stripe's retry; one already
processed is acknowledged without repeating the work.

Radar's verdict is read on each succeeded payment: `elevated` holds the order
in PAYMENT_REVIEW, `highest` blocks it. Held orders are released from the
orders screen (OWNER/ADMIN, with a reason). PayPal is not implemented; the
checkout does not offer it.

## 7a. Applying this release to an existing database

Two things to run once, as the owner role, in this order:

1. `pnpm --filter @da/db migrate:deploy` — applies, in order:
   - `20260923130000_payment_integrity_totp_replay` (TOTP replay column,
     three-decimal `Payment.amountCharged`, RESTRICT instead of CASCADE from
     Order to Payment and Payment to Refund);
   - `20260923150000_basket_offers` (sale columns on `CartItem`,
     `Order.offerSnapshot`) — **the cart and checkout write these, so deploy
     the migration before the code**;
   - `20260923180000_retention_reminders` (`RenewalReminder`,
     `CartRecoveryEvent.heldOut`);
   - `20260923190000_referral_redemption` (`ReferralRedemption`);
   - `20260923200000_whatsapp_channel` (WhatsApp number and consent on
     `Customer`, `NotificationLog.providerMessageId`/`deliveryStatus`,
     `RenewalReminder.channel`, `WhatsappInbound`) — the checkout writes the
     new `Customer` columns, so deploy it before the code.
     All are additive.
2. Re-run `packages/db/prisma/init/roles.prod.sql` — it now revokes UPDATE and
   DELETE on `AuditLog`, `StockMovement` and `KeyImportBatch` from `da_app`, and
   UPDATE on `vault.KeyAccessLog` from `da_vault`. Re-run it after any future
   migration that recreates one of those tables.

## 8. DNS

| Record                                 | Purpose                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `A` / `CNAME` for apex, `admin`, `api` | the three applications                                                                                         |
| `TXT` SPF, `CNAME` DKIM, `TXT` DMARC   | on the transactional sending domain                                                                            |
| the same three, on `mail.`             | marketing sends on a separate subdomain, so a campaign cannot damage the deliverability of a licence-key email |

Set DMARC to `p=none` first and read the reports for a week before tightening.

## 9. Marketing features

Every marketing feature (Admin → Marketing) ships **off**. Before switching on
one that shows a discount to shoppers in Saudi Arabia, obtain the Ministry of
Commerce discount licence and enter its number on that feature's screen; the
seasonal-sale and offer screens refuse to enable a discount without it.
Promotional emails go only to customers with recorded marketing consent and
carry a one-click unsubscribe. Set `API_PUBLIC_URL` (or `NEXT_PUBLIC_API_URL`)
so the `List-Unsubscribe` header can point at the API.

## 10. WhatsApp

Optional. Cart recovery and renewal reminders can go on WhatsApp **instead
of** email to customers who ticked the WhatsApp box at checkout — the Cloud
API directly, no reseller. Until the four variables below are set and the
channel is switched on (Admin → Marketing → WhatsApp), nothing changes:
everything stays on email.

### Meta setup, once

1. **Business verification.** Meta Business Suite → Settings → Security
   Centre → Start verification, with the commercial registration. Without it
   the number is capped at 250 business-initiated conversations a day.
2. **App and number.** developers.facebook.com → Create app → Business →
   add the WhatsApp product. In WhatsApp Manager add the store's number (one
   that is not already on the WhatsApp app — it cannot be on both), verify it
   by SMS or call, and set the display name, which Meta reviews. Copy the
   **Phone number ID** (a long number, not the phone number) into
   `WHATSAPP_PHONE_NUMBER_ID`.
3. **Permanent token.** Business Settings → Users → System users → Add
   (role Admin) → Assign assets: the app (full control) and the WhatsApp
   account → Generate token, expiry **Never**, permissions
   `whatsapp_business_messaging` and `whatsapp_business_management`. That is
   `WHATSAPP_ACCESS_TOKEN`. The token on the app's "API setup" page lasts 24
   hours; do not use it.
4. **App secret.** App dashboard → App settings → Basic → App secret →
   `WHATSAPP_APP_SECRET`. Every webhook delivery is checked against it
   (`X-Hub-Signature-256`); without it the webhook refuses everything.
5. **Webhook.** Generate any long random string for `WHATSAPP_VERIFY_TOKEN`
   and restart the API. App dashboard → WhatsApp → Configuration → Webhook →
   Edit: callback URL `<API_PUBLIC_URL>/v1/webhooks/whatsapp` (the admin
   screen prints it when `API_PUBLIC_URL` is set), verify token the same
   string. Meta calls the URL once to check it. Then **Webhook fields →
   subscribe to `messages`** — that one field carries both the delivery
   statuses and the customers' replies (STOP).
6. Switch the app to **Live** mode, or only the test numbers listed on the
   app can receive anything.

### Templates to submit

WhatsApp Manager → Message templates → Create. Two templates, each approved
in Arabic (`ar`) and English (`en`) under the same name; put the names on the
admin screen. The code sends exactly these variables in this order
(`apps/api/src/whatsapp/templates.ts`), so the wording may change but the
number of `{{n}}` may not.

The URL button in both: type **Visit website**, URL type **Dynamic**, URL
`<STOREFRONT_URL>/{{1}}` (for example `https://digital-activation.com/{{1}}`).
The code sends the path after the domain — `cart?restore=…` or
`en/cart?add=…` — so the button opens the signed link.

**1. Abandoned cart — category Marketing**, suggested name `cart_reminder`.

Arabic body:

```
مرحباً {{1}}، ما زالت سلتك في ديجيتال أكتيفيشن بانتظارك: {{2}}.
أكمل طلبك من الزر أدناه متى شئت، وستجد السلة كما تركتها.
```

Arabic footer: `لإيقاف هذه الرسائل أرسل: إيقاف`
Arabic button text: `أكمل الطلب`

English body:

```
Hi {{1}}, your cart at Digital Activation is still waiting: {{2}}.
Complete your order with the button below whenever you are ready — it is just as you left it.
```

English footer: `Reply STOP to stop these messages`
English button text: `Complete order`

Samples for review: `{{1}}` = `سارة` / `Sarah`; `{{2}}` =
`Microsoft Office 2021 Pro Plus (SAR 249.00)`; button `{{1}}` =
`cart?restore=sample`. `{{2}}` may also carry the discount line — "with 10%
off applied when you open the link — discount licence …" — when the rung has
one; the licence number is added by the code from the cart-recovery screen.

**2. Renewal reminder — category Utility**, suggested name
`licence_renewal_reminder`. No offer, ever: a Utility template with a
promotion in it is re-categorised as Marketing, and the renewal code stays in
the email for customers with email consent.

Arabic body:

```
مرحباً {{1}}، هذا تذكير بموعد ترخيص {{2}}: {{3}}.
يمكنك تجديده من الزر أدناه ليستمر دون انقطاع.
```

Arabic footer: `لإيقاف هذه الرسائل أرسل: إيقاف`
Arabic button text: `جدّد الترخيص`

English body:

```
Hi {{1}}, a reminder about your {{2}} licence: it {{3}}.
You can renew it with the button below so it keeps working without a break.
```

English footer: `Reply STOP to stop these messages`
English button text: `Renew licence`

Samples: `{{1}}` = `سارة` / `Sarah`; `{{2}}` = `Microsoft 365 Personal`;
`{{3}}` = `ينتهي في 12 أكتوبر 2026` / `ends on 12 October 2026` (after
expiry the code sends `انتهى في …` / `ended on …`); button `{{1}}` =
`cart?add=sample`.

### How it behaves

- A step goes to WhatsApp only when the channel is on, "prefer WhatsApp" is
  on, the token and number id are set, that purpose has a template name, and
  the customer has WhatsApp consent not withdrawn since. Otherwise email, as
  before. Never both: a WhatsApp send replaces the email for that step. If
  Meta refuses the message outright (template missing, number not on
  WhatsApp), the step falls back to email where email is allowed.
- Holdout, quiet hours, stale-step and once-per-offset rules are the cart
  recovery and renewal settings', unchanged; the channel is recorded on
  `CartRecoveryEvent.channel` and `RenewalReminder.channel`.
- A reply of STOP / إيقاف / إلغاء / unsubscribe (any case, any hamza) clears
  the customer's WhatsApp opt-in and gets one confirmation. Meta's error
  131050 (the customer blocked marketing inside WhatsApp) is recorded the
  same way. Email consent is untouched by either.
- The admin screen's test send (ADMIN only, 5 a minute, audited) sends the
  saved template with sample values to one number in international form.

## 11. API — the OpenAPI document and the integration suite

### The spec

`/docs` (Swagger UI) and `/docs-json` exist outside production only. For the
storefront and admin teams there is a file instead:

```bash
pnpm --filter @da/api openapi        # writes apps/api/openapi.json
```

It needs no database, Redis or secrets: the script builds the app in Nest's
`preview` mode, which constructs the module graph without instantiating a
single provider, and fills any unset environment variable with a placeholder
nobody reads. CI runs it on every push and uploads the file as the `openapi`
artefact; it is gitignored, so there is no checked-in copy to go stale.

The schemas come from `@da/contracts`. Request bodies, queries and path
params are read off the `ZodPipe` each route already validates with, so the
spec cannot describe a shape the route does not accept. Responses are named
per handler with `@ZodResponse(cartSchema)` (from `common/openapi.ts`); a
handler without one shows an untyped response. Every contracts schema is a
named component (`cartSchema` → `Cart`), with a `…Request` twin where the
request side reads differently (defaults optional, unknown keys allowed).

### Integration tests

`apps/api/src/integration/*.int.test.ts` boot the real AppModule against a
real Postgres and drive it over HTTP: checkout to a paid order and assigned
keys, an amount mismatch held for review, a redelivered webhook, a one-use
coupon across two buyers, an earned bundle, a Stripe refund, and the
cart-recovery sweep's consent rule. Stripe signature checks are stubbed and
mail uses the capture transport; nothing leaves the machine.

They run only when `TEST_DATABASE_URL` is set, and refuse a URL that is
neither local nor named like a test database. With a throwaway container:

```bash
docker run --rm -d --name da-test-pg -p 55432:5432 \
  -e POSTGRES_USER=da -e POSTGRES_PASSWORD=test -e POSTGRES_DB=da_test \
  postgres:18-alpine

pnpm db:generate && pnpm turbo run build --filter=@da/api^...
TEST_DATABASE_URL=postgresql://da:test@localhost:55432/da_test?schema=public \
  pnpm --filter @da/api test:int

docker rm -f da-test-pg
```

The suite applies the migrations itself (`prisma migrate deploy`) and creates
its own uniquely named catalogue each run, so it can run repeatedly against
the same database. It connects as the owner for both the application and the
vault client and does not apply `prisma/init/01-roles.sql`: the role split is
a property of the real database, not of what these tests check. `pnpm test`
never runs this suite.
