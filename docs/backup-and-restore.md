# Backup and restore — policy and drill runbook

TASK-0030 · status: **draft policy, no drill run yet.** Nothing on this page has
been executed against staging or production. Every number marked
**PROPOSAL** is waiting on the owner; every section marked **OWNER DECISION**
must be decided before the drill.

Context: staging (`new.` / `admin.` / `api.`) becomes production in place
(DEC-0011), so the backups of staging _are_ the production backups from the day
of cutover. `docs/deployment.md` §1 "Backups" says to enable a daily Coolify
backup and verify a restore; this page is the detail behind that paragraph, and
`deployment.md`'s release checklist requires "a restore drill within the last
month (TASK-0030)".

---

## 1. What exists and what needs a backup

| Store                                           | Holds                                                                                                                                                                                    | Backup?                                                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL 18 — schema `public`                 | Catalogue, content, customers, orders, payments, staff, `Setting` rows (site, payment-method and similar configuration as JSON), redirects, analytics, supplier sheets, audit log        | **Yes.** The business.                                                                                                                                          |
| PostgreSQL 18 — schema `vault`                  | `LicenseKey` (AES-GCM ciphertext + `wrappedDek` + `kekVersion`), `KeyAccessLog`, `KeyImportBatch`                                                                                        | **Yes, in the same dump.** Unrecoverable if lost: a delivered key a customer re-reveals from their account exists nowhere else.                                 |
| Postgres roles `da_app`, `da_vault`             | Cluster-level objects, **not** inside a per-database dump                                                                                                                                | Not backed up as data. Recreated by `pnpm db:roles` (idempotent) after any restore. Their passwords live in Coolify's environment, not in the backup.           |
| Cloudflare R2 bucket `digital-activation-media` | Product images and article images (`Asset` rows point at object keys)                                                                                                                    | **Yes**, separately — see §4. R2 is durable storage but not a backup: a bad delete or overwrite through the API token is replicated instantly.                  |
| Redis 7                                         | At this commit the API uses it only for rate-limit counters (`apps/api/src/infra/redis*.ts`); `workers/jobs` is a stub and no BullMQ queue exists in code yet                            | **No** for now — losing it loosens rate limits briefly, nothing else. Revisit the day BullMQ queues carry licence deliveries (`deployment.md` §2 expects that). |
| The vault key (KEK)                             | AWS KMS key `alias/digital-activation-vault` in production (`KEK_PROVIDER=aws-kms`); `KEK_LOCAL_BASE64` while any row or staff TOTP secret is still wrapped locally (`deployment.md` §5) | **Never inside a database backup.** See §2.                                                                                                                     |
| Application secrets                             | Coolify environment (`DATABASE_URL*`, `JWT_ACCESS_SECRET`, `LINK_SIGNING_SECRET`, `S3_*`, payment keys …)                                                                                | Recorded by the owner in a password manager, not in any backup bucket. Most can be regenerated; the KEK material cannot.                                        |
| Code                                            | GitHub `main`                                                                                                                                                                            | Already off-site. Not part of this policy.                                                                                                                      |

## 2. The rule that matters most: keys and ciphertext never travel together

Every licence key in `vault.LicenseKey` is encrypted with its own data key, and
that data key is wrapped by the KEK. So:

- **A database backup without the KEK is useless** for the vault — the
  ciphertext cannot be opened. Losing the KEK (deleting the KMS key, losing the
  only copy of `KEK_LOCAL_BASE64`) destroys every licence in every backup at
  once.
- **A backup that contains both is a breach.** Anyone who obtains that one
  bucket can decrypt every key the store has ever sold.

Therefore:

1. Database backups go to the backup bucket. **No KEK material is ever written
   there** — not `.env`, not a Coolify environment export, not a "restore kit".
2. **KMS (production):** the key never leaves AWS. Protect it against deletion
   instead of copying it: keep automatic rotation on, never schedule deletion,
   and restrict `kms:ScheduleKeyDeletion` / `kms:DisableKey` to the owner's AWS
   root/admin identity only. The API's IAM user already has only
   Encrypt/Decrypt/GenerateDataKey/DescribeKey (`deployment.md` §5).
3. **`KEK_LOCAL_BASE64` (while still needed):** one copy in the owner's password
   manager, recorded as "vault KEK, local, version N". Different account and
   different provider from the backup bucket. Remove it once
   `deployment.md` §5's TOTP check returns no rows and `vault:rewrap` reports
   nothing left to rewrap.
4. Backups taken while some rows were wrapped locally need the local KEK to open
   those rows, **for as long as those backups are retained**. Keep the local KEK
   in the password manager until the oldest such backup has expired.
5. The backup bucket's credentials and the KMS credentials are held by
   different identities. An attacker needs both.

## 3. PostgreSQL — schedule, retention, destination

### Mechanism (general knowledge — verify in the Coolify UI before relying on it)

Coolify offers **Scheduled Backups** on a database resource: a cron
expression, the databases to include, local retention and an optional
**S3-compatible destination** (configured under _Storages_) with its own
retention. For PostgreSQL it runs `pg_dump` inside the container (custom format
at the time of writing) and uploads the file. It does **not** encrypt the file
itself and does not provide point-in-time recovery (no WAL archiving).

Things to confirm in the UI, and record in the first drill note: the exact
dump format and extension, whether both schemas are included (they are in one
database, so a whole-database dump includes `vault`), whether "backup all
databases" uses `pg_dumpall` (which would also capture roles and their
password hashes — **do not enable that**; roles are recreated by
`db:roles`), and whether upload failure produces a notification.

### Proposal

| Item        | PROPOSAL                                                                                                                                             | Reasoning                                                                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RPO**     | **24 h** at launch; tighten to **≤ 1 h** once order volume justifies it (WAL archiving via a sidecar such as WAL-G, or a managed Postgres with PITR) | A daily `pg_dump` cannot do better than its interval. Orders lost since the last dump can be partly rebuilt from Stripe/PayPal, but a licence imported and then lost is gone. |
| **RTO**     | **4 h** to a working API on restored data                                                                                                            | Restore of a small database is minutes; the time goes on roles, env, deploy, verification. The drill measures the real number.                                                |
| Schedule    | Daily at **02:00 UTC** (`0 2 * * *`), plus a **manual backup before every migration on the live database** (`deployment.md` already requires it)     | Before the analytics salt prune (03:29 UTC) so the window in §3.1 is not extended needlessly; quiet hours for the Gulf audience.                                              |
| Retention   | **7 daily + 4 weekly** (≈ 35 days) off-site; **2 days** on the server's local disk                                                                   | Long enough to notice silent corruption; short enough for the analytics-salt rule below.                                                                                      |
| Destination | **OWNER DECISION** — see §3.2                                                                                                                        |                                                                                                                                                                               |

#### 3.1 Retention is also a privacy setting

`deployment.md` §1: every backup holds that day's `AnalyticsSalt` next to that
day's events, so the analytics ids stay linkable to addresses for as long as
the backup exists. Backups also contain customer names, emails, order history
and audit logs. Treat every backup as personal data for its whole retention.
Longer retention is not "safer" — it is a longer exposure. If the owner wants
monthly archives beyond 35 days, that is a legal/privacy decision, not an
operations one.

#### 3.2 Destination — OWNER DECISION

Requirements, whichever provider:

- **Off the Coolify server and off Hostinger.** A server loss must not take the
  backups with it.
- **A different account from the media bucket's write token** — the API's
  `S3_*` credentials must not be able to touch backups.
- Encrypted at rest (all three options below do this by default), and
  ideally **object lock / versioning** so a compromised Coolify host cannot
  delete history.
- A write-only (or write + list) key for Coolify; read/delete only for the owner.

Options to price (the owner chooses; costs are for a database in the tens of
MB, i.e. negligible storage — the deciding factors are account separation and
object lock):

| Option                                                 | Notes                                                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Cloudflare R2, **separate bucket**, separate API token | Same vendor as media; cheapest and simplest. Weakest separation — one Cloudflare account compromise reaches both. |
| Backblaze B2 / Wasabi                                  | Different vendor from media and from AWS KMS. Supports object lock.                                               |
| AWS S3 in a **different** AWS account from the KMS key | Strong object lock; must not share an account/IAM with the KMS key, or rule §2.5 is broken.                       |

Client-side encryption of the dump (e.g. `age` with a public key, private key
held offline by the owner) is **recommended but optional**: the vault rows are
already encrypted, but the `public` schema (customers, orders) is not. If
adopted, the private key is a third secret that must be stored like the KEK —
separate from the backups. **OWNER DECISION.**

## 4. R2 media

Media can be re-uploaded in principle, but product and article images were
migrated once and edited since; re-creating them is days of work.

**PROPOSAL:** a weekly copy (`rclone sync --backup-dir`, or R2's own bucket
replication if available on the account) from `digital-activation-media` into
the backup destination under `media/`, with **30 days** of versioned history;
and object versioning / a lifecycle rule on the live bucket if R2 offers it on
the plan. RPO 7 days for images is acceptable because new uploads are few and
visible in the admin. **OWNER DECISION:** whether to do this now or accept "R2
durability only" until launch.

Restore check: every `Asset` row's object key resolves (§6 step 9).

## 5. Access control

| Who                     | Backup bucket                        | KMS key                                  | Password manager entry (local KEK, backup encryption key if any) |
| ----------------------- | ------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------- |
| Coolify (automated)     | write (+ list for retention pruning) | none                                     | none                                                             |
| API at runtime          | none                                 | Encrypt/Decrypt/GenerateDataKey/Describe | none                                                             |
| Owner                   | read, delete, configure              | admin                                    | yes                                                              |
| Agents (Claude, others) | **none**                             | **none**                                 | **none**                                                         |

Agents write runbooks and drill reports; they do not hold backup or key
credentials, and they never download a production dump.

## 6. Restore drill — into a THROWAWAY database

Run by the owner, or with the owner at the keyboard (TASK-0030 acceptance
criterion). **Never** restore over the staging/production database, never point
a running API, storefront or cron at the restored copy (the crons email real
customers — CLAUDE.md rule 3), and never restore onto a laptop: the dump holds
customer personal data.

**Where:** a new, temporary PostgreSQL 18 resource in Coolify (e.g.
`pg-restore-drill`), internal network only, no published port, deleted at the
end. A separate container — not a second database inside the live cluster —
so the drill's `da_app` / `da_vault` roles and passwords cannot collide with the
live ones. **OWNER DECISION:** confirm the server has the headroom, or use a
separate VPS.

Fill the drill record (§7) as you go; times matter for the RTO.

1. **Pick the backup.** In Coolify → the Postgres resource → Backups, note the
   newest successful backup's timestamp, size and location. Record whether the
   copy you restore is the **off-site** one (it should be — that is the copy a
   server loss leaves you).
2. **Create the throwaway resource** (`postgres:18-alpine`). Note its internal
   hostname and owner credentials; they exist only for the drill.
3. **Fetch the dump** onto the throwaway container (download from the bucket
   with the owner's read key, or Coolify's restore/import into that resource if
   the UI offers it). Do not copy it anywhere else.
4. **Restore without owners or grants** — the live role grants are rebuilt by
   the script, not trusted from the dump:

   ```bash
   pg_restore --no-owner --no-privileges --exit-on-error \
     -d "<throwaway owner URL>" /tmp/<backup-file>
   ```

   (If the backup is plain SQL rather than custom format, use `psql -v
ON_ERROR_STOP=1 -f`.) Record any errors verbatim — an error here is a drill
   finding, not something to work around silently.

5. **Recreate roles and grants** on the throwaway database, using throwaway
   passwords (never the live ones). From a shell that has only the drill's
   variables set — not the repo `.env`, which points at the live database:

   ```bash
   DATABASE_URL_MIGRATE=<throwaway owner URL> \
   DA_APP_PASSWORD=<drill-only> DA_VAULT_PASSWORD=<drill-only> \
     pnpm db:roles
   ```

   Alternatively `psql -f packages/db/prisma/init/roles.prod.sql` with the same
   variables (`deployment.md` §1).

   **Trap:** both `db:roles` and `db:doctor` load the repo-root `.env` with
   dotenv's default (no override). A variable you set in the shell wins; a
   variable you _forget_ silently falls back to `.env` — the live database.
   Safest is to run steps 5–6 from a checkout that has **no `.env` at all**
   (e.g. a shell on the Coolify host or a fresh clone), so a missing variable
   fails instead of reaching staging.

6. **Run the doctor against the copy** (TASK-0030 acceptance criterion). Set all
   three URLs to the throwaway database explicitly in the shell — the doctor
   loads `.env` but already-set variables win:

   ```bash
   DATABASE_URL_MIGRATE=<throwaway owner URL> \
   DATABASE_URL=<throwaway da_app URL> \
   DATABASE_URL_VAULT=<throwaway da_vault URL> \
     pnpm db:doctor
   ```

   Required: all green, in particular **`da_app` denied `vault.LicenseKey`**,
   `da_vault` cannot `DELETE`, migrations applied with none failed, table count
   matches the schema. Before running, confirm the doctor's printed (redacted)
   hosts are the throwaway's, not the live one.

7. **Row counts — compare with the live database at backup time.** Run the same
   queries on the live database (read-only, as the owner) close to the backup
   timestamp and on the copy. Expect equality, or live ≥ copy only by rows
   created after the backup.

   ```sql
   SELECT 'Product' t, count(*) FROM "Product"
   UNION ALL SELECT 'Variant', count(*) FROM "Variant"
   UNION ALL SELECT 'Customer', count(*) FROM "Customer"
   UNION ALL SELECT 'Order', count(*) FROM "Order"
   UNION ALL SELECT 'Payment', count(*) FROM "Payment"
   UNION ALL SELECT 'Article', count(*) FROM "Article"
   UNION ALL SELECT 'Asset', count(*) FROM "Asset"
   UNION ALL SELECT 'Redirect', count(*) FROM "Redirect"
   UNION ALL SELECT 'Setting', count(*) FROM "Setting"
   UNION ALL SELECT 'StaffUser', count(*) FROM "StaffUser"
   UNION ALL SELECT 'AuditLog', count(*) FROM "AuditLog";

   -- vault (as the owner role on the copy)
   SELECT state, "kekVersion", count(*)
   FROM vault."LicenseKey"
   GROUP BY 1, 2 ORDER BY 1, 2;
   SELECT count(*) FROM vault."KeyAccessLog";
   SELECT count(*) FROM vault."KeyImportBatch";

   -- latest activity, to state the effective RPO
   SELECT max("createdAt") FROM "Order";
   SELECT max("createdAt") FROM vault."LicenseKey";
   SELECT max("updatedAt") FROM "Setting";
   ```

   Record counts only. Never select `ciphertext`, `wrappedDek`, `totpSecret`,
   order-note bodies or any customer field into the drill record.

8. **Vault decrypt check — a gap.** There is no decrypt self-test in the code
   today: `VaultService.selfTest()` only runs `SELECT 1`, and `/health/ready`
   checks connectivity, not decryption. Proving that the restored ciphertext
   still opens therefore needs one of:
   - **(preferred, to build under its own task)** a non-printing check that
     opens N sampled `LicenseKey` rows through the configured KEK and reports
     only `opened: N / failed: M` — never the plaintext. It needs
     `DATABASE_URL_VAULT` pointed at the copy and KMS Decrypt rights, so the
     owner runs it.
   - **(interim, local-KEK rows only)** `pnpm --filter @da/api vault:rewrap`
     **without `--apply`** against the copy reports how many rows the local KEK
     opens and writes nothing (`apps/api/src/vault/rewrap-cli.ts`). It opens
     the wrapped data key, not the licence, and needs the AWS variables set as
     well. It does not test KMS-wrapped rows.
   - **(manual, owner only)** in a throwaway API pointed at the copy with mail,
     payments and crons disabled, reveal one known test key through the admin
     and compare it out of band. Do not put the value in the record.

   Until the first option exists, record which method was used and that KMS
   decryption of restored rows is **not yet proven**.

9. **Media check.** Pick 20 `Asset` rows from the copy and request
   `S3_PUBLIC_BASE_URL` + key for each; all should return 200. If §4 is
   adopted, also restore 3 objects from the media backup into a scratch prefix
   and compare checksums.
10. **Stop the clock.** Time from step 1 to step 8 is the measured RTO for the
    data layer. Add an estimate for repointing the apps (env change + redeploy),
    which the drill deliberately does not do.
11. **Destroy.** Delete the throwaway resource and its volume, delete the
    downloaded dump from wherever it was fetched to, and record that you did.
12. **Report.** Save the record (§7) as
    `project-management/reports/release/TASK-0030-restore-drill-<YYYY-MM-DD>.md`
    and link it from TASK-0030. Repeat monthly while the release checklist in
    `deployment.md` requires "a restore drill within the last month", and after
    any change to the backup mechanism, destination or KEK provider.

## 7. Drill record template

```markdown
# Restore drill — <YYYY-MM-DD>

- Performed by: <owner name> (with: <agent/role, if any>)
- Backup used: <timestamp UTC> · <size> · location: <off-site bucket / local> · format: <custom/plain>
- Throwaway target: <Coolify resource name / host>, Postgres <version>
- KEK provider at backup time: <aws-kms / local / mixed>

## Timeline (UTC)

| Step                  | Start | End | Notes                                 |
| --------------------- | ----- | --- | ------------------------------------- |
| 1 Pick backup         |       |     |                                       |
| 3 Fetch dump          |       |     |                                       |
| 4 pg_restore          |       |     | errors: none / <verbatim>             |
| 5 db:roles            |       |     |                                       |
| 6 db:doctor           |       |     | result: PASS / FAIL (<which check>)   |
| 7 Row counts          |       |     |                                       |
| 8 Vault decrypt check |       |     | method: <a/b/c> · opened N / failed M |
| 9 Media check         |       |     | 20/20 OK                              |
| 11 Destroyed          |       |     | resource + dump deleted: yes          |

## Row counts (live at <time> vs copy)

| Table | Live | Copy | Match |
| ----- | ---- | ---- | ----- |

## Results

- Effective RPO (newest row in copy vs backup time): <…>
- Measured RTO, data layer: <…> · estimated full RTO incl. redeploy: <…>
- db:doctor vault isolation on the copy: PASS / FAIL
- Vault decrypt proven: yes (method) / not yet — <why>
- Off-site copy restorable without access to the Coolify server: yes / no

## Findings and follow-ups

- <finding> → <task id or "none">

No licence key, credential, connection string or customer data appears in this record.
```

## 8. Owner decisions, in one list

1. **RPO / RTO** — accept 24 h / 4 h for launch, or set others (and whether to
   fund PITR now).
2. **Backup destination and its cost** — R2 separate bucket, Backblaze/Wasabi,
   or S3 in a separate AWS account; with object lock or not.
3. **Retention** — 7 daily + 4 weekly (≈ 35 days), or other; anything longer is
   also a privacy decision (§3.1).
4. **Client-side encryption of dumps** — yes/no, and where its private key lives.
5. **Media backup** — weekly copy now, or rely on R2 durability until launch.
6. **Drill host** — throwaway Coolify resource on the same server, or a
   separate machine; and a date for the first drill, run by or with the owner.
7. **KMS deletion protection** — restrict key deletion/disable to the owner's
   identity (an AWS change only the owner can make).

## 9. What this page does not do

- It does not enable or run any backup, and no restore has been performed.
- It does not change `docs/deployment.md`; under COMMENT-0003 the backup
  section there is maintained by TASK-0032 and should link here once the owner
  has decided §8.
