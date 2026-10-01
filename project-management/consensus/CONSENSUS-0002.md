---
id: CONSENSUS-0002
subject: 'Legacy licence keys: migration into the vault and scrub of the source'
status: DRAFT
participants:
  [
    exec-director,
    pm-01,
    pm-04,
    pm-06,
    database-architect,
    security-engineer,
    release-manager,
  ]
related_decision:
related_tasks: [TASK-0040]
approved_at:
created_at: 2026-09-29
updated_at: 2026-09-29
---

# CONSENSUS-0002 — Legacy licence keys: migration into the vault and scrub of the source

**Status: draft.** Level 5: it handles live customer secrets and ends in an irreversible scrub. It needs the board and the owner.

## Context

Staff delivered keys and Office 365 / Adobe account credentials by pasting them into WooCommerce order notes. They sit in plaintext in the live WordPress database and in the local backup under `Old Website/` (gitignored). The vault exists; there is no script yet that moves these values in, and no scrub procedure.

## Corrected context (CR-0002, 2026-09-29)

The plaintext values exist in exactly two places: the live WordPress database (BUG-0014) and the local SQL dump (BUG-0015). They are not in Git, the new database, any build or any container. The first question is therefore no longer how to move them. It is whether to move them at all, and the owner answers it in TASK-0043. The questions below apply only if the answer is option A.

## Questions the board must answer

1. Extraction: parse on an isolated machine, never printing note content; how is a note classified as “contains a key” without a human reading it?
2. Mapping: which order item does each extracted value belong to, and what happens when it cannot be mapped?
3. Account credentials (username + password) are not licence keys — does the vault model hold them, or do those customers get a reset / re-issue flow?
4. Verification before scrub: what count-and-checksum proves every value landed?
5. Scrub: of the live WordPress DB (irreversible, user-owned), of backups, and in what order relative to DNS cutover.
6. Destruction of the plaintext backups: when, by whom, and how it is recorded.

## Options

To be written by the database-architect and security-engineer under TASK-0040.

## Final consensus

Not reached.
