import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type CatalogCard,
  type CatalogCollection,
  type CatalogProduct,
  type CatalogQuery,
  type CatalogVariant,
  type Home,
  type HomeRail,
  blockDocumentSchema,
  faqItemsSchema,
  RAIL_MIN_PRODUCTS,
  RAIL_SIZE,
  ROUTES,
  type SitemapFeed,
  SALES_PROOF_THRESHOLD,
} from '@da/contracts';
import { FulfillmentMode, Locale, Prisma, PublishStatus } from '@da/db';

import { PrismaService } from '../prisma/prisma.service.js';

import { displayPrice, type FxTable } from './pricing.js';

/** Prisma's Json columns are `unknown` at the type level; parse, do not cast. */
function parseBlocks(value: Prisma.JsonValue | null): CatalogProduct['body'] {
  const parsed = blockDocumentSchema.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

function parseFaq(value: Prisma.JsonValue | null): CatalogProduct['faq'] {
  if (value === null) return null;
  const parsed = faqItemsSchema.safeParse(value);
  return parsed.success && parsed.data.length > 0 ? parsed.data : null;
}

function parseSteps(value: Prisma.JsonValue | null): CatalogProduct['activationSteps'] {
  if (value === null) return null;
  if (!Array.isArray(value)) return null;
  const steps: NonNullable<CatalogProduct['activationSteps']> = [];
  for (const [index, entry] of value.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.text !== 'string') continue;
    steps.push({
      step: typeof record.step === 'number' ? record.step : index + 1,
      text: record.text,
      ...(typeof record.assetId === 'string' ? { assetId: record.assetId } : {}),
    });
  }
  return steps.length > 0 ? steps : null;
}

/**
 * Whether stock is a question worth asking about this variant.
 *
 * Only a FROM_STOCK line has a shelf to count. An ON_DEMAND or MANUAL_SETUP
 * line is bought from a supplier after the customer pays, so it is always
 * sellable — and reading its empty inventory as zero is what made 67 of 72
 * products advertise themselves as out of stock when none of them were.
 */
function isStocked(variant: { fulfillmentMode: FulfillmentMode }): boolean {
  return variant.fulfillmentMode === FulfillmentMode.FROM_STOCK;
}

/** Sellable count for a stocked variant: on hand minus what carts hold. */
function sellable(variant: { inventory: { onHand: number; reserved: number } | null }): number {
  return Math.max(0, (variant.inventory?.onHand ?? 0) - (variant.inventory?.reserved ?? 0));
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Draft products are reachable only with the preview token, and the
   * storefront only sends it while running on a host that is not indexable.
   * A staging site showing drafts is what staging is for; production shows
   * published only, and that asymmetry is enforced here rather than trusted to
   * the caller.
   */
  private statusFilter(query: CatalogQuery): { status?: PublishStatus } {
    const token = process.env.PREVIEW_TOKEN;
    const allowDrafts = Boolean(token && query.preview && query.preview === token);
    return allowDrafts ? {} : { status: PublishStatus.PUBLISHED };
  }

  private async fxTable(): Promise<FxTable> {
    const currencies = await this.prisma.client.currency.findMany({
      where: { isActive: true },
      include: { rates: { orderBy: { fetchedAt: 'desc' }, take: 1 } },
    });

    const table: FxTable = {};
    for (const currency of currencies) {
      const latest = currency.rates[0];
      if (!latest) continue;
      table[currency.code] = {
        rate: latest.rate,
        decimals: currency.decimals,
        roundingRule: currency.roundingRule,
      };
    }
    return table;
  }

  private localeFor(query: CatalogQuery): Locale {
    return query.locale === 'en' ? Locale.EN : Locale.AR;
  }

  // --- collections ----------------------------------------------------------

  async collections(query: CatalogQuery): Promise<
    {
      slug: string;
      name: string;
      headline: string | null;
      productCount: number;
      children: number;
    }[]
  > {
    const locale = this.localeFor(query);
    const status = this.statusFilter(query);

    const categories = await this.prisma.client.category.findMany({
      orderBy: [{ position: 'asc' }, { slug: 'asc' }],
      include: {
        translations: { where: { locale } },
        _count: { select: { children: true } },
        products: { where: { product: status }, select: { productId: true } },
      },
    });

    return categories.map((category) => ({
      slug: category.slug,
      name: category.translations[0]?.name ?? category.slug,
      headline: category.translations[0]?.headline ?? null,
      productCount: category.products.length,
      children: category._count.children,
    }));
  }

  async collection(slug: string, query: CatalogQuery): Promise<CatalogCollection> {
    const locale = this.localeFor(query);
    const status = this.statusFilter(query);

    const category = await this.prisma.client.category.findUnique({
      where: { slug },
      include: {
        translations: { where: { locale } },
        parent: { include: { translations: { where: { locale } } } },
        children: {
          orderBy: { position: 'asc' },
          include: {
            translations: { where: { locale } },
            products: { where: { product: status }, select: { productId: true } },
          },
        },
      },
    });

    if (!category) throw new NotFoundException(`No collection with slug "${slug}"`);

    const translation = category.translations[0];
    const total = await this.prisma.client.productCategory.count({
      where: { categoryId: category.id, product: status },
    });

    const links = await this.prisma.client.productCategory.findMany({
      where: { categoryId: category.id, product: status },
      orderBy: this.cardOrder(query),
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
      include: this.cardInclude(locale),
    });

    const fx = await this.fxTable();

    const breadcrumbs: CatalogCollection['breadcrumbs'] = [
      { name: locale === Locale.AR ? 'الرئيسية' : 'Home', href: ROUTES.home },
      { name: locale === Locale.AR ? 'المتجر' : 'Store', href: ROUTES.store },
    ];
    if (category.parent) {
      breadcrumbs.push({
        name: category.parent.translations[0]?.name ?? category.parent.slug,
        href: ROUTES.collection(category.parent.slug),
      });
    }
    breadcrumbs.push({
      name: translation?.name ?? category.slug,
      href: ROUTES.collection(category.slug),
    });

    return {
      slug: category.slug,
      locale: query.locale,
      name: translation?.name ?? category.slug,
      headline: translation?.headline ?? null,
      body: parseBlocks(translation?.body ?? null),
      faq: parseFaq(translation?.faq ?? null),
      breadcrumbs,
      children: category.children.map((child) => ({
        slug: child.slug,
        name: child.translations[0]?.name ?? child.slug,
        productCount: child.products.length,
      })),
      seo: {
        title: translation?.seoTitle ?? null,
        description: translation?.seoDescription ?? null,
      },
      products: links.map((link) => this.toCard(link.product, query.currency, fx)),
      total,
      page: query.page,
      perPage: query.perPage,
    };
  }

  // --- home -----------------------------------------------------------------

  /**
   * Everything the home page renders, in one query pass.
   *
   * Two rules hold this together. Nothing is padded: a category with fewer
   * than RAIL_MIN_PRODUCTS products is dropped rather than shown as a ragged
   * row, because a row with one card in it reads as a broken page. And nothing
   * is invented: the counts, the brands and the "best selling" order all come
   * out of the catalog, so the page cannot advertise a range that is not there.
   */
  async home(query: CatalogQuery): Promise<Home> {
    const locale = this.localeFor(query);
    const status = this.statusFilter(query);
    const fx = await this.fxTable();

    const [categories, brands, productCount, bestSellers, newest] = await Promise.all([
      this.prisma.client.category.findMany({
        // Top level only. A rail per leaf category would be forty rows.
        where: { parentId: null },
        orderBy: [{ position: 'asc' }, { slug: 'asc' }],
        include: {
          translations: { where: { locale } },
          products: {
            where: { product: status },
            orderBy: [{ position: 'asc' }],
            include: this.cardInclude(locale),
          },
        },
      }),
      this.prisma.client.brand.findMany({
        orderBy: [{ position: 'asc' }, { slug: 'asc' }],
        include: {
          translations: { where: { locale } },
          _count: { select: { products: { where: status } } },
        },
      }),
      this.prisma.client.product.count({ where: status }),
      this.prisma.client.product.findMany({
        where: { ...status, salesCount: { gte: SALES_PROOF_THRESHOLD } },
        orderBy: { salesCount: 'desc' },
        take: RAIL_SIZE * 2,
        include: this.cardInclude(locale).product.include,
      }),
      this.prisma.client.product.findMany({
        where: status,
        // A draft has no publishedAt, so preview falls back to creation order.
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        take: RAIL_SIZE * 2,
        include: this.cardInclude(locale).product.include,
      }),
    ]);

    const links = categories.map((category) => ({
      slug: category.slug,
      name: category.translations[0]?.name ?? category.slug,
      headline: category.translations[0]?.headline ?? null,
      href: ROUTES.collection(category.slug),
      productCount: category.products.length,
    }));

    const rails: HomeRail[] = categories
      .map((category, index) => ({
        ...links[index],
        slug: category.slug,
        name: category.translations[0]?.name ?? category.slug,
        headline: category.translations[0]?.headline ?? null,
        href: ROUTES.collection(category.slug),
        productCount: category.products.length,
        products: category.products
          .slice(0, RAIL_SIZE)
          .map((link) => this.toCard(link.product, query.currency, fx)),
      }))
      .filter((rail) => rail.products.length >= RAIL_MIN_PRODUCTS);

    return {
      locale: query.locale,
      currency: query.currency,
      categories: links.filter((link) => link.productCount > 0),
      rails,
      bestSellers: bestSellers
        .slice(0, RAIL_SIZE)
        .map((product) => this.toCard(product, query.currency, fx)),
      newest: newest.slice(0, RAIL_SIZE).map((product) => this.toCard(product, query.currency, fx)),
      brands: brands
        .filter((brand) => brand._count.products > 0)
        .map((brand) => ({
          slug: brand.slug,
          name: brand.translations[0]?.name ?? brand.name,
          headline: null,
          href: ROUTES.brand(brand.slug),
          productCount: brand._count.products,
        })),
      productCount,
      isPreview: status.status === undefined,
    };
  }

  // --- product --------------------------------------------------------------

  async product(slug: string, query: CatalogQuery): Promise<CatalogProduct> {
    const locale = this.localeFor(query);
    const status = this.statusFilter(query);

    const product = await this.prisma.client.product.findFirst({
      where: { slug, ...status },
      include: {
        translations: { where: { locale } },
        brand: { include: { translations: { where: { locale } } } },
        variants: {
          where: { status: status.status ? PublishStatus.PUBLISHED : undefined },
          orderBy: { position: 'asc' },
          include: { inventory: true },
        },
        categories: {
          orderBy: { position: 'asc' },
          include: {
            category: {
              include: {
                translations: { where: { locale } },
                parent: { include: { translations: { where: { locale } } } },
              },
            },
          },
        },
        media: {
          orderBy: { position: 'asc' },
          include: { asset: { include: { alts: { where: { locale } } } } },
        },
      },
    });

    if (!product) throw new NotFoundException(`No product with slug "${slug}"`);
    if (product.variants.length === 0) {
      throw new NotFoundException(`Product "${slug}" has no sellable variant`);
    }

    const translation = product.translations[0];
    const fx = await this.fxTable();

    const variants: CatalogVariant[] = product.variants.map((variant) => {
      const stocked = isStocked(variant);

      return {
        id: variant.id,
        sku: variant.sku,
        licensePeriodValue: variant.licensePeriodValue,
        licensePeriodUnit: variant.licensePeriodUnit,
        deviceCount: variant.deviceCount,
        platform: variant.platform,
        activationMethod: variant.activationMethod,
        deliverySlaSeconds: variant.deliverySlaSeconds,
        fulfillmentMode: variant.fulfillmentMode,
        requiresActivationEmail: variant.requiresActivationEmail,
        price: displayPrice(variant.priceUsd, variant.compareAtUsd, query.currency, fx),
        available: stocked ? sellable(variant) : null,
        inStock: stocked ? sellable(variant) > 0 : true,
        isDefault: variant.isDefault,
      };
    });

    // Open on the cheapest variant that can actually be bought. Landing on a
    // sold-out default is how the legacy store greeted its highest-traffic
    // product page with "غير متوفر".
    const inStock = variants.filter((variant) => variant.inStock);
    const pool = inStock.length > 0 ? inStock : variants;
    const selected =
      [...pool].sort((a, b) => Number(a.price.amount) - Number(b.price.amount))[0] ?? pool[0];

    const primary =
      product.categories.find((link) => link.isPrimary)?.category ??
      product.categories[0]?.category;

    const breadcrumbs: CatalogProduct['breadcrumbs'] = [
      { name: locale === Locale.AR ? 'الرئيسية' : 'Home', href: ROUTES.home },
      { name: locale === Locale.AR ? 'المتجر' : 'Store', href: ROUTES.store },
    ];
    if (primary?.parent) {
      breadcrumbs.push({
        name: primary.parent.translations[0]?.name ?? primary.parent.slug,
        href: ROUTES.collection(primary.parent.slug),
      });
    }
    if (primary) {
      breadcrumbs.push({
        name: primary.translations[0]?.name ?? primary.slug,
        href: ROUTES.collection(primary.slug),
      });
    }
    breadcrumbs.push({
      name: translation?.name ?? product.slug,
      href: ROUTES.product(product.slug),
    });

    return {
      slug: product.slug,
      kind: product.kind,
      locale: query.locale,
      name: translation?.name ?? product.slug,
      shortDesc: translation?.shortDesc ?? null,
      body: parseBlocks(translation?.body ?? null),
      faq: parseFaq(translation?.faq ?? null),
      activationSteps: parseSteps(translation?.activationSteps ?? null),
      downloadUrl: translation?.downloadUrl ?? null,
      brand: product.brand
        ? {
            slug: product.brand.slug,
            name: product.brand.translations[0]?.name ?? product.brand.name,
          }
        : null,
      breadcrumbs,
      images: product.media.map((entry) => ({
        url: this.assetUrl(entry.asset.key),
        alt: entry.asset.alts[0]?.alt ?? translation?.name ?? product.slug,
        width: entry.asset.width,
        height: entry.asset.height,
      })),
      hasGoldenWarranty: product.hasGoldenWarranty,
      salesCount: product.salesCount,
      // Emitted only from real, approved, verified-purchase reviews. There are
      // none yet, and an invented rating is what earned the legacy store its
      // 565 synthetic reviews.
      rating:
        product.ratingCount > 0
          ? { value: product.ratingAvg.toFixed(2), count: product.ratingCount }
          : null,
      variants,
      selectedVariantId: selected?.id ?? '',
      seo: {
        title: translation?.seoTitle ?? null,
        description: translation?.seoDescription ?? null,
      },
      isDraft: product.status !== PublishStatus.PUBLISHED,
    };
  }

  // --- helpers --------------------------------------------------------------

  /**
   * Everything the sitemap lists, in one query per kind.
   *
   * Built here rather than in the storefront because the answer depends on
   * publish status and on `updatedAt`, and neither is visible from a page that
   * fetches one product at a time. It carries no prices, no translations and
   * no locale: a sitemap URL is the same URL in both languages, and the
   * hreflang alternates are generated from the path.
   *
   * Draft rows are excluded even when a preview token is present. A preview is
   * for a person looking at unfinished work; a sitemap is a request to index,
   * and asking Google to index a draft is not something a query parameter
   * should be able to do.
   */
  async sitemap(): Promise<SitemapFeed> {
    const products = await this.prisma.client.product.findMany({
      where: { status: PublishStatus.PUBLISHED },
      orderBy: { slug: 'asc' },
      select: {
        slug: true,
        updatedAt: true,
        media: {
          orderBy: { position: 'asc' },
          take: 1,
          select: { asset: { select: { key: true } } },
        },
      },
    });

    // A category with nothing published in it renders an empty page, and an
    // empty page is not worth a crawl — the legacy store's sixteen collection
    // pages went unsubmitted for 178 days, but submitting empty ones would
    // have earned the same nothing for a different reason.
    const categories = await this.prisma.client.category.findMany({
      where: { products: { some: { product: { status: PublishStatus.PUBLISHED } } } },
      orderBy: { slug: 'asc' },
      select: { slug: true, updatedAt: true },
    });

    return {
      products: products.map((product) => {
        const key = product.media[0]?.asset.key;
        return {
          path: ROUTES.product(product.slug),
          lastModified: product.updatedAt.toISOString(),
          // Inline on the page's own URL rather than in a separate image
          // sitemap: Google reads both, and one list that says which page each
          // image belongs to is better than two lists to keep in step.
          ...(key ? { images: [this.assetUrl(key)] } : {}),
        };
      }),
      collections: categories.map((category) => ({
        path: ROUTES.collection(category.slug),
        lastModified: category.updatedAt.toISOString(),
      })),
    };
  }

  private assetUrl(key: string): string {
    const base = process.env.S3_PUBLIC_BASE_URL;
    return base ? new URL(key, base).toString() : `/media/${key}`;
  }

  private cardOrder(query: CatalogQuery): Prisma.ProductCategoryOrderByWithRelationInput[] {
    switch (query.sort) {
      case 'newest':
        return [{ product: { publishedAt: 'desc' } }, { position: 'asc' }];
      case 'best-selling':
        return [{ product: { salesCount: 'desc' } }, { position: 'asc' }];
      default:
        return [{ position: 'asc' }];
    }
  }

  private cardInclude(locale: Locale) {
    return {
      product: {
        include: {
          translations: { where: { locale } },
          brand: { include: { translations: { where: { locale } } } },
          variants: { orderBy: { position: 'asc' as const }, include: { inventory: true } },
          media: {
            where: { isHero: true },
            take: 1,
            include: { asset: { include: { alts: { where: { locale } } } } },
          },
        },
      },
    };
  }

  private toCard(
    product: Prisma.ProductGetPayload<ReturnType<CatalogService['cardInclude']>['product']>,
    currency: string,
    fx: FxTable,
  ): CatalogCard {
    const translation = product.translations[0];

    // Buyable means buyable, which for most of this catalog has nothing to do
    // with a shelf: a made-to-order variant is always buyable, and a stocked
    // one is buyable while it has stock left.
    const priced = product.variants.map((variant) => ({
      variant,
      stocked: isStocked(variant),
      available: isStocked(variant) ? sellable(variant) : null,
      buyable: isStocked(variant) ? sellable(variant) > 0 : true,
    }));

    // The card shows the entry price — the cheapest variant a visitor could
    // actually buy, falling back to the cheapest overall when none can be
    // bought, so a sold-out product still shows what it costs.
    const buyable = priced.filter((entry) => entry.buyable);
    const pool = buyable.length > 0 ? buyable : priced;
    const cheapest =
      [...pool].sort((a, b) => a.variant.priceUsd.comparedTo(b.variant.priceUsd))[0] ?? priced[0];

    // The promise the card makes is the fastest one the product can keep.
    const modes = product.variants.map((variant) => variant.fulfillmentMode);
    const fulfillmentMode = modes.includes(FulfillmentMode.FROM_STOCK)
      ? FulfillmentMode.FROM_STOCK
      : modes.includes(FulfillmentMode.ON_DEMAND)
        ? FulfillmentMode.ON_DEMAND
        : FulfillmentMode.MANUAL_SETUP;

    // "Only N left" is a true statement about a shelf, so it is reported only
    // when there is one. Null for a made-to-order product, which has no count
    // to give and must not have one invented for urgency.
    const stockedEntries = priced.filter((entry) => entry.stocked);
    const available =
      stockedEntries.length > 0
        ? stockedEntries.reduce((total, entry) => total + (entry.available ?? 0), 0)
        : null;

    const hero = product.media[0];

    return {
      slug: product.slug,
      name: translation?.name ?? product.slug,
      shortDesc: translation?.shortDesc ?? null,
      image: hero
        ? {
            url: this.assetUrl(hero.asset.key),
            alt: hero.asset.alts[0]?.alt ?? translation?.name ?? product.slug,
            width: hero.asset.width,
            height: hero.asset.height,
          }
        : null,
      price: cheapest
        ? displayPrice(cheapest.variant.priceUsd, cheapest.variant.compareAtUsd, currency, fx)
        : { amount: '0.00', currency: 'USD', compareAt: null, discountPercent: null },
      inStock: buyable.length > 0,
      available,
      fulfillmentMode,
      variantCount: Math.max(1, product.variants.length),
      hasGoldenWarranty: product.hasGoldenWarranty,
      // Below the floor a count is noise, not proof.
      salesCount: product.salesCount >= SALES_PROOF_THRESHOLD ? product.salesCount : 0,
      brand: product.brand?.translations[0]?.name ?? product.brand?.name ?? null,
      isDraft: product.status !== PublishStatus.PUBLISHED,
    };
  }
}
