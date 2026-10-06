import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

/**
 * The product card image, in the store's own template (CR-0004).
 *
 * The legacy catalogue's pictures are one design: a hanging gift card on a
 * light fingerprint-patterned background, the brand logo in its white top, a
 * grey ribbon in the corner naming the term or the device count, a wave into
 * the brand's colour, the product name in white on that colour, and two white
 * chips — "genuine key" and "instant delivery". This draws that card from
 * data, so every new product gets the same picture the old ones have.
 *
 * Drawn with sharp: the shapes as SVG, the text through sharp's own Pango +
 * HarfBuzz text renderer with a bundled font file. That combination shapes
 * Arabic and orders mixed Arabic/Latin text correctly without depending on
 * whatever fonts the server image happens to have. Nothing here calls a
 * model; the AI only proposes the words (`card-text.ts`).
 */

export const CARD_SIZE = 1200;

export interface CardSpec {
  /** One or two lines; long names shrink to fit. */
  title: string;
  /** The corner ribbon, one to three very short lines ("مدى", "الحياة"). */
  ribbon: string[];
  /** The two chips, in reading order (the first sits on the right in RTL). */
  chips: [CardChip, CardChip];
  /** Brand colour as #rrggbb. */
  color: string;
  /** The brand logo, any format sharp reads. Null draws the brand name instead. */
  logo: Buffer | null;
  brandName: string | null;
}

export interface CardChip {
  label: string;
  icon: 'key' | 'bolt' | 'shield' | 'user' | 'clock';
}

export interface RenderedCard {
  webp: Buffer;
  /** Fonts the render fell back from, for the panel to mention. */
  notes: string[];
}

// --- fonts ----------------------------------------------------------------------

/**
 * `apps/api/assets/fonts`, from both `src/supplier/card` and `dist/supplier/card`.
 * CARD_FONT_DIR overrides it.
 */
function fontDir(): string {
  return process.env.CARD_FONT_DIR ?? path.resolve(__dirname, '..', '..', '..', 'assets', 'fonts');
}

interface Face {
  family: string;
  file: string | undefined;
}

function face(weight: 'bold' | 'black'): Face {
  const dir = fontDir();
  const candidates =
    weight === 'black'
      ? ['Tajawal-ExtraBold.ttf', 'Tajawal-Black.ttf', 'Tajawal-Bold.ttf']
      : ['Tajawal-Bold.ttf', 'Tajawal-ExtraBold.ttf'];
  for (const name of candidates) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return { family: process.env.CARD_FONT_FAMILY ?? 'Tajawal', file };
  }
  return { family: 'sans-serif', file: undefined };
}

export function fontsAvailable(): boolean {
  return face('bold').file !== undefined;
}

function escapeMarkup(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** One block of text as a transparent PNG, wrapped to `width`. */
async function textLayer(input: {
  text: string;
  size: number;
  color: string;
  width: number;
  weight: 'bold' | 'black';
  align?: 'centre' | 'left' | 'right';
  spacing?: number;
}): Promise<{ data: Buffer; width: number; height: number }> {
  const font = face(input.weight);
  const weightName = input.weight === 'black' ? 'ExtraBold' : 'Bold';
  const result = await sharp({
    text: {
      text: `<span foreground="${input.color}">${escapeMarkup(input.text)}</span>`,
      font: `${font.family} ${weightName} ${String(input.size)}`,
      ...(font.file ? { fontfile: font.file } : {}),
      width: input.width,
      align: input.align ?? 'centre',
      rgba: true,
      dpi: 72,
      spacing: input.spacing ?? Math.round(input.size * 0.15),
      wrap: 'word',
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { data: result.data, width: result.info.width, height: result.info.height };
}

/** The largest size, from `start` down, at which the text fits the box. */
async function fitText(input: {
  text: string;
  start: number;
  min: number;
  color: string;
  width: number;
  height: number;
  weight: 'bold' | 'black';
}): Promise<{ data: Buffer; width: number; height: number }> {
  let size = input.start;
  for (;;) {
    const layer = await textLayer({ ...input, size });
    if ((layer.height <= input.height && layer.width <= input.width) || size <= input.min)
      return layer;
    size = Math.max(input.min, size - 4);
  }
}

// --- colour ----------------------------------------------------------------------

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? '087f70';
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  return `#${[r, g, b]
    .map((n) =>
      Math.round(Math.max(0, Math.min(255, n)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Mixes a colour toward white by `amount` (0..1). */
export function tint(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({
    r: r + (255 - r) * amount,
    g: g + (255 - g) * amount,
    b: b + (255 - b) * amount,
  });
}

/** Mixes a colour toward black by `amount` (0..1). */
export function shade(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({ r: r * (1 - amount), g: g * (1 - amount), b: b * (1 - amount) });
}

/**
 * The colour a logo is mostly drawn in, ignoring the white and near-grey
 * pixels of its background and anti-aliasing. Null when there is no
 * saturated colour (a black wordmark), so the caller can fall back.
 */
export async function logoColor(logo: Buffer): Promise<string | null> {
  const { data, info } = await sharp(logo)
    .resize(64, 64, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const a = data[i + 3] ?? 255;
    if (a < 128) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 40 || max < 50) continue; // grey, white or black
    const key = `${String(r >> 5)}-${String(g >> 5)}-${String(b >> 5)}`;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const best = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  if (!best || best.count < 8) return null;
  return rgbToHex({ r: best.r / best.count, g: best.g / best.count, b: best.b / best.count });
}

// --- the card ----------------------------------------------------------------------

const CARD = { x: 230, y: 80, w: 740, h: 1040, r: 40 };
const PANEL_TOP = 640;

function icon(name: CardChip['icon'], color: string): string {
  // 48×48 line icons, drawn at the chip's icon box.
  const stroke = `fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"`;
  switch (name) {
    case 'key':
      return `<circle cx="16" cy="24" r="9" ${stroke}/><path d="M25 24h18M37 24v7M43 24v5" ${stroke}/>`;
    case 'bolt':
      return `<path d="M27 4 10 27h13l-3 17 18-24H25z" ${stroke}/>`;
    case 'shield':
      return `<path d="M24 4 7 10v12c0 11 7 19 17 22 10-3 17-11 17-22V10z" ${stroke}/><path d="m16 24 6 6 11-12" ${stroke}/>`;
    case 'user':
      return `<circle cx="24" cy="16" r="8" ${stroke}/><path d="M8 42c2-9 8-13 16-13s14 4 16 13" ${stroke}/>`;
    default:
      return `<circle cx="24" cy="24" r="18" ${stroke}/><path d="M24 13v12l8 5" ${stroke}/>`;
  }
}

function backgroundSvg(spec: CardSpec): string {
  const color = spec.color;
  const light = tint(color, 0.55);
  const { x, y, w, h, r } = CARD;
  const rings = Array.from({ length: 14 }, (_, i) => {
    const radius = 90 + i * 46;
    return `<circle cx="160" cy="1060" r="${String(radius)}" /><circle cx="1080" cy="150" r="${String(radius * 0.8)}" />`;
  }).join('');
  const chipY = 900;
  const chipW = 300;
  const chipH = 150;
  const chipXs = [x + w - 40 - chipW, x + 40];
  const chips = chipXs
    .map((cx, index) => {
      const chip = spec.chips[index] as CardChip;
      return `
      <rect x="${String(cx)}" y="${String(chipY + 8)}" width="${String(chipW)}" height="${String(chipH)}" rx="22" fill="#d9dde3"/>
      <rect x="${String(cx)}" y="${String(chipY)}" width="${String(chipW)}" height="${String(chipH)}" rx="22" fill="#ffffff"/>
      <rect x="${String(cx + chipW - 104)}" y="${String(chipY + 31)}" width="88" height="88" rx="18" fill="${tint(color, 0.88)}"/>
      <g transform="translate(${String(cx + chipW - 84)} ${String(chipY + 51)})">${icon(chip.icon, color)}</g>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(CARD_SIZE)}" height="${String(CARD_SIZE)}" viewBox="0 0 ${String(CARD_SIZE)} ${String(CARD_SIZE)}">
  <defs>
    <clipPath id="card"><rect x="${String(x)}" y="${String(y)}" width="${String(w)}" height="${String(h)}" rx="${String(r)}"/></clipPath>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="18"/></filter>
  </defs>
  <rect width="100%" height="100%" fill="#eef0f3"/>
  <g fill="none" stroke="#ffffff" stroke-width="12" opacity="0.75">${rings}</g>
  <rect x="${String(x + 6)}" y="${String(y + 22)}" width="${String(w - 12)}" height="${String(h)}" rx="${String(r)}" fill="#1f2937" opacity="0.18" filter="url(#soft)"/>
  <g clip-path="url(#card)">
    <rect x="${String(x)}" y="${String(y)}" width="${String(w)}" height="${String(h)}" fill="#ffffff"/>
    <path d="M${String(x)} ${String(PANEL_TOP - 36)} C ${String(x + 220)} ${String(PANEL_TOP - 96)}, ${String(x + 520)} ${String(PANEL_TOP - 96)}, ${String(x + w)} ${String(PANEL_TOP - 30)} V ${String(y + h)} H ${String(x)} Z" fill="${light}"/>
    <path d="M${String(x)} ${String(PANEL_TOP)} C ${String(x + 220)} ${String(PANEL_TOP - 56)}, ${String(x + 520)} ${String(PANEL_TOP - 56)}, ${String(x + w)} ${String(PANEL_TOP + 6)} V ${String(y + h)} H ${String(x)} Z" fill="${color}"/>
    ${chips}
  </g>
  <rect x="${String(CARD_SIZE / 2 - 64)}" y="${String(y + 30)}" width="128" height="26" rx="13" fill="#e2e5ea"/>
  <path d="M${String(x + 50)} ${String(y - 14)} h150 v176 l-75 -34 l-75 34 z" fill="#9aa1ab"/>
  <path d="M${String(x + 50)} ${String(y - 14)} l-22 22 h22 z" fill="#6b7280"/>
</svg>`;
}

export async function renderCard(spec: CardSpec): Promise<RenderedCard> {
  const notes: string[] = [];
  if (!fontsAvailable()) {
    notes.push(
      'Tajawal font files are not in apps/api/assets/fonts; the card used the server default font.',
    );
  }
  const layers: sharp.OverlayOptions[] = [];
  const { x, w } = CARD;

  // Logo, or the brand name in its colour.
  const logoBox = { left: x + 90, top: 250, width: w - 180, height: 290 };
  if (spec.logo) {
    const logo = await sharp(spec.logo)
      .resize(logoBox.width, logoBox.height, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer({ resolveWithObject: true });
    layers.push({
      input: logo.data,
      left: Math.round(logoBox.left + (logoBox.width - logo.info.width) / 2),
      top: Math.round(logoBox.top + (logoBox.height - logo.info.height) / 2),
    });
  } else if (spec.brandName) {
    const name = await fitText({
      text: spec.brandName,
      start: 120,
      min: 48,
      color: spec.color,
      width: logoBox.width,
      height: logoBox.height,
      weight: 'black',
    });
    layers.push({
      input: name.data,
      left: Math.round(logoBox.left + (logoBox.width - name.width) / 2),
      top: Math.round(logoBox.top + (logoBox.height - name.height) / 2),
    });
  }

  // Title, white on the brand colour.
  const titleBox = { left: x + 60, top: PANEL_TOP + 40, width: w - 120, height: 190 };
  const title = await fitText({
    text: spec.title,
    start: 66,
    min: 34,
    color: '#ffffff',
    width: titleBox.width,
    height: titleBox.height,
    weight: 'black',
  });
  layers.push({
    input: title.data,
    left: Math.round(titleBox.left + (titleBox.width - title.width) / 2),
    top: Math.round(titleBox.top + (titleBox.height - title.height) / 2),
  });

  // Ribbon text, white on grey.
  if (spec.ribbon.length > 0) {
    const ribbon = await fitText({
      text: spec.ribbon.slice(0, 3).join('\n'),
      start: 38,
      min: 20,
      color: '#ffffff',
      width: 130,
      height: 112,
      weight: 'bold',
    });
    layers.push({
      input: ribbon.data,
      left: Math.round(x + 50 + (150 - ribbon.width) / 2),
      top: Math.round(CARD.y - 2 + (112 - ribbon.height) / 2),
    });
  }

  // Chip labels, beside each chip's icon.
  const chipXs = [x + w - 40 - 300, x + 40];
  for (const [index, chip] of spec.chips.entries()) {
    const label = await fitText({
      text: chip.label,
      start: 38,
      min: 22,
      color: '#1f2937',
      width: 170,
      height: 120,
      weight: 'black',
    });
    const left = chipXs[index] ?? 0;
    layers.push({
      input: label.data,
      left: Math.round(left + 16 + (170 - label.width) / 2),
      top: Math.round(900 + (150 - label.height) / 2),
    });
  }

  const webp = await sharp(Buffer.from(backgroundSvg(spec)))
    .composite(layers)
    .webp({ quality: 88, effort: 5 })
    .toBuffer();
  return { webp, notes };
}

/** Default ribbon lines from a variant's terms, as the legacy cards read. */
export function defaultRibbon(input: {
  licensePeriodUnit: string;
  licensePeriodValue: number | null;
  deviceCount: number;
}): string[] {
  if (input.deviceCount > 1)
    return [String(input.deviceCount), input.deviceCount <= 10 ? 'أجهزة' : 'جهاز'];
  if (input.licensePeriodUnit === 'LIFETIME') return ['مدى', 'الحياة'];
  const n = input.licensePeriodValue ?? 1;
  if (input.licensePeriodUnit === 'YEAR')
    return n === 1 ? ['سنة', 'واحدة'] : [String(n), n <= 10 ? 'سنوات' : 'سنة'];
  if (input.licensePeriodUnit === 'MONTH')
    return n === 1 ? ['شهر', 'واحد'] : [String(n), n <= 10 ? 'أشهر' : 'شهراً'];
  return [String(n), 'يوم'];
}
