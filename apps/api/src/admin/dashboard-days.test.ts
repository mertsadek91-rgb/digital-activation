import { describe, expect, it } from 'vitest';

import { dayKeys, storeDay } from './dashboard-days.js';

/**
 * The day boundary, which is the one thing on the dashboard that can be wrong
 * while every total still adds up.
 */
describe('storeDay', () => {
  it('puts a late Riyadh evening on the Riyadh day, not the UTC one', () => {
    // 22:30 in Riyadh on the 4th is 19:30 UTC on the 4th — the easy case.
    expect(storeDay(new Date('2026-03-04T19:30:00Z'), 'Asia/Riyadh')).toBe('2026-03-04');
  });

  it('puts an hour past Riyadh midnight on the new day, while UTC is still on the old one', () => {
    // 22:30 UTC is 01:30 the next morning in Riyadh. Bucketing this on UTC is
    // how a sale made after midnight lands on yesterday's chart.
    const at = new Date('2026-03-04T22:30:00Z');
    expect(storeDay(at, 'UTC')).toBe('2026-03-04');
    expect(storeDay(at, 'Asia/Riyadh')).toBe('2026-03-05');
  });

  it('reads a zone behind UTC the other way round', () => {
    const at = new Date('2026-03-05T02:00:00Z');
    expect(storeDay(at, 'UTC')).toBe('2026-03-05');
    expect(storeDay(at, 'America/New_York')).toBe('2026-03-04');
  });
});

describe('dayKeys', () => {
  it('ends on the day it was given and runs oldest first', () => {
    expect(dayKeys('2026-03-05', 3)).toEqual(['2026-03-03', '2026-03-04', '2026-03-05']);
  });

  it('crosses a month end', () => {
    expect(dayKeys('2026-03-02', 4)).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });

  it('crosses a leap day', () => {
    expect(dayKeys('2028-03-01', 3)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });

  it('returns sixty distinct days for the window the dashboard asks for', () => {
    const keys = dayKeys('2026-03-05', 60);
    expect(keys).toHaveLength(60);
    expect(new Set(keys).size).toBe(60);
    expect(keys.at(-1)).toBe('2026-03-05');
  });

  /**
   * The reason this steps over UTC and not local midnights. A window computed
   * in a DST zone loses a day to the spring-forward and repeats one in the
   * autumn, and both show up as a chart with a duplicated bar nobody can
   * explain.
   */
  it('keeps sixty distinct days across a daylight-saving change', () => {
    const keys = dayKeys('2026-04-05', 60);
    expect(new Set(keys).size).toBe(60);
    expect(keys).toContain('2026-03-29');
  });
});
