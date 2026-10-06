import { describe, expect, it } from 'vitest';

import { diffLine, supplierUnavailable, suspiciousOutage, suspiciousShrink } from './diff.js';
import { nameKey, nameSimilarity } from './names.js';
import type { SupplierLine } from './sheet-parse.js';

describe('nameKey', () => {
  it('folds case, whitespace and compatibility forms only', () => {
    expect(nameKey('  Suite  Pro\nKey 1 PC ')).toBe('suite pro key 1 pc');
    expect(nameKey('Ｓｕｉｔｅ')).toBe('suite');
    expect(nameKey('Pro 2024')).not.toBe(nameKey('Pro 2021'));
  });
});

describe('nameSimilarity', () => {
  it('ranks the same product above a sibling with a different count', () => {
    const probe = 'Windows 11 Pro Retail Key 1 PC';
    const same = nameSimilarity(probe, 'Windows 11/10 Pro Retail Key 1 PC');
    const sibling = nameSimilarity(probe, 'Windows 11/10 Pro Retail Key 5 PC');
    const other = nameSimilarity(probe, 'Antivirus Shield 3 Devices 1 Year');
    expect(same).toBeGreaterThan(sibling);
    expect(sibling).toBeGreaterThan(other);
    expect(nameSimilarity('A b', 'a  B')).toBe(1);
  });
});

describe('diff rules', () => {
  const stored = {
    costUsd: '1.50',
    outOfStock: false,
    category: 'C',
    warranty: '7 days',
    remarks: null,
  };
  const line: SupplierLine = {
    nameKey: 'x',
    name: 'X',
    category: 'C',
    costUsd: '1.50',
    priceText: '$1.50',
    warranty: '7 days',
    remarks: null,
    outOfStock: false,
    partialStrike: false,
    wholesaleOnly: false,
    rowNumber: 9,
  };

  it('ignores a row that only moved', () => {
    expect(diffLine(stored, { ...line, rowNumber: 40 })).toEqual([]);
  });

  it('reports cost and stock changes', () => {
    expect(
      diffLine(stored, { ...line, costUsd: '2.00', outOfStock: true }).map((c) => c.kind),
    ).toEqual(['COST', 'STOCK']);
  });

  it('treats struck or vanished lines as unavailable', () => {
    expect(supplierUnavailable({ outOfStock: true, missingSince: null })).toBe(true);
    expect(supplierUnavailable({ outOfStock: false, missingSince: new Date() })).toBe(true);
    expect(supplierUnavailable({ outOfStock: false, missingSince: null })).toBe(false);
  });

  it('refuses a read that lost more than half the rows', () => {
    expect(suspiciousShrink(300, 140)).toBe(true);
    expect(suspiciousShrink(300, 160)).toBe(false);
    expect(suspiciousShrink(10, 1)).toBe(false);
  });

  it('holds a read that would mark most linked products out at once', () => {
    expect(suspiciousOutage(20, 11)).toBe(true);
    expect(suspiciousOutage(20, 10)).toBe(false);
    expect(suspiciousOutage(6, 6)).toBe(false);
  });
});
