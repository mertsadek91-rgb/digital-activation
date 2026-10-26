import type { LineTerms, TermMatch } from '@da/contracts';

import { nameKey } from './names.js';

/**
 * The years and devices a supplier line's name states (TASK-0134).
 *
 * The supplier writes them in free text, a different way on every line:
 * "Key 3 Device 2 Year", "1PC 1Y", "5 Users / 12 Months", "Unlimited Devices
 * Lifetime", "1D1Y". Linking used to match on the name alone, so "3 Device
 * 2 Year" was offered for our "2 devices · 3 years" because the words were
 * close. Reading the terms lets the suggestions put the right sibling first
 * and say plainly when one differs.
 *
 * Only what the name states is read. A part it does not state is null, and a
 * comparison with null is UNKNOWN — never a guess.
 */

export interface ParsedLineTerms {
  /** 0 means unlimited; null when the name states no device count. */
  devices: number | null;
  /**
   * False for a bare "N PC" / "N Mac": the number may be a version or a title
   * ("Windows 11 PC Lifetime", "FIFA 23 PC 1 Year", REV-0195). Such a count
   * can confirm our own (MATCH) but never contradicts it and never fills a
   * new product.
   */
  devicesSure: boolean;
  period: { unit: 'DAY' | 'MONTH' | 'YEAR' | 'LIFETIME'; value: number | null } | null;
  /** The name with the terms taken out, for comparing product names alone. */
  rest: string;
}

const DEVICE_WORDS = String.raw`(?:pcs?|devices?|dev|users?|seats?|macs?|computers?|mobiles?|licen[cs]es?)`;
const UNLIMITED = new RegExp(
  String.raw`\bunlimited\s*${DEVICE_WORDS}\b|\b${DEVICE_WORDS}\s*:?\s*unlimited\b`,
  'i',
);
/** A word that only ever counts devices: "3 Devices", "5 Users", "2 PCs". */
const COUNT = new RegExp(
  String.raw`(?<![\d.])(\d{1,4})\s*[-x×]?\s*(?:devices?|dev|users?|seats?|pcs|macs|computers?|mobiles?|licen[cs]es?)\b`,
  'i',
);
/*
 * "PC" and "Mac" alone also name a platform, after a version or a title:
 * "Windows 11 PC", "Office 2021 Mac", "FIFA 23 PC 1 Year" (REV-0193/0195).
 * A count is sure only where the supplier's wording says so: glued to the
 * number ("1PC") or after "Key"/"for" ("Key 1 PC", "Key for 1 PC"). Any
 * other "N PC" is read but not trusted (`devicesSure: false`).
 */
const PC_GLUED = /(?<![\w.])(\d{1,3})(?:pc|mac)\b/i;
// A lookbehind, so "key" stays in the name compared with ours.
const PC_AFTER_KEY = /(?<=\b(?:keys?|for)\s+)(\d{1,3})\s*-?\s*(?:pc|mac)\b/i;
const PC_BARE = /(?<![\d.])(\d{1,3})\s*-?\s*(?:pc|mac)\b/i;
/** Numbers that are product names, never device counts: Norton 360, Microsoft 365. */
const NAME_NUMBERS = new Set([360, 365]);
// "1D1Y": devices glued to the term, as in the supplier's codes.
const GLUED = /(?<![\d.])(\d{1,3})\s*d\s*(?=\d{1,2}\s*y\b)/i;

const LIFETIME = /\b(?:lifetime|life\s*time|permanent|perpetual|forever|one[-\s]?time)\b/i;
const YEARS = /(?<![\d.])(\d{1,2})\s*[-]?\s*(?:years?|yrs?|y)\b/i;
const MONTHS = /(?<![\d.])(\d{1,3})\s*[-]?\s*(?:months?|mos?|m)\b/i;
const DAYS = /(?<![\d.])(\d{1,3})\s*[-]?\s*(?:days?|d)\b(?!\s*\d)/i;

export function parseLineTerms(name: string): ParsedLineTerms {
  let rest = nameKey(name);
  const take = (pattern: RegExp): RegExpExecArray | null => {
    const match = pattern.exec(rest);
    if (match) rest = `${rest.slice(0, match.index)} ${rest.slice(match.index + match[0].length)}`;
    return match;
  };
  // A "PC"/"Mac" count, unless the number is a product's own (Microsoft 365 Mac).
  const takeIf = (pattern: RegExp): RegExpExecArray | null => {
    const match = pattern.exec(rest);
    return match?.[1] && !NAME_NUMBERS.has(Number(match[1])) ? take(pattern) : null;
  };

  let devices: number | null = null;
  let devicesSure = true;
  if (take(UNLIMITED)) devices = 0;
  else {
    const counted = take(COUNT) ?? takeIf(PC_GLUED) ?? takeIf(PC_AFTER_KEY) ?? take(GLUED);
    if (counted?.[1]) devices = Number(counted[1]);
    else {
      // Read, not taken out of the name: if it is a version, it is part of it.
      const bare = PC_BARE.exec(rest);
      if (bare?.[1] && !NAME_NUMBERS.has(Number(bare[1]))) {
        devices = Number(bare[1]);
        devicesSure = false;
      }
    }
  }

  let period: ParsedLineTerms['period'] = null;
  if (take(LIFETIME)) period = { unit: 'LIFETIME', value: null };
  else {
    const years = take(YEARS);
    const months = years ? null : take(MONTHS);
    const days = years || months ? null : take(DAYS);
    if (years?.[1]) period = { unit: 'YEAR', value: Number(years[1]) };
    else if (months?.[1]) period = { unit: 'MONTH', value: Number(months[1]) };
    else if (days?.[1]) period = { unit: 'DAY', value: Number(days[1]) };
  }

  return { devices, devicesSure, period, rest: rest.replace(/\s+/g, ' ').trim() };
}

/** Our variant's own terms, as stored. */
export interface VariantTerms {
  deviceCount: number | null;
  licensePeriodUnit: 'DAY' | 'MONTH' | 'YEAR' | 'LIFETIME' | 'UNSPECIFIED';
  licensePeriodValue: number | null;
}

/** A line's terms against a variant's: MATCH, DIFFERENT, or UNKNOWN when either side is silent. */
export function compareTerms(line: ParsedLineTerms, variant: VariantTerms): LineTerms {
  const devicesMatch = matchDevices(line.devices, variant.deviceCount);
  return {
    devices: line.devices,
    period: line.period,
    // An unsure count never says "different" (see `devicesSure`).
    devicesMatch: !line.devicesSure && devicesMatch === 'DIFFERENT' ? 'UNKNOWN' : devicesMatch,
    periodMatch: matchPeriod(line.period, variant),
  };
}

function matchDevices(line: number | null, ours: number | null): TermMatch {
  if (line === null || ours === null) return 'UNKNOWN';
  return line === ours ? 'MATCH' : 'DIFFERENT';
}

function matchPeriod(line: ParsedLineTerms['period'], variant: VariantTerms): TermMatch {
  if (line === null || variant.licensePeriodUnit === 'UNSPECIFIED') return 'UNKNOWN';
  if (line.unit === 'LIFETIME' || variant.licensePeriodUnit === 'LIFETIME') {
    return line.unit === variant.licensePeriodUnit ? 'MATCH' : 'DIFFERENT';
  }
  const theirs = { unit: line.unit, value: line.value ?? 1 };
  const ours = { unit: variant.licensePeriodUnit, value: variant.licensePeriodValue ?? 1 };
  // "12 Months" is "1 Year"; "365 Days" is too (REV-0193). Months and years
  // compare in months, anything with days in days (a month as 30, a year as 365).
  if (theirs.unit !== 'DAY' && ours.unit !== 'DAY') {
    return months(theirs) === months(ours) ? 'MATCH' : 'DIFFERENT';
  }
  return days(theirs) === days(ours) ? 'MATCH' : 'DIFFERENT';
}

type Span = { unit: 'DAY' | 'MONTH' | 'YEAR'; value: number };
const months = (span: Span): number => (span.unit === 'YEAR' ? span.value * 12 : span.value);
const days = (span: Span): number =>
  span.unit === 'DAY' ? span.value : span.unit === 'MONTH' ? span.value * 30 : span.value * 365;

/**
 * How much the terms move a line's name score when ordering suggestions:
 * up a little when both match, down a lot when either differs, unchanged when
 * a side is silent.
 *
 * A weight, not a sort key (REV-0193): among the same product's siblings the
 * one with the right years and devices comes first, but a different product
 * whose terms happen to match ("Windows 11 Home 1 PC Lifetime" for our
 * "Windows 11 Pro") does not jump ahead of the right product whose name
 * states no terms.
 */
export function termsWeight(terms: LineTerms): number {
  if (terms.devicesMatch === 'DIFFERENT' || terms.periodMatch === 'DIFFERENT') return 0.6;
  return terms.devicesMatch === 'MATCH' && terms.periodMatch === 'MATCH' ? 1.15 : 1;
}
