# QA checklist

The gate a task passes before it leaves QA. Tick what applies; write “n/a” with
a reason for what does not. Record the result in the task's **QA results**.

## Every task

- [ ] Acceptance criteria met, each one checked, not assumed
- [ ] `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test` pass
- [ ] Integration suite passes if the API or schema changed
- [ ] The task's REGRESSION_MATRIX rows retested
- [ ] No secret, key, token or order-note content in code, logs, tests, fixtures or the task file
- [ ] Files changed match `affected_files`; anything extra is explained
- [ ] `pnpm pm:sync` run; `pnpm pm:check` clean

## User-facing (storefront or admin)

- [ ] Arabic and English both checked — English passing does not imply Arabic
- [ ] Widths 1440, 1280, 1024, 768, 430, 390, 360 — no overflow, no clipped text
- [ ] Loading, empty and error states
- [ ] Keyboard only: reachable, visible focus, logical order in RTL
- [ ] Contrast AA; touch targets ≥ 44 px
- [ ] Mixed-direction inputs (phone, VAT, numbers) still `dir="ltr"`
- [ ] Light and dark if the page supports both

## Public pages

- [ ] Canonical and hreflang correct in both locales
- [ ] One `Product` entity at most in JSON-LD
- [ ] Sitemap includes or excludes the page as intended
- [ ] Lighthouse budget holds

## Security-relevant (auth, vault, checkout, webhooks, CSP, env)

- [ ] Security Engineer review recorded in the task
- [ ] Negative tests: wrong role, expired session, replay, bad signature
- [ ] Nothing logs plaintext keys or tokens (check the redaction list)
