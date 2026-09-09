/**
 * Shared UI primitives for the storefront and the admin.
 *
 * The tokens are the contract; components land here as Release 1 progresses.
 * Import the stylesheet once per app: `@import "@da/ui/tokens.css";`
 */

export const BRAND = {
  nameAr: 'متجر التفعيل الرقمي',
  nameEn: 'Digital Activation',
  taglineAr: 'بيع أكواد التفعيل الرقمية لجميع البرامج وأنظمة التشغيل',
  taglineEn: 'Genuine activation keys for software and operating systems',
} as const;

/** Direction per locale, used for the `dir` attribute and logical CSS. */
export const DIRECTION = { ar: 'rtl', en: 'ltr' } as const;

/**
 * Performance budget, enforced by Lighthouse CI and a bundle-size gate.
 * The legacy product page shipped 104 stylesheets, 93 scripts and 226 requests,
 * and finished loading in 17.4 seconds. These numbers are the reason the CI
 * fails a pull request rather than filing a ticket.
 */
export const PERFORMANCE_BUDGET = {
  lcpMs: 1800,
  inpMs: 200,
  cls: 0.05,
  ttfbMs: 200,
  htmlBytes: 60 * 1024,
  cssFiles: 1,
  jsFiles: 6,
  requests: 35,
  thirdPartyScriptsBeforeInteraction: 0,
} as const;
