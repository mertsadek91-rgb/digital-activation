import { describe, expect, it } from 'vitest';

import { counted, productCount } from './counted.js';

/**
 * The six Arabic agreements, and the boundaries between them.
 *
 * Every case here is a number where the form changes or where a hand-written
 * rule would plausibly get it wrong — 2 against 3, 10 against 11, 99 against
 * 100, and the ones past a hundred where the band is decided by the last two
 * digits rather than by size.
 */
describe('productCount, Arabic', () => {
  it('has a phrase for none, one and two, with no numeral', () => {
    expect(productCount(0, 'ar')).toBe('لا منتجات');
    expect(productCount(1, 'ar')).toBe('منتج واحد');
    expect(productCount(2, 'ar')).toBe('منتجان');
  });

  it('uses the plural of paucity from three to ten', () => {
    expect(productCount(3, 'ar')).toBe('3 منتجات');
    expect(productCount(5, 'ar')).toBe('5 منتجات');
    expect(productCount(10, 'ar')).toBe('10 منتجات');
  });

  it('switches to the accusative singular at eleven', () => {
    expect(productCount(11, 'ar')).toBe('11 منتجاً');
    expect(productCount(37, 'ar')).toBe('37 منتجاً');
    expect(productCount(99, 'ar')).toBe('99 منتجاً');
  });

  it('switches again at a hundred', () => {
    expect(productCount(100, 'ar')).toBe('100 منتج');
    expect(productCount(1000, 'ar')).toBe('1,000 منتج');
  });

  it('reads the band off the last two digits, not the size', () => {
    // مئة وثلاثة منتجات — back to the plural of paucity, at 103.
    expect(productCount(103, 'ar')).toBe('103 منتجات');
    // مئة وأحد عشر منتجاً — and back to the accusative singular at 111.
    expect(productCount(111, 'ar')).toBe('111 منتجاً');
  });

  it('writes Latin digits, like the rest of this store', () => {
    // `ar` alone yields ١٢ in most ICU builds. The prices on the same page are
    // Latin, and two numbering systems in one line is the actual bug.
    expect(productCount(12, 'ar')).toContain('12');
    expect(productCount(12, 'ar')).not.toContain('١٢');
  });

  it('is the form the catalog was getting wrong', () => {
    // Adobe has three. The page said "3 منتجاً" — the eleven-and-above form.
    expect(productCount(3, 'ar')).not.toBe('3 منتجاً');
  });
});

describe('productCount, English', () => {
  it('pluralises on one', () => {
    expect(productCount(0, 'en')).toBe('0 products');
    expect(productCount(1, 'en')).toBe('1 product');
    expect(productCount(2, 'en')).toBe('2 products');
    expect(productCount(37, 'en')).toBe('37 products');
  });
});

describe('counted', () => {
  it('falls back to other for a form that was not supplied', () => {
    // An English caller supplies two of six and must never see a blank.
    expect(counted(3, 'en', { other: '{n} keys' })).toBe('3 keys');
    // An Arabic caller who omits the dual gets the general form rather than
    // nothing — wrong grammar is recoverable, an empty string is not.
    expect(counted(2, 'ar', { other: '{n} مفتاح' })).toBe('2 مفتاح');
  });

  it('leaves a form with no placeholder alone', () => {
    expect(counted(0, 'ar', { zero: 'لا شيء', other: '{n}' })).toBe('لا شيء');
  });
});
