---
name: impact-analysis
description: Pre- and post-change impact analysis for L3+ work in this repo — what could break, who must review, what to retest. Use before implementing a shared or cross-system change, and again after, before requesting review.
---

# Impact analysis

## Before the change

1. **Route it.** Run `node agent-os/tools/pm.mjs route --paths <every file you expect to touch> [--level N]`.
   The output gives you:
   - the real authority level (the ownership floor applies)
   - the decision class
   - the smallest team
   - the workflow

   If the task's `authority_level` is lower than the router's, raise it with `pm set`
   and give a reason.
2. **Search before creating.** Is there an existing utility, component, service or module
   that already does this? `git grep` it.
3. **Walk the blast radius.** For each item below, note it or write "no impact":
   - modules and pages
   - shared components and `tokens.css`
   - API contracts (`packages/contracts`) and every consumer (storefront, admin, workers, importers)
   - schema and migrations
   - auth and RBAC
   - vault
   - CSP and third-party budget
   - SEO (routes, canonical, hreflang, sitemaps, JSON-LD)
   - analytics
   - ar/en and RTL
   - mobile widths
   - performance (per-request rendering)
   - integrations (Stripe, WhatsApp, KMS, R2, mail)
   - crons
   - tests
   - docs
4. **Collision check.** Is another open task claiming the same files? `pm check` reports
   collisions. Sequence the work; do not edit in parallel.
5. **Write it down.** Put it in the task body under "Pre-change impact analysis". List the
   regression rows from `project-management/REGRESSION_MATRIX.md` you will run.

## After the change

1. `git diff --stat`: every file changed must be in `affected_files`, or explained.
2. Record the secondary effects you actually observed: UI, mobile, RTL, API, data,
   performance, SEO.
3. Create follow-up work as tasks (`pm create TASK …`). Do not bury it in prose.
4. Run the regression rows. Then request an independent review (skill `independent-review`).
