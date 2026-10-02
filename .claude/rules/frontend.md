---
paths:
  - "apps/storefront/**"
  - "apps/admin/**"
  - "packages/ui/**"
---

# Frontend (Next.js 16 — read `node_modules/next/dist/docs/` before using an unfamiliar API)

- **Storefront structure:**
  - Middleware is `src/proxy.ts`, the Next 16 name.
  - Every page renders per request so the CSP nonce works; the root layout calls `connection()`.
  - `connect-src` allows only the API and Stripe.
  - The Lighthouse budget requires zero third-party requests, so adding any external script is an L4 change (CSP + performance + privacy).
- **Relative imports** in the storefront are extensionless (Bundler resolution). Workspace packages keep `.js`.
- **Design tokens** live in `packages/ui/src/tokens.css` and follow the UI Kit (`docs/ui-kit-review.md`, TASK-0100): teal `#087F70`, mint `#E9F5F1`; the kit's warning hue `#B54708` is the only "offer" accent (the amber is gone); Tajawal for Arabic, Inter for English and for prices/codes (`--font-latin`); 8 px spacing grid; 8/12/999 radii; 48 px controls, 44 px touch targets; 1200 px content width.
  - Use tokens, not hex.
  - `design-system/…/MASTER.md` is a stale template (BUG-0009). Ignore it.
  - Token changes are L3 and route to design-system-architect, art-director and accessibility.
- **Admin:**
  - Uses its own translator, not next-intl.
  - Has no server-side session gate yet (TASK-0063); the API enforces access.
  - Loads Tajawal through `next/font` (`--font-tajawal`; BUG-0011 fixed).
- **Verification is rendering, not reading.**
  - Check 1440 / 1024 / 768 / 390 / 360 in **ar (RTL) and en**, loading, empty and error states.
  - Keep `dir="ltr"` on phone, VAT and number inputs.
  - The `visual-qa` subagent does this.
- **Anti-generic design:** avoid card walls, pill clusters, decorative gradients, meaningless stats and inconsistent icon families. Aim for deliberate hierarchy and density.
