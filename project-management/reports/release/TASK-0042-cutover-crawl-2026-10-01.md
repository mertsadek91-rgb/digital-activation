# Cutover rehearsal crawl — 2026-10-01 (TASK-0042)

This follows up the 2026-09-30 crawl (`TASK-0042-cutover-crawl-2026-09-30.md`),
which covered only the 93 Rank Math sitemap URLs. This run covers the whole
legacy URL inventory the redirect map is built from, investigates the five
broken URLs and the two-hop chains, and checks `/privacy` for English.

Read-only. Nothing was written to any database or environment. Every request
was a GET, with the user-agent `DA-cutover-rehearsal/1.0`, at 2 per second or
fewer: about 550 requests in total. One side effect of any crawl applies here
too: the staging storefront counts redirect hits and records 404 paths in its
own tables. That bookkeeping is the application's, not this crawl's.

## Method

The redirect map has no public listing. `GET /v1/content/redirects?path=` looks
up one path, and the full list is behind the staff-only `/v1/admin/redirects`.
The WordPress export it was generated from is in `Old Website/`, which agents
may not read. So the inventory was rebuilt from the same objects the generator
reads (`packages/db/scripts/legacy/redirects.ts`), taken from the live legacy
site:

| Source                                                  | What it is                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| Rank Math sitemaps (`/sitemap_index.xml`, 5 children)   | What Search Console was given                                           |
| WP REST `wp/v2/pages`, `posts`, `product`               | Every published page, post and product: the generator's main input      |
| WP REST `wp/v2/product_cat`, live permalink             | The category archive URLs the legacy site actually serves               |
| `product_cat` term slugs as `/product-category/<slug>/` | The form the generator writes into the map                              |
| The generator's `FIXED` table                           | `/المتجر/`, `/my-account/`, `/support/`, offers, blog, `/validate-key/` |
| WP REST `wp/v2/categories`, `tags`                      | Post archives: never in the map's scope, crawled to see what happens    |

Paths were deduplicated on their decoded form, which gave 174 unique paths. Each
one was requested on `https://new.digital-activation.com` with redirects
followed by hand, up to 10 hops, and the full chain was recorded. A path passes
when every hop is 301 or 308 and the last answer is 200.

The crawler is a scratch script and is not in the repository.

## Counts per source

A path that appears in more than one source is counted in each.

| Source                                         | URLs | Pass (before this change) |
| ---------------------------------------------- | ---- | ------------------------- |
| sitemap: product-sitemap.xml                   | 72   | 72                        |
| sitemap: page-sitemap.xml                      | 10   | 8                         |
| sitemap: post-sitemap.xml                      | 8    | 8                         |
| sitemap: category-sitemap.xml                  | 2    | 0                         |
| sitemap: local-sitemap.xml                     | 1    | 0                         |
| REST: products                                 | 71   | 71                        |
| REST: pages                                    | 14   | 12                        |
| REST: posts                                    | 7    | 7                         |
| Generator `FIXED` table                        | 6    | 6                         |
| Map form `/product-category/<slug>/`           | 16   | 15                        |
| **REST: product_cat, live `/collections/…`**   | 16   | **1**                     |
| REST: post categories                          | 2    | 0                         |
| REST: tags (out of scope, `noindex` on legacy) | 47   | 0                         |
| **Unique paths**                               | 174  | 106                       |

- **The sitemaps:** 92 unique paths, 87 pass. That matches the 93/88 from
  2026-09-30, because the homepage appears in two sitemaps and was counted
  twice then.
- **The map scope** (pages, posts, products, the `FIXED` table and the
  generator's category form): 108 unique paths, 105 pass.

### Chains

| Chain             | Count | Notes                                                                        |
| ----------------- | ----- | ---------------------------------------------------------------------------- |
| `200`             | 1     | `/`                                                                          |
| `308 → 200`       | 3     | `/cart/`, `/checkout/`, `/collections/coreldraw/` (the new path is the same) |
| `308 → 308 → 200` | 102   | The trailing slash is stripped, then the map redirects                       |
| `308 → 404`       | 67    | The failures below                                                           |
| `404`             | 1     | `/locations.kml`                                                             |

## Every failure, with its chain

### The five from 2026-09-30, still failing on staging

| Legacy path                  | Chain                                   | Cause                                                                                                                      |
| ---------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/refund-and-return-policy/` | `308 /refund-and-return-policy` → `404` | Not in the map. The generator skipped it because `/refunds` was not published when it ran. It was published on 2026-09-17. |
| `/سياسة-الاسترجاع/`          | `308 /سياسة-الاسترجاع` → `404`          | The same                                                                                                                   |
| `/شروحات/`                   | `308 /شروحات` → `404`                   | A post category. These were never in the generator's scope.                                                                |
| `/تفعيل-البرامج/`            | `308 /تفعيل-البرامج` → `404`            | The same                                                                                                                   |
| `/locations.kml`             | `404`                                   | Rank Math's local-SEO file. Nothing serves it.                                                                             |

### New: 15 legacy category archives (indexed)

On the live site, the WooCommerce category base was renamed from
`product-category` to `collections`, and child categories nest under their
parents. The generator keys every category row as
`/product-category/<term-slug>`, so the URLs Google actually has do not match
the map. The legacy pages are `index, follow` with a self-canonical, so they
are indexed.

| Legacy path (live permalink)                                                      | Chain                 |
| --------------------------------------------------------------------------------- | --------------------- |
| `/collections/ويندوز-windows/`                                                    | `308 (slash)` → `404` |
| `/collections/ويندوز-windows/windows-10-ويندوز/`                                  | `308 (slash)` → `404` |
| `/collections/ويندوز-windows/windows-11-ويندوز/`                                  | `308 (slash)` → `404` |
| `/collections/ويندوز-windows/windows-server-ويندوز-سيرفر/`                        | `308 (slash)` → `404` |
| `/collections/ويندوز-windows/windows-server-ويندوز-سيرفر/windows-server-cal/`     | `308 (slash)` → `404` |
| `/collections/ويندوز-windows/windows-server-ويندوز-سيرفر/windows-server-rds-cal/` | `308 (slash)` → `404` |
| `/collections/ويندوز-windows/windows-server-ويندوز-سيرفر/microsoft-sql-server/`   | `308 (slash)` → `404` |
| `/collections/ويندوز-windows/visual-studio/`                                      | `308 (slash)` → `404` |
| `/collections/أدوات-سيو/`                                                         | `308 (slash)` → `404` |
| `/collections/أدوبي-adobe/`                                                       | `308 (slash)` → `404` |
| `/collections/أوتوديسك-autodesk/`                                                 | `308 (slash)` → `404` |
| `/collections/أوفيس-office/`                                                      | `308 (slash)` → `404` |
| `/collections/اشتراكات/`                                                          | `308 (slash)` → `404` |
| `/collections/الحماية-antivirus/`                                                 | `308 (slash)` → `404` |
| `/collections/سوق-ووردبريس/`                                                      | `308 (slash)` → `404` |

All of their `/product-category/<term-slug>/` forms resolve. For example,
`/product-category/أدوبي-adobe/` goes `308 → 308 /collections/adobe → 200`.
The one exception is `microsoft-sql-server`, below.

### New: one category with no map row

`/product-category/microsoft-sql-server/` gives `308` and then `404`. The
generator logged it as "no match in the new catalog". The legacy archive has 0
products.

### Out of scope: 47 tag archives

Every `/tag/<slug>/` gives `308 (slash)` and then `404`. The legacy tag pages are
`noindex, follow` and are not in any Rank Math sitemap. Several are leftover
theme demo tags (`cameras`, `hi-fi`, `keybords`). A 404 is the right answer for
an unindexed archive, and nothing was changed for them.

## What was fixed, and how

### 1. Five static redirects in `apps/storefront/next.config.ts`

The `legacyGaps` table is mapped into `redirects()` next to the sitemap and feed
rules, as literal 301s. The comment above it explains why they are static: the
database map may not be written by this task, and none of the five came from
the generator.

| Source (built `routes-manifest.json`)                    | Destination   | Why                                                                                      |
| -------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `/refund-and-return-policy`                              | `/en/refunds` | It was the English copy of the policy. It became the `en` row of `refunds` (`pages.ts`). |
| `/%D8%B3%D9%8A%D8%A7%D8%B3%D8%A9-…` (`/سياسة-الاسترجاع`) | `/refunds`    | The Arabic policy                                                                        |
| `/%D8%B4%D8%B1%D9%88%D8%AD%D8%A7%D8%AA` (`/شروحات`)      | `/blog`       | The blog has no category pages. The index is the closest page.                           |
| `/%D8%AA%D9%81%D8%B9%D9%8A%D9%84-…` (`/تفعيل-البرامج`)   | `/blog`       | The same                                                                                 |
| `/locations.kml`                                         | `/contact`    | See below                                                                                |

**`/locations.kml`: redirect to `/contact`, not 410.**

- The file held only the shop's name, address and coordinates, which is what
  `/contact` now carries.
- Crawlers found it only through `/local-sitemap.xml`, which already 301s to
  `/sitemap.xml`.
- A 410 would need a route handler of its own, more code for a URL nothing
  links to, and it would discard whatever the URL had earned.

**Encoding.** Next matches custom redirect sources against the
percent-encoded request path (`resolve-routes.js`), so the Arabic sources go
through `encodeURI`.

**Verification.**

- The built manifest contains all five rules, at indexes 10–14.
- They were tested against the local `next dev` server already running from this worktree (port 3105), which loaded this config, using
  uppercase percent-encoding (what browsers send) and lowercase (what
  WordPress links use). Both match:

| Request                       | Result                                              |
| ----------------------------- | --------------------------------------------------- |
| `/refund-and-return-policy/`  | `308 /refund-and-return-policy` → `301 /en/refunds` |
| `/سياسة-الاسترجاع/`           | `308` → `301 /refunds`                              |
| `/شروحات/`, `/تفعيل-البرامج/` | `308` → `301 /blog`                                 |
| `/locations.kml`              | `301 /contact`                                      |

- On staging, all four destinations (`/en/refunds`, `/refunds`, `/blog`,
  `/contact`) answer 200 today.

### 2. Legacy `/collections/…` category URLs: a fallback lookup in `apps/storefront/src/lib/gone.ts`

When a path has no map row and starts with `/collections/`, `goneOrRedirect`
now looks up `/product-category/<last segment>`.

- **Why the last segment works:** it is the WooCommerce term slug in both
  spellings, so the row the generator already wrote is the right answer.
  Nothing has to be added to the database, and nothing is duplicated.
- **Cost:** the fallback runs only for a path that was about to 404.
- **No shadowing:**
  - The new site's collection slugs are Latin and single-segment, so no live
    collection is affected.
  - Nested legacy paths reach the `[...slug]` catch-all. Top-level ones reach
    `collections/[slug]`. Both call `goneOrRedirect`.
- **Expected after deploy:** 14 of the 15 resolve as `308 (slash) → 308
/collections/<new> → 200`, which is 2 hops. `microsoft-sql-server` still has
  no row.

### Checks run

- `npx tsc --noEmit -p tsconfig.json` (storefront): clean.
- `NEXT_PUBLIC_API_URL=http://localhost:4000 NEXT_PUBLIC_SITE_URL=http://localhost:3000 npx next build --webpack`: succeeds.
- Prettier and ESLint on both changed files: clean.

The storefront has no unit-test suite. The `gone.ts` fallback is verified by
the staging chains of the `/product-category/` forms above. It will be crawled
end to end after deploy.

## The two-hop chains: left at two hops, deliberately

- **Why a static rule cannot do it.** Next prepends its own trailing-slash
  rule, `/:path+/ → /:path+` (308, `internal: true`), ahead of every custom
  redirect. It is index 0 in the built `routes-manifest.json`
  (`load-custom-routes.js`). So a `next.config` source written in the slashed
  form can never match first. The new static rules are 2 hops for slashed
  legacy URLs for the same reason.
- **The only single-hop route.** Set `skipTrailingSlashRedirect: true` (Next 16
  docs, `03-file-conventions/proxy.md` "Advanced Proxy flags"). Then
  re-implement the slash strip in `src/proxy.ts`. For a slashed path, the proxy
  would ask the API for the map row and redirect straight to it, and otherwise
  308 to the unslashed form.
- **Why that was not done:**
  1. **Duplicate content.** The flag is global. Any slashed path the proxy fails
     to handle (an error path, a matcher gap, a future matcher edit) renders a
     200 at `/x/` next to `/x`. That is exactly the duplicate content that is
     not acceptable.
  2. **Load and coupling.** It puts an API round-trip in the proxy for every
     slashed request. Bots asking for slashed junk would be amplified into API
     calls. It also needs a fail-open path for an API outage. `gone.ts`
     already records why the map is not consulted in the proxy.
  3. **Scope.** `src/proxy.ts` is also the CSP writer. Changing it is outside
     this task's files and is its own L4 change (`seo_routes` + CSP).
- **Why two hops is acceptable.** Google follows up to 10 hops and passes
  signals through 308s. Runbook check C8 expects a single hop. It should be
  amended to "≤ 2 permanent hops", or a separate L4 task should be opened for
  the proxy design above.

## `/privacy` in English: a content gap

`GET /v1/content/pages/privacy?locale=en` returns `"locale":"ar"`. The API
falls back to Arabic because no English row exists. On staging, `/privacy`
declares only `ar` and `x-default` alternates, and `/en/privacy` answers 200
with the Arabic body and a "translation missing" notice. That behaviour is
correct (`[...slug]/page.tsx`). What is missing is the English text. It is
legal text and belongs to the owner, so none was written. `terms` has the same
fallback today.

## What remains

1. **Deploy, then re-crawl** with the same inventory. Expected result: 125 of
   174 unique paths pass, and all 92 sitemap paths pass. The 49 that would still
   fail are the 47 tags plus both forms of `microsoft-sql-server`.
2. **`microsoft-sql-server`:** this needs an owner or SEO decision. The options
   are a redirect to `/collections/windows-server` (its parent), or leaving it
   as a 404 (0 products).
3. **Regenerating the map:** if `redirects.ts` is run again, it will now write
   the two refund rows, because `/refunds` is published. The static pair in
   `next.config.ts` shadows them, so delete it afterwards. The generator should
   also learn the live `/collections/<parents>/<slug>/` form, after which the
   `gone.ts` fallback can go.
4. **Two hops:** amend runbook C8, or open the L4 proxy task.
5. **English privacy and terms text:** this is the owner's content.
6. **Reviews:** this task is L4. It still needs the independent review and the
   cross-manager reviews (pm-05, pm-06) before COMPLETED. None has happened.
