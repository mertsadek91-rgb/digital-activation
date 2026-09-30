# Product Evolution, Growth, Intelligence & Innovation — operating model

**Manager:** PM-07. The organisation studies the product, the codebase, users,
data, the market, competitors and technology. It turns what it finds into
shaped proposals, and **the owner decides**. Self-improving never means
self-authorizing. Procedure: skill `opportunity-shaping`.

## The squad

Existing roles are reused rather than duplicated.

| Role                                             | Id                                         | Runs as                                          |
| ------------------------------------------------ | ------------------------------------------ | ------------------------------------------------ |
| Product Opportunity & Innovation Lead            | `product-opportunity-lead`                 | main                                             |
| Embedded Product Engineer / Technical Lead       | `embedded-product-engineer`                | `subagent:embedded-product-engineer` (read-only) |
| Senior Product / UX Designer                     | existing `product-ui-designer`             | `subagent:product-designer`                      |
| Product & Growth Analyst                         | `product-growth-analyst`                   | `subagent:research-analyst`                      |
| Competitive Intelligence Analyst                 | existing `competitor-intelligence-analyst` | `subagent:research-analyst` (no shell)           |
| Growth & Marketing Strategist                    | `growth-marketing-strategist`              | main                                             |
| Art Director, whenever visual expression changes | existing `art-director`                    | `subagent:art-director`                          |

- **Other specialists** (PM-01 … PM-06, SEO, security, accessibility, RTL, data
  and so on) join through `pm route`. They do not join by default.
- **Authority:** every Product Evolution role is capped at L1. Discovery is not
  delivery.
- **Quality comes from each role's `quality_contract`** in `PERMISSIONS.json`,
  not from claimed years of experience.

## Entities

| Entity                     | What it is                                                                                                                                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SIG` signal               | An observation, with type (PRODUCT, CUSTOMER, MARKET, COMPETITOR, TECHNOLOGY, BUSINESS), source, reference, date and evidence quality. **The watchlist is signals with status WATCH plus a `reevaluate_when` trigger.** Weak signals stay here instead of flooding the inbox. |
| `INS` insight              | An interpretation across signals.                                                                                                                                                                                                                                             |
| `OPP` opportunity          | A shaped proposal (schema: `agent-os/schemas/opportunity.schema.json`). **Not a task and not implementation authority.** The narrative, the _Opportunity Development Pack_, lives in `project-management/opportunities/OPP-XXXX.md`.                                          |
| evidence                   | `pm evidence`: type, claim, **stance (SUPPORTS/OPPOSES)**, quality (FACT/OBSERVATION/INFERENCE/ASSUMPTION/HYPOTHESIS), source, date.                                                                                                                                          |
| review                     | `pm review`: ENGINEERING_SHAPING, UX, ART_DIRECTION and the others.                                                                                                                                                                                                           |
| owner decision             | `opportunity_decided`. Owner-only.                                                                                                                                                                                                                                            |
| ranking                    | `ranking_set`. Owner-only.                                                                                                                                                                                                                                                    |
| portfolio preferences      | Owner-only.                                                                                                                                                                                                                                                                   |
| priority review suggestion | `priority_review_suggested`. Any role; it never reorders.                                                                                                                                                                                                                     |

## Lifecycle

```
DETECTED → TRIAGED → DISCOVERY → PRODUCT_SHAPING → [DESIGN_SHAPING] → TECHNICAL_SHAPING
        → EVIDENCE_REVIEW → CROSS_FUNCTIONAL_REVIEW → READY_FOR_OWNER_DECISION
                                                          │ owner only
          APPROVE / APPROVE_AND_PRIORITIZE → APPROVED ──→ CR-XXXX (source_opportunity) → normal delivery governance
          RESEARCH_MORE → DISCOVERY (with questions)   DEFER → DEFERRED (revisit_when)
          REJECT → REJECTED (reason; kept as knowledge) WATCH → WATCH       MERGE → MERGED (merged_into)
```

The CLI refuses any agent transition out of READY_FOR_OWNER_DECISION, other
than a return to DISCOVERY.

## The readiness gate

An opportunity reaches READY_FOR_OWNER_DECISION only if all of these hold:

- An **ENGINEERING_SHAPING** review from embedded-product-engineer. Engineering
  shapes the proposal before approval, not after.
- A **UX** review, if `user_facing`.
- An **ART_DIRECTION** review, if `visual_impact`.
- At least one supporting evidence item, and `evidence_strength` set.
- Evidence strength is justified:
  - **STRONG** needs two or more factual supporting items.
  - **Competitor-only evidence** caps strength at WEAK.
  - **WEAK or INSUFFICIENT** evidence may only recommend RESEARCH,
    VALIDATE_WITH_USERS, EXPERIMENT, PROTOTYPE, WATCH or DO_NOT_BUILD.
- `recommendation`, `technical_effort`, `user_value` and `risk` are set, as
  categorical values (NONE…VERY_HIGH). There is no composite score.
- The pack has non-empty sections for Problem, **Evidence Against**,
  Alternatives, Why Now, **Why Not Now**, Cost of Doing Nothing, Technical
  Feasibility, Risks, Success Criteria, Validation Plan and Recommendation. The
  template in the opportunity file has the rest.

## Duplicate prevention

`pm create OPP|SIG` compares the new item with every opportunity (including
rejected and deferred ones), signal, task, CR and epic. It **refuses** the
creation until each similar item has an explicit relation: DUPLICATE,
OVERLAPPING, RELATED, DEPENDENT or DISTINCT. A DUPLICATE relation is refused
outright; link the signal or MERGE instead.

`pm check` keeps flagging unrelated look-alikes.

The heuristic is word overlap. It catches near-identical wording, such as the
admin-font case (0.80). It misses paraphrases, such as SIG-0005 vs TASK-0050;
search with `pm similar` before creating anything.

## Approval → delivery

**Approval:** the dashboard's owner APPROVE creates a CR that inherits the
opportunity's title and risk, sets `source_opportunity`, and is linked back from
the opportunity.

**Delivery:** a task may carry `related_opportunity` only if both hold (the CLI
refuses otherwise):

- the opportunity is APPROVED
- the task's `related_change_request` is that CR

After approval, engineering and design may still challenge the plan. Record a
finding, raise a decision review, or escalate. Approval does not override
reality.

## Triggers

Discovery does **not** run in the background. Nothing in this repository
schedules it. It happens:

- on request
- at milestone completion
- after a release
- on a routine the owner sets up with the `schedule` skill, if they choose to

The dashboard never claims monitoring that does not exist.

## Absolute rules

Product Evolution must **never**:

- approve its own opportunities
- reorder the ranking
- implement anything unapproved
- fabricate demand, metrics or sources
- present opinion as user evidence
- hide evidence against a proposal
- copy competitors
- create duplicates to look productive

**Recommending DO_NOT_BUILD, SIMPLIFY or WATCH is a success, not a failure.**

## Current pipeline (2026-09-29)

| Item                                                | Status                                       |
| --------------------------------------------------- | -------------------------------------------- |
| OPP-0001: one source of truth for official channels | READY_FOR_OWNER_DECISION                     |
| OPP-0002: rebuild verified social proof             | DISCOVERY; WEAK evidence, RESEARCH           |
| SIG-0004: AI-assistant referrals                    | watchlist; re-evaluate when TASK-0050 exists |
| SIG-0005: no analytics                              | linked to TASK-0050                          |

**OPP-0001 detail:**

- Shaped by engineering (REV-0001), UX (REV-0002) and primary-source research.
- Blocked on the owner confirming the real social handles.
