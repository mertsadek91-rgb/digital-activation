# Tajawal

Three files go here, and nothing else:

    tajawal-400.woff2
    tajawal-500.woff2
    tajawal-700.woff2

`globals.css` declares those three exact paths. Until they exist every page
load asks for them, gets a 404, and falls back to the system stack —
`system-ui, -apple-system, 'Segoe UI', sans-serif`, which renders Arabic
acceptably on all three major platforms but is not the typeface the design was
drawn in.

## Where to get them

Tajawal is under the SIL Open Font License, so the files may be self-hosted.
Take the Arabic + Latin subset rather than the full family: the legacy site
made three requests to `fonts.googleapis.com` before it could paint any text,
and the whole point of self-hosting is that this one does not.

`font-display: swap` is already set on all three faces, so text paints in the
fallback immediately and reflows once when the real font lands. That is the
right trade for a store — a price nobody can read for 200ms is worse than a
price that shifts.
