import sharp from 'sharp';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CardDefaults,
  type CardPreview,
  type CardSpecInput,
  type LogoColor,
  type ProductImages,
  type SaveCard,
  cardIconSchema,
} from '@da/contracts';
import { Locale } from '@da/db';
import { z } from 'zod';

import { say } from '../../common/panel-locale.js';
import { UnreadableImageError, decodeDataUrl } from '../../media/image.js';
import { MediaService } from '../../media/media.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SupplierAiService } from '../ai/supplier-ai.service.js';

import { defaultRibbon, fontsAvailable, logoColor, renderCard } from './card.js';

/** The store's own teal, for a brand with no logo colour to borrow. */
const FALLBACK_COLOR = '#087f70';

const suggestionSchema = z.object({
  title: z.string().trim().min(1).max(80),
  ribbon: z.array(z.string().trim().min(1).max(14)).max(3),
  chips: z
    .array(z.object({ label: z.string().trim().min(1).max(24), icon: cardIconSchema.catch('key') }))
    .length(2),
});

const SUGGEST_SYSTEM =
  'You write the few words printed on a product gift-card image for Digital Activation, an Arabic-first software licence store. Short, factual, no invented claims. Answer with one JSON object only.';

const SUGGEST_SHAPE = [
  'Return {"title": product name for the card, at most 28 characters, Latin script as printed on the box,',
  ' "ribbon": 1 to 3 very short Arabic lines for the corner ribbon, such as ["مدى","الحياة"] or ["5","أجهزة"],',
  ' "chips": [{"label": two Arabic words, "icon": one of clock, bolt, key, shield, user}, {"label": ..., "icon": ...}]}.',
  'The chips name two true benefits, such as instant delivery (تسليم فوري) and a genuine key (مفتاح أصلي) or account (حساب أصلي).',
].join('\n');

/**
 * The product card picture (CR-0004): defaults from the product, an optional
 * AI suggestion for the words, a preview, and saving through the ordinary
 * image upload — so the card is processed, stored, alt-texted and audited
 * exactly like a picture somebody uploaded.
 */
@Injectable()
export class CardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly ai: SupplierAiService,
  ) {}

  private async product(slug: string) {
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      include: {
        translations: { select: { locale: true, name: true } },
        brand: { include: { logo: { select: { key: true } } } },
        variants: { orderBy: [{ isDefault: 'desc' }, { position: 'asc' }], take: 1 },
        _count: { select: { media: true } },
      },
    });
    if (!product) throw new NotFoundException(say('لا يوجد منتج بهذا الرابط.', 'No such product.'));
    return product;
  }

  /** The brand logo's bytes from the public bucket, or null. */
  private async logoBytes(key: string | undefined): Promise<Buffer | null> {
    const base = process.env.S3_PUBLIC_BASE_URL;
    if (!key || !base) return null;
    try {
      const response = await fetch(`${base}/${key}`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return null;
      return Buffer.from(await response.arrayBuffer());
    } catch {
      return null;
    }
  }

  async defaults(slug: string): Promise<CardDefaults> {
    const product = await this.product(slug);
    const logo = await this.logoBytes(product.brand?.logo?.key);
    const variant = product.variants[0];
    const en = product.translations.find((t) => t.locale === Locale.EN)?.name;
    const ar = product.translations.find((t) => t.locale === Locale.AR)?.name;
    const account = product.kind === 'ACCOUNT';
    const color = logo ? await logoColor(logo).catch(() => null) : null;
    const spec: CardSpecInput = {
      // The legacy cards carry the English name: it is what is printed on the box.
      title: (en ?? ar ?? product.slug).slice(0, 80),
      ribbon: variant ? defaultRibbon(variant) : [],
      chips: [
        { label: 'تسليم فوري', icon: 'clock' },
        { label: account ? 'حساب أصلي' : 'مفتاح أصلي', icon: account ? 'user' : 'shield' },
      ],
      color: color ?? FALLBACK_COLOR,
      useLogo: logo !== null,
    };
    return {
      spec,
      brandName: product.brand?.name ?? null,
      hasLogo: logo !== null,
      fontsAvailable: fontsAvailable(),
      hasImages: product._count.media > 0,
    };
  }

  /** The model proposes the card's words; the colour and logo stay as they are. */
  async suggest(slug: string, current: CardSpecInput): Promise<CardSpecInput> {
    const product = await this.product(slug);
    const names = product.translations.map((t) => `${t.locale}: ${t.name}`).join('; ');
    const variant = product.variants[0];
    const terms = variant
      ? `Terms: ${variant.licensePeriodUnit === 'LIFETIME' ? 'lifetime' : `${String(variant.licensePeriodValue ?? 1)} ${variant.licensePeriodUnit}`}, ${String(variant.deviceCount)} device(s)`
      : '';
    const answer = suggestionSchema.parse(
      await this.ai.completeJson(
        SUGGEST_SYSTEM,
        [
          `Product names: ${names}`,
          `Brand: ${product.brand?.name ?? 'unknown'}`,
          terms,
          '',
          SUGGEST_SHAPE,
        ].join('\n'),
        600,
      ),
    );
    return {
      ...current,
      title: answer.title,
      ribbon: answer.ribbon,
      chips: [answer.chips[0] ?? current.chips[0], answer.chips[1] ?? current.chips[1]],
    };
  }

  private async render(slug: string, spec: CardSpecInput) {
    const product = await this.product(slug);
    // A logo uploaded for this card wins over the brand's; it is used only
    // for the drawing, never stored on its own.
    const logo = spec.logoDataUrl
      ? await uploadedLogo(spec.logoDataUrl)
      : spec.useLogo
        ? await this.logoBytes(product.brand?.logo?.key)
        : null;
    const card = await renderCard({
      title: spec.title,
      ribbon: spec.ribbon,
      chips: spec.chips,
      color: spec.color,
      logo,
      brandName: product.brand?.name ?? null,
    });
    return { product, card };
  }

  /** The main colour of an uploaded logo, for the card's colour field. */
  async uploadedLogoColor(dataUrl: string): Promise<LogoColor> {
    return { color: await logoColor(await uploadedLogo(dataUrl)) };
  }

  async preview(slug: string, spec: CardSpecInput): Promise<CardPreview> {
    const { card } = await this.render(slug, spec);
    return { dataUrl: `data:image/webp;base64,${card.webp.toString('base64')}`, notes: card.notes };
  }

  async save(slug: string, input: SaveCard, actorId: string | undefined): Promise<ProductImages> {
    const { product, card } = await this.render(slug, input);
    const ar = product.translations.find((t) => t.locale === Locale.AR)?.name ?? input.title;
    const en = product.translations.find((t) => t.locale === Locale.EN)?.name ?? input.title;
    return this.media.upload(
      slug,
      {
        dataUrl: `data:image/webp;base64,${card.webp.toString('base64')}`,
        filename: `${slug}-card.webp`,
        alt: { ar: `بطاقة ${ar}`.slice(0, 300), en: `${en} card`.slice(0, 300) },
        isHero: input.isHero || product._count.media === 0,
      },
      actorId,
    );
  }
}

/** What an uploaded logo may be, read from its bytes. */
const LOGO_FORMATS = new Set(['png', 'jpeg', 'webp']);

/**
 * An uploaded logo's bytes, checked to be an image sharp can read before it
 * reaches the renderer, so a bad file is a clear refusal rather than a 500.
 */
async function uploadedLogo(dataUrl: string): Promise<Buffer> {
  try {
    const bytes = decodeDataUrl(dataUrl);
    const meta = await sharp(bytes).metadata();
    // The content decides, not the label: SVG text sent as "image/png" is
    // still SVG to sharp, and only raster logos are accepted (REV-0168).
    if (!LOGO_FORMATS.has(meta.format ?? '')) {
      throw new UnreadableImageError(`unsupported format ${meta.format ?? 'unknown'}`);
    }
    if (!meta.width || !meta.height) throw new UnreadableImageError('no dimensions');
    return bytes;
  } catch (error) {
    throw new BadRequestException(
      say(
        `تعذّرت قراءة الشعار المرفوع: ${error instanceof Error ? error.message : ''}`,
        `The uploaded logo could not be read: ${error instanceof Error ? error.message : ''}`,
      ),
    );
  }
}
