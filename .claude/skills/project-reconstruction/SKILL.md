---
name: project-reconstruction
description: Rebuild working context in a fresh session without reading the whole history — canonical state first, then only the active work, decisions and code that matter to the task. Use at the start of a session, after context compaction, or when picking up someone else's task.
---

# Project reconstruction

Read in this order. Stop as soon as you have enough to act.

1. **Root `CLAUDE.md`.** It is already loaded.
2. **`node agent-os/tools/pm.mjs attention`:** what the owner is waiting on.
   **`node agent-os/tools/pm.mjs check`:** whether state is consistent. If not, fix that first.
3. **`project-management/PROJECT_STATUS.md`:** the curated narrative, including phase and
   decisions pending.
4. **The task you were given:**
   - `pm show <TASK>` gives fields, reviews, evidence and full event history.
   - The body is in `project-management/tasks/<status>/<TASK>.md`: objective, plan, work
     log, handoff notes.
5. **Decisions it cites** (`project-management/decisions/DEC-*`). Check each is still
   ACTIVE.
6. **`pm route --paths <files>`:** who else is needed. The `.claude/rules/*` for those paths
   load automatically when you open the files.
7. **The code itself.** Verify before you assert. Earlier sessions misread the deployment
   state (see CR-0002).

## Handoff when you stop

Add a "Handoff" section to the task body with:
- what was attempted
- what changed (files)
- what remains
- blockers
- tests run and their results
- decisions made
- the next recommended action

Then record where the task stands with `pm transition` or `pm note`.
