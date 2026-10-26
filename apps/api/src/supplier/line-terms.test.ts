import { describe, expect, it } from 'vitest';

import { compareTerms, parseLineTerms, termsWeight } from './line-terms.js';

describe('parseLineTerms', () => {
  it.each([
    ['ESET HOME Security Essential/Internet Security Key 3 Device 2 Year', 3, 'YEAR', 2],
    ['ESET HOME Security Essential/Internet Security Key 1 Device 3 Year', 1, 'YEAR', 3],
    ['Kaspersky Total Security 5 Devices 1 Year', 5, 'YEAR', 1],
    ['Windows 11 Pro Retail Key 1 PC', 1, null, null],
    ['Bitdefender Total Security 1PC 1Y', 1, 'YEAR', 1],
    ['Norton 360 Deluxe 5 Users / 12 Months', 5, 'MONTH', 12],
    ['McAfee Total Protection Unlimited Devices 1 Year', 0, 'YEAR', 1],
    ['NordVPN Devices: Unlimited Lifetime', 0, 'LIFETIME', null],
    ['ESET NOD32 1D1Y', 1, 'YEAR', 1],
    ['Office 2021 Professional Plus Bind Key', null, null, null],
    ['Microsoft 365 Personal 1 Year', null, 'YEAR', 1],
    ['Avast Premium Security 10-PC 2-Years', 10, 'YEAR', 2],
    ['Adobe Creative Cloud 30 Days', null, 'DAY', 30],
    ['Windows Server 2022 Standard Permanent', null, 'LIFETIME', null],
  ])('%s', (name, devices, unit, value) => {
    const parsed = parseLineTerms(name);
    expect(parsed.devices).toBe(devices);
    expect(parsed.period).toEqual(unit === null ? null : { unit, value });
  });

  // REV-0193: a version or a title number before "PC"/"Mac" is never a trusted device count.
  it.each([
    ['Office 2021 Home & Business Mac', null],
    ['Microsoft 365 Mac 1 Year', null],
    ['Windows 11 PC', null],
    ['Windows 10 PC Key', null],
    ['Battlefield 4 PC', null],
    ['FIFA 23 PC', null],
    ['Call of Duty MW 3 PC', null],
    ['Kaspersky Standard 3 PC 1 Year', null],
    ['Kaspersky 1 PC', null],
    ['Windows 11/10 Pro Retail Key 1 PC', 1],
    ['Office 2021 Pro Plus 1 Key for 1 PC', 1],
    ['Office 2021 Home & Business Mac 1Mac', 1],
  ])('%s: trusted devices %s', (name, devices) => {
    const parsed = parseLineTerms(name);
    expect(parsed.devicesSure ? parsed.devices : null).toBe(devices);
  });

  // REV-0195: with a term after it, a bare "N PC" is still read, but not trusted.
  it.each([
    ['Windows 11 PC Lifetime', 11],
    ['Windows 10 PC / Lifetime', 10],
    ['FIFA 23 PC 1 Year', 23],
    ['Sims 4 PC - Lifetime', 4],
  ])('%s: an unsure count never contradicts ours', (name, read) => {
    const parsed = parseLineTerms(name);
    expect(parsed).toMatchObject({ devices: read, devicesSure: false });
    const one = {
      deviceCount: 1,
      licensePeriodUnit: 'LIFETIME',
      licensePeriodValue: null,
    } as const;
    expect(compareTerms(parsed, one).devicesMatch).toBe('UNKNOWN');
    // The version stays in the name compared with ours.
    expect(parsed.rest).toContain(String(read));
  });

  it('lets an unsure count confirm ours', () => {
    const three = { deviceCount: 3, licensePeriodUnit: 'YEAR', licensePeriodValue: 1 } as const;
    expect(compareTerms(parseLineTerms('Avast 3 PC 1 Year'), three).devicesMatch).toBe('MATCH');
  });

  it('keeps version numbers that are not terms in the remaining name', () => {
    expect(parseLineTerms('Windows 11 Pro Retail Key 1 PC').rest).toBe('windows 11 pro retail key');
    expect(parseLineTerms('Norton 360 Deluxe 5 Device 1 Year').rest).toBe('norton 360 deluxe');
  });
});

describe('compareTerms', () => {
  const ours = { deviceCount: 2, licensePeriodUnit: 'YEAR', licensePeriodValue: 3 } as const;

  it('matches only the line with the same devices and years', () => {
    const right = compareTerms(parseLineTerms('ESET Key 2 Device 3 Year'), ours);
    const wrong = compareTerms(parseLineTerms('ESET Key 3 Device 2 Year'), ours);
    expect(right).toMatchObject({ devicesMatch: 'MATCH', periodMatch: 'MATCH' });
    expect(wrong).toMatchObject({ devicesMatch: 'DIFFERENT', periodMatch: 'DIFFERENT' });
    expect(termsWeight(right)).toBeGreaterThan(termsWeight(wrong));
  });

  it('treats 12 months as one year, and a silent side as unknown', () => {
    const year = { deviceCount: 1, licensePeriodUnit: 'YEAR', licensePeriodValue: 1 } as const;
    expect(compareTerms(parseLineTerms('X 1 PC 12 Months'), year).periodMatch).toBe('MATCH');
    expect(compareTerms(parseLineTerms('PlayStation Plus 365 Days'), year).periodMatch).toBe(
      'MATCH',
    );
    expect(compareTerms(parseLineTerms('X Retail Key'), year)).toMatchObject({
      devicesMatch: 'UNKNOWN',
      periodMatch: 'UNKNOWN',
    });
    const unstated = {
      deviceCount: null,
      licensePeriodUnit: 'UNSPECIFIED',
      licensePeriodValue: null,
    } as const;
    expect(compareTerms(parseLineTerms('X 3 Device 2 Year'), unstated)).toMatchObject({
      devicesMatch: 'UNKNOWN',
      periodMatch: 'UNKNOWN',
    });
  });

  it('matches unlimited with unlimited and lifetime with lifetime', () => {
    const forever = {
      deviceCount: 0,
      licensePeriodUnit: 'LIFETIME',
      licensePeriodValue: null,
    } as const;
    expect(compareTerms(parseLineTerms('VPN Unlimited Devices Lifetime'), forever)).toMatchObject({
      devicesMatch: 'MATCH',
      periodMatch: 'MATCH',
    });
    expect(compareTerms(parseLineTerms('VPN 5 Devices 1 Year'), forever)).toMatchObject({
      devicesMatch: 'DIFFERENT',
      periodMatch: 'DIFFERENT',
    });
  });
});
