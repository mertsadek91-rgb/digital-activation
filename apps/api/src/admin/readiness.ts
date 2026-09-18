import {
  countBodyWords,
  type Readiness,
  type ReadinessCheck,
  READINESS_RULES,
} from '@da/contracts';
import { Locale } from '@da/db';

import { panelLocale } from '../common/panel-locale.js';

/**
 * The publish gate.
 *
 * 43 of the 101 legacy products were published with no SEO title and no meta
 * description, and every one of the sixteen category pages shipped without a
 * description too — across 178 days not one of them earned a single search
 * impression. This is the check that makes that impossible rather than merely
 * discouraged.
 *
 * Blockers are the failures that cost the old store its visibility. The hero
 * image is a warning: a page without one converts worse, but it indexes and
 * ranks fine, and making it a blocker today would freeze the entire catalog
 * behind a media migration that has not happened yet. A gate that blocks
 * everything gets switched off, and then it guards nothing.
 *
 * The reasons are written in the *reader's* language, which is not the locale
 * being assessed. Those were the same thing while the panel was Arabic-only,
 * and conflating them broke as soon as it was not: auditing the English copy
 * would answer in English to an Arabic-speaking editor, and auditing the
 * Arabic copy would answer in Arabic to an English-speaking one. A refusal
 * nobody can read is a refusal nobody fixes, whichever way round it falls.
 */

interface ProductForReadiness {
  translations: {
    locale: Locale;
    name: string;
    body: unknown;
    seoTitle: string | null;
    seoDescription: string | null;
  }[];
  variants: { sku: string; priceUsd: { toNumber: () => number } }[];
  media: unknown[];
  primaryCategoryId: string | null;
}

/**
 * Flattens a block document to the text a reader would see.
 *
 * The counting itself is `countBodyWords` from the contracts, shared with the
 * editor's live counter — a panel that says 118 while the gate has counted 121
 * is a panel nobody believes twice.
 */
export function bodyText(body: unknown): string {
  if (!Array.isArray(body)) return '';

  let text = '';
  for (const block of body) {
    if (block === null || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    if (typeof record.html === 'string') text += ` ${record.html.replace(/<[^>]+>/g, ' ')}`;
    if (typeof record.text === 'string') text += ` ${record.text}`;
    if (Array.isArray(record.items)) {
      for (const item of record.items) {
        if (item !== null && typeof item === 'object') {
          const entry = item as Record<string, unknown>;
          if (typeof entry.q === 'string') text += ` ${entry.q}`;
          if (typeof entry.a === 'string') text += ` ${entry.a}`;
        }
      }
    }
  }

  return text;
}

type Reason =
  | 'seoTitleMissing'
  | 'seoTitleShort'
  | 'seoDescriptionMissing'
  | 'seoDescriptionShort'
  | 'bodyShort'
  | 'noPrimaryCategory'
  | 'noVariant'
  | 'zeroPrice'
  | 'noImage'
  | 'noEnglishName';

/**
 * One writer per reason, taking the numbers it needs. Kept as functions rather
 * than templates so the Arabic can put the count where Arabic puts it.
 */
const REASONS: Record<Reason, Record<'ar' | 'en', (n?: number) => string>> = {
  seoTitleMissing: {
    ar: () => 'لا يوجد عنوان SEO — وهو العنوان الذي يظهر في نتائج البحث.',
    en: () => 'No SEO title. This is the headline in search results.',
  },
  seoTitleShort: {
    ar: (n) =>
      `عنوان SEO مكوّن من ${String(n)} حرفاً، والحد الأدنى ${String(READINESS_RULES.seoTitleMinLength)}.`,
    en: (n) =>
      `SEO title is ${String(n)} characters; ${String(READINESS_RULES.seoTitleMinLength)} is the minimum.`,
  },
  seoDescriptionMissing: {
    ar: () =>
      'لا يوجد وصف ميتا. جميع صفحات التصنيفات في الموقع القديم صدرت بدون وصف ولم تحقّق أيّ ظهور.',
    en: () =>
      'No meta description. Every legacy category page shipped without one and none of them ever ranked.',
  },
  seoDescriptionShort: {
    ar: (n) =>
      `وصف الميتا مكوّن من ${String(n)} حرفاً، والحد الأدنى ${String(READINESS_RULES.seoDescriptionMinLength)}.`,
    en: (n) =>
      `Meta description is ${String(n)} characters; ${String(READINESS_RULES.seoDescriptionMinLength)} is the minimum.`,
  },
  bodyShort: {
    ar: (n) =>
      `الوصف مكوّن من ${String(n)} كلمة، والحد الأدنى ${String(READINESS_RULES.bodyMinWords)}.`,
    en: (n) =>
      `Description is ${String(n)} words; ${String(READINESS_RULES.bodyMinWords)} is the minimum.`,
  },
  noPrimaryCategory: {
    ar: () => 'لا يوجد تصنيف رئيسي، فلا مسار تنقّل للمنتج ولا صفحة أمّ في الرابط الأساسي.',
    en: () => 'No primary category, so the product has no breadcrumb and no canonical parent.',
  },
  noVariant: {
    ar: () => 'لا يوجد متغيّر، فلا شيء يمكن شراؤه.',
    en: () => 'No variant, so there is nothing to buy.',
  },
  zeroPrice: {
    ar: () => 'أحد المتغيّرات سعره صفر.',
    en: () => 'A variant is priced at zero.',
  },
  noImage: {
    ar: () => 'لا توجد صورة. الصفحة ستُفهرس، لكن معدّل التحويل سيكون ضعيفاً.',
    en: () => 'No image. The page will index, but it will convert badly.',
  },
  noEnglishName: {
    ar: () => 'لا يوجد اسم إنجليزي، فصفحة /en ستستخدم الرابط بدلاً منه.',
    en: () => 'No English name, so the /en page falls back to the slug.',
  },
};

export function assessProduct(product: ProductForReadiness, locale: Locale): Readiness {
  // `locale` says which translation is being judged; `panelLocale()` says who
  // is reading the verdict. Only the second one picks the wording.
  const lang = panelLocale();
  const say = (reason: Reason, n?: number): string => REASONS[reason][lang](n);

  const translation = product.translations.find((entry) => entry.locale === locale);
  const checks: ReadinessCheck[] = [];

  const title = translation?.seoTitle?.trim() ?? '';
  const titlePassed = title.length >= READINESS_RULES.seoTitleMinLength;
  checks.push({
    key: 'seoTitle',
    severity: 'blocker',
    passed: titlePassed,
    detail: titlePassed
      ? null
      : title.length === 0
        ? say('seoTitleMissing')
        : say('seoTitleShort', title.length),
  });

  const description = translation?.seoDescription?.trim() ?? '';
  const descriptionPassed = description.length >= READINESS_RULES.seoDescriptionMinLength;
  checks.push({
    key: 'seoDescription',
    severity: 'blocker',
    passed: descriptionPassed,
    detail: descriptionPassed
      ? null
      : description.length === 0
        ? say('seoDescriptionMissing')
        : say('seoDescriptionShort', description.length),
  });

  const words = countBodyWords(bodyText(translation?.body));
  const bodyPassed = words >= READINESS_RULES.bodyMinWords;
  checks.push({
    key: 'body',
    severity: 'blocker',
    passed: bodyPassed,
    detail: bodyPassed ? null : say('bodyShort', words),
  });

  checks.push({
    key: 'primaryCategory',
    severity: 'blocker',
    passed: product.primaryCategoryId !== null,
    detail: product.primaryCategoryId !== null ? null : say('noPrimaryCategory'),
  });

  const hasVariant = product.variants.length > 0;
  checks.push({
    key: 'sku',
    severity: 'blocker',
    passed: hasVariant,
    detail: hasVariant ? null : say('noVariant'),
  });

  const pricePassed =
    hasVariant && product.variants.every((variant) => variant.priceUsd.toNumber() > 0);
  checks.push({
    key: 'price',
    severity: 'blocker',
    passed: pricePassed,
    detail: pricePassed ? null : say('zeroPrice'),
  });

  // Warnings from here down.
  checks.push({
    key: 'heroImage',
    severity: 'warning',
    passed: product.media.length > 0,
    detail: product.media.length > 0 ? null : say('noImage'),
  });

  const english = product.translations.find((entry) => entry.locale === Locale.EN);
  const englishNamed = Boolean(english?.name.trim());
  checks.push({
    key: 'englishName',
    severity: 'warning',
    passed: englishNamed,
    detail: englishNamed ? null : say('noEnglishName'),
  });

  return {
    // The translation that was judged, not the language it was judged in.
    // These were one value until the reasons started following the reader, and
    // reporting `lang` here would tell the panel it had assessed the English
    // copy because the staff member happens to read English.
    locale: locale === Locale.EN ? 'en' : 'ar',
    publishable: checks.every((check) => check.severity !== 'blocker' || check.passed),
    checks,
  };
}
