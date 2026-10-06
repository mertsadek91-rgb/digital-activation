import { applySupplierPricesSchema, parseSheetUrl, setSupplierLinkSchema } from '@da/contracts';
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
