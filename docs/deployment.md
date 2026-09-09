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

The storefront reads `S3_PUBLIC_BASE_URL` at build time to allowlist that
hostname for `next/image`. Miss it and images silently fail to optimise rather
than erroring, which is easy not to notice.

## 7. Payment secrets

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYPAL_CLIENT_SECRET` — API
resource only, for the same reason as the KMS credentials.

## 8. DNS

| Record                                 | Purpose                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `A` / `CNAME` for apex, `admin`, `api` | the three applications                                                                                         |
| `TXT` SPF, `CNAME` DKIM, `TXT` DMARC   | on the transactional sending domain                                                                            |
| the same three, on `mail.`             | marketing sends on a separate subdomain, so a campaign cannot damage the deliverability of a licence-key email |

Set DMARC to `p=none` first and read the reports for a week before tightening.
