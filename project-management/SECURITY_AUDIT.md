# Security audit

**Owner:** security-engineer (PM-06)

**Date:** 2026-09-29, corrected under CR-0002

**Basis:** [CURRENT_STATE_AUDIT.md](CURRENT_STATE_AUDIT.md)

This is a review by reading code and making read-only live checks. It is not a
penetration test. Nothing was written to any system, and no secret or customer
data was read.

## New Node.js application

| ID       | Severity | Finding                                                                      | Task      |
| -------- | -------- | ---------------------------------------------------------------------------- | --------- |
| BUG-0002 | MEDIUM   | Fingerprint salt is not enforced in production (the column is vault-only)    | TASK-0011 |
| BUG-0004 | MEDIUM   | Replaying a refresh token does not revoke the session                        | TASK-0013 |
| BUG-0003 | LOW      | The KeyAccessLog cascade exists, but the live DB denies DELETE to `da_vault` | TASK-0012 |
| BUG-0005 | LOW      | Deactivating or logging out staff takes effect only within 15 minutes        | TASK-0014 |
| BUG-0006 | LOW      | An emailed order link cannot pay; dormant until card payment is on           | TASK-0017 |
| BUG-0007 | LOW      | Order links never expire; one secret is reused across purposes               | TASK-0018 |

Under review, not yet findings:

- Which staff roles can reach READONLY-scoped routes (TASK-0015)
- Two identical webhook deliveries arriving at the same moment
- How CMS HTML is sanitised before rendering

## Outside the new application

| ID       | Severity | System           | Finding                                                          |
| -------- | -------- | ---------------- | ---------------------------------------------------------------- |
| BUG-0014 | HIGH     | LEGACY_WORDPRESS | Plaintext keys and credentials in the live WordPress order notes |
| BUG-0015 | MEDIUM   | MIGRATION        | Local backup copies of the same data on the developer machine    |

Checked and found clear:

- **Git:** none of this data is committed, in HEAD or in any branch's history.
- **New database:** not imported.
- **Coolify:** not in any build context. There is no Dockerfile, and builds come
  from GitHub.

## Controls confirmed in place

- **Vault role isolation**, confirmed live:
  - `da_app` has no access to the vault schema.
  - `da_vault` has no DELETE.
- **Encryption:** envelope encryption under KMS; a local KEK is refused in
  production.
- **Key reveal:** needs ADMIN plus a fresh TOTP, and writes the access log first.
- **Staff login:**
  - Argon2id, with a timing-safe path for unknown users
  - TOTP codes are single-use
  - httpOnly, SameSite=strict cookies
- **Browser headers:** per-request nonce CSP; HSTS preload.
- **Stripe:** signatures verified on the raw request body, with idempotent event
  handling.
- **Logs:** sensitive values are redacted.
- **Secret scanning:** gitleaks plus a guard against committing legacy artefacts.
- **Staging indexing:** blocked, confirmed live with both `noindex` and a robots
  disallow.
