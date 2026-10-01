# Digital Activation

Rebuild of digital-activation.com — an Arabic-first store selling software
licence keys — from WordPress/WooCommerce to a Node.js monorepo. Owner:
mertsadekist. Plan: `docs/plan.html`. Deploy runbook: `docs/deployment.md`.

## Where things stand (verify before you assert — CR-0002)

- **Legacy (live):** `digital-activation.com` is still WordPress on Hostinger.
- **New stack (staging, Coolify, built from GitHub `main`):** storefront
  `new.digital-activation.com` (noindexed), admin `admin.`, API `api.`
  One environment; it becomes production in place (DEC-0011).
- **Migrated:** catalogue, content, media, redirects. **Not:** customers,
  orders, legacy keys (owner decision TASK-0043).
- Current state, health and what needs the owner: `pnpm pm attention`,
  `project-management/PROJECT_STATUS.md`, dashboard (`pnpm pm:dashboard`).

## Stack

pnpm 9 · Turbo · Node ≥ 22.12 · TypeScript **6.0.x (pinned — not 7)**
`apps/storefront` Next.js 16 · `apps/admin` Next.js 16 · `apps/api` NestJS 12 on
Fastify · `packages/db` Prisma 7 (pg adapter), PostgreSQL 18, schemas `public`

- `vault` · `packages/{contracts,seo,i18n,ui}` · `workers/jobs` (stub; cron
  sweeps run inside the API).

## Commands

```
pnpm install
pnpm typecheck && pnpm lint && pnpm test      # what CI's verify job runs
pnpm format:check
pnpm --filter @da/api test:int                # DB-backed integration suite (needs Postgres)
pnpm pm check                                 # governance + state consistency (CI)
pnpm agent-os:eval                            # Agent OS evals (CI)
```

## Non-negotiable

1. **No secrets in the transcript.** Never read or print `.env` (use `pnpm env:check`), never paste licence keys, tokens or order-note content anywhere.
2. **`Old Website/` and `.cache/` are read-only legacy input** in the main checkout only. They hold plaintext customer secrets. Never copy from them into the repo, a task, a log or a screenshot.
3. **The database in `.env` is the live staging database.** No experiments, lock tests, `migrate reset`, seeding or `--apply` imports against it without an approved task. Crons there email real addresses.
4. **`vaultPrisma` is imported only in `apps/api/src/vault/`.** JSON-LD is produced only in `packages/seo/src/jsonld.ts`.
5. **Applied migrations are immutable.** Write a new one.
6. **Owner decisions belong to the owner** — roadmap, opportunity approval, ranking, scope, legal, money, destructive or irreversible actions. Never record approval, consensus or a review that did not happen.
7. **Verify outcomes, not claims.** Run the test, render the page (ar/RTL _and_ en), hit the endpoint, query the row.
8. Commit, push or open PRs only when asked.

These are enforced where possible: `.claude/hooks/guard.mjs` (policy
`agent-os/policies/guard.json`) denies secret reads, legacy-backup writes,
state bypass, owner impersonation and destructive git/DB/rm commands.

## Project state — the Agent OS

Canonical state is **`agent-os/state/events.jsonl`** (append-only). Change it
only with the CLI; everything under `project-management/` except record
_bodies_, the narrative docs and the dashboard code is generated from it.

```
node agent-os/tools/pm.mjs help
pnpm pm route --paths <files> [--level N]     # who should work on this, and why
pnpm pm transition TASK-0010 IN_PROGRESS --by backend-architect --reason "…"
pnpm pm review TASK-0010 --type TECHNICAL --result PASS --independent --by qa-lead --findings "…"
```

- Every meaningful change maps to a TASK / BUG / CR / OPP. L1–2 work needs
  git + tests; L3+ needs an **independent review** before COMPLETED (the CLI
  refuses otherwise); L4 a second manager; L5 a CONSENSUS record.
- Authority levels, decision rights and vetoes: `agent-os/DECISION_RIGHTS_MATRIX.md`.
- Routing: use the smallest team `pm route` returns. Reviewers run as fresh-
  context subagents (`.claude/agents/`), never as the implementer.
- Product ideas go through Product Evolution (PM-07) as signals and
  opportunities — never straight to code. `agent-os/PRODUCT_EVOLUTION_OPERATING_MODEL.md`.

## Reconstruct context (new session)

1. This file. 2. `pnpm pm attention` and `project-management/PROJECT_STATUS.md`.
2. The task you were given: `pnpm pm show <ID>` and its file under
   `project-management/tasks/`. 4. Path rules load themselves from
   `.claude/rules/` when you open matching files. 5. Relevant DEC records.
3. The code. Do not read the whole history.

## On-demand

Skills in `.claude/skills/` (impact-analysis, opportunity-shaping,
release-readiness, database-change, visual-qa, project-reconstruction).
Architecture of the Agent OS: `agent-os/AGENT_OS_V2_ARCHITECTURE.md`.
Agent-system threats: `agent-os/THREAT_MODEL.md`.
