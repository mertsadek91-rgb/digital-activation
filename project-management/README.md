# Project management

> **V2 (CR-0003).** Canonical state is now `agent-os/state/events.jsonl`, changed only through
> `pnpm pm …`. The front matter of the record files below, and every index and state file, are
> **generated projections**. Hand edits are detected by `pnpm pm check` and blocked by the guard hook.
> Where this README describes V1 behaviour, `agent-os/AGENT_OS_V2_ARCHITECTURE.md` takes precedence.
> Serve the dashboard with `pnpm pm:dashboard`.

The organisational memory of the Digital Activation rebuild: every meaningful
task, issue, change request, decision and consensus item, who owns it, what
authority it carries, and where it stands. Set up under **CR-0001**, which
activated the owner's master operating constitution.

Open `dashboard/index.html` in a browser. It needs no server.

## Read this first

A new session reconstructs the project from, in order:

1. [PROJECT_STATUS.md](PROJECT_STATUS.md) — the management summary
2. `PROJECT_STATE.json` — the numbers, generated
3. [PROJECT_KNOWLEDGE_BASE.md](PROJECT_KNOWLEDGE_BASE.md) — how the system is built
4. [CURRENT_STATE_AUDIT.md](CURRENT_STATE_AUDIT.md) — what is good, fragile, risky
5. `TASK_INDEX.json`, then the task files that are not in `backlog/` or `completed/`
6. `decisions/`, `consensus/`, `change-requests/`
7. the tail of `logs/activity.log` and `logs/task-events.log`

## Sources and generated files

| Edit these (source of truth)                                                                                                                                             | Never edit these (written by `pnpm pm:sync`)                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `tasks/<status>/TASK-XXXX.md` · `issues/BUG-XXXX.md` · `change-requests/CR-XXXX.md` · `decisions/DEC-XXXX.md` · `consensus/CONSENSUS-XXXX.md` · `epics/` · `milestones/` | `TASK_INDEX.json` · `ISSUE_INDEX.json` · `CHANGE_INDEX.json` · `DECISION_INDEX.json`                    |
| `PERMISSIONS.json` — roles and their authority                                                                                                                           | `PROJECT_STATE.json` · `AGENT_STATE.json` · `MANAGER_STATE.json`                                        |
| `PROJECT_CONFIG.json` — phase, current milestone, health rules, ownership map, reports                                                                                   | `agents/*.md` · `managers/*.md` — profiles rebuilt from PERMISSIONS.json plus live assignments          |
| `logs/activity.log`, `logs/changes.log` — append meaningful events by hand                                                                                               | `dashboard/data.js` · `history/YYYY-MM-DD.json` · status transitions appended to `logs/task-events.log` |

This is the answer to the constitution's rule that the dashboard must never
knowingly show stale status (§138): there is only one place to change a task's
state, and everything else is derived from it.

```bash
pnpm pm:sync     # rebuild everything, move task files to their status folder, log transitions
pnpm pm:check    # exit 1 if anything is stale or breaks a rule (CI-ready)
```

## What sync validates

- ids are unique and match file names; status, stage, priority and risk use the vocabulary
- the primary agent and manager exist in PERMISSIONS.json
- **authority:** a task's level does not exceed its primary agent's `max_authority`
- **Level 4:** a second manager is among the required reviewers
- **Level 5:** no task passes the APPROVAL stage without a `related_consensus`
- **completion:** COMPLETED ⇔ progress 100
- **dependencies:** nothing moves past READY while a dependency is open, unless it says WAITING_DEPENDENCY or BLOCKED
- **file collisions:** two open, non-backlog tasks declaring the same file are reported (§71)

## Conventions

**One task, one file.** Front matter carries the fields in the table on the
dashboard; the body carries the constitution's sections (objective, original
request, … completion checklist). Copy an existing task to start a new one.

**Authority levels.** L1 observe · L2 local change · L3 shared change (manager
approval) · L4 cross-system (second manager) · L5 critical (Consensus Board).
`max_authority` in PERMISSIONS.json is the highest level a role may be primary
on; the approvals of that level still apply.

**Progress** follows the lifecycle, not a feeling: 10 investigation · 20
analysis · 30 impact · 40 implementation started · 60 core done · 70 technical
review · 80 management/UX review · 90 QA/security/regression · 100 every
applicable approval passed.

**Health** is a rule, written in PROJECT_CONFIG.json, not a score.

**Comments** in task files are `COMMENT-XXXX · <role id> · <TYPE> — message`,
TYPE one of COMMENT, QUESTION, REVIEW, WARNING, APPROVAL, REJECTION.

**Secrets.** Nothing in this tree may contain a secret, an `.env` value, a
licence key or any content from the legacy order notes. Describe, never quote.

## The organisation

Seven managers (Executive Product Director, PM-01 … PM-06) and 42 specialist
roles, 40 staffed on this project. The CRM/ERP Workflow Architect and the AI
Integration Architect are defined but unstaffed: nothing in scope needs them.
See `dashboard/permissions.html` or PERMISSIONS.json.

## Honesty rules this tree keeps

- A decision the owner made is recorded as theirs, with its date. A decision
  reconstructed from code says so (DEC-0009).
- Consensus is never recorded as reached unless it was. CONSENSUS-0001 and
  CONSENSUS-0002 are open.
- An approval that belongs to the owner (e.g. DEC-0010, TASK-0001) stays
  pending until the owner gives it.
