import { describe, expect, it } from 'vitest';

import { words } from '../common/arabic.js';

import { type Indexed, scoreRow } from './search.service.js';

/**
 * Guards the order results come back in.
 *
 * A wrong weight here does not throw and does not fail a build. It puts the
 * bundle above the product somebody asked for, or the six products that
 * mention Office above the one called Office — and the only symptom is that
 * people stop using the search box.
 */
function row(overrides: { slug: string; name: string; blurb?: string }): Indexed {
  const blurb = overrides.blurb ?? '';
  return {
    id: overrides.slug,
    slug: overrides.slug,
    name: overrides.name,
    blurb,
    nameWords: words(`${overrides.name} ${overrides.slug}`),
    blurbWords: words(blurb),
    haystack: [...words(`${overrides.name} ${overrides.slug}`)].join(' '),
  };
}

function score(entry: Indexed, query: string): number {
  const asked = words(query);
  return scoreRow(entry, asked, [...asked].join(' '));
}

const office = row({ slug: 'office-2021-pro-plus', name: 'Office 2021 Pro Plus' });
const bundle = row({
  slug: 'starter-bundle-windows-11-pro-office-365',
  name: 'Starter Bundle: Windows 11 Pro and Office 365',
});
const mentionsOffice = row({
  slug: 'windows-11-pro',
  name: 'Windows 11 Pro',
  blurb: 'Runs Office and every other desktop application',
});

describe('scoreRow', () => {
  it('puts the product named for the query above the bundle containing it', () => {
    expect(score(office, 'office 2021 pro plus')).toBeGreaterThan(
      score(bundle, 'office 2021 pro plus'),
    );
  });

  it('puts a name match above a description match', () => {
    // Somebody searching "office" wants the product called Office, not the
    // ones whose blurb happens to mention it.
    expect(score(office, 'office')).toBeGreaterThan(score(mentionsOffice, 'office'));
  });

  it('scores a description match above nothing at all', () => {
    expect(score(mentionsOffice, 'office')).toBeGreaterThan(0);
  });

  it('refuses a row that matches less than half the query', () => {
    // One word of four is the category, not the product — and a search that
    // returns everything has told the visitor nothing. "Runs Office …" shares
    // only "office" with this query, because the row is a Home edition and the
    // query asks for Pro Plus.
    const home = row({
      slug: 'windows-11-home',
      name: 'Windows 11 Home',
      blurb: 'Runs Office and every other desktop application',
    });
    expect(score(home, 'office 2021 pro plus')).toBe(0);
  });

  it('keeps a half-matching row, far below the one that matches outright', () => {
    // "Windows 11 Pro" shares "office" (from its description) and "pro" with
    // "office 2021 pro plus". That is a weak answer rather than a wrong one,
    // so it is kept and ranked far down — the failure this guards against is
    // it being kept and ranked *near the top*.
    const weak = score(mentionsOffice, 'office 2021 pro plus');
    expect(weak).toBeGreaterThan(0);
    expect(score(office, 'office 2021 pro plus')).toBeGreaterThan(weak * 5);
  });

  it('matches a single word against a long name', () => {
    expect(score(office, 'office')).toBeGreaterThan(0);
    expect(score(bundle, 'windows')).toBeGreaterThan(0);
  });

  it('rewards the whole phrase over the same words scattered', () => {
    const scattered = row({
      slug: 'pro-plus-office-2021-oem',
      name: 'Pro Plus OEM for 2021 Office',
    });
    expect(score(office, 'office 2021 pro plus')).toBeGreaterThan(
      score(scattered, 'office 2021 pro plus'),
    );
  });

  it('finds an Arabic name from a query spelled without its hamza', () => {
    // The case the whole thing exists for: the catalog writes "أشتراك" and a
    // customer types "اشتراك".
    const arabic = row({
      slug: 'adobe-acrobat-pro-dc',
      name: 'أشتراك أدوبي أكروبات برو لمدة سنة - Adobe Acrobat Pro DC',
    });
    expect(score(arabic, 'اشتراك ادوبي اكروبات')).toBeGreaterThan(0);
  });

  it('finds the same row from its Latin name on an Arabic query, and the reverse', () => {
    // Software names are written in Latin letters even by people typing
    // Arabic, so both halves of the name have to be searchable at once.
    const arabic = row({
      slug: 'adobe-acrobat-pro-dc',
      name: 'أشتراك أدوبي أكروبات برو - Adobe Acrobat Pro DC',
    });
    expect(score(arabic, 'adobe acrobat')).toBeGreaterThan(0);
    expect(score(arabic, 'أدوبي أكروبات')).toBeGreaterThan(0);
  });

  it('scores nothing for a query with no word in common', () => {
    expect(score(office, 'photoshop')).toBe(0);
  });

  it('scores nothing for a query that is only separators', () => {
    expect(score(office, '--- ///')).toBe(0);
  });
});
