# Decision rights matrix

The machine form is `agent-os/policies/decision-rights.json`, and the CLI enforces
it. V2 replaces V1's generic "everyone must agree" consensus with **named
decision owners and bounded vetoes**. After the maximum number of review rounds
an item escalates; it does not loop.

## Review statements

| Statement                     | Meaning                                                                                       | Who may use it                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| PASS / FAIL                   | the criteria were verified, or not                                                            | any reviewer                                                                              |
| RECOMMENDATION / CONCERN      | advice; does not block                                                                        | any reviewer                                                                              |
| OBJECTION                     | must be answered before completion                                                            | any reviewer                                                                              |
| **BLOCKING_OBJECTION / VETO** | blocks completion and release until the same reviewer clears it or the owner accepts the risk | **only the roles in `veto` for that decision class**; the CLI refuses it from anyone else |
| ACCEPTED_RISK                 | a risk accepted on the record                                                                 | the owner (`risk_accepted` is owner-only)                                                 |
| USER_DECISION_REQUIRED        | the decision belongs to the owner                                                             | any reviewer                                                                              |

## Striking a review (`pm review-invalidate`, TASK-0092)

A review that should not count (recorded by another tool, never actually run)
is struck by appending a `review_invalidated` event; the original stays in the
log and `pm show` lists it as invalidated. Who may strike it depends on what it
says:

| Struck review                              | Who may strike it                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| any review recorded by the owner           | nobody: an agent cannot unsay the owner                                                                                                |
| BLOCKING_OBJECTION / VETO                  | only the reviewer who recorded it                                                                                                      |
| any other non-PASS (OBJECTION, CONCERN, …) | the reviewer, or exec-director — never the task's responsible manager, so dissent cannot be erased and the round count cannot be reset |
| PASS                                       | the reviewer, exec-director, the task's responsible manager, the reviewer's manager, or the class owner/escalation chain               |

The task's primary agent can never strike another reviewer's review of its own
work. Every invalidation needs a reason, and `pm check` replays the authority.

## Classes

| Class                  | Owner                    | Required reviewers                             | Veto                                         | Max rounds | Escalation                    |
| ---------------------- | ------------------------ | ---------------------------------------------- | -------------------------------------------- | ---------- | ----------------------------- |
| `product_scope`        | pm-01                    | exec-director                                  | owner                                        | 2          | exec-director → owner         |
| `architecture`         | pm-04                    | backend-architect, pm-06                       | security-engineer                            | 3          | exec-director → owner         |
| `auth`                 | auth-rbac-specialist     | security-engineer, backend-architect, qa-lead  | security-engineer                            | 3          | pm-04 → exec-director → owner |
| `database_schema`      | database-architect       | backend-architect, qa-lead                     | database-architect, security-engineer        | 3          | pm-04 → owner                 |
| `payment`              | pm-04                    | security-engineer, integration-engineer, pm-01 | security-engineer, owner                     | 3          | exec-director → owner         |
| `security`             | security-engineer        | pm-06                                          | security-engineer                            | 2          | pm-06 → exec-director → owner |
| `design_system`        | design-system-architect  | frontend-architect, accessibility-specialist   | accessibility-specialist                     | 3          | pm-03 → exec-director         |
| `visual`               | pm-03                    | art-director                                   | accessibility-specialist                     | 3          | pm-03 → exec-director         |
| `seo_routes`           | technical-seo-specialist | frontend-architect, pm-05                      | technical-seo-specialist                     | 2          | pm-05 → pm-04 → owner         |
| `analytics_schema`     | analytics-engineer       | pm-05, security-engineer                       | security-engineer                            | 2          | pm-05 → owner                 |
| `destructive_data`     | database-architect       | security-engineer, release-manager             | database-architect, security-engineer, owner | 2          | owner                         |
| `release`              | release-manager          | qa-lead                                        | qa-lead, security-engineer, release-manager  | 2          | pm-06 → owner                 |
| `opportunity_approval` | **owner**                | embedded-product-engineer                      | owner                                        | 2          | pm-07 → owner                 |
| `roadmap_ranking`      | **owner**                | —                                              | owner                                        | 1          | owner                         |

- **Which class applies:** a task's `decision_class`, or else the class of the
  highest-level routing domain its `affected_files` touch. Opportunities are
  always `opportunity_approval`.
- **Deliberately absent:** a design preference has no veto over architecture,
  and a product preference has no veto over a security control.
- **Owner-only events** (the CLI refuses them from agents):
  - `opportunity_decided`
  - `ranking_set`
  - `portfolio_preferences_set`
  - `risk_accepted`

## Consensus records

CONSENSUS-0001 and CONSENSUS-0002 remain the record for Level 5 decision
reviews. A CONSENSUS record now names its `decision_class`. "Consensus"
means: required reviewers have recorded reviews, no blocking statement is
open, and the owner has decided where the class requires it. It does not
mean unanimity.
