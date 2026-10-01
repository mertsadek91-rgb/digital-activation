---
name: release-readiness
description: Release gate for this project (Coolify, one environment promoted from staging to production) — what must be true before a production-facing change or the cutover ships. Use before any deploy, DNS change, env change or cutover step.
---

# Release readiness

The depth of the gate depends on the change. A copy fix does not need the cutover gate.
Pick the row that applies.

| Change | Gate |
|---|---|
| L1–2 local change | CI green; visual QA if user-facing (ar + en) |
| L3 shared change | the row above, plus a passing independent review event and the regression rows for that system |
| L4 cross-system change | the rows above, plus a second-manager review and a security review if the change touches auth, the vault, checkout, webhooks, CSP or env; migration dry-run on a copy |
| L5 or cutover | the rows above, plus a CONSENSUS record, a backup taken and a restore proven (TASK-0030), a rollback path written (TASK-0032), the owner's go/no-go, and a release-manager review |

## Cutover specifics

Staging becomes production in place (DEC-0011); TASK-0044 holds the list.

- **Demo data:** remove the `example.invalid` customers and orders with a dry-run-first
  script. Only the owner runs it.
- **Environment:**
  - set `NEXT_PUBLIC_SITE_URL` to the apex; this turns indexing on
  - `STOREFRONT_URL` (CORS and email links)
  - `SEO_BLOCK_INDEXING`
  - remove `PREVIEW_TOKEN`
  - switch the payment keys to live (CONSENSUS-0001)
- **DNS:** move the apex from Hostinger to Coolify with a short TTL. Keep WordPress on a
  noindexed subdomain as the rollback. This step is the owner's.
- **After the switch:**
  - crawl the legacy URLs (TASK-0042)
  - submit sitemaps
  - watch for 72 hours: 404 monitor, error reporter, and paid → delivered under 60 s

## Rules

- Never release with an open BLOCKING_OBJECTION or VETO; the CLI refuses READY_FOR_RELEASE.
- Never weaken CI to ship.
- Record the release: `pm create REL …`, then `pm transition REL-… RELEASED`.
