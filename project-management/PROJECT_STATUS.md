# Project status

**As of:** 2026-09-29 (corrected under CR-0002)

**Phase:** staging live on Coolify; validation before the production cutover

**Health:** ATTENTION_REQUIRED. BUG-0001 is the only open HIGH in the new
application. Live numbers are in `PROJECT_STATE.json` and
`dashboard/index.html`.

The full evidence is in [CURRENT_STATE_AUDIT.md](CURRENT_STATE_AUDIT.md). It
supersedes the first audit of the same day, which misread the migration and
deployment state.

## Summary

| Environment               | Hosts                                                               | State                                            |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| Legacy (live)             | `digital-activation.com`                                            | WordPress on Hostinger; still the public store   |
| New application (staging) | storefront `new.`, admin `admin.`, API `api.digital-activation.com` | built from GitHub by Coolify; running; noindexed |

**Migration**

- Complete and serving on staging: catalogue, content, media and redirects.
- Not started: customers, orders and delivered keys. Whether they migrate at all
  is still to be decided.

**What stands between staging and production**

- card payments
- sweep reliability (BUG-0001)
- error tracking
- a tested backup restore
- a cutover runbook
- clearing staging's demo data

Staging becomes production in place (DEC-0011), so that last item is part of the
cutover itself.

## Health scope

Health describes the new application only. Two findings sit outside it and are
tracked separately, not ignored:

- **BUG-0014 (HIGH, LEGACY_WORDPRESS):** the live WordPress database still holds
  plaintext keys and credentials in its order notes.
- **BUG-0015 (MEDIUM, MIGRATION):** the local backup of the same data sits on the
  developer machine.

Neither reaches Git, the new database, any build or any container.

## Decisions waiting on the owner

These are the questions the repository cannot answer.

1. **TASK-0043 — migration scope.** Should legacy customers, orders and keys
   migrate? The options are A (everything), B (history without secrets) or
   C (nothing). The answer decides whether the SQL dump is still needed.
2. **CONSENSUS-0001 — payments.**
   - Has Stripe approved the Turkish entity?
   - Is PayPal still wanted for launch?
   - Would you launch on bank transfer alone? That is what staging offers today.
3. **TASK-0011 — salt.** Is `VAULT_FINGERPRINT_SALT` set on the Coolify API
   resource? The repository cannot show it.
4. **BUG-0016 — staging data and mail.**
   - Which mail transport does the Coolify API use today?
   - Who owns the one non-demo customer and order on staging?
5. **CR-0001 / CR-0002 — this system and the corrected audit.** Please review.

## Next task

TASK-0010 (sweep locks). Do not start until you say so.

## Agent OS V2 (CR-0003, 2026-09-29)

How work is governed has changed; the product state above has not. The details are in `agent-os/`.

- **Canonical state:** state now lives in one event log. The dashboard derives from it live (`pnpm pm:dashboard`).
- **Enforcement:** a hook blocks secret reads, legacy-backup writes, state bypass, owner impersonation and destructive commands.
- **Checks:** CI runs `pnpm agent-os:eval` (55 tests) and `pnpm pm check`.
- **Product Evolution (PM-07):**
  - **OPP-0001** (official channels) is **ready for your decision**, shaped by real engineering, UX and research reviews. It needs you to confirm which social handles the store actually owns.
  - OPP-0002 is still in discovery.
- **New findings:**
  - **BUG-0017:** your user-level Claude settings hold a plaintext MCP credential. Move it.
  - **BUG-0018:** hook `ask` decisions don't stop edits in bypass mode.
  - **BUG-0019:** a research agent wrote a scratch file outside the repo.
- **Awaiting your review:** CR-0003, and decisions DEC-0012, DEC-0013 and DEC-0014 (PROPOSED).
