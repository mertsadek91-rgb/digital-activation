import { Locale } from '@da/db';
import { describe, expect, it } from 'vitest';

import { runWithPanelLocale } from '../common/panel-locale.js';

import { assessProduct } from './readiness.js';

/**
 * Guards the publish gate.
 *
 * 43 of the 101 legacy products were published with no SEO title and no meta
 * description, and across 178 days not one of those pages earned a single search
 * impression. A gate that lets one of those through is worse than no gate: the
 * product goes live, looks published, and is invisible. A gate that blocks on
 * something cosmetic is just as bad — it gets switched off, and then it guards
 * nothing. So both directions are pinned here.
 */
type ProductForReadiness = Parameters<typeof assessProduct>[0];

const BODY_WORDS = Array.from({ length: 140 }, (_, i) => `كلمة${String(i)}`).join(' ');

function aProduct(overrides: Partial<ProductForReadiness> = {}): ProductForReadiness {
  return {
    translations: [
      {
        locale: Locale.AR,
        name: 'ويندوز 11 برو',
        body: [{ html: `<p>${BODY_WORDS}</p>` }],
        seoTitle: 'ويندوز 11 برو مفتاح تفعيل أصلي مدى الحياة',
        seoDescription:
          'اشترِ مفتاح تفعيل ويندوز 11 برو أصلي بضمان مدى الحياة وتسليم فوري عبر البريد الإلكتروني خلال دقيقة واحدة من إتمام الدفع.',
      },
      {
        locale: Locale.EN,
        name: 'Windows 11 Pro',
        body: [{ html: `<p>${BODY_WORDS}</p>` }],
        seoTitle: 'Windows 11 Pro Retail Activation Key — Lifetime',
        seoDescription:
          'Buy a genuine Windows 11 Pro retail activation key with a lifetime guarantee and instant delivery by email within one minute of payment.',
      },
    ],
    variants: [{ sku: 'win-11-pro-life-1pc', priceUsd: { toNumber: () => 24.9 } }],
    media: [{ url: 'https://cdn.example.com/win11.jpg' }],
    primaryCategoryId: 'cat_windows',
    ...overrides,
  };
}

function withTranslation(
  changes: Partial<ProductForReadiness['translations'][number]>,
  locale: Locale = Locale.AR,
): ProductForReadiness {
  const base = aProduct();
  return {
    ...base,
    translations: base.translations.map((entry) =>
      entry.locale === locale ? { ...entry, ...changes } : entry,
    ),
  };
}

function failed(product: ProductForReadiness, locale: Locale = Locale.AR): string[] {
  return assessProduct(product, locale)
    .checks.filter((check) => !check.passed)
    .map((check) => check.key);
}

describe('assessProduct', () => {
  it('publishes a product that has everything the legacy catalogue lacked', () => {
    const readiness = assessProduct(aProduct(), Locale.AR);

    expect(readiness.publishable).toBe(true);
    expect(failed(aProduct())).toEqual([]);
  });

  it('says nothing at all about a check that passed', () => {
    // Every check used to carry its complaint whether or not it applied, so a
    // fully ready product shipped eight sentences describing what was wrong
    // with it. Anything rendering `detail` without also reading `passed` — a
    // future export, a second panel — would have read those as failures.
    const readiness = assessProduct(aProduct(), Locale.AR);

    expect(readiness.checks.every((check) => check.passed)).toBe(true);
    expect(readiness.checks.map((check) => check.detail)).toEqual(readiness.checks.map(() => null));
  });

  it('blocks a product with no SEO title', () => {
    const readiness = assessProduct(withTranslation({ seoTitle: null }), Locale.AR);

    expect(readiness.publishable).toBe(false);
    expect(failed(withTranslation({ seoTitle: null }))).toContain('seoTitle');
  });

  it('blocks a product with no meta description', () => {
    const readiness = assessProduct(withTranslation({ seoDescription: null }), Locale.AR);

    expect(readiness.publishable).toBe(false);
    expect(failed(withTranslation({ seoDescription: null }))).toContain('seoDescription');
  });

  it('treats a whitespace-only SEO title as missing, not as present', () => {
    expect(failed(withTranslation({ seoTitle: '   ' }))).toContain('seoTitle');
  });

  it('blocks an SEO title that is too short to be a search headline', () => {
    expect(failed(withTranslation({ seoTitle: 'ويندوز 11' }))).toContain('seoTitle');
  });

  it('blocks when the assessed locale has no translation row at all', () => {
    const arabicOnly = aProduct({
      translations: aProduct().translations.filter((entry) => entry.locale === Locale.AR),
    });

    expect(assessProduct(arabicOnly, Locale.EN).publishable).toBe(false);
  });

  it('blocks a body that is too thin to rank', () => {
    expect(failed(withTranslation({ body: [{ html: '<p>مفتاح تفعيل</p>' }] }))).toContain('body');
  });

  it('blocks a product with no primary category, which would have no breadcrumb', () => {
    expect(failed(aProduct({ primaryCategoryId: null }))).toContain('primaryCategory');
  });

  it('blocks a product with nothing to buy', () => {
    const keys = failed(aProduct({ variants: [] }));

    expect(keys).toContain('sku');
    expect(keys).toContain('price');
  });

  it('blocks a variant priced at zero, which would sell a licence for nothing', () => {
    const free = aProduct({
      variants: [
        { sku: 'a', priceUsd: { toNumber: () => 24.9 } },
        { sku: 'b', priceUsd: { toNumber: () => 0 } },
      ],
    });

    expect(failed(free)).toContain('price');
    expect(assessProduct(free, Locale.AR).publishable).toBe(false);
  });

  it('does not block on a missing hero image, so the catalogue is not frozen behind media', () => {
    const readiness = assessProduct(aProduct({ media: [] }), Locale.AR);
    const heroImage = readiness.checks.find((check) => check.key === 'heroImage');

    expect(heroImage?.passed).toBe(false);
    expect(heroImage?.severity).toBe('warning');
    expect(readiness.publishable).toBe(true);
  });

  it('does not block on a missing English name either', () => {
    const arabicOnly = aProduct({
      translations: aProduct().translations.filter((entry) => entry.locale === Locale.AR),
    });
    const readiness = assessProduct(arabicOnly, Locale.AR);

    expect(readiness.checks.find((check) => check.key === 'englishName')?.passed).toBe(false);
    expect(readiness.publishable).toBe(true);
  });
});

describe('assessProduct reasons', () => {
  /**
   * The reason follows the reader, not the content.
   *
   * These two used to be the same thing: the wording was picked by the locale
   * being assessed, on the reasoning that an Arabic page's problems belong
   * with the Arabic page. That only held while every reader was Arabic. An
   * English-speaking editor auditing the Arabic catalog got a list of blockers
   * they could not act on, which is the failure the gate exists to prevent.
   */
  it('writes the reasons in Arabic for an Arabic reader', () => {
    const readiness = runWithPanelLocale('ar', () =>
      assessProduct(withTranslation({ seoDescription: null }), Locale.AR),
    );
    const check = readiness.checks.find((entry) => entry.key === 'seoDescription');

    expect(readiness.locale).toBe('ar');
    expect(check?.detail).toContain('لا يوجد وصف ميتا');
    expect(check?.detail).not.toMatch(/[A-Za-z]{4,}/);
  });

  it('writes them in English for an English reader', () => {
    const readiness = runWithPanelLocale('en', () =>
      assessProduct(withTranslation({ seoDescription: null }, Locale.EN), Locale.EN),
    );
    const check = readiness.checks.find((entry) => entry.key === 'seoDescription');

    expect(readiness.locale).toBe('en');
    expect(check?.detail).toBe(
      'No meta description. Every legacy category page shipped without one and none of them ever ranked.',
    );
  });

  it('answers an English reader in English about the Arabic copy', () => {
    const readiness = runWithPanelLocale('en', () =>
      assessProduct(withTranslation({ seoDescription: null }), Locale.AR),
    );
    const check = readiness.checks.find((entry) => entry.key === 'seoDescription');

    // Still judging the Arabic translation — only the wording moved.
    expect(readiness.locale).toBe('ar');
    expect(check?.detail).toBe(
      'No meta description. Every legacy category page shipped without one and none of them ever ranked.',
    );
  });

  it('answers an Arabic reader in Arabic about the English copy', () => {
    const readiness = runWithPanelLocale('ar', () =>
      assessProduct(withTranslation({ seoDescription: null }, Locale.EN), Locale.EN),
    );
    const check = readiness.checks.find((entry) => entry.key === 'seoDescription');

    expect(readiness.locale).toBe('en');
    expect(check?.detail).toContain('لا يوجد وصف ميتا');
  });

  it('falls back to Arabic when nothing says who is reading', () => {
    // Outside a request: the scheduled jobs and these tests. Nothing there has
    // a reader to ask.
    const check = assessProduct(
      withTranslation({ seoDescription: null }, Locale.EN),
      Locale.EN,
    ).checks.find((entry) => entry.key === 'seoDescription');

    expect(check?.detail).toContain('لا يوجد وصف ميتا');
  });

  it('says how short a title is, so the editor knows how much to add', () => {
    const readiness = runWithPanelLocale('en', () =>
      assessProduct(withTranslation({ seoTitle: 'Win 11' }, Locale.EN), Locale.EN),
    );

    expect(readiness.checks.find((entry) => entry.key === 'seoTitle')?.detail).toBe(
      'SEO title is 6 characters; 20 is the minimum.',
    );
  });

  it('counts the words it actually found when it refuses a thin body', () => {
    const readiness = runWithPanelLocale('en', () =>
      assessProduct(withTranslation({ body: [{ text: 'one two three' }] }, Locale.EN), Locale.EN),
    );

    expect(readiness.checks.find((entry) => entry.key === 'body')?.detail).toBe(
      'Description is 3 words; 120 is the minimum.',
    );
  });

  it('counts FAQ questions and answers towards the body, because the page shows them', () => {
    const faqBody = [{ items: [{ q: 'one two three four', a: 'five six seven eight' }] }];
    const readiness = runWithPanelLocale('en', () =>
      assessProduct(withTranslation({ body: faqBody }, Locale.EN), Locale.EN),
    );

    expect(readiness.checks.find((entry) => entry.key === 'body')?.detail).toBe(
      'Description is 8 words; 120 is the minimum.',
    );
  });

  it('counts no words at all when the body column holds something unreadable', () => {
    // A legacy import can leave anything in a Json column. Counting must fail
    // closed — zero words, blocked — rather than throw in the admin list.
    const readiness = runWithPanelLocale('en', () =>
      assessProduct(withTranslation({ body: 'not a block document' }, Locale.EN), Locale.EN),
    );

    expect(readiness.checks.find((entry) => entry.key === 'body')?.detail).toBe(
      'Description is 0 words; 120 is the minimum.',
    );
  });
});
