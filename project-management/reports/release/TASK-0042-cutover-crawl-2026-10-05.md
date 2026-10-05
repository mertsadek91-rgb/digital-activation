# Cutover rehearsal crawl — 2026-10-05, after deploy (TASK-0042)

The post-deploy re-crawl that `TASK-0042-cutover-crawl-2026-10-01.md` left as
its first open item, and that REV-0094 asked for before the task can close.
The two changes from 2026-10-01 — the five static redirects in
`apps/storefront/next.config.ts` and the `/collections/…` fallback in
`apps/storefront/src/lib/gone.ts` — are on staging now (`main` at `1a0a189`,
built by Coolify; the owner confirmed the deploy on 2026-10-05).

Read-only, as before. Every request was a GET with the user-agent
`DA-cutover-rehearsal/1.0`, at 2 per second or fewer: 174 paths, about 560
requests including the redirect hops, plus 12 for the hreflang sample. The
crawler is a scratch script and is not in the repository; its method is the
one described in the 2026-10-01 report, and the inventory it rebuilt is the
same 174 unique paths, from the same public sources on the live legacy site
(the Rank Math sitemaps, the WP REST API for pages, posts, products,
`product_cat`, post categories and tags, the generator's `FIXED` table and
the `/product-category/<slug>/` form of every category).

## Result

**125 of 174 unique paths pass** — a path passes when every hop is 301 or 308
and the last answer is 200. That is the number the 2026-10-01 report
predicted for after the deploy, to the path.

| Source                                         | URLs | Pass 2026-10-01 | Pass now |
| ---------------------------------------------- | ---- | --------------- | -------- |
| sitemap: product-sitemap.xml                   | 72   | 72              | 72       |
| sitemap: page-sitemap.xml                      | 10   | 8               | **10**   |
| sitemap: post-sitemap.xml                      | 8    | 8               | 8        |
| sitemap: category-sitemap.xml                  | 2    | 0               | **2**    |
| sitemap: local-sitemap.xml                     | 1    | 0               | **1**    |
| REST: products                                 | 71   | 71              | 71       |
| REST: pages                                    | 14   | 12              | **14**   |
| REST: posts                                    | 7    | 7               | 7        |
| Generator `FIXED` table                        | 6    | 6               | 6        |
| Map form `/product-category/<slug>/`           | 16   | 15              | 15       |
| REST: product_cat, live `/collections/…`       | 16   | 1               | **15**   |
| REST: post categories                          | 2    | 0               | **2**    |
| REST: tags (out of scope, `noindex` on legacy) | 47   | 0               | 0        |
| **Unique paths**                               | 174  | 106             | **125**  |

- **Every sitemap URL resolves.** All 92 unique paths across the five Rank
  Math sitemaps — what Search Console was given — pass. On 2026-10-01 it was 87.
- **The map scope** (pages, posts, products, the `FIXED` table and the
  generator's category form): 108 unique paths, 107 pass. The one failure is
  `microsoft-sql-server`, below.
- **The 49 that still fail** are the 47 tag archives, which were `noindex` on
  the legacy site and were never in scope, and both forms of
  `microsoft-sql-server`.

### Chains

| Chain             | Count | Notes                                                                        |
| ----------------- | ----- | ---------------------------------------------------------------------------- |
| `200`             | 1     | `/`                                                                          |
| `301 → 200`       | 1     | `/locations.kml → /contact` (static rule, no trailing slash to strip)        |
| `308 → 200`       | 3     | `/cart/`, `/checkout/`, `/collections/coreldraw/` (the new path is the same) |
| `308 → 308 → 200` | 116   | The trailing slash is stripped, then the map (or the fallback) redirects     |
| `308 → 301 → 200` | 4     | The slash is stripped, then one of the four static rules fires               |
| `308 → 404`       | 49    | The failures below                                                           |

Nothing exceeds two permanent hops, which is what runbook check C8
(`docs/deployment.md` §13) accepts.

### What the 2026-10-01 changes did, as crawled

| Legacy path                                                                      | 2026-10-01          | Now                                               |
| -------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------- |
| `/refund-and-return-policy/`                                                     | `308 → 404`         | `308 → 301 /en/refunds → 200`                     |
| `/سياسة-الاسترجاع/`                                                              | `308 → 404`         | `308 → 301 /refunds → 200`                        |
| `/شروحات/`, `/تفعيل-البرامج/`                                                    | `308 → 404`         | `308 → 301 /blog → 200`                           |
| `/locations.kml`                                                                 | `404`               | `301 /contact → 200`                              |
| 14 live category archives, e.g. `/collections/ويندوز-windows/windows-11-ويندوز/` | `308 (slash) → 404` | `308 (slash) → 308 /collections/<new slug> → 200` |

All 14 nested `/collections/<parent>/<slug>/` archives now land on the new
collection the generator mapped their term slug to, through the `gone.ts`
fallback, in two hops.

### The one map-scope failure: `microsoft-sql-server`

| Legacy path                                                                     | Chain               |
| ------------------------------------------------------------------------------- | ------------------- |
| `/product-category/microsoft-sql-server/`                                       | `308 (slash) → 404` |
| `/collections/ويندوز-windows/windows-server-ويندوز-سيرفر/microsoft-sql-server/` | `308 (slash) → 404` |

Unchanged from 2026-10-01: the generator wrote no row for it ("no match in
the new catalog"), the legacy archive has 0 products, and it is in no Rank
Math sitemap (the product-category sitemap is not published; `product_cat`
URLs reach this inventory through the REST API only). It still needs the
owner's or the SEO specialist's call: a 301 to its parent,
`/collections/windows-server`, or leave the 404 for an empty archive. The
redirect, if chosen, is one row in the redirect map, which this task may not
write without an approved data change.

## The other acceptance criteria

### hreflang reciprocal on sampled pages

Twelve pages, six pairs, fetched the same way. Every page declares `ar`,
`en` and `x-default`, each pair declares the same three, and the canonical
of each page is itself:

| Pair                                | Alternates on both pages                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `/` and `/en`                       | `ar=/` `en=/en` `x-default=/`                                                          |
| `/store/windows-11-pro` and `/en/…` | `ar=/store/windows-11-pro` `en=/en/store/windows-11-pro` `x-default=ar`                |
| `/collections/windows` and `/en/…`  | `ar=/collections/windows` `en=/en/collections/windows` `x-default=ar`                  |
| `/golden-warranty` and `/en/…`      | `ar=/golden-warranty` `en=/en/golden-warranty` `x-default=ar`                          |
| `/blog` and `/en/blog`              | `ar=/blog` `en=/en/blog` `x-default=ar`                                                |
| `/privacy` and `/en/privacy`        | `ar=/privacy` `x-default=/privacy` only, and `/en/privacy` canonicalises to `/privacy` |

The `privacy` pair is the content gap the 2026-10-01 report described: no
English row exists, the API falls back to Arabic, and the page declares no
`en` alternate and points its canonical at the Arabic original. That is the
correct declaration for a fallback, and the English text is the owner's
(legal copy). `terms` behaves the same way.

### The homepage stays Arabic at `/`

`/` answers 200 with `<html lang="ar" dir="rtl">`; `/en` answers 200 with
`lang="en" dir="ltr"`. No redirect on either.

### `SEO_BLOCK_INDEXING` and `NEXT_PUBLIC_SITE_URL` for the cutover

What can be verified before the cutover is the mechanism, and it was:

- Every sampled page on staging carries `<meta name="robots"
content="noindex, nofollow, nocache">`, and its canonical and alternates
  are built on `https://new.digital-activation.com`. Both are derived from
  `NEXT_PUBLIC_SITE_URL` (`robotsMeta()` in `apps/storefront/src/lib/seo.ts`:
  noindex on anything that is not the production apex), so staging cannot
  be indexed while it holds the `new.` host, and the apex build will index
  without a second switch.
- At cutover, `NEXT_PUBLIC_SITE_URL` must be `https://digital-activation.com`
  on the storefront, and the indexing block must be off. The runbook
  (`docs/deployment.md` §13) carries the check; the values themselves are
  the release manager's to set and this crawl's method (fetch `/` and read the
  robots meta and the canonical host) is the one to confirm them with, on the
  apex, before the DNS change is announced.

### The legacy sitemap files themselves, on staging

Raised in the SEO review of this report (REV-0130): `/sitemap.xml` answers
404 on staging **by design** — `apps/storefront/src/lib/sitemap.ts` returns
`notFound()` when the host is not indexable, so a crawler cannot be handed a
sitemap for a site that is `noindex`. The seven legacy sitemap paths that
`next.config.ts` 301s to `/sitemap.xml` (`/sitemap_index.xml`,
`/product-sitemap.xml`, `/page-sitemap.xml`, `/post-sitemap.xml`,
`/product_cat-sitemap.xml`, `/category-sitemap.xml`, `/local-sitemap.xml`)
therefore end in a 404 on staging, and can only be proven to end in a 200 on
the apex. They are not in the 174-path inventory above, which holds the URLs
_listed in_ the sitemaps, not the files. Runbook check C7 should say so
explicitly: on the apex, after the DNS change, fetch `/sitemap_index.xml` and
confirm `301 → /sitemap.xml → 200`.

## What remains

1. **`microsoft-sql-server`**: the SEO manager's recommendation (REV-0130) is
   a 301 of both forms to the parent, `/collections/windows-server`, as a
   one-row data change under its own approved task; the task can close with
   the 404 in place. Everything else in the map scope resolves.
2. **Regenerating the map**: unchanged advice from 2026-10-01. If
   `redirects.ts` is run again it will now write the two refund rows; the
   static pair in `next.config.ts` shadows them and should be deleted
   afterwards. The generator should also learn the live
   `/collections/<parents>/<slug>/` form, after which the `gone.ts` fallback
   can go.
3. **English privacy and terms text**: the owner's content.
4. **Reviews**: this task is L4. REV-0094 (pm-05, CONCERN) asked for this
   re-crawl before COMPLETED; the independent re-review and the pm-06 review
   are recorded against this report.
