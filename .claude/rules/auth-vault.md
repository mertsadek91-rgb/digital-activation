---
paths:
  - "apps/api/src/auth/**"
  - "apps/api/src/account/**"
  - "apps/api/src/vault/**"
  - "apps/api/src/fulfillment/**"
  - "packages/db/prisma/schema/30-vault.prisma"
  - "packages/db/prisma/init/**"
---

# Auth and licence vault — L4 minimum, security review mandatory

- **The vault holds the product itself.** It lives in schema `vault`, reachable only by role `da_vault`. `da_app` has no grant on it, and `da_vault` has no DELETE (both verified live on 2026-09-29).
  - Import `vaultPrisma` from `@da/db` **only** inside `apps/api/src/vault/`.
  - `pnpm db:doctor` proves the isolation.
- **Envelope encryption:** each row gets an AES-256-GCM DEK, wrapped by the KEK in AWS KMS. `KEK_PROVIDER=local` is refused in production.
- **Revealing a key** needs ADMIN plus a TOTP step-up within 15 minutes, and writes `KeyAccessLog` *before* the plaintext exists. Keep that order.
- **Fingerprints** are `sha256(salt ␠ key)` and must use the same salt forever (BUG-0002 / TASK-0011). Never change the salt on a database that has rows.
- **Staff sessions:**
  - Argon2id, with a decoy hash for unknown emails; TOTP is mandatory and single-use.
  - Access JWT lasts 15 minutes; the refresh token rotates and lasts 30 days.
  - Every retired refresh hash is kept (`StaffRetiredToken`); a replay outside a 10 s grace window revokes the session (BUG-0004, TASK-0013).
  - `StaffGuard` checks the session row on every request, so logout and deactivation take effect at once (BUG-0005, TASK-0014).
- **Router:** `pnpm pm route --paths <files>` returns the required team, which here always includes the security reviewer. A VETO from `security-engineer` blocks completion; see the decision rights.
- **No frontend-only permission checks.** The API is the enforcement point.
