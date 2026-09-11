import { describe, expect, it } from 'vitest';

import { foldArabic, normalizeArabicDigits, normalizeForSearch, toLatinSlug } from './arabic.js';

/**
 * Guards search matching, where a failure looks like an empty shelf.
 *
 * Arabic writers vary hamza, alef maksura, ta marbuta and diacritics freely, and
 * both spellings turn up in this store's own Search Console data — "أوفيس" and
 * "اوفيس", "التفعيل" and "تفعيل". If the index and the query are not folded the
 * same way, a shopper searching for a product the store sells is told there are
 * no results, and leaves. Nothing in a log says that happened.
 */
describe('foldArabic', () => {
  it('folds the hamza forms of alef onto one letter', () => {
    expect(foldArabic('أوفيس')).toBe(foldArabic('اوفيس'));
    expect(foldArabic('إنترنت')).toBe(foldArabic('انترنت'));
    expect(foldArabic('آيفون')).toBe(foldArabic('ايفون'));
  });

  it('folds alef maksura onto ya and ta marbuta onto ha', () => {
    expect(foldArabic('على')).toBe(foldArabic('علي'));
    expect(foldArabic('حماية')).toBe(foldArabic('حمايه'));
  });

  it('removes the diacritics and tatweel that carry no meaning for matching', () => {
    expect(foldArabic('مُفَتِّح')).toBe(foldArabic('مفتح'));
    expect(foldArabic('تفعيـــل')).toBe(foldArabic('تفعيل'));
  });

  it('leaves Latin text alone, because product titles are bilingual', () => {
    expect(foldArabic('Windows 11 Pro')).toBe('Windows 11 Pro');
  });
});

describe('normalizeArabicDigits', () => {
  it('maps both the Arabic-Indic and the extended Arabic-Indic digits to Latin', () => {
    expect(normalizeArabicDigits('ويندوز ١١')).toBe('ويندوز 11');
    expect(normalizeArabicDigits('ويندوز ۱۱')).toBe('ويندوز 11');
  });

  it('leaves Latin digits untouched', () => {
    expect(normalizeArabicDigits('Office 2021')).toBe('Office 2021');
  });
});

describe('normalizeForSearch', () => {
  it('matches the two spellings that both appear in this store Search Console data', () => {
    expect(normalizeForSearch('أوفيس')).toBe(normalizeForSearch('اوفيس'));
    expect(normalizeForSearch('التنشيط الرقمي')).toBe(normalizeForSearch('التنشيط الرقمى'));
  });

  it('is idempotent, so indexing a value twice cannot change it', () => {
    const once = normalizeForSearch('  أوفيس ٢٠٢١  Pro  ');

    expect(normalizeForSearch(once)).toBe(once);
  });

  it('collapses whitespace and trims, so a pasted query still matches', () => {
    expect(normalizeForSearch('  ويندوز   11   برو ')).toBe('ويندوز 11 برو');
  });

  it('lowercases the Latin half, because the index is folded the same way', () => {
    expect(normalizeForSearch('Windows 11 PRO')).toBe('windows 11 pro');
  });

  it('strips the invisible bidi controls a copy-paste from a browser carries', () => {
    expect(normalizeForSearch('‏ويندوز‎')).toBe(normalizeForSearch('ويندوز'));
  });

  it('normalises digits, so "ويندوز ١١" finds "ويندوز 11"', () => {
    expect(normalizeForSearch('ويندوز ١١')).toBe(normalizeForSearch('ويندوز 11'));
  });
});

describe('toLatinSlug', () => {
  it('takes the Latin half of a bilingual title, which is the product name', () => {
    expect(toLatinSlug('Windows 11 Pro مفتاح تفعيل')).toBe('windows-11-pro');
  });

  it('returns null when a title has no usable Latin run, rather than mangling it', () => {
    // The caller must then supply a slug by hand. The legacy alternative was a
    // percent-encoded Arabic path past 300 characters, unusable as a citation.
    expect(toLatinSlug('مفتاح تفعيل')).toBeNull();
  });

  it('never leaves a leading, trailing or doubled separator', () => {
    const slug = toLatinSlug('  Office --- 2021  Pro Plus  ');

    expect(slug).toBe('office-2021-pro-plus');
  });

  it('keeps a slug short enough to be usable in a URL', () => {
    const slug = toLatinSlug('Autodesk '.repeat(30));

    expect(slug?.length).toBeLessThanOrEqual(96);
    expect(slug?.endsWith('-')).toBe(false);
  });

  it('normalises Arabic-Indic digits in a title rather than dropping them', () => {
    expect(toLatinSlug('Windows ١١ Pro')).toBe('windows-11-pro');
  });
});
