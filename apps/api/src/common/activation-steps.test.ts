import { describe, expect, it } from 'vitest';

import { parseActivationSteps } from './activation-steps.js';

/**
 * Guards delivery against the shape of a Json column.
 *
 * `ProductTranslation.activationSteps` is written by the admin as `[{ step,
 * text }]` and by the WordPress import as whatever the legacy row happened to
 * hold. Two callers read it — the licence email and the customer's order page —
 * and a throw in either one turns an unreadable how-to into an undelivered
 * order. A product with no readable steps must still deliver.
 */
describe('parseActivationSteps', () => {
  it('reads the shape the admin writes', () => {
    expect(
      parseActivationSteps([
        { step: 1, text: 'افتح الإعدادات' },
        { step: 2, text: 'أدخل مفتاح التفعيل' },
      ]),
    ).toEqual(['افتح الإعدادات', 'أدخل مفتاح التفعيل']);
  });

  it('reads a plain array of strings, which is what part of the legacy data holds', () => {
    expect(parseActivationSteps(['one', 'two'])).toEqual(['one', 'two']);
  });

  it('yields no steps for null or a missing column, rather than throwing', () => {
    expect(parseActivationSteps(null)).toEqual([]);
    expect(parseActivationSteps(undefined)).toEqual([]);
  });

  it('yields no steps when the column holds a string, a number or an object', () => {
    expect(parseActivationSteps('1. open settings')).toEqual([]);
    expect(parseActivationSteps(42)).toEqual([]);
    expect(parseActivationSteps({ step: 1, text: 'open settings' })).toEqual([]);
  });

  it('skips the entries it cannot read and keeps the ones it can', () => {
    expect(
      parseActivationSteps([
        { step: 1, text: 'open settings' },
        null,
        42,
        ['nested'],
        { step: 2 },
        { step: 3, text: 7 },
        'enter the key',
      ]),
    ).toEqual(['open settings', 'enter the key']);
  });

  it('drops blank and whitespace-only steps rather than numbering an empty line', () => {
    expect(parseActivationSteps([{ text: '' }, { text: '   ' }, '', '  '])).toEqual([]);
  });

  it('trims each step, because the legacy text carries stray indentation', () => {
    expect(parseActivationSteps([{ text: '  open settings \n' }, '  enter the key  '])).toEqual([
      'open settings',
      'enter the key',
    ]);
  });

  it('keeps the order it was given, because the email and the order page must agree', () => {
    expect(parseActivationSteps([{ text: 'c' }, { text: 'a' }, { text: 'b' }])).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('yields no steps for an empty array', () => {
    expect(parseActivationSteps([])).toEqual([]);
  });
});
