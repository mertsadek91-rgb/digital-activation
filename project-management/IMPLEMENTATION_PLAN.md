# Implementation plan — from here to cutover and after

The original plan (`docs/plan.html`) scheduled Phase 0 → 1 → 2 → 3. The code is
past most of Phase 1 and much of Phase 2, and is running on staging (Coolify: `new.`, `admin.` and `api.digital-activation.com`). The production cutover has not happened, and the legacy WordPress site still serves the apex (CR-0002). This
plan picks up from where the code actually is. Target dates are proposals for
the owner, not commitments.

| Milestone      | Objective                         | Owner           | Gate to close                                                                                   |
| -------------- | --------------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| MILESTONE-0001 | Governance & discovery            | exec-director   | owner reviews TASK-0001/DEC-0010; CONSENSUS-0001 has its inputs                                 |
| MILESTONE-0002 | Release 1 hardening               | pm-04           | BUG-0001…0005 fixed + regression; security sign-off                                             |
| MILESTONE-0003 | Cutover readiness                 | pm-06           | payments decided; legacy data migrated on staging; restore drill; alerting; E2E delivery < 60 s |
| MILESTONE-0004 | Cutover & 72-hour watch           | release-manager | owner go/no-go; DNS; 72-hour watch; plaintext backups destroyed                                 |
| MILESTONE-0005 | Post-cutover measurement & growth | pm-05           | analytics live; KPI month-1 report; mobile budgets                                              |

## Sequencing and why

1. **TASK-0010 first** (sweep locks): the fulfilment sweep is the safety net
   for paid orders. Nothing else in M2 depends on it, but it is the cheapest
   HIGH to close.
2. **TASK-0011 needs the owner** (is the salt set in production?). Ask now; it
   is on the critical path for M2.
3. **Auth tasks are sequenced**, not parallel: TASK-0013 then TASK-0014 — both
   edit `auth.service.ts` (§71, §83).
4. **Docs on `deployment.md` are sequenced:** TASK-0070 → TASK-0032 (which
   absorbs TASK-0030's backup section).
5. **Payments wait for CONSENSUS-0001.** TASK-0021 does not start until then.
6. **Legacy data is the long pole:** CONSENSUS-0002 → TASK-0040, and TASK-0041
   in parallel → TASK-0042 rehearsal.
7. **Growth work (M5)** does not start before the cutover, to stop the drift the
   plan warned against (scope creep before Release 1 shipped).

## Critical path to cutover

CONSENSUS-0002 → TASK-0040 → TASK-0042 → TASK-0032 runbook → owner go/no-go.
In parallel: CONSENSUS-0001 → TASK-0021; TASK-0030; TASK-0031; TASK-0060.

## Not planned yet (needs an owner decision to enter scope)

Invoice PDFs · Web Push · fraud velocity rules · English legal text (legal
content is the owner's) · BullMQ migration (TASK-0034 decides) · market and
competitor research refresh (the plan's diagnosis is from 2026-09).
