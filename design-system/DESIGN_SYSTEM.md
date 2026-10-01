# Digital Activation — Design System

The source of truth is **`packages/ui/src/tokens.css`**. This document describes
it; if the two disagree, the CSS wins and this file is wrong. Every value below
is quoted from the code. Supersedes `design-system/digital-activation/MASTER.md`
(BUG-0009, TASK-0061).

Both apps load the tokens the same way (`apps/storefront/src/app/globals.css`,
`apps/admin/src/app/globals.css`):

```css
@import 'tailwindcss';
@import '@da/ui/tokens.css';
```

The tokens sit in a Tailwind `@theme` block, so each one is both a CSS custom
property and a Tailwind utility. **Use the token, not the hex.** Changing a
token is an L3 change routed to design-system-architect, art-director and
accessibility (`.claude/rules/frontend.md`).

The brand is carried over from the live store on purpose: "teal #148576 for the
header and buy buttons, amber #faa21b for offers, a 15px spacing grid, Tajawal
throughout" (`tokens.css` header comment).

## Colour

### Brand — teal

| Token                 | Value     | Role                                                          |
| --------------------- | --------- | ------------------------------------------------------------- |
| `--color-brand`       | `#148576` | Primary: header, buy buttons, `.btn-primary`, the focus ring  |
| `--color-brand-hover` | `#0f6a5e` | Hover state of brand fills                                    |
| `--color-brand-soft`  | `#e1f0ed` | Tinted brand background; `::selection` background             |
| `--color-brand-ink`   | `#0a544b` | Brand-coloured text; `.btn-ghost` label; `::selection` colour |

### Accent — amber, offers only

`tokens.css`: "Offers, discounts and urgency only. Not a general-purpose accent."

| Token                  | Value     |
| ---------------------- | --------- |
| `--color-accent`       | `#faa21b` |
| `--color-accent-hover` | `#e08f0d` |
| `--color-accent-soft`  | `#fdf1dc` |

Do not use amber for navigation, generic CTAs or decoration. Text on an amber
fill is dark: `.btn-accent` uses `color: #3a2400` (`apps/storefront/src/app/home.css`,
a hardcoded value — see "Known debt").

### Semantic

| Token                  | Value     | Note                                                                                           |
| ---------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `--color-danger`       | `#d93a12` |                                                                                                |
| `--color-danger-soft`  | `#fdeae4` |                                                                                                |
| `--color-warning`      | `#b8860b` | No `-soft` pair exists                                                                         |
| `--color-success`      | `#127658` | Replaced `#147d5f`, which was 4.32:1 on `--color-success-soft`; this clears 4.5:1 on that tint |
| `--color-success-soft` | `#e0f0ea` | Background of the added-to-cart note and the support chip                                      |

### Delivery and tier accents

`tokens.css`: "Gold & Instant delivery specific accents".

| Token                  | Value     |
| ---------------------- | --------- |
| `--color-gold`         | `#b37400` |
| `--color-gold-soft`    | `#fff9e6` |
| `--color-gold-border`  | `#f2dc99` |
| `--color-gold-ink`     | `#8a5300` |
| `--color-instant`      | `#0b7a5a` |
| `--color-instant-soft` | `#e3f5ee` |

`--color-gold-ink` is gold as text (the footer's warranty link, the gold
guarantee badge icon); `--color-gold` stays a border and icon colour.

### Footer guarantee badges

Added for the footer's delivery and support badges (TASK-0086). The base value
is the card's start stripe and hover border only; `-ink` is the icon/text
colour on `-soft`.

| Token                 | Value     |
| --------------------- | --------- |
| `--color-info`        | `#0284c7` |
| `--color-info-soft`   | `#e0f2fe` |
| `--color-info-ink`    | `#0369a1` |
| `--color-purple`      | `#7c3aed` |
| `--color-purple-soft` | `#ede9fe` |
| `--color-purple-ink`  | `#6d28d9` |

### Surfaces

| Token                   | Value     | Use                                                     |
| ----------------------- | --------- | ------------------------------------------------------- |
| `--color-bg`            | `#ffffff` | Storefront `body` background                            |
| `--color-surface`       | `#f6f6f6` | Admin `body` background; scrollbar track; ghost hover   |
| `--color-surface-2`     | `#eeefef` | Second-level surface                                    |
| `--color-border`        | `#e2e5e4` | Default border                                          |
| `--color-border-strong` | `#cbd2d0` | Emphasised border; `.btn-ghost` border; scrollbar thumb |

### Text

| Token                 | Value     | Use                                                                                       |
| --------------------- | --------- | ----------------------------------------------------------------------------------------- |
| `--color-ink`         | `#1c2422` | Headings `h1`–`h4`                                                                        |
| `--color-ink-body`    | `#4a4a4a` | Body text in both apps. Was `#777777` (4.48:1, fails AA); `#4a4a4a` is 8.86:1 on white    |
| `--color-ink-muted`   | `#606967` | Secondary text. Replaced `#6b7472` (4.17–4.45:1 on tinted surfaces); clears every surface |
| `--color-ink-inverse` | `#ffffff` | Text on brand fills (`.btn-primary`)                                                      |

Contrast is a hard floor: small text must reach 4.5:1 on the surface it sits on.
The muted and success values were both darkened for that reason; do not lighten
them.

### Contrast ratios

Computed with the WCAG 2 relative-luminance formula from the hex values in
`tokens.css`. AA needs 4.5:1 for normal text and 3:1 for large text (24 px, or
18.66 px bold) and for non-text UI such as borders and icons.

| Foreground              | Background               | Ratio   | Normal text    |
| ----------------------- | ------------------------ | ------- | -------------- |
| `ink` `#1c2422`         | `bg` `#ffffff`           | 15.85:1 | Pass           |
| `ink-body` `#4a4a4a`    | `bg` `#ffffff`           | 8.86:1  | Pass           |
| `ink-body` `#4a4a4a`    | `surface-2` `#eeefef`    | 7.69:1  | Pass           |
| `ink-muted` `#606967`   | `bg` `#ffffff`           | 5.65:1  | Pass           |
| `ink-muted` `#606967`   | `surface-2` `#eeefef`    | 4.91:1  | Pass           |
| `ink-muted` `#606967`   | `brand-soft` `#e1f0ed`   | 4.82:1  | Pass           |
| `brand-ink` `#0a544b`   | `brand-soft` `#e1f0ed`   | 7.51:1  | Pass           |
| `ink-inverse` `#ffffff` | `brand` `#148576`        | 4.52:1  | Pass (barely)  |
| `brand` `#148576`       | `bg` `#ffffff`           | 4.52:1  | Pass (barely)  |
| `#3a2400`               | `accent` `#faa21b`       | 7.16:1  | Pass           |
| `success` `#127658`     | `success-soft` `#e0f0ea` | 4.74:1  | Pass           |
| `instant` `#0b7a5a`     | `instant-soft` `#e3f5ee` | 4.70:1  | Pass           |
| `danger` `#d93a12`      | `bg` `#ffffff`           | 4.60:1  | Pass           |
| `gold-ink` `#8a5300`    | `bg` `#ffffff`           | 6.33:1  | Pass           |
| `gold-ink` `#8a5300`    | `gold-soft` `#fff9e6`    | 6.01:1  | Pass           |
| `gold-ink` `#8a5300`    | `surface` `#f6f6f6`      | 5.86:1  | Pass           |
| `info-ink` `#0369a1`    | `info-soft` `#e0f2fe`    | 5.17:1  | Pass           |
| `purple-ink` `#6d28d9`  | `purple-soft` `#ede9fe`  | 5.98:1  | Pass           |
| `brand-ink` `#0a544b`   | `surface` `#f6f6f6`      | 8.16:1  | Pass           |
| `ink-inverse` `#ffffff` | `success` `#127658`      | 5.59:1  | Pass           |
| `brand` `#148576`       | `surface` `#f6f6f6`      | 4.18:1  | **Fail**       |
| `danger` `#d93a12`      | `danger-soft` `#fdeae4`  | 3.96:1  | **Fail**       |
| `gold` `#b37400`        | `bg` `#ffffff`           | 3.88:1  | **Fail**       |
| `brand` `#148576`       | `brand-soft` `#e1f0ed`   | 3.85:1  | **Fail**       |
| `gold` `#b37400`        | `gold-soft` `#fff9e6`    | 3.68:1  | **Fail**       |
| `warning` `#b8860b`     | `bg` `#ffffff`           | 3.25:1  | **Fail**       |
| `warning` `#b8860b`     | `accent-soft` `#fdf1dc`  | 2.91:1  | **Fail**       |
| `accent` `#faa21b`      | `bg` `#ffffff`           | 2.05:1  | **Fail** (all) |

Rules that follow from the table:

- **Amber is never text.** `--color-accent` is a fill only; its text colour is
  `#3a2400`. `--color-warning` is also below 4.5:1 on every surface, so it is a
  border, stripe or icon colour, not a text colour.
- **Teal text sits on white only.** On `--color-surface` or `--color-brand-soft`
  use `--color-brand-ink`.
- **Danger and gold text** on their own `-soft` tints fail; use them for large
  text, icons and borders, or darken the token (an L3 token change).
- The `tokens.css` header comment gives `#4a4a4a` as "8.6:1"; the computed value
  is 8.86:1.

## Typography

| Token         | Value                                                         |
| ------------- | ------------------------------------------------------------- |
| `--font-sans` | `'Tajawal', system-ui, -apple-system, 'Segoe UI', sans-serif` |
| `--font-mono` | `'IBM Plex Mono', ui-monospace, monospace`                    |

Tajawal is loaded by `next/font` in both apps
(`apps/storefront/src/app/[locale]/layout.tsx`, `apps/admin/src/app/layout.tsx`):
`subsets: ['arabic', 'latin']`, `weight: ['400', '500', '700', '800']`,
`display: 'swap'`, `variable: '--font-tajawal'`. Because `next/font` registers
the face under a generated name, each app's `globals.css` overrides the token,
unlayered:

```css
:root {
  --font-sans:
    var(--font-tajawal), system-ui, -apple-system, 'Segoe UI', sans-serif;
}
```

No request goes to `fonts.googleapis.com`. Only the four weights above are
loaded (400, 500, 700, 800). Use only those in new CSS.

The CSS does not yet follow that rule: `font-weight: 600` or `900` appears in 36
declarations. Tajawal has no 600 face and none is loaded for 900, so the browser
maps each to the nearest loaded face by the CSS font-matching rules (600 to 700,
900 to 800) rather than synthesising a weight. The comment at
`apps/storefront/src/app/[locale]/layout.tsx:30` records this. The result is
that 600 renders as 700: the design intent of a semibold is lost. See "Known
debt".

### Scale

| Token         | Value       |
| ------------- | ----------- |
| `--text-xs`   | `0.8125rem` |
| `--text-sm`   | `0.875rem`  |
| `--text-base` | `1rem`      |
| `--text-lg`   | `1.125rem`  |
| `--text-xl`   | `1.375rem`  |
| `--text-2xl`  | `1.5rem`    |
| `--text-3xl`  | `1.875rem`  |
| `--text-4xl`  | `2.25rem`   |

| Token              | Value  | Use                |
| ------------------ | ------ | ------------------ |
| `--leading-tight`  | `1.25` | Headings `h1`–`h4` |
| `--leading-normal` | `1.6`  | Storefront `body`  |

Headings also get `text-wrap: balance` (storefront `globals.css`).

## Spacing — the 15 px grid

| Token            | Value   |
| ---------------- | ------- |
| `--spacing-unit` | `15px`  |
| `--spacing-half` | `7.5px` |
| `--spacing-1`    | `15px`  |
| `--spacing-2`    | `30px`  |
| `--spacing-3`    | `45px`  |
| `--spacing-4`    | `60px`  |
| `--spacing-5`    | `90px`  |

Note the steps: 1–4 are multiples of 15, and `--spacing-5` jumps to 90 px
(6 units), not 75.

## Touch targets — 44 px

`tokens.css` sets a floor in `@layer base`: "Touch targets stay at 44px
regardless of visual size."

```css
:where(button, a[role='button'], [type='submit']) {
  min-block-size: 44px;
}
```

`:where()` keeps specificity at zero, so a component may raise the size but
should never go below it. `.btn` raises it to `min-block-size: 48px`. The
storefront also sets `touch-action: manipulation` and `cursor: pointer` on
`button, a, [role='button'], summary`.

## Radii and elevation

| Token           | Value   |
| --------------- | ------- |
| `--radius-sm`   | `6px`   |
| `--radius-md`   | `10px`  |
| `--radius-lg`   | `16px`  |
| `--radius-xl`   | `22px`  |
| `--radius-pill` | `999px` |

| Token                 | Value                                                                  |
| --------------------- | ---------------------------------------------------------------------- |
| `--shadow-xs`         | `0 1px 2px 0 rgb(0 0 0 / 0.04)`                                        |
| `--shadow-sm`         | `0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.08)`      |
| `--shadow-md`         | `0 4px 12px -2px rgb(0 0 0 / 0.08), 0 2px 6px -2px rgb(0 0 0 / 0.04)`  |
| `--shadow-lg`         | `0 12px 32px -12px rgb(0 0 0 / 0.18)`                                  |
| `--shadow-card`       | `0 2px 8px -2px rgb(0 0 0 / 0.05), 0 1px 3px rgb(0 0 0 / 0.03)`        |
| `--shadow-card-hover` | `0 12px 28px -6px rgb(0 0 0 / 0.1), 0 4px 10px -2px rgb(0 0 0 / 0.05)` |
| `--shadow-drawer`     | `0 20px 40px -10px rgb(0 0 0 / 0.28)`                                  |

## Layout and motion

| Token                 | Value                           | Use                                                      |
| --------------------- | ------------------------------- | -------------------------------------------------------- |
| `--container-max`     | `1400px`                        | Page container                                           |
| `--header-height`     | `72px`                          | Header                                                   |
| `--utility-height`    | `34px`                          | Contact bar above the header, scrolls away while it pins |
| `--sticky-buy-height` | `64px`                          | Mobile sticky buy bar                                    |
| `--ease-out`          | `cubic-bezier(0.16, 1, 0.3, 1)` | Default easing (`.btn` uses `180ms var(--ease-out)`)     |

Reduced motion is honoured twice: `tokens.css` collapses animation and
transition durations to `0.01ms` under `prefers-reduced-motion: reduce`, and
the storefront also disables smooth scroll. Scroll reveals (`.reveal`) run only
under `@supports (animation-timeline: view())` and
`prefers-reduced-motion: no-preference`; everywhere else the content is simply
visible.

## RTL

Arabic is the default and is right-to-left.

- **Direction per locale** comes from `DIRECTION = { ar: 'rtl', en: 'ltr' }` in
  `packages/ui/src/index.ts`. The storefront sets
  `<html lang={locale} dir={DIRECTION[locale]}>`; the admin uses its own
  `ADMIN_LOCALE_DIR`.
- **Logical properties only.** `tokens.css`: "All layout properties are logical
  (inline-start / inline-end), so one stylesheet serves the Arabic RTL
  storefront and the English LTR one." Use `padding-inline`, `inset-block-end`,
  `inline-size`, `border-inline-start`, not `left` / `right` / `width`.
- **Deliberate physical exceptions** are commented where they occur: the
  WhatsApp button (`.whatsapp-fab`, `catalog.css`) is "Pinned to the physical
  right in both languages", and the social-proof toast (`.social-proof-live`,
  `marketing-signals.css`) takes `left: 18px` at `min-width: 900px`. A new
  physical property needs the same kind of justification in a comment.
- **Prices are isolated LTR runs.** Storefront `globals.css` sets
  `unicode-bidi: isolate; direction: ltr` on `.price strong`, `.price s`,
  `.card-price strong`, `.card-price s`, `.variant-price`, `.buy-total strong`,
  `.buy-bar-price`, `.cart-line-total`, `.order-line-total` and `.totals dd`, so
  `$19.99` does not become `19.99$` in Arabic. A new price element must be added
  to that list.
- **Inputs** for phone, VAT and numbers keep `dir="ltr"`.
- **Verify** at 1440 / 1024 / 768 / 390 / 360 in both ar and en.

## Component conventions

Verified in `apps/storefront/src/app/home.css` and `cart.css`.

| Class          | Definition                                                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.btn`         | `inline-flex`, `min-block-size: 48px`, `padding-inline: var(--spacing-2)`, `border-radius: var(--radius-md)`, `font-weight: 700`, `box-shadow: var(--shadow-sm)`; hover lifts `translateY(-2px)` to `--shadow-md` |
| `.btn-primary` | `--color-brand` fill, `--color-ink-inverse` text; hover `--color-brand-hover`                                                                                                                                     |
| `.btn-accent`  | `--color-accent` fill, `#3a2400` text; hover `--color-accent-hover`. Offers only                                                                                                                                  |
| `.btn-ghost`   | `--color-bg` fill, `--color-brand-ink` text, `1px solid var(--color-border-strong)`; hover border `--color-brand`, fill `--color-surface`                                                                         |
| `.btn-buy`     | `flex: 1 1 14rem` (cart)                                                                                                                                                                                          |
| `.btn-wide`    | `inline-size: 100%` (cart)                                                                                                                                                                                        |

Global conventions (storefront `globals.css`):

- Focus: `:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }`.
  Never remove it.
- Selection: `--color-brand-soft` background, `--color-brand-ink` text.
- Caret: `--color-brand`. Scrollbar: `8px`, thumb `--color-border-strong` with
  `--radius-pill`, track `--color-surface`, thumb hover `--color-brand`.

Shared React components do not exist yet: `packages/ui/src/index.ts` exports
`BRAND` and `DIRECTION` only ("components land here as Release 1 progresses").

### Performance budget

The budget's only home is `apps/storefront/lighthouserc.json` (BUG-0010); there
is no copy in code. Lighthouse CI runs the desktop preset against `/` and `/en`,
three runs each, and errors on:

| Assertion                            | Limit                  |
| ------------------------------------ | ---------------------- |
| `categories:performance`             | min score `0.95`       |
| `categories:accessibility`           | min score `0.95`       |
| `categories:seo`                     | min score `1`          |
| `largest-contentful-paint`           | `1800` ms              |
| `cumulative-layout-shift`            | `0.05`                 |
| `total-blocking-time`                | `200` ms               |
| `server-response-time`               | `200` ms               |
| `resource-summary:script:count`      | `20`                   |
| `resource-summary:stylesheet:count`  | `2`                    |
| `resource-summary:total:count`       | `60`                   |
| `resource-summary:third-party:count` | `0`                    |
| `resource-summary:document:size`     | `61440` bytes (60 KiB) |

`font-display`, `render-blocking-resources`, `unused-css-rules`, `image-alt`,
`modern-image-formats` and `uses-responsive-images` are also errors;
`unused-javascript` is a warning. Design choices that add a font, stylesheet or
third-party request have to fit inside it. If this document and the JSON
disagree, the JSON wins.

## Known debt — hardcoded colours

Hex literals that bypass the tokens, counted with
`grep -oE '#[0-9a-fA-F]{3,8}\b'` in `apps/storefront/src/app/`:

| File                                                               | Hex literals |
| ------------------------------------------------------------------ | ------------ |
| `footer.css`                                                       | 15           |
| `catalog.css`                                                      | 21           |
| `contact.css`                                                      | 16           |
| `account.css`                                                      | 7            |
| `warranty.css`                                                     | 7            |
| `home.css`                                                         | 4            |
| `cart.css`                                                         | 2            |
| `globals.css`, `growth.css`, `marketing-signals.css`, `offers.css` | 0            |

Some are legitimate third-party brand colours (WhatsApp `#25d366` on
`.whatsapp-fab`, and the `.social-btn` WhatsApp, Telegram, X and Instagram
hovers in `footer.css`). `footer.css` was tokenised in TASK-0086: its 15
remaining matches are those 13 brand values plus two in a comment. The rest of
the table still maps to tokens. Known residue: the WhatsApp hover puts a white
icon on `#25d366` (1.98:1, under the 3:1 non-text floor), and
`.newsletter-error-msg` (`--color-danger`) is 3.92:1 where the newsletter card
fades to `--color-brand-soft`.

## Known debt — font weights

`font-weight: 600` or `900` (neither is loaded; see "Typography"), counted with
`grep -oE 'font-weight:\s*(600|900)'` over the CSS in `apps/`:

| File                                         | `600` | `900` |
| -------------------------------------------- | ----- | ----- |
| `apps/admin/src/app/admin.css`               | 16    | 0     |
| `apps/admin/src/app/marketing/retention.css` | 2     | 0     |
| `apps/storefront/src/app/catalog.css`        | 5     | 0     |
| `apps/storefront/src/app/home.css`           | 2     | 1     |
| `apps/storefront/src/app/contact.css`        | 2     | 0     |
| `apps/storefront/src/app/account.css`        | 1     | 0     |
| `apps/storefront/src/app/warranty.css`       | 1     | 0     |

Each should become 500, 700 or 800 deliberately.

## Known debt — contrast and admin CSS

- `apps/admin/src/app/admin.css:400` sets `.warn { color: var(--color-warning) }`:
  3.25:1 on white, which fails AA for its `--text-xs` size.
- `admin.css` repeats token values as `var()` fallbacks, which hide a renamed
  or missing token: `var(--color-accent-soft, #fdf1dc)` at lines 1469, 2054 and
  2092, and `var(--color-brand, #148576)` at line 5501.
- `admin.css` references tokens that `tokens.css` does not define:
  `--color-brand-strong` (line 2335, which falls back to the off-palette
  `#10b981`) and `--color-warning-soft` (line 4113, no fallback).
