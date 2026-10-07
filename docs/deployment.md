# Deployment — Coolify

Three application containers, two backing services, one Postgres with two
schemas and three roles.

```
digital-activation.com        →  storefront   (Next.js, port 3000)
admin.digital-activation.com  →  admin        (Next.js, port 3001)
api.digital-activation.com    →  api          (NestJS,  port 4000)
                                 jobs         (worker, no public port)

postgres 18 · redis 7                    (internal network only)
```

Only the three web containers get a public domain. Postgres, Redis and the
worker stay on Coolify's internal network with no published port.

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

Nothing outside Coolify legitimately needs Postgres or Redis: the
API, the worker and the storefront all run inside that network, and a
development machine runs its own stack via `pnpm infra:up`. So neither gets a
public port.

Two cases do need reaching it from a laptop: the first migration, before any
application is deployed to run it, and developing against the real services
rather than a local Docker stack. Neither needs a public port.

Bind each resource to the server's loopback interface — in Ports Mappings:

```
127.0.0.1:5432:5432     postgres
127.0.0.1:6379:6379     redis
```

That makes them reachable from the VPS itself and nowhere else. Then:

```bash
pnpm tunnel
```

which forwards both to the same ports locally over SSH. It needs
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

**Retention decides how private the analytics are.** The day's visitor id is an
HMAC of the visitor's address and user agent under a random salt kept in the
`AnalyticsSalt` table (TASK-0097). The prune deletes each salt by 03:29 UTC the
next day, which is what makes old ids impossible to link back to an address —
but every backup taken while a salt existed holds it next to that day's events,
and with the salt the ids can be brute-forced over the IPv4 space. The real
irreversibility window is therefore the backup retention, not the day: keep it
as short as recovery allows, and treat backups as personal data for as long as
they are kept.

## 2. Redis

A Coolify resource, **internal only** — no published port, no domain.

Redis carries BullMQ: licence delivery, transactional mail, the abandoned-cart
ladder, FX refresh, sitemap regeneration. Enable persistence (`appendonly yes`)
so a restart does not drop queued key deliveries.

**There is no search service.** Catalogue search, including Arabic folding,
runs inside the API against PostgreSQL (DEC-0009, confirmed by the owner on
2026-10-02). Do not provision Meilisearch; the API neither reads `MEILI_*` nor
needs them, and leftover values in a resource's environment are ignored.

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

Whatever the Sentry SDK adds on its own also passes through `scrubEvent`
(`apps/api/src/infra/error-scrub.ts`). It applies the fields the log redacts, at
any depth, plus URL scrubbing, email masking and licence-key masking. The user,
the request body and cookies are dropped, and headers are cut to an allowlist.

**Alerts.** Point three uptime monitors at the API:

| Probe              | Fires when                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `/health/ready`    | the API or its database is down                                                                     |
| `/health/sweeps`   | a cron has not run for two periods, or it left work behind (a stranded paid line, an overdue draft) |
| `/health/delivery` | a paid line went past its delivery promise in the last hour, or is still waiting past it            |

The last two need `MONITOR_API_KEY` in the header `x-da-monitor`, so the uptime
service must be able to send a custom header. Set the key on the API only and
generate it with `pnpm secrets:generate`. It must differ from `INTERNAL_API_KEY`,
and the API refuses to boot if they match, because that key also steers the
per-visitor rate limits. The probes answer 503 while firing and 404 without the
key, allow 30 requests a minute per address, and are neither logged nor reported.
**`AUTO_DELIVERY`** (optional, `on`|`off`, default `on`) is the incident switch
for automatic licence delivery. With `off`, keys are still assigned on payment
but nothing is emailed: lines wait in the admin fulfilment queue for staff to
send. Any other value refuses the boot. Set it in Coolify and **restart the
API**; the API logs a warning at boot while it is off. While it is `on`, staff
confirming a bank transfer sends the keys at once.

**`CRON_JOBS`** (optional, `on`|`off`, default `on`) registers the API's cron
sweeps. `off` is for an API that is only being measured, such as the Lighthouse
CI job; the API refuses to boot with it in production. Never set it in Coolify.

Stocked lines are sent automatically on payment (BUG-0021), so `/health/delivery`
fires only when a send fails or an order is held for risk; on-demand and
manual-setup lines carry their own, longer delivery promise.

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
- one table per model the schema declares — the expected count is read from
  the schema files, so it stays right as migrations add tables
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

### Switching an existing vault to KMS

Licences imported while `KEK_PROVIDER=local` have their data keys wrapped by
`KEK_LOCAL_BASE64`, and KMS cannot open those — under `aws-kms` the API sends
every wrapped key to KMS. Rewrap them once, before production starts on KMS:

1. With the KMS key and IAM user ready, put `AWS_KMS_KEY_ID`, `AWS_REGION`,
   `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in the `.env` that also
   holds `KEK_LOCAL_BASE64` and `DATABASE_URL_VAULT`, and set
   `VAULT_KEY_VERSION=2`.
2. `pnpm --filter @da/api vault:rewrap` — reports how many rows the local KEK
   opens. Nothing is written.
3. `pnpm --filter @da/api vault:rewrap --apply` — rewraps each of them under
   KMS, checks each result by opening it through KMS before writing, and
   changes nothing but `wrappedDek` and `kekVersion`. Safe to re-run; a second
   run finds nothing to do.
4. Switch the API to `KEK_PROVIDER=aws-kms` with `VAULT_KEY_VERSION=2`, and the
   `.env` on any laptop that imports keys too: a key imported under `local`
   into the production vault is one KMS cannot open.

Keep `KEK_LOCAL_BASE64` afterwards for the staff TOTP rows below; the licences
no longer need it.

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

### `VAULT_FINGERPRINT_SALT` — setting or changing it (TASK-0011)

The fingerprint is how an import or a manual delivery spots a licence already
in the vault. A production API refuses to boot without a salt of at least 32
characters (`pnpm secrets:generate` makes one). The check runs only when
`NODE_ENV=production`; on a host still at the default `development` the API
boots with whatever is there, including nothing.

Setting it on a vault that already holds keys, or changing it, leaves the
stored fingerprints under the old salt. Until they are recomputed, a licence
already in stock or already delivered no longer matches, and could be stocked
and sold again. So:

1. **Freeze key imports and manual fulfilment** (no "Add keys", no manual
   delivery from the queue) before the API restarts with the new salt.
2. Deploy, then from the API's terminal:
   `pnpm --filter @da/api vault:refingerprint` — a report of counts and row
   ids, never a licence.
3. `pnpm --filter @da/api vault:refingerprint --apply`. Re-run until it
   reports `failed: 0`; a second run changes nothing already done. Rows
   reported as holding the same licence are left alone — which one to keep is
   a person's call.
4. Lift the freeze.

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

Card payments are optional. With none of the three Stripe keys set the API
boots, the checkout offers no card, and the store takes bank transfer (and
crypto, if configured) only — enable those under Admin → Payments. What it
refuses is some of the keys without the others: a charge whose webhook cannot
be verified is money taken for an order that never learns it was paid.

`JWT_ACCESS_SECRET` must be generated (`pnpm secrets:generate`); production
refuses to start with a value that looks like the `.env.example` placeholder.
Newsletter links sent before TASK-0099 were signed with it, and their
unsubscribe links are honoured for good (below), so rotating it retires the
unsubscribe links in those older emails. `JWT_REFRESH_SECRET` is gone: nothing ever read
it (refresh tokens are opaque rows, not JWTs). Delete it from the API resource;
a leftover value is ignored.

### `LINK_SIGNING_SECRET` — the order and cart links in emails

Signs the `?key=` on every order link (the view link carrying the bank-transfer
instructions, the receipt, the delivery email, staff resends) and the
`?restore=` on abandoned-cart links (TASK-0018). **API resource only**, its own
value: the API refuses to boot if it equals `JWT_ACCESS_SECRET`, is under 32
characters, or (in production) looks like a placeholder. Generate it with
`pnpm secrets:generate --print` and add it in Coolify → API → Environment
Variables, then redeploy.

**Unset, the API still boots.** It derives a link key from `JWT_ACCESS_SECRET`
under a label of its own and logs a `LINK_SIGNING_SECRET is not set` warning at
boot. Refusing to boot would take checkout and licence delivery down on the
first deploy that lands before the owner adds the variable; the fallback is no
weaker than the shared key it replaces. Add the variable anyway — until then a
leaked session key also opens every order page, and the two cannot be rotated
apart.

**Order links expire after 30 days.** An unpaid order is cancelled after 14, so
the link carrying the payment instructions outlives its use; a delivered key is looked at in the first weeks.
After that the page — which shows the licence key — opens only by signing in
(the emailed sign-in link works for every order's address), or staff resend the
message from the order screen, which mints a fresh link. Cart links keep their
30 days.

The key names its purpose inside the signed part (`v2.<purpose>.<expiry>.<mac>`),
and each purpose has its own lifetime. Every emailed link today is `view`: it
shows that one order, keys included once delivered, and cannot pay or open
anything else — a forwarded email reveals what the delivery email already
holds, for at most 30 days. A short-lived `pay` purpose (48 hours) is reserved
for TASK-0017, the pay-from-another-device link; nothing mints or accepts it yet.

**Transition, until 2026-11-15 00:00 UTC** (`LEGACY_LINK_CUTOFF` in
`apps/api/src/common/link-secret.ts`):

- Order links emailed before this release (v1: no expiry, signed with
  `JWT_ACCESS_SECRET`) and cart links signed with `JWT_ACCESS_SECRET` keep
  working. From the cutoff they are refused, however recent.
- Links signed with the fallback while the variable was missing keep working
  after it is added — also only until the cutoff. Add it before then.
- The date gives every link sent up to the release at least the 30 days a new
  one gets, assuming the release ships by 2026-10-16. If it slips, move the
  constant and this paragraph together.

Rotating `LINK_SIGNING_SECRET` later retires every order and cart link already
sent; customers then sign in.

### Newsletter links (TASK-0099)

The confirm and unsubscribe links are signed with `LINK_SIGNING_SECRET` too,
each under its own purpose (`apps/api/src/subscriptions/newsletter-link.ts`),
so a confirm link never passes for an unsubscribe one, or the other way round.

- **Confirm links** (the footer box and the welcome window) **expire after 7
  days.** Nobody confirms a subscription weeks later; asking again sends a
  fresh link. Ones emailed before this release keep working until the cutoff
  above, like the order links.
- **Unsubscribe links never expire, and neither do the old ones.** Links
  signed with `JWT_ACCESS_SECRET` before this release, and links signed with
  the fallback key, stay valid past the cutoff. Withdrawing consent must stay
  as easy as giving it (GDPR art. 7(3)), CAN-SPAM wants an opt-out to work
  after the message is sent, and Gmail and Yahoo expect a working one-click
  unsubscribe. The worst a non-expiring link allows is that whoever holds the
  email takes that one address off the list, and its owner can subscribe again.
- So **rotating either `LINK_SIGNING_SECRET` or `JWT_ACCESS_SECRET` breaks the
  unsubscribe links already in people's mailboxes.** Rotate only for a real
  compromise (the owner's call), and expect to handle opt-outs by reply for a
  while afterwards.

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

## 12. Releases, rollback and the migration policy

### Migrations are forward-only

An applied migration is never edited and never reverted; a mistake is fixed by
the next migration. What keeps a code rollback safe is how each migration is
written:

- **Additive by default:** new tables, new nullable columns, new indexes, a
  constraint swapped inside one transaction. The previous release keeps working
  against the new schema, so rolling the code back needs no database step.
- **Destructive changes take two releases (expand, then contract).** Release N
  stops reading and writing the column; release N+1 drops it. A destructive
  migration is an owner decision (`destructive_data`), never part of a hotfix.
- **Migrations deploy before the code that needs them** (§7a), as a release
  command, never on container start.
- Before any migration on the live database: a fresh backup of the kind you have
  restored at least once (TASK-0030), and `pnpm db:doctor` green afterwards.

### Rolling back application code

1. In Coolify, open the application (storefront, admin or api) → its
   deployments, and redeploy the last good one. If that image is no longer kept,
   deploy the last good commit of `main` instead.
2. Roll back one application at a time, starting with the one that broke. The
   storefront and admin depend on the API's contracts, so after rolling the API
   back, check that both still load.
3. Nothing in the database moves. A migration the bad release shipped stays —
   which is why migrations have to be additive.
4. Record what happened in a BUG record, with the commit and the time.

A `NEXT_PUBLIC_*` variable is inlined at build time. Changing one, including
`NEXT_PUBLIC_SITE_URL`, means **rebuilding** the storefront, not restarting it.

## 13. Cutover runbook — WordPress to the new storefront

Today the apex `digital-activation.com` is WordPress on Hostinger, and the new
storefront runs on `new.digital-activation.com` with indexing off. Cutover moves
the storefront to the apex; admin and API keep their hostnames (DEC-0011).
Everything that has to differ between staging and production is TASK-0044's
list. Most of it is applied at step C4; its own ordering section says which items come before (go/no-go) and after.

The owner performs or approves every step that changes DNS, payments, Coolify
or data. An agent may run the read-only checks.

**Fill in before starting — not recorded in the repo:** where the apex DNS is
hosted (and whether it is proxied, e.g. by Cloudflare: then `dig` shows the
proxy's addresses, not Coolify's, and certificates are issued differently), and
the hostname WordPress falls back to (written `old.` below).

**HSTS is one-way.** The storefront sends
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
(`apps/storefront/next.config.ts`). Once the apex serves it, browsers insist on
valid HTTPS for two years on the apex **and every subdomain**, including `old.`
and anything else still on Hostinger. A rollback cannot fall back to plain HTTP.
Submitting the domain to the preload list is a separate, deliberate decision;
the header alone does not do it.

### Go / no-go, the day before

All must hold; any one missing is a no-go.

| Check                                                                                                          | Evidence                                      |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Release 1 payment line-up decided (CONSENSUS-0001), each method tested with a real small amount                | one order per method, key delivered in < 60 s |
| Legacy data decision made (TASK-0043); if migrating, the import dry run is clean                               | `pnpm db:import` dry-run report               |
| 301 map in place and a full crawl of staging with zero broken links (TASK-0042)                                | crawl report                                  |
| `pnpm db:doctor` green; a restore drill within the last month (TASK-0030)                                      | command output, drill note                    |
| Error reporting and alerting reach a person (TASK-0031)                                                        | a deliberate test error arrives               |
| Apex DNS TTL lowered to 300 s **at least 48 hours earlier**, so the old TTL has expired everywhere             | `dig +noall +answer digital-activation.com`   |
| SPF, DKIM and DMARC pass on both sending domains (§8)                                                          | a test message's headers                      |
| TASK-0044's "before cutover" items done, and demo data removed from the database after a backup (TASK-0044 §H) | the list ticked; backup file; removal report  |
| A WordPress backup taken and stored off Hostinger                                                              | the file, restorable                          |

### Day of cutover

| Step | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Who                 | Check                                                                                                                                                                                                                                                                                                 | Abort if                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| C1   | Freeze WordPress: no new orders or content (checkout in maintenance mode). List WordPress orders placed but not yet paid or delivered (pending bank transfers, PayPal holds) and finish each **on WordPress**                                                                                                                                                                                                                                                                                                                               | Owner               | a test checkout on WordPress is refused; the in-flight list is empty or each has an owner                                                                                                                                                                                                             | the freeze cannot be applied                                                   |
| C2   | Final sync of whatever TASK-0043 migrates, then `pnpm db:doctor`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Owner               | counts match the dry run plus orders since; doctor green                                                                                                                                                                                                                                              | counts differ and the gap is unexplained                                       |
| C3   | Make WordPress answer on `old.` too, with valid HTTPS, and noindex **on the `old.` host only** (`Disallow: /` and `X-Robots-Tag: noindex` keyed on the host) — the apex still serves WordPress until C5 and must stay indexable; keep it running                                                                                                                                                                                                                                                                                            | Owner               | `old.` loads over HTTPS and its robots.txt disallows everything                                                                                                                                                                                                                                       | `old.` has no valid certificate                                                |
| C4   | Apply TASK-0044's list **and C5 straight after it**: storefront domain to the apex, `NEXT_PUBLIC_SITE_URL=https://digital-activation.com` (**rebuild**), `STOREFRONT_URL` to the apex, then restart the API (its CORS origins are `STOREFRONT_URL` and `ADMIN_URL`; there is no separate setting). From here `new.` stops working (CORS refuses it) and checkout returns and emails point at the apex, which is WordPress until C5 — so keep C4→C5 to minutes. Session cookies are host-only on `api.`; there is no cookie domain to change | Owner               | the storefront builds with the apex settings                                                                                                                                                                                                                                                          | the build fails: revert C4, WordPress is still live                            |
| C5   | Point the apex **and `www`** DNS at Coolify (`new.` already points there). In Coolify, add `www` and `new.` as domains that **301 to the apex, keeping the path** (nothing in the app does this)                                                                                                                                                                                                                                                                                                                                            | Owner               | `dig` returns the expected address; a certificate is issued for apex, `www`, `new.`; a deep URL on each, e.g. `curl -sI https://www.digital-activation.com/store/windows-11-pro` and the same on `new.`, answers one 301 to the same path on the apex                                                 | no valid certificate within 30 minutes (visitors see an error meanwhile)       |
| C6   | Smoke test on the apex in ar and en: home, category, product, search, cart, one real small order per payment method                                                                                                                                                                                                                                                                                                                                                                                                                         | Owner, agent (read) | key delivered in < 60 s; no 5xx in the API log                                                                                                                                                                                                                                                        | any payment or delivery fails                                                  |
| C7   | Indexing: robots.txt allows, pages carry no `noindex`, the sitemap lists products and categories. Submit the sitemap in Search Console and request indexing of the top pages                                                                                                                                                                                                                                                                                                                                                                | Owner, agent (read) | `curl -s https://digital-activation.com/robots.txt`; `curl -sI https://digital-activation.com/sitemap_index.xml` is `301 → /sitemap.xml → 200` (on staging `/sitemap.xml` is 404 by design, so this can only be proven on the apex — TASK-0042 report 2026-10-05); Search Console accepts the sitemap | robots still disallows: C4 not rebuilt, or `SEO_BLOCK_INDEXING=true` still set |
| C8   | Spot-check redirects: the top 20 legacy URLs from the Search Console export                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Agent (read)        | each is permanent (301 or 308) to a 200, in at most 2 hops until the trailing-slash hop is removed (TASK-0042 report)                                                                                                                                                                                 | more than 1 in 20 fails                                                        |

`SEO_BLOCK_INDEXING=true` (`packages/seo/src/indexing.ts`) forces noindex on any
host. It is the hold switch if the site must go live before it may be indexed;
it too needs a rebuild to change.

**C4 is the point of no easy return.** Before it, abort by undoing C1–C3
(unfreeze WordPress, move it back to the apex). After it, abort with the
rollback below.

### The first 72 hours

Every few hours on day one, then daily:

- the API's 5xx rate and error reports
- time from payment to key delivery
- the 404 log (Admin → Redirects), adding a 301 for anything real
- orders and conversion against the WordPress baseline
- Search Console coverage and crawl errors

A 2–6 week dip in search visibility is expected while Google processes the
redirects (plan §13). On its own it is not a reason to roll back.

### Rolling back to WordPress

When the new storefront cannot take orders or deliver keys, and a fix is further
away than the rollback:

1. **Decide.** The owner calls it; note the time and the reason in a BUG record.
2. **DNS:** point the apex and `www` back at Hostinger. With the TTL at 300 s,
   most visitors are back within minutes. Hostinger must serve valid HTTPS on
   both: HSTS (above) leaves no plain-HTTP fallback.
3. **WordPress:** lift the checkout freeze, and make sure the host-keyed noindex
   still applies to `old.` only, so the apex serves and indexes the old site
   again while `old.` stays out of the index.
4. **New storefront and API:** set `NEXT_PUBLIC_SITE_URL` and `STOREFRONT_URL`
   back to the staging values (restart the API for CORS) and **rebuild**, so it is noindex
   again; remove the `www`/`new.` 301s and move its domain back to `new.`.
5. **Orders taken on the new stack meanwhile** stay in its database and do not
   exist in WordPress. List them in the admin (orders since the C5 time) and
   make sure each one was delivered or refunded.
6. **Cached redirects:** browsers and Google keep the new stack's permanent redirects (mostly 308s) for a
   while, and those point at new URLs that WordPress answers with 404. Expect
   that for returning visitors and in Search Console until Google recrawls; if
   the rollback will last, add WordPress redirects from the new URLs back to the
   old ones.
7. Leave the TTL at 300 s until the next attempt.

Admin and API are not affected by a storefront rollback; they keep their
hostnames.
