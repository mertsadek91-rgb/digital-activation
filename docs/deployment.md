# Deployment — Coolify

Three application containers, three backing services, one Postgres with two
schemas and three roles.

```
digital-activation.com        →  storefront   (Next.js, port 3000)
admin.digital-activation.com  →  admin        (Next.js, port 3001)
api.digital-activation.com    →  api          (NestJS,  port 4000)
                                 jobs         (worker, no public port)

postgres 17 · redis 7 · meilisearch      (internal network only)
```

Only the three web containers get a public domain. Postgres, Redis, Meilisearch
and the worker stay on Coolify's internal network with no published port.

---

## 1. Postgres

Create a **PostgreSQL 17** resource in Coolify. Nothing else on this list can
be done first.

Coolify generates a database name, a user and a password. That user is the
database owner — it is used **only** for migrations, never by the running
application.

Then create the two application roles once, as the owner:

```bash
psql "$DATABASE_URL_MIGRATE" \
  -v ON_ERROR_STOP=1 \
  -v owner_role="$PGUSER" \
  -v app_password="$DA_APP_PASSWORD" \
  -v vault_password="$DA_VAULT_PASSWORD" \
  -f packages/db/prisma/init/roles.prod.sql
```

Generate those two passwords yourself (`openssl rand -base64 32`), keep them in
`.env`, and use them to build `DATABASE_URL` and `DATABASE_URL_VAULT`. The
script is idempotent, so re-running it after a restore or a rotation is safe.

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

Publish a port temporarily only when you need to run migrations from your own
machine, and add `?sslmode=require` for that; then close it again.

**Do not put a pooler in front of it yet.** At this volume the API's own pool is
ample, and PgBouncer in transaction mode adds prepared-statement failure modes
that are not worth debugging for no gain. Revisit when concurrency justifies it.

### Backups

Enable Coolify's scheduled backup on the Postgres resource, daily, to an
S3-compatible target — not to the same server's disk. Verify a restore once
before the cutover, because an unverified backup is a belief rather than a
backup.

## 2. Redis and Meilisearch

Both as Coolify resources, internal only.

Redis carries BullMQ: licence delivery, transactional mail, the abandoned-cart
ladder, FX refresh, sitemap regeneration. Enable persistence (`appendonly yes`)
so a restart does not drop queued key deliveries.

Meilisearch needs a master key; the app reads it as `MEILI_MASTER_KEY`.

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
probe round-trips the database, so a database outage shows as _not ready_
rather than as a stream of 500s.

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

## 5. Secrets that must not sit in Coolify's environment editor

Most values are fine as Coolify environment variables. Two are not.

**`KEK_LOCAL_BASE64`** — the key that unwraps every licence key in the vault.
`validateEnv` refuses to boot with `KEK_PROVIDER=local` when `NODE_ENV=production`,
deliberately: a single environment variable that decrypts the entire product
inventory is not a key-management strategy. Production needs a real KMS. This is
an open decision, and it blocks the vault module.

**Payment secrets** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`PAYPAL_CLIENT_SECRET`. Scope them to the API resource only; the storefront and
admin never need them.

## 6. DNS

| Record                                 | Purpose                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `A` / `CNAME` for apex, `admin`, `api` | the three applications                                                                                         |
| `TXT` SPF, `CNAME` DKIM, `TXT` DMARC   | on the transactional sending domain                                                                            |
| the same three, on `mail.`             | marketing sends on a separate subdomain, so a campaign cannot damage the deliverability of a licence-key email |

Set DMARC to `p=none` first and read the reports for a week before tightening.
