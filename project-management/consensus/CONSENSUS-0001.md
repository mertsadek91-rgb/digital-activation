---
# GENERATED from agent-os/state/events.jsonl — change it with `pnpm pm`, not by hand. The body below is yours.
id: CONSENSUS-0001
created_at: 2026-09-29
updated_at: 2026-09-30
subject: Release 1 payment line-up and the go-live gate
status: OPEN
participants:
  [
    exec-director,
    pm-01,
    pm-03,
    pm-04,
    pm-06,
    security-engineer,
    integration-engineer,
    cro-specialist,
  ]
related_decision: DEC-0002
related_tasks: [TASK-0020, TASK-0021]
approved_at:
---

# CONSENSUS-0001 — Release 1 payment line-up and the go-live gate

**Status: open. No consensus has been reached and none is claimed here.** The board cannot close this without facts only the owner has.

## Trigger

DEC-0002 says Stripe + PayPal. The code today: Stripe implemented but optional (3cf6c0a), PayPal returns 503, bank transfer implemented, no provider interface. The plan’s top risk — Stripe refusing the Turkish entity — is still unresolved.

## Inputs needed from the owner

1. Has Stripe approved the Turkish entity (TR34, Istanbul) for live payments? If not, what is the status?
2. Is PayPal Business set up and approved for this entity?
3. Would the owner accept launching with fewer methods than DEC-0002 states, and on what terms?

## Options

|           | A. Stripe + PayPal before cutover           | B. Stripe + manual at cutover, PayPal in R1.1 | C. Bank transfer only at cutover                          | D. Merchant of record (Paddle / Lemon Squeezy)  |
| --------- | ------------------------------------------- | --------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| Business  | Matches DEC-0002                            | Close to it                                   | Reproduces the manual flow blamed for 31.9% cancellations | Removes the entity-acceptance risk; fees higher |
| UX        | Best coverage                               | Card covers most buyers                       | Worst: wait for confirmation                              | Hosted checkout, less control                   |
| Technical | PayPal build + provider interface           | Provider interface now, PayPal later          | Nothing new                                               | New provider; webhook + fulfilment mapping      |
| Security  | Two webhook surfaces                        | One                                           | None new                                                  | Different webhook surface                       |
| Schedule  | Slowest                                     | Medium                                        | Fastest                                                   | Medium                                          |
| Rollback  | WordPress stays as fallback in every option |                                               |                                                           |                                                 |

## Specialist notes

- **pm-04 / integration-engineer:** whichever option, extract a provider interface before adding a second provider; checkout.service.ts currently embeds Stripe.
- **pm-06 / security-engineer:** each provider adds a signed-webhook surface; the Stripe one is idempotent via WebhookEvent. Any new provider must match that bar.
- **cro-specialist:** option C should be treated as a regression of the plan’s central KPI unless the owner decides otherwise.

## Objections

None recorded yet.

## Final consensus

Not reached.
