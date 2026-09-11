import { describe, expect, it } from 'vitest';

import { absoluteUrl, alternates, canonical, localizedPath } from './hreflang.js';

/**
 * Guards the locale routing that the whole bilingual plan rests on.
 *
 * Arabic is at the root and English is prefixed — the reverse of the usual
 * arrangement, and deliberately so: `/` holds 69.6% of the store's impressions
 * and moving it would throw that away. A non-reciprocal alternate set, or an
 * x-default pointing at the prefixed locale, is the kind of mistake that
 * validates fine and quietly demotes the wrong half of the catalogue.
 */
describe('localizedPath', () => {
  it('leaves an Arabic path at the root, because that is where the history is', () => {
    expect(localizedPath('/store/windows-11-pro', 'ar')).toBe('/store/windows-11-pro');
  });

  it('prefixes English and only English', () => {
    expect(localizedPath('/store/windows-11-pro', 'en')).toBe('/en/store/windows-11-pro');
  });

  it('maps the home page to /en rather than /en/', () => {
    expect(localizedPath('/', 'ar')).toBe('/');
    expect(localizedPath('/', 'en')).toBe('/en');
  });

  it('adds the leading slash a caller may have dropped, so no path becomes relative', () => {
    expect(localizedPath('store/win', 'ar')).toBe('/store/win');
    expect(localizedPath('store/win', 'en')).toBe('/en/store/win');
  });
});

describe('absoluteUrl', () => {
  it('builds an absolute URL on the given origin', () => {
    expect(absoluteUrl('https://digital-activation.com', '/store/win', 'en')).toBe(
      'https://digital-activation.com/en/store/win',
    );
  });

  it('ignores a path on the base URL, so the locale prefix cannot be nested twice', () => {
    expect(absoluteUrl('https://digital-activation.com/en/', '/store/win', 'en')).toBe(
      'https://digital-activation.com/en/store/win',
    );
  });
});

describe('alternates', () => {
  it('is reciprocal: each locale is listed exactly once and both point at the same page', () => {
    const links = alternates('https://digital-activation.com', '/store/win');

    expect(links.map((link) => link.hrefLang)).toEqual(['ar', 'en', 'x-default']);
    expect(links.map((link) => link.href)).toEqual([
      'https://digital-activation.com/store/win',
      'https://digital-activation.com/en/store/win',
      'https://digital-activation.com/store/win',
    ]);
  });

  it('puts x-default on Arabic, not on English', () => {
    const links = alternates('https://digital-activation.com', '/store/win');
    const byLang = new Map(links.map((link) => [link.hrefLang, link.href]));

    expect(byLang.get('x-default')).toBe(byLang.get('ar'));
    expect(byLang.get('x-default')).not.toBe(byLang.get('en'));
  });

  it('names every alternate a page can have, so the set is closed', () => {
    // A locale added to the app without being added here would ship pages that
    // are alternates of nothing — the legacy site's exact state, with no
    // hreflang at all while English demand went unanswered.
    expect(alternates('https://digital-activation.com', '/')).toHaveLength(3);
  });
});

describe('canonical', () => {
  it('is self-referencing for each locale by default', () => {
    expect(canonical('https://digital-activation.com', '/store/win', 'ar')).toBe(
      'https://digital-activation.com/store/win',
    );
    expect(canonical('https://digital-activation.com', '/store/win', 'en')).toBe(
      'https://digital-activation.com/en/store/win',
    );
  });

  it('uses an override verbatim, because that is the only reason to pass one', () => {
    expect(
      canonical('https://digital-activation.com', '/store/win', 'en', 'https://elsewhere.test/x'),
    ).toBe('https://elsewhere.test/x');
  });
});
