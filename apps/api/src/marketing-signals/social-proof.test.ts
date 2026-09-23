import { describe, expect, it } from 'vitest';

import { type SocialProofSettings, socialProofSchema } from '@da/contracts';

import {
  type PaidOrderRow,
  agoBucket,
  aggregateSocialProof,
  previewSocialProof,
} from './social-proof.js';

const NOW = new Date('2026-09-20T12:00:00Z');
const hoursAgo = (hours: number): Date => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

const SETTINGS: SocialProofSettings = {
  enabled: true,
  windowHours: 72,
  minOrders: 3,
  showCountry: true,
  intervalSeconds: 25,
  maxPerPage: 3,
};

function rows(...entries: [hours: number, country: string | null][]): PaidOrderRow[] {
  return entries.map(([hours, country]) => ({ paidAt: hoursAgo(hours), billingCountry: country }));
}

describe('agoBucket', () => {
  it('says "hours" for anything under a day', () => {
    expect(agoBucket(hoursAgo(1), NOW)).toBe('hours');
    expect(agoBucket(hoursAgo(23.9), NOW)).toBe('hours');
  });

  it('says "day" from 24 up to 48 hours', () => {
    expect(agoBucket(hoursAgo(24), NOW)).toBe('day');
    expect(agoBucket(hoursAgo(47.9), NOW)).toBe('day');
  });

  it('says "days" from 48 hours on', () => {
    expect(agoBucket(hoursAgo(48), NOW)).toBe('days');
    expect(agoBucket(hoursAgo(700), NOW)).toBe('days');
  });
});

describe('aggregateSocialProof', () => {
  it('shows nothing below the minimum number of orders', () => {
    const result = aggregateSocialProof(rows([2, 'SA'], [5, 'AE']), SETTINGS, NOW);
    expect(result).toEqual({ count: 0, windowHours: 72, recent: [] });
  });

  it('shows the count once the minimum is reached', () => {
    const result = aggregateSocialProof(rows([2, 'SA'], [5, 'AE'], [30, 'KW']), SETTINGS, NOW);
    expect(result.count).toBe(3);
    expect(result.recent).toEqual([
      { country: 'SA', ago: 'hours' },
      { country: 'AE', ago: 'hours' },
      { country: 'KW', ago: 'day' },
    ]);
  });

  it('ignores orders outside the window, even if the query returned them', () => {
    // Three rows, but one is older than 72 hours: two in the window is below 3.
    const result = aggregateSocialProof(rows([2, 'SA'], [5, 'AE'], [80, 'KW']), SETTINGS, NOW);
    expect(result.count).toBe(0);
    expect(result.recent).toEqual([]);
  });

  it('ignores an order dated in the future', () => {
    const result = aggregateSocialProof(rows([2, 'SA'], [5, 'AE'], [-3, 'KW']), SETTINGS, NOW);
    expect(result.count).toBe(0);
  });

  it('shows nothing at all when the feature is off', () => {
    const result = aggregateSocialProof(
      rows([2, 'SA'], [5, 'AE'], [6, 'KW'], [7, 'QA']),
      { ...SETTINGS, enabled: false },
      NOW,
    );
    expect(result).toEqual({ count: 0, windowHours: 72, recent: [] });
  });

  it('counts an order under an hour old but does not announce it', () => {
    const result = aggregateSocialProof(rows([0.1, 'SA'], [2, 'AE'], [5, 'KW']), SETTINGS, NOW);
    expect(result.count).toBe(3);
    expect(result.recent).toEqual([
      { country: 'AE', ago: 'hours' },
      { country: 'KW', ago: 'hours' },
    ]);
  });

  it('never returns more notices than one page may show, newest first', () => {
    const result = aggregateSocialProof(
      rows([50, 'OM'], [2, 'SA'], [30, 'AE'], [5, 'KW'], [10, 'QA']),
      { ...SETTINGS, maxPerPage: 2 },
      NOW,
    );
    expect(result.count).toBe(5);
    expect(result.recent).toEqual([
      { country: 'SA', ago: 'hours' },
      { country: 'KW', ago: 'hours' },
    ]);
  });

  it('sends no notices when the page shows only the summary line', () => {
    const result = aggregateSocialProof(
      rows([2, 'SA'], [5, 'AE'], [30, 'KW']),
      { ...SETTINGS, intervalSeconds: 0 },
      NOW,
    );
    expect(result.count).toBe(3);
    expect(result.recent).toEqual([]);
  });

  it('drops the country when the store does not show countries', () => {
    const result = aggregateSocialProof(
      rows([2, 'SA'], [5, 'AE'], [30, 'KW']),
      { ...SETTINGS, showCountry: false },
      NOW,
    );
    expect(result.recent).toEqual([{ ago: 'hours' }, { ago: 'hours' }, { ago: 'day' }]);
  });

  it('shows no country when the buyer gave none, or gave something that is not a code', () => {
    const result = aggregateSocialProof(
      rows([2, null], [5, 'Riyadh'], [30, ' ae ']),
      SETTINGS,
      NOW,
    );
    expect(result.recent).toEqual([{ ago: 'hours' }, { ago: 'hours' }, { country: 'AE', ago: 'day' }]);
  });

  it('lets nothing but the count, the age and the country out', () => {
    // Rows as a careless query might return them, with every field a buyer
    // could be recognised by. None of it may reach the output.
    const leaky = [
      {
        paidAt: hoursAgo(2),
        billingCountry: 'SA',
        email: 'buyer@example.com',
        billingName: 'Fatimah Al-Qahtani',
        city: 'Jeddah',
        number: 'DA-2026-00187',
        id: 'ord_1',
      },
      { paidAt: hoursAgo(3), billingCountry: 'AE', email: 'b@example.com', number: 'DA-2' },
      { paidAt: hoursAgo(4), billingCountry: 'KW', email: 'c@example.com', number: 'DA-3' },
    ];
    const result = aggregateSocialProof(leaky, SETTINGS, NOW);

    expect(Object.keys(result).sort()).toEqual(['count', 'recent', 'windowHours']);
    for (const notice of result.recent) {
      expect(Object.keys(notice).every((key) => key === 'country' || key === 'ago')).toBe(true);
    }
    const text = JSON.stringify(result);
    for (const secret of ['example.com', 'Fatimah', 'Jeddah', 'DA-', 'ord_1', 'paidAt']) {
      expect(text).not.toContain(secret);
    }
    // And the public contract, which is strict about notice fields, accepts it.
    expect(socialProofSchema.safeParse(result).success).toBe(true);
  });
});

describe('previewSocialProof', () => {
  const line = (orderId: string, productId: string) => ({
    orderId,
    productId,
    slug: `slug-${productId}`,
    name: `Product ${productId}`,
  });

  it('counts distinct orders per product and marks those over the floor', () => {
    const preview = previewSocialProof(
      [
        line('o1', 'win'),
        line('o1', 'win'), // two lines, one order
        line('o2', 'win'),
        line('o3', 'win'),
        line('o2', 'office'),
      ],
      SETTINGS,
    );
    expect(preview.rows).toEqual([
      { productId: 'win', slug: 'slug-win', name: 'Product win', count: 3, shown: true },
      { productId: 'office', slug: 'slug-office', name: 'Product office', count: 1, shown: false },
    ]);
  });

  it('still reports what would show while the feature is off', () => {
    const preview = previewSocialProof(
      [line('o1', 'win'), line('o2', 'win'), line('o3', 'win')],
      { ...SETTINGS, enabled: false },
    );
    expect(preview.enabled).toBe(false);
    expect(preview.rows[0]?.shown).toBe(true);
  });
});
