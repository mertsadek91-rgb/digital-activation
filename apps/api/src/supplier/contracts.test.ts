import {
  applySupplierPricesSchema,
  parseSheetUrl,
  setSupplierLinkSchema,
  setVariantMarkupSchema,
} from '@da/contracts';
import { describe, expect, it } from 'vitest';

describe('setSupplierLinkSchema', () => {
  // REV-0144: a coercing number check tried first turned "" and null into 0,
  // so every link made from the panel was stored at a 0% markup.
  it.each([[''], [null], [undefined]])('keeps %s as "use the default markup"', (value) => {
    const parsed = setSupplierLinkSchema.parse({ itemId: 'i', markupPercent: value });
    expect(parsed.markupPercent === 0).toBe(false);
    expect([undefined, null, '']).toContain(parsed.markupPercent);
  });

  it('accepts a real markup, including zero typed on purpose', () => {
    expect(setSupplierLinkSchema.parse({ itemId: 'i', markupPercent: 35 }).markupPercent).toBe(35);
    expect(setSupplierLinkSchema.parse({ itemId: 'i', markupPercent: '0' }).markupPercent).toBe(0);
    expect(() => setSupplierLinkSchema.parse({ itemId: 'i', markupPercent: -5 })).toThrow();
  });
});

describe('applySupplierPricesSchema', () => {
  it('needs at least one variant or "all"', () => {
    expect(() => applySupplierPricesSchema.parse({})).toThrow();
    expect(applySupplierPricesSchema.parse({ all: true }).confirmLarge).toBe(false);
    expect(applySupplierPricesSchema.parse({ variantIds: ['v'] }).variantIds).toEqual(['v']);
  });
});

describe('parseSheetUrl', () => {
  it('reads the id and the tab', () => {
    expect(
      parseSheetUrl(
        'https://docs.google.com/spreadsheets/d/1eHCuShPggYvdy_dWbJwmljxWEoNv-65f_MCFSLK4-I0/edit?gid=42#gid=42',
      ),
    ).toEqual({ spreadsheetId: '1eHCuShPggYvdy_dWbJwmljxWEoNv-65f_MCFSLK4-I0', sheetGid: 42 });
    expect(parseSheetUrl('https://example.com/x')).toBeNull();
  });
});

// TASK-0135: a row's own markup, as a percentage or as the price wanted.
describe('setVariantMarkupSchema', () => {
  it('keeps null as "back to the sheet markup", never 0 (REV-0144)', () => {
    expect(setVariantMarkupSchema.parse({ markupPercent: null }).markupPercent).toBeNull();
  });

  it('takes one of markup or price, never both or neither', () => {
    expect(
      setVariantMarkupSchema.safeParse({ markupPercent: 20, targetPriceUsd: 12 }).success,
    ).toBe(false);
    expect(setVariantMarkupSchema.safeParse({ apply: true }).success).toBe(false);
    expect(setVariantMarkupSchema.parse({ targetPriceUsd: 13.37 })).toEqual({
      targetPriceUsd: 13.37,
      apply: false,
    });
  });

  // REV-0197: numbers only, so a blank never becomes 0%.
  it.each([[''], ['  '], ['13'], [true], [[5]]])('refuses %j', (value) => {
    expect(setVariantMarkupSchema.safeParse({ markupPercent: value }).success).toBe(false);
    expect(setVariantMarkupSchema.safeParse({ targetPriceUsd: value }).success).toBe(false);
  });

  it('refuses a negative markup and a price of zero', () => {
    expect(setVariantMarkupSchema.safeParse({ markupPercent: -5 }).success).toBe(false);
    expect(setVariantMarkupSchema.safeParse({ targetPriceUsd: 0 }).success).toBe(false);
  });
});
