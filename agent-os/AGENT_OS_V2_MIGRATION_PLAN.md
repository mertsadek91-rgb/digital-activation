# Agent OS V2 — migration plan and record

**Change request:** CR-0003. The migration is staged and reversible. No V1
mechanism is removed until its V2 replacement is proven by an eval.

**Status:**

- Every stage below ran on 2026-09-29, in branch
  `claude/enterprise-multi-agent-governance-451ac4`. Nothing is committed.
- Rollback for the whole migration: `git checkout -- . && git clean -fd agent-os
.claude CLAUDE.md`. V1 itself was never committed either. Keep a copy of
  `project-management/` before cleaning.

| Stage                              | What                                                                                                                                                                                                                                          | Evidence it works                                                                                                                                                                                                        | Rollback                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **M0 Audit and safety**            | `AGENT_OS_V2_CURRENT_STATE_AUDIT.md`; V1 indexes snapshotted before migrating                                                                                                                                                                 | —                                                                                                                                                                                                                        | —                                                                                             |
| **M1 Lean root context**           | root `CLAUDE.md`, 88 lines. None existed before                                                                                                                                                                                               | —                                                                                                                                                                                                                        | delete it                                                                                     |
| **M2 Rules and skills**            | 7 path-scoped rules, 6 skills                                                                                                                                                                                                                 | —                                                                                                                                                                                                                        | delete `.claude/rules`, `.claude/skills`                                                      |
| **M3 Agents and router**           | 7 subagents with restricted tools; `routing.json` + `router.mjs`; `PERMISSIONS.json` gains executors, PM-07 and quality contracts, with nothing removed                                                                                       | routing.test.mjs (10)                                                                                                                                                                                                    | revert the files                                                                              |
| **M4 Permissions and hooks**       | PreToolUse guard and PostToolUse metrics; permission deny rules                                                                                                                                                                               | guard.test.mjs (19 incl. REV-0004/0005 regressions); a live probe of the hook as a subprocess; three real blocks during the migration itself                                                                             | remove the `hooks` block from `.claude/settings.json`                                         |
| **M5 Canonical state**             | `pm migrate-v1` imported all **77** V1 records unchanged as `v1_imported` events                                                                                                                                                              | V2 indexes compared field by field with the V1 snapshot: **0 differences** (tasks, issues, CRs, decisions, consensus, agent and manager state), apart from one V2 omission (`affected_pages`), fixed; state.test.mjs (7) | delete `agent-os/state/`; the archived V1 generator is in `project-management/tools/archive/` |
| **M6 Dashboard**                   | reads `/api/state` live; falls back to `data.js`; all V1 views kept                                                                                                                                                                           | consistency.test.mjs (served state = canonical state)                                                                                                                                                                    | revert `app.js` and `styles.css`                                                              |
| **M7 Independent review**          | reviewer executors never `main`; CLI completion gate at L3+; V1's six fake "REVIEW" comments relabelled                                                                                                                                       | decision-rights.test.mjs (5)                                                                                                                                                                                             | —                                                                                             |
| **M8 Product Evolution**           | PM-07 and squad; SIG/INS/OPP entities; evidence, reviews, lifecycle, owner decisions                                                                                                                                                          | opportunity.test.mjs (10); OPP-0001 shaped by real fresh-context reviews                                                                                                                                                 | —                                                                                             |
| **M9 Opportunity dashboard**       | discovery lanes, detail with owner actions, compare, radar, portfolio, signals and watchlist, ranking                                                                                                                                         | rendered and checked in the browser                                                                                                                                                                                      | —                                                                                             |
| **M10 Eval harness**               | `agent-os/evals/`, 55 tests, each in an isolated sandbox; CI step                                                                                                                                                                             | `pnpm agent-os:eval`                                                                                                                                                                                                     | —                                                                                             |
| **M11 Observability and governor** | `governor.json`; `pm metrics`; stuck and loop detection                                                                                                                                                                                       | decision-rights.test.mjs (governor case)                                                                                                                                                                                 | —                                                                                             |
| **M12 V1 compatibility removal**   | Done (TASK-0083). Neither `project-management/tools/sync.mjs` nor `PROJECT_CONFIG.file_ownership` was ever committed (REV-0066 claimed removing them; it was invalidated); stale references removed; ownership is `routing.json` domains only | consistency.test.mjs (M12 case)                                                                                                                                                                                          | —                                                                                             |

## Findings the migration itself produced

- **TASK-0010 was mis-levelled.** Its files include `checkout/`, which has an
  L4 floor. V1 stated the floor rule but never checked it. Now at L4.
- **Four V2 bugs were caught by evals or by first use and fixed:**
  - a glob that could not match inside braces
  - repeated CLI flags being dropped
  - non-deterministic projections after formatting
  - `owner_mode` returning `undefined` instead of false
- **The guard blocked the migrating agent three times.** One block was
  correct. Two exposed over-broad rules, fixed with eval cases that pin the
  precision.

## Follow-ups (traceable)

| Task      | What                                                                                             | Level |
| --------- | ------------------------------------------------------------------------------------------------ | ----- |
| TASK-0081 | Load the `.claude/agents` definitions in a fresh session; re-verify their tool restrictions      | L2    |
| TASK-0082 | Detect script-based writes (`node -e`, `python -c`) to protected paths, or document an allowlist | L3    |
| TASK-0083 | Remove `PROJECT_CONFIG.file_ownership` after one release (M12)                                   | L2    |

Owner actions:

| Item     | Action                                                                              |
| -------- | ----------------------------------------------------------------------------------- |
| BUG-0017 | Move the plaintext MCP credential out of `~/.claude/settings.json`                  |
| BUG-0018 | Decide whether to run agents outside `bypassPermissions`, so that `ask` gates apply |
