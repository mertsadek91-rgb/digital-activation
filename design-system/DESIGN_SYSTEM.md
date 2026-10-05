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
| `--color-accent-ink`   | `#3a2400` |

Do not use amber for navigation, generic CTAs or decoration. Text on an amber
fill is `--color-accent-ink` (added in TASK-0086 for `.card-discount-tag`,
which was a hardcoded `#2e1c00`). `.btn-accent` in `home.css` still writes the
same value as a literal `#3a2400` (see "Known debt"). Amber-family text on
white or on `--color-accent-soft` (`.stock-low`, `.badge-accent`,
`.draft-flag`, the warranty notice) uses `--color-gold-ink`, which keeps the
warm hue.

### Semantic

| Token                  | Value     | Note                                                                                           |
| ---------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `--color-danger`       | `#d93a12` |                                                                                                |
| `--color-danger-soft`  | `#fdeae4` |                                                                                                |
| `--color-danger-ink`   | `#b02e0e` | Danger as small text on a tint (TASK-0094); `--color-danger` stays for white, borders, icons   |
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

| Foreground              | Background                | Ratio   | Normal text                   |
| ----------------------- | ------------------------- | ------- | ----------------------------- |
| `ink` `#1c2422`         | `bg` `#ffffff`            | 15.85:1 | Pass                          |
| `ink-body` `#4a4a4a`    | `bg` `#ffffff`            | 8.86:1  | Pass                          |
| `ink-body` `#4a4a4a`    | `surface-2` `#eeefef`     | 7.69:1  | Pass                          |
| `ink-muted` `#606967`   | `bg` `#ffffff`            | 5.65:1  | Pass                          |
| `ink-muted` `#606967`   | `surface-2` `#eeefef`     | 4.91:1  | Pass                          |
| `ink-muted` `#606967`   | `brand-soft` `#e1f0ed`    | 4.82:1  | Pass                          |
| `brand-ink` `#0a544b`   | `brand-soft` `#e1f0ed`    | 7.51:1  | Pass                          |
| `ink-inverse` `#ffffff` | `brand` `#148576`         | 4.52:1  | Pass (barely)                 |
| `brand` `#148576`       | `bg` `#ffffff`            | 4.52:1  | Pass (barely)                 |
| `accent-ink` `#3a2400`  | `accent` `#faa21b`        | 7.16:1  | Pass                          |
| `gold-ink` `#8a5300`    | `accent-soft` `#fdf1dc`   | 5.66:1  | Pass                          |
| `ink-inverse` `#ffffff` | `gold-ink` `#8a5300`      | 6.33:1  | Pass                          |
| `ink-inverse` `#ffffff` | `danger-ink` `#b02e0e`    | 6.48:1  | Pass                          |
| `danger-ink` `#b02e0e`  | `surface` `#f6f6f6`       | 5.99:1  | Pass                          |
| `info-ink` `#0369a1`    | `bg` `#ffffff`            | 5.93:1  | Pass                          |
| `ink-inverse` `#ffffff` | `info-ink` `#0369a1`      | 5.93:1  | Pass                          |
| `ink-inverse` `#ffffff` | `instant` `#0b7a5a`       | 5.32:1  | Pass                          |
| `#075e54` (WhatsApp)    | `bg` `#ffffff`            | 7.67:1  | Pass                          |
| `#075e54` (WhatsApp)    | `#e7f7ed` (WhatsApp tint) | 6.91:1  | Pass                          |
| `ink-inverse` `#ffffff` | `#075e54` (WhatsApp)      | 7.67:1  | Pass                          |
| `#128c7e` (WhatsApp)    | `#e7f7ed` (WhatsApp tint) | 3.73:1  | Non-text pass                 |
| `#0088cc` (Telegram)    | `#e8f4fb` (Telegram tint) | 3.48:1  | Non-text pass (fails as text) |
| `success` `#127658`     | `success-soft` `#e0f0ea`  | 4.74:1  | Pass                          |
| `instant` `#0b7a5a`     | `instant-soft` `#e3f5ee`  | 4.70:1  | Pass                          |
| `danger` `#d93a12`      | `bg` `#ffffff`            | 4.60:1  | Pass                          |
| `danger-ink` `#b02e0e`  | `bg` `#ffffff`            | 6.48:1  | Pass                          |
| `danger-ink` `#b02e0e`  | `danger-soft` `#fdeae4`   | 5.57:1  | Pass                          |
| `danger-ink` `#b02e0e`  | `brand-soft` `#e1f0ed`    | 5.52:1  | Pass                          |
| `#075e54` (WhatsApp)    | `#25d366` (WhatsApp)      | 3.87:1  | Non-text pass                 |
| `gold-ink` `#8a5300`    | `bg` `#ffffff`            | 6.33:1  | Pass                          |
| `gold-ink` `#8a5300`    | `gold-soft` `#fff9e6`     | 6.01:1  | Pass                          |
| `gold-ink` `#8a5300`    | `surface` `#f6f6f6`       | 5.86:1  | Pass                          |
| `info-ink` `#0369a1`    | `info-soft` `#e0f2fe`     | 5.17:1  | Pass                          |
| `purple-ink` `#6d28d9`  | `purple-soft` `#ede9fe`   | 5.98:1  | Pass                          |
| `brand-ink` `#0a544b`   | `surface` `#f6f6f6`       | 8.16:1  | Pass                          |
| `ink-inverse` `#ffffff` | `success` `#127658`       | 5.59:1  | Pass                          |
| `brand` `#148576`       | `surface` `#f6f6f6`       | 4.18:1  | **Fail**                      |
| `danger` `#d93a12`      | `surface` `#f6f6f6`       | 4.26:1  | **Fail**                      |
| `danger` `#d93a12`      | `danger-soft` `#fdeae4`   | 3.96:1  | **Fail**                      |
| `danger` `#d93a12`      | `brand-soft` `#e1f0ed`    | 3.92:1  | **Fail**                      |
| `ink-inverse` `#ffffff` | `#25d366` (WhatsApp)      | 1.98:1  | **Fail** (all)                |
| `gold` `#b37400`        | `bg` `#ffffff`            | 3.88:1  | **Fail**                      |
| `brand` `#148576`       | `brand-soft` `#e1f0ed`    | 3.85:1  | **Fail**                      |
| `gold` `#b37400`        | `gold-soft` `#fff9e6`     | 3.68:1  | **Fail**                      |
| `warning` `#b8860b`     | `bg` `#ffffff`            | 3.25:1  | **Fail**                      |
| `warning` `#b8860b`     | `accent-soft` `#fdf1dc`   | 2.91:1  | **Fail**                      |
| `accent` `#faa21b`      | `bg` `#ffffff`            | 2.05:1  | **Fail** (all)                |
| `accent` `#faa21b`      | `accent-soft` `#fdf1dc`   | 1.83:1  | **Fail** (all)                |
| `ink-inverse` `#ffffff` | `#0088cc` (Telegram)      | 3.89:1  | **Fail**                      |
| `#128c7e` (WhatsApp)    | `bg` `#ffffff`            | 4.14:1  | **Fail**                      |
| `ink-inverse` `#ffffff` | `brand` at 92% opacity    | 4.07:1  | **Fail**                      |

Rules that follow from the table:

- **Amber is never text.** `--color-accent` is a fill only; its text colour is
  `#3a2400`. `--color-warning` is also below 4.5:1 on every surface, so it is a
  border, stripe or icon colour, not a text colour.
- **Teal text sits on white only.** On `--color-surface` or `--color-brand-soft`
  use `--color-brand-ink`.
- **Danger text on a tint uses `--color-danger-ink`.** `--color-danger` is fine
  on white but fails on `--color-danger-soft` and `--color-brand-soft`; it
  stays the border, stripe and icon colour. Gold text likewise uses
  `--color-gold-ink`.
  TASK-0086 moved every danger text in the storefront stylesheets to
  `--color-danger-ink`. That covers `.error`, which every form uses and which
  was 3.96:1 on `--color-danger-soft` and is now 5.57:1. It also covers four
  texts measured in the browser on their real backgrounds. `.licence-deadline`
  sits on white, or on `--color-surface` for a line still being prepared, where
  `--color-danger` was 4.26:1. `.stock-out` and `.card-buy-error` sit on white.
  `.variant-out` was at 0.55 opacity inside a sold-out variant, which made it
  2.35:1. The fade now skips the note, so it renders at 6.48:1.
- **Gold is a border, stripe, icon or graphic colour.** The gold stars
  (`.stars`, `role="img"`) and the gold icons are 3.88:1 on white, above the
  3:1 that non-text needs. Gold text and gold fills behind white text use
  `--color-gold-ink`.
- **Third-party icons on their own tints clear only the non-text bar.**
  WhatsApp `#128c7e` and Telegram `#0088cc` stay on the contact page's icon
  tiles. A text badge beside them uses WhatsApp's dark teal `#075e54` or
  `--color-info-ink`.
- **Brand-colour fills keep a dark icon when the fill is light.** The footer
  WhatsApp hover is WhatsApp's own dark teal `#075e54` on `#25d366` (3.87:1);
  white on that green is 1.98:1.
- **Colours TASK-0086 changed rather than only tokenised.** Each one now uses
  the nearest token, and all still pass AA (pm-03 review REV-0114):
  - Renewal-row stripes moved from `#a07c1a` to `--color-gold` `#b37400`, and
    from `#b4231d` to `--color-danger` `#d93a12`.
  - The lapsed-row background moved from `#fdf6f5` to `--color-danger-soft`
    `#fdeae4`.
  - Critical warning text is now `--color-danger-ink` at 5.57:1 (was 8.97:1).
  - The warning note is `--color-gold-ink` at 6.01:1 (was 6.84:1).
  - The warranty notice moved from `#7a4a00` to `--color-gold-ink` `#8a5300`.
  - The discount tag moved from `#2e1c00` to `--color-accent-ink` `#3a2400`.
  - The mega-panel shadow went from 22% to 18% alpha, as `--shadow-card-hover`.
  - A sold-out variant's border and background no longer fade with its text.
  - The stars moved from amber to gold.
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

The budget's only home is `apps/storefront/lighthouserc.json` (BUG-0010,
TASK-0051): the numbers are not repeated here, because every copy so far has
drifted from it. The Performance budget job in `.github/workflows/ci.yml`
measures `/`, `/en`, a product, a category and a filled cart, on mobile and
desktop, against a seeded fixture catalogue; what it currently misses is
tracked in TASK-0101. Design choices that add a font, a stylesheet, a script
or any third-party request have to fit inside that budget.

## Known debt — hardcoded colours

Hex literals that bypass the tokens, counted with
`grep -oE '#[0-9a-fA-F]{3,8}\b'` in `apps/storefront/src/app/`:

| File                                                               | Hex literals | In code | In comments |
| ------------------------------------------------------------------ | ------------ | ------- | ----------- |
| `footer.css`                                                       | 15           | 13      | 2           |
| `contact.css`                                                      | 16           | 11      | 5           |
| `catalog.css`                                                      | 7            | 4       | 3           |
| `home.css`                                                         | 4            | 4       | 0           |
| `cart.css`                                                         | 2            | 2       | 0           |
| `account.css`, `warranty.css`                                      | 0            | 0       | 0           |
| `globals.css`, `growth.css`, `marketing-signals.css`, `offers.css` | 0            | 0       | 0           |

TASK-0086 tokenised `footer.css`, `catalog.css` (21 before), `contact.css`,
`account.css` (7 before) and `warranty.css` (7 before). Every literal left in
code in those five files is a documented third-party brand colour:

- WhatsApp `#25d366`, `#075e54`, `#128c7e`, and the contact page's tints of
  them, `#e7f7ed` and `#bcead0`. These appear on `.whatsapp-fab`,
  `.drawer-link-wa`, the contact channel card and the footer `.social-btn`.
- Telegram `#0088cc`, and its tints `#e8f4fb` and `#c2e2f6` on the contact
  page.
- X and Apple black `#000000`.
- The Instagram gradient stops in `footer.css`.

`contact.css` keeps 11 literals in code even after the migration, because each
of them is a brand value. Its count of 16 looks unchanged, but that is
coincidence: 5 of the literals come from the new explanatory comment.

`home.css` (`.btn-accent` `#3a2400`, which is now the value of
`--color-accent-ink`, plus `#7a4a00` and `#ffffff`) and `cart.css` (`#fff`,
`#7a4a00`) have not been migrated. `--color-accent-ink` and `--color-gold-ink`
cover their values.

Other residue in the TASK-0086 files that is not a hex literal:

- The drawer and modal scrims, `rgb(0 0 0 / 0.55)` and `0.45`.
- One drawer shadow, `0 0 32px rgb(0 0 0 / 0.18)`.
- The WhatsApp FAB's green glow.
- `var(--space-3|4|5, …)` in `account.css` and `catalog.css`. These tokens do
  not exist, so the fallback pixel values always apply.

`account.css` referenced an undefined `--shadow-elevated`, so its order-card
hover lost its shadow. It now uses `--shadow-card-hover`.

The metrics, pillars, steps, notice and CTA rules in `warranty.css` have no
markup: no component uses them, and only `.warranty-emblem-badge` renders.
They were tokenised and their ratios fixed on paper only. Two fixes there:
`.warranty-step-num` is now on a `--color-gold-ink` fill, and the CTA paragraph
no longer has `opacity: 0.92`, which put it at 4.07:1.

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
