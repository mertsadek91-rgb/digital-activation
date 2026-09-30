---
paths:
  - "agent-os/**"
  - "project-management/**"
  - ".claude/**"
---

# Agent OS internals

- **Canonical state:** `agent-os/state/events.jsonl` (DEC-0012).
  - It is append-only; `pm check` fails if a committed line changes.
  - Git merges it with `merge=union`.
  - Write only through `agent-os/tools/pm.mjs`. The guard denies everything else.
- **Artifact classes** (see `agent-os/AGENT_OS_V2_ARCHITECTURE.md` §Artifacts):
  - **CANONICAL:** the event log, plus `PERMISSIONS.json`, `PROJECT_CONFIG.json` and `agent-os/policies/*` as configuration.
  - **GENERATED:** record front matter, the `*_INDEX.json` and `*_STATE.json` files, `agents/`, `managers/`, `dashboard/data.js` and `history/`.
  - **HUMAN_NARRATIVE:** record bodies and the `*.md` docs.
  - **IMMUTABLE_HISTORY:** `project-management/logs/*.log` from V1.
- **Changing a rule or policy:**
  - Add or adjust the eval in `agent-os/evals/` in the same change.
  - Run `pnpm agent-os:eval && pnpm pm check`.
  - Policy files are ask-gated.
- **No fake activity.** A review is a `pm review` event with the real reviewer and `--independent` only if it ran in a fresh context. Opportunity decisions, ranking and portfolio preferences are owner-only; the CLI refuses agents.
- **Keep it small.** Before adding a role, agent, skill, rule or field, check whether an existing one covers it.
