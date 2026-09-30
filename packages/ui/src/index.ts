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

/*
 * The performance budget has one home: `apps/storefront/lighthouserc.json`,
 * which Lighthouse CI enforces on every pull request (BUG-0010). A copy here
 * drifted from it once — nothing read it, so nothing noticed. Change the
 * numbers there, not here.
 */
