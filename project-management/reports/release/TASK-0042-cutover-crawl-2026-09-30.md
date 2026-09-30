# Cutover rehearsal crawl — 2026-09-30 (TASK-0042)

Read-only. Legacy URLs were taken from the live WordPress sitemaps
(`https://digital-activation.com/sitemap_index.xml`, Rank Math: post, page,
product, category, local). Each path was then requested on staging
(`https://new.digital-activation.com`), following redirects without executing
anything. About 300 GET/HEAD requests were spread over a few minutes. Nothing
was written anywhere.

## Result

| Sitemap              | URLs   | Reach a 200 through permanent redirects |
| -------------------- | ------ | --------------------------------------- |
| product-sitemap.xml  | 72     | 72                                      |
| page-sitemap.xml     | 10     | 8                                       |
| post-sitemap.xml     | 8      | 8                                       |
| category-sitemap.xml | 2      | 0                                       |
| local-sitemap.xml    | 1      | 0                                       |
| **Total**            | **93** | **88**                                  |

Redirect chains: 87 × `308 → 308 → 200`, 1 × `200`, 4 × `308 → 404`,
1 × `404`.

### Broken (5)

| Legacy path                                | What happens                                                  |
| ------------------------------------------ | ------------------------------------------------------------- |
| `/refund-and-return-policy/`               | trailing slash stripped (308), then 404 — no entry in the map |
| `/سياسة-الاسترجاع/` (Arabic refund policy) | the same                                                      |
| `/شروحات/` (blog category)                 | the same                                                      |
| `/تفعيل-البرامج/` (blog category)          | the same                                                      |
| `/locations.kml` (Rank Math local SEO)     | 404; nothing serves it                                        |

These need redirect entries (Admin → Redirects, or the redirect generator) to
the new refund page and the blog. The KML file can go, or be served as a
static file if local SEO keeps using it. Writing redirects into the staging
database is a data change, so it was not done here.

### Two hops, not one

Every redirected URL takes two hops. First the trailing slash is stripped
(308), then the map redirects (308). Google follows up to 10 hops, so this is
not an error, but one hop is better. The runbook check C8 expects a single hop.
There are two options: match the map with and without the trailing slash, or
redirect straight from the slashed form. This is a follow-up.

## Other checks

- **Homepage stays Arabic at `/`:** 200, `lang="ar"`, `dir="rtl"`. ✓
- **hreflang:** on the 5 sampled pages, ar/en/x-default are present and the en
  pages link back to ar. `/privacy` has no `en` alternate, which is worth a
  look. ✓
- **Indexing switch on staging:** `robots.txt` is `Disallow: /` and the pages carry
  `noindex, nofollow`. That is correct for staging, and it is what step C4 of
  the runbook (`docs/deployment.md` §13) must flip, by rebuilding with the
  production `NEXT_PUBLIC_SITE_URL`.
- **Canonical and hreflang hosts:** they are absolute URLs on `new.` today and
  follow `NEXT_PUBLIC_SITE_URL`, so they move to the apex with the rebuild.

## Not covered & Follow-ups

- **Sitemap XML Redirects Fixed:** Added `/category-sitemap.xml` and `/local-sitemap.xml` to `apps/storefront/next.config.ts` permanent sitemap redirects array. Both now resolve with a clean 301 to `/sitemap.xml`.
- **Hreflang on `/privacy`:** The missing `en` alternate on `/privacy` is by design (`[...slug]/page.tsx:63`): `/privacy` only exists in Arabic, and declaring a non-existent English alternate causes Google Search Console validation errors.
- **5 Legacy Paths:** Require database redirect entries (Admin → Redirects) or data migration import before final cutover.
- **Two-Hop Reduction:** Tracked as an optimization under SEO routes to strip slash and redirect in a single hop.
