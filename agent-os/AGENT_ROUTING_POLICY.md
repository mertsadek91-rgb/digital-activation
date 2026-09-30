# Agent routing policy

**A role that exists is not an active agent.** Run
`pnpm pm route --paths <files> [--level N] [--type research|audit|opportunity_shaping] [--user-facing] [--visual]`.
It returns the smallest team, with the reason each member is on it. The machine
form lives in `agent-os/policies/routing.json` and `tools/lib/router.mjs`.
Evals: `agent-os/evals/routing.test.mjs`.

## Algorithm

1. **Domains.** Each path belongs to the _first_ matching domain in
   `routing.json`, which lists domains from most to least specific. For example,
   `proxy.ts` falls under `storefront-routing`, not `storefront`. The domains
   table is also the single file-ownership map.
2. **Level.** The level is the requested level, or higher if a domain's
   `min_level` (the ownership floor) demands it.
3. **Implementer.** The primary agent of the riskiest domain.
4. **Reviewers, added by level:**

   | Level | Adds                                                    |
   | ----- | ------------------------------------------------------- |
   | L2    | visual QA, if the change is user-facing                 |
   | L3+   | an independent reviewer (`qa-lead`)                     |
   | L4+   | the other domains' managers as second-manager reviewers |
   | L5    | the decision class's required reviewers                 |

5. **Tag specialists**, added only from their `from_level`:

   | Tag         | Specialist               |
   | ----------- | ------------------------ |
   | `security`  | security-engineer        |
   | `visual`    | art-director             |
   | `data`      | database-architect       |
   | `seo`       | technical-seo-specialist |
   | `payments`  | qa-lead                  |
   | `migration` | security-engineer        |

6. **Executors.** Implementers run where they are mapped, usually `main`. Anyone
   routed **as a reviewer** runs in a fresh context: its own subagent if it has
   one, otherwise `subagent:independent-reviewer`. A reviewer never runs as
   `main`.
7. **Governor.** The team is capped by `max_fan_out_by_level` or `_by_type`.
   Optional members are trimmed first. If the required team still exceeds the
   cap, `over_limit` is reported and a human decides.

## Examples from this project

| Work                                      | Team                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| TASK-0062, admin font (L2)                | frontend-engineer · visual-qa                                                       |
| `tokens.css` change (L3)                  | design-system-architect · visual-qa · qa-lead (independent) · art-director          |
| TASK-0010, sweep locks (L4 by floor)      | backend-architect · qa-lead · security-engineer                                     |
| TASK-0013, auth (L4)                      | auth-rbac-specialist · qa-lead · security-engineer · pm-06                          |
| Auth redesign (L5)                        | the L4 team + backend-architect (decision-rights reviewer)                          |
| SEO route change (L4)                     | frontend-architect · qa-lead · security-engineer · technical-seo-specialist · pm-04 |
| Opportunity shaping, user-facing + visual | opportunity lead · embedded-product-engineer · product-ui-designer · art-director   |
| Research                                  | competitor-intelligence-analyst (read-only subagent)                                |

## Before spawning anyone else

Ask what specific information, capability, independence or parallelism the
extra agent adds. If there is no answer, do not spawn it.

**Parallel implementation** needs:

- disjoint files (`pm check` reports collisions)
- separate worktrees

Read-only research may run in parallel freely.
