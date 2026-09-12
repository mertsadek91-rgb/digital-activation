import { describe, expect, it } from 'vitest';

import { subjectWords, words } from './arabic.js';

/**
 * Guards the tokenizer the 404 suggester matches on.
 *
 * Every case below is taken from the shape of this store's own data rather
 * than invented. The legacy URLs are percent-encoded Arabic, the product names
 * are Arabic with an English tail, and the two spell the same words
 * differently — the catalog has a product called "أشتراك" whose own legacy URL
 * a customer would type as "اشتراك". If those do not fold to one word, the
 * suggester matches nothing on exactly the traffic it exists for, and it fails
 * silently: an empty suggestion list looks the same as a page with no near
 * neighbours.
 */
describe('words', () => {
  it('reads a percent-encoded Arabic legacy URL', () => {
    // "/product/برو" as WordPress wrote it.
    const bag = words('/product/%d8%a8%d8%b1%d9%88');
    expect([...bag]).toEqual(['product', 'برو']);
  });

  it('folds every alif to one, which is the store’s own disagreement', () => {
    expect(words('أشتراك')).toEqual(words('اشتراك'));
    expect(words('إصدار')).toEqual(words('اصدار'));
    expect(words('آخر')).toEqual(words('اخر'));
  });

  it('folds taa marbuta to haa, because a slug generator drops the dots', () => {
    expect(words('لمدة سنة')).toEqual(words('لمده سنه'));
  });

  it('folds alif maqsura to yaa', () => {
    expect(words('مستوى')).toEqual(words('مستوي'));
  });

  it('strips the harakat and the tatweel, which decorate without changing', () => {
    expect(words('بَرْنامَج')).toEqual(words('برنامج'));
    expect(words('بــــرو')).toEqual(words('برو'));
  });

  it('splits a slug on its hyphens and lowercases the Latin half', () => {
    expect([...words('/store/Adobe-Acrobat-Pro-DC')]).toEqual(['store', 'adobe', 'acrobat', 'pro']);
  });

  it('drops words under three characters, which are prepositions and noise', () => {
    // "dc" and "1" are not what anybody was searching for.
    expect(words('adobe-acrobat-pro-dc-1-year').has('dc')).toBe(false);
    expect(words('adobe-acrobat-pro-dc-1-year').has('year')).toBe(true);
  });

  it('matches on the raw text when the percent-escape is malformed', () => {
    // A crawler probing with a broken escape must not throw a 500 out of a
    // page whose entire job is to be the thing that did not throw.
    expect(() => words('/product/%E0%A4%A')).not.toThrow();
    expect(words('/product/%zz-office').has('office')).toBe(true);
  });

  it('finds nothing in a path that is only separators', () => {
    expect(words('///---///').size).toBe(0);
  });

  it('shares words between a legacy Arabic URL and the product’s Arabic name', () => {
    // The actual test: this pair is why the suggester exists.
    const asked = words('/product/اشتراك-ادوبي-اكروبات-برو-لمدة-سنة');
    const name = words('أشتراك أدوبي أكروبات برو لمدة سنة - Adobe Acrobat Pro DC 1 Year');

    const shared = [...asked].filter((word) => name.has(word));
    // Everything but "product" itself.
    expect(shared).toHaveLength(asked.size - 1);
  });
});

/**
 * The words the score is actually taken over.
 *
 * The score is a share of these, so anything left in that is not about a
 * product makes every path look less like every product — and it gets worse
 * the deeper the path is nested, which is exactly where the legacy URLs are.
 */
describe('subjectWords', () => {
  it('drops the routing vocabulary of both stores', () => {
    // `/product/` is the old store's shape and `/store/` is this one's.
    expect([...subjectWords('/en/store/acrobat-professional')]).toEqual([
      'acrobat',
      'professional',
    ]);
    expect([...subjectWords('/product/office-2019')]).toEqual(['office', '2019']);
  });

  it('leaves nothing behind for a path that is only routing', () => {
    // `/store` is a real page, so a 404 on it is not a near miss for a
    // product called "store" — it is a request with no subject at all.
    expect(subjectWords('/store').size).toBe(0);
    expect(subjectWords('/collections/').size).toBe(0);
  });

  it('drops the Arabic routing words too, which is where the legacy URLs are', () => {
    expect([...subjectWords('/منتج/اوفيس')]).toEqual(['اوفيس']);
  });

  it('keeps a product word that happens to sit next to a routing one', () => {
    expect(subjectWords('/store/store-manager-pro').has('manager')).toBe(true);
  });
});
