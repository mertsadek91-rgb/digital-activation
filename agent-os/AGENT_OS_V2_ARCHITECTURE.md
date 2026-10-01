# Agent OS V2 — architecture

**CR-0003**. This supersedes the V1 design in DEC-0010. Governing decisions:

| Record   | Decision                             |
| -------- | ------------------------------------ |
| DEC-0012 | canonical state                      |
| DEC-0013 | risk-adaptive governance and routing |
| DEC-0014 | Product Evolution                    |

The objective: **the smallest organisation and process that can make a good
decision and carry it out safely.** Roles are a catalog; the router picks the
team. Rules that can be enforced mechanically are.

## Layers

| Concern                       | Mechanism                                                                              | Where                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Always-needed context         | root `CLAUDE.md`, under 200 lines                                                      | `/CLAUDE.md`                                                                       |
| Area knowledge                | path-scoped rules; they load only when matching files are read                         | `.claude/rules/*.md`                                                               |
| Occasional procedures         | skills                                                                                 | `.claude/skills/*/SKILL.md`                                                        |
| Specialists needing isolation | subagents with restricted tools                                                        | `.claude/agents/*.md`                                                              |
| Hard boundaries               | PreToolUse guard hook (runs in every mode, including bypass) and permission deny rules | `.claude/hooks/guard.mjs`, `agent-os/policies/guard.json`, `.claude/settings.json` |
| Observability                 | PostToolUse metrics hook; guard decision log                                           | `.claude/metrics/` (local)                                                         |
| Canonical state               | append-only event log                                                                  | `agent-os/state/events.jsonl`                                                      |
| State writes                  | validating CLI (schemas, enums, lifecycle, authority, decision rights, owner-only)     | `agent-os/tools/pm.mjs`                                                            |
| Owner decisions               | dashboard server in owner mode, or the interactive owner CLI                           | `agent-os/tools/server.mjs`, `pm owner`                                            |
| Projections                   | front matter, indexes, profiles, `data.js`                                             | `agent-os/tools/lib/project.mjs`                                                   |
| Routing                       | domain table, ownership floor, level requirements, executors                           | `agent-os/policies/routing.json`, `tools/lib/router.mjs`                           |
| Decision rights               | owner, reviewers, veto domains, maximum rounds, escalation                             | `agent-os/policies/decision-rights.json`                                           |
| Governor                      | fan-out, review-round, attempt and research-loop limits; stuck detection               | `agent-os/policies/governor.json`, `tools/lib/rules.mjs`                           |
| Agent OS evals                | `node:test`, each in an isolated sandbox                                               | `agent-os/evals/`                                                                  |
| CI enforcement                | `pnpm agent-os:eval && pnpm pm:check` in the `verify` job                              | `.github/workflows/ci.yml`                                                         |

## Canonical state (DEC-0012)

- **The log is the only source of truth.** One JSON event per line in
  `events.jsonl`, schema `agent-os/schemas/event.schema.json`. Current state is
  the fold of the file in order (`materialize()`). Entity kinds:

  | Prefix      | Entity         |
  | ----------- | -------------- |
  | `TASK`      | task           |
  | `BUG`       | issue          |
  | `CR`        | change request |
  | `DEC`       | decision       |
  | `CONSENSUS` | consensus      |
  | `EPIC`      | epic           |
  | `MILESTONE` | milestone      |
  | `OPP`       | opportunity    |
  | `SIG`       | signal         |
  | `INS`       | insight        |
  | `REL`       | release        |

  Reviews, evidence, links, owner decisions, ranking, portfolio preferences
  and accepted risks are events on those entities.

- **Transactional append.** `commit()` takes a lock, builds the resulting state
  in memory, runs every guard against it, and only then appends. If it refuses,
  nothing is written.
- **Append-only.** `pm check` fails if a committed line was removed or
  rewritten; locally it compares against HEAD, in CI against the PR base.
  `.gitattributes` merges the log with `merge=union`, so parallel branches keep
  both sides.
- **Projections are a pure function of the log.** Wall-clock checks such as
  stuck detection use the last event's time, so a committed projection stays
  valid. Live views pass the real clock.
- **Why not SQLite or the app's Postgres.**
  - A binary database in Git cannot be reviewed in a PR, and it conflicts on
    every parallel branch.
  - The app database is live staging and must not hold agent state.
  - Line-per-event JSON diffs cleanly, merges with `union`, and needs no
    dependency.

## Artifact registry

| Class                 | Artifacts                                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CANONICAL**         | `agent-os/state/events.jsonl`. Configuration: `project-management/PERMISSIONS.json`, `PROJECT_CONFIG.json`, `agent-os/policies/*`, `agent-os/schemas/*`                                                        |
| **GENERATED**         | record front matter; `*_INDEX.json`, `*_STATE.json` (V1-compatible fields); `agents/*.md`, `managers/*.md`; `dashboard/data.js`; `history/*.json`                                                              |
| **HUMAN_NARRATIVE**   | record bodies (task plans and work logs, opportunity development packs, decision rationale); `PROJECT_STATUS.md`, `CURRENT_STATE_AUDIT.md`, knowledge base, runbooks                                           |
| **IMMUTABLE_HISTORY** | `project-management/logs/*.log` (V1, frozen); the event log itself                                                                                                                                             |
| **DEPRECATED**        | `project-management/tools/sync.mjs` (now forwards to `pm`); `tools/archive/sync-v1.mjs.txt` (V1 source, kept for the record); `FILE_OWNERSHIP` in `PROJECT_CONFIG.json` (superseded by `routing.json` domains) |

## Risk-adaptive governance (DEC-0013)

| Level           | Workflow                                                                                                                  | Enforced by                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| L1 Observe      | Inspect → Analyze → Report                                                                                                | —                                                          |
| L2 Local        | Understand → Implement → Test → Verify                                                                                    | CI                                                         |
| L3 Shared       | Impact review → Implement → **independent review** → Tests → Regression                                                   | CLI refuses COMPLETED without a passing independent review |
| L4 Cross-system | the above + second manager + QA                                                                                           | `pm check` (second manager); router adds reviewers         |
| L5 Critical     | Decision record → Specialists → Risk review → Owner approval → Controlled implementation → Full regression → Release gate | CLI refuses past APPROVAL without CONSENSUS                |

The level is never lower than the **ownership floor** of the paths a task
touches (`routing.json` `min_level`). V1 stated this rule; V2 checks it.

**Artifact weight follows the level.** L1–2 work needs state plus git and
tests. L3+ keeps the richer task body. L4–5 need impact records, reviews and
release evidence.

## Independent evaluation

The implementer is never the only evaluator. Reviewer roles run as
fresh-context subagents: the router never assigns `main` to a reviewer. Their
tool lists exclude Edit and Write, so they report findings and do not fix.

The CLI rejects two things: an "independent" review whose reviewer is the
primary agent, and COMPLETED at L3+ without one. Reviews are events with
reviewer, executor, type, result, findings and evidence. V1's six "REVIEW"
comments were self-authored and are labelled as such.

## Governor

- **Limits** (in `governor.json`):
  - fan-out by level and by type (shaping 6, research 3, audit 2)
  - review rounds: 3
  - failed attempts: 2
  - research loops without new evidence: 2
  - stuck-after-days per status
  - duplicate-similarity threshold
- **Tracked:**
  - tool calls per session (hook)
  - guard denials (hook)
  - review rounds, attempts and transitions (event log)
- **Not tracked:** token and model cost are not exposed to hooks, so they are
  not estimated.

## Dashboard

`pnpm pm:dashboard` serves `project-management/dashboard/`. `/api/state` is
computed from the log on every request.

- **V1 views, kept:** overview, tasks, kanban, agents, managers, epics,
  milestones, issues, changes, decisions, consensus, files, timeline, reports,
  permissions.
- **V2 views:** attention, discovery and opportunities (lifecycle lanes,
  compare, owner ranking), opportunity detail with owner actions, radar,
  portfolio, signals and watchlist, reviews, risks, security, releases.
- **Offline:** opened from `file://` it falls back to the `data.js` snapshot and
  is read-only.

## What V2 does not do

- It does not run in the background. Discovery happens when someone asks, at a
  milestone, or on a routine the owner schedules; see
  PRODUCT_EVOLUTION_OPERATING_MODEL.
- It cannot prove which agent typed a CLI command. See THREAT_MODEL for what
  attribution rests on.
