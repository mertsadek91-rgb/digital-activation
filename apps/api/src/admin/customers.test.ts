import { describe, expect, it } from 'vitest';

import { consentState } from './customers.service.js';

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

describe('consentState', () => {
  it('is NONE when nothing was ever recorded', () => {
    expect(consentState(null, null)).toBe('NONE');
  });

  it('is the latest choice', () => {
    expect(consentState(day(1), null)).toBe('OPTED_IN');
    expect(consentState(day(1), day(2))).toBe('OPTED_OUT');
    expect(consentState(day(3), day(2))).toBe('OPTED_IN');
    expect(consentState(null, day(2))).toBe('OPTED_OUT');
  });
});
