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

## 8. DNS

| Record                                 | Purpose                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `A` / `CNAME` for apex, `admin`, `api` | the three applications                                                                                         |
| `TXT` SPF, `CNAME` DKIM, `TXT` DMARC   | on the transactional sending domain                                                                            |
| the same three, on `mail.`             | marketing sends on a separate subdomain, so a campaign cannot damage the deliverability of a licence-key email |

Set DMARC to `p=none` first and read the reports for a week before tightening.
