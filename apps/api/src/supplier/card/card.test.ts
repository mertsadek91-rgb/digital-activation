import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { CARD_SIZE, defaultRibbon, hexToRgb, logoColor, renderCard, shade, tint } from './card.js';

describe('defaultRibbon', () => {
  it('reads like the legacy cards', () => {
    expect(
      defaultRibbon({ licensePeriodUnit: 'LIFETIME', licensePeriodValue: null, deviceCount: 1 }),
    ).toEqual(['مدى', 'الحياة']);
    expect(
      defaultRibbon({ licensePeriodUnit: 'LIFETIME', licensePeriodValue: null, deviceCount: 5 }),
    ).toEqual(['5', 'أجهزة']);
    expect(
      defaultRibbon({ licensePeriodUnit: 'YEAR', licensePeriodValue: 1, deviceCount: 1 }),
    ).toEqual(['سنة', 'واحدة']);
    expect(
      defaultRibbon({ licensePeriodUnit: 'MONTH', licensePeriodValue: 3, deviceCount: 1 }),
    ).toEqual(['3', 'أشهر']);
  });
});

describe('colour helpers', () => {
  it('tints and shades within range', () => {
    expect(hexToRgb('#087f70')).toEqual({ r: 8, g: 127, b: 112 });
    expect(tint('#000000', 1)).toBe('#ffffff');
    expect(shade('#ffffff', 1)).toBe('#000000');
    expect(hexToRgb('nonsense')).toEqual({ r: 8, g: 127, b: 112 });
  });

  it("finds a logo's main colour and ignores its white background", async () => {
    const logo = await sharp({
      create: { width: 40, height: 40, channels: 4, background: '#ffffff' },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 20, height: 20, channels: 4, background: '#e8410a' },
          })
            .png()
            .toBuffer(),
          left: 10,
          top: 10,
        },
      ])
      .png()
      .toBuffer();
    const color = await logoColor(logo);
    expect(color).not.toBeNull();
    expect(hexToRgb(color ?? '').r).toBeGreaterThan(200);
  });

  it('gives no colour for a black wordmark', async () => {
    const logo = await sharp({
      create: { width: 30, height: 30, channels: 4, background: '#111111' },
    })
      .png()
      .toBuffer();
    expect(await logoColor(logo)).toBeNull();
  });
});

describe('renderCard', () => {
  it('renders a square WebP with or without a logo', async () => {
    const logo = await sharp({
      create: { width: 300, height: 120, channels: 4, background: '#0078d4' },
    })
      .png()
      .toBuffer();
    for (const input of [logo, null]) {
      const { webp } = await renderCard({
        title: 'Windows 11 Pro',
        ribbon: ['مدى', 'الحياة'],
        chips: [
          { label: 'تسليم فوري', icon: 'clock' },
          { label: 'مفتاح أصلي', icon: 'shield' },
        ],
        color: '#0078d4',
        logo: input,
        brandName: 'Windows',
      });
      const meta = await sharp(webp).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', CARD_SIZE, CARD_SIZE]);
      expect(webp.length).toBeLessThan(1_400_000);
    }
  }, 30_000);
});
