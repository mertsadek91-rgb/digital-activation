import { describe, expect, it } from 'vitest';

import { acceptRate } from './fx-refresh.service.js';

/** The guards between a public feed and every converted price in the store. */
describe('acceptRate', () => {
  it('accepts a first rate and an ordinary move', () => {
    expect(acceptRate(3.6725, null)).toBe('ok');
    expect(acceptRate(3.68, 3.6725)).toBe('ok');
  });

  it('holds back a jump that looks like a broken feed', () => {
    expect(acceptRate(36.725, 3.6725)).toBe('jump');
    expect(acceptRate(0.36, 3.6725)).toBe('jump');
  });

  it('ignores a rate that is not a positive number', () => {
    expect(acceptRate(Number.NaN, 3.67)).toBe('invalid');
    expect(acceptRate(0, null)).toBe('invalid');
    expect(acceptRate(-1, null)).toBe('invalid');
  });
});
