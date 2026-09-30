---
name: independent-review
description: How to get a real independent review of L3+ work — dispatch the routed fresh-context reviewer subagents with the right brief, and let them record their own review events. Use when a task reaches review; required before any L3+ task can be COMPLETED.
---

# Independent review

The implementer is never the only evaluator. The CLI refuses COMPLETED at L3 or above
unless a passing `--independent` review exists from someone other than the primary agent.

1. `node agent-os/tools/pm.mjs route --paths <changed files> --level <task level>` lists
   the reviewers and their executors. Examples:
   - `qa-lead` → `subagent:independent-reviewer`
   - `security-engineer` → `subagent:security-reviewer`
   - `responsive-design-specialist` → `subagent:visual-qa`
2. Dispatch each reviewer with the Agent tool, using the executor's subagent type. Give
   **only** the following, and never your own verdict:
   - task id, objective and acceptance criteria
   - constraints (the relevant `.claude/rules/*`)
   - the changed files (`git diff --stat` and the paths)
   - how to run and verify: test commands, a launch.json entry, a disposable database
3. Reviewers record their own result with `pm review … --independent --executor subagent:<name>`.
4. Handling the result:
   - FAIL or OBJECTION: the implementer fixes the finding, then asks for a new review round.
   - More than `max_review_rounds` (governor): `pm check` flags escalation. Escalate along
     the decision class instead of looping.
   - BLOCKING_OBJECTION or VETO: only roles with that right can record one. It stays open
     until the same reviewer records a later non-blocking result, or the owner accepts the
     risk.
5. Only now: `pm transition <TASK> COMPLETED --progress 100 --stage COMPLETED --by <primary> --reason "…"`.

Never write a review on someone else's behalf. Never mark a review independent unless it
ran in a fresh context.
