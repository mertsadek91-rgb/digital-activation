---
paths:
  - "packages/seo/**"
  - "packages/i18n/**"
  - "apps/storefront/src/app/**"
  - "apps/storefront/messages/**"
  - "apps/storefront/next.config.ts"
  - "apps/storefront/src/lib/gone.ts"
---

# SEO, locales and RTL

- **Locales:**
  - `/` is the **Arabic** homepage and holds 69.6% of all impressions.
  - English lives under `/en`.
  - hreflang is reciprocal with `x-default = ar` (DEC-0003). Never move `/`.
- **Structured data:** `packages/seo/src/jsonld.ts` is the only JSON-LD producer. `buildGraph` throws on two `Product` entities. Pass it the same `DisplayPrice` the page renders.
- **Indexing:**
  - Indexing derives from `NEXT_PUBLIC_SITE_URL`. Anything other than the apex is noindex plus a robots disallow, which is what keeps staging (`new.`) out of the index.
  - Flipping it is a cutover step (TASK-0044), not a code change.
  - Filtered listings are noindex and canonicalise to the base page. Each page sets its own canonical.
- **Legacy URLs** resolve through the Redirect table (`lib/gone.ts`, 308) and `next.config.ts` (301). Changing a route is decision class `seo_routes`, L4, with technical-seo-specialist and PM-05.
- **Messages:** ar and en must keep key parity; it is checked at compile time. Translations must keep meaning, not just keys; offers and legal text are the owner's.
- **Arabic search:** folding and digit normalisation happen in `packages/i18n`. The catalogue search is in-app, not Meilisearch (DEC-0009).
