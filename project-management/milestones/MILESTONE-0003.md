---
id: MILESTONE-0003
title: Cutover readiness
status: PLANNED
target: 2026-10-30
owner: pm-06
created_at: 2026-09-29
updated_at: 2026-09-29
---

# MILESTONE-0003 — Cutover readiness

## Objective

Everything the cutover runbook needs: payments decided, legacy data migrated and scrubbed, backups proven, the platform observable.

## Acceptance criteria

- CONSENSUS-0001 and CONSENSUS-0002 resolved
- A restore drill has been performed and recorded
- Error reporting and delivery-latency alerting live
- Orders, customers and legacy keys imported on staging; crawl shows zero broken links
- An E2E test proves card order → key delivered < 60 s

## Tasks

Derived from `related_milestone` in each task file; see the dashboard.
