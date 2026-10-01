---
paths:
  - ".github/**"
  - "docs/deployment.md"
  - "docker-compose.yml"
  - "scripts/**"
  - ".env.example"
  - "turbo.json"
---

# Release and infrastructure

- **Deployment:**
  - Coolify builds each app from GitHub with pnpm build and start commands (`docs/deployment.md` §3). There is no Dockerfile and no CD job.
  - `docker-compose.yml` is for local services only.
- **One environment.** Staging on `new.`/`admin.`/`api.` becomes production in place (DEC-0011). Anything that differs between staging and production belongs in TASK-0044's list.
- **Migrations** run as a release command, not on container start. `pnpm db:doctor` is the pre-DNS gate.
- **Secrets:**
  - `pnpm secrets:generate --print` gives the values to paste into Coolify.
  - `pnpm env:check` validates without printing.
  - Rotating a production secret is the owner's call.
- **CI is a release gate** (L3, ask-gated). Never weaken a job, skip a test or add `continue-on-error` to get green.
- **Runbooks:** migration policy, code rollback, cutover and rollback to WordPress are `docs/deployment.md` §12–13 (TASK-0032). What changes at cutover is `project-management/reports/release/TASK-0044-production-transition.md`.
- **Not yet in place:** a vendor for error reporting and uptime alerts (the scrubber and probes exist; TASK-0031), and a backup policy with a restore drill (TASK-0030). Do not claim otherwise.
- **Release checks:** load the `release-readiness` skill before any production-facing change.
