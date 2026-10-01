---
name: opportunity-shaping
description: Product Evolution (PM-07) procedure — turn a signal into an evidence-backed Opportunity Development Pack for the owner, with engineering, design and art direction shaping before approval. Use when discovering or proposing any product, UX, design, growth, SEO, reliability or technology improvement.
---

# Opportunity shaping

Full model: `agent-os/PRODUCT_EVOLUTION_OPERATING_MODEL.md`. Self-improving never means
self-authorizing.

1. **Signal first.** Record what you observed with `pm create SIG`: source, reference, date
   and evidence quality. A weak or early signal stays a signal. Give it status WATCH and a
   `reevaluate_when` trigger. Do not open an opportunity for every observation.
2. **Deduplicate.** `pm similar "<title>"`. Relate every candidate:
   - DUPLICATE: stop, and link the signal to the existing item
   - OVERLAPPING, RELATED, DEPENDENT or DISTINCT
   The CLI refuses creation until each candidate has a relation. Search tasks, CRs, epics,
   and rejected or deferred opportunities too.
3. **Create** with `pm create OPP --json '{…}' --relation …`. Name the accountable role in
   `proposed_by` (never "the AI"), set `user_facing` and `visual_impact` honestly, and start
   at DETECTED, TRIAGED or DISCOVERY.
4. **Route the shaping team.** `pm route --type opportunity_shaping [--user-facing] [--visual]`.
5. **Evidence, for and against.** `pm evidence` for each claim: type, stance, quality
   (FACT / OBSERVATION / INFERENCE / ASSUMPTION / HYPOTHESIS), source and date. Look for
   evidence *against* on purpose. Rules:
   - Competitor-only evidence caps strength at WEAK.
   - STRONG needs two factual supporting items.
   - Never invent a metric. If there is no baseline, measurement setup is a prerequisite.
6. **Engineering before approval.** Dispatch `embedded-product-engineer`. It reads the repo
   and records ENGINEERING_SHAPING. User-facing work: `product-designer` records UX. Visual
   work: `art-director` records ART_DIRECTION.
7. **Write the pack** in `project-management/opportunities/OPP-XXXX.md`. Every template
   section counts: Evidence Against, Alternatives (including do nothing and improve
   existing), Why Now, Why Not Now, Cost of Doing Nothing, Technical Feasibility, Risks,
   Success Criteria, Validation Plan, Recommendation.
8. **Score** with categorical values (`pm set`): user_value, business_value, technical_effort,
   risk, evidence_strength, recommendation. Weak evidence can only recommend RESEARCH,
   VALIDATE_WITH_USERS, EXPERIMENT, PROTOTYPE, WATCH or DO_NOT_BUILD.
9. **Walk the lifecycle** with `pm transition` through the shaping stages to
   READY_FOR_OWNER_DECISION. The gate refuses an incomplete pack.
10. **Stop.** The owner decides in the dashboard: approve, research more, defer, reject,
    watch or merge. Approval creates the CR. Delivery then follows normal governance.
    You may suggest a priority review; you never reorder the owner's ranking.
