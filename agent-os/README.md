# agent-os

The operating system for the agents working on this repository.

| Area                       | Contents                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Start here**             | root `CLAUDE.md`, then `pnpm pm attention`                                                                                                                                      |
| **Architecture**           | [AGENT_OS_V2_ARCHITECTURE.md](AGENT_OS_V2_ARCHITECTURE.md)                                                                                                                      |
| **Why and how it changed** | [audit](AGENT_OS_V2_CURRENT_STATE_AUDIT.md) · [migration](AGENT_OS_V2_MIGRATION_PLAN.md)                                                                                        |
| **Rules of engagement**    | [decision rights](DECISION_RIGHTS_MATRIX.md) · [routing](AGENT_ROUTING_POLICY.md) · [product evolution](PRODUCT_EVOLUTION_OPERATING_MODEL.md) · [threat model](THREAT_MODEL.md) |
| `state/events.jsonl`       | canonical state (append-only). Change it only with `tools/pm.mjs`                                                                                                               |
| `policies/`                | enums, routing and ownership, decision rights, governor, guard policy                                                                                                           |
| `schemas/`                 | JSON Schemas for every entity, the event, review and evidence                                                                                                                   |
| `tools/`                   | `pm.mjs` (CLI), `server.mjs` (dashboard), `lib/`                                                                                                                                |
| `evals/`                   | `pnpm agent-os:eval`; each test runs in an isolated sandbox                                                                                                                     |

```
pnpm pm help               # every command
pnpm pm check              # validate state + projections (CI runs this)
pnpm pm:dashboard          # http://127.0.0.1:4600 — owner actions only from your own terminal
pnpm agent-os:eval         # the Agent OS test suite
```
