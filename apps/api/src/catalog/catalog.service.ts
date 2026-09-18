import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type CatalogBrand,
  type CatalogCard,
  type CatalogCollection,
  type CatalogProduct,
  type CatalogProductWithRelated,
  type CatalogQuery,
  type CatalogVariant,
  type Home,
  type HomeRail,
  blockDocumentSchema,
  faqItemsSchema,
  RAIL_MIN_PRODUCTS,
  RAIL_SIZE,
  RELATED_SIZE,
  BLOG_MORE_SIZE,
  ROUTES,
  type CatalogStore,
  type SitemapFeed,
  SALES_PROOF_THRESHOLD,
} from '@da/contracts';
import { ArticleKind, FulfillmentMode, Locale, Prisma, PublishStatus } from '@da/db';

import { toArticleCard } from '../common/article-card.js';
import { sanitizeBlocks } from '../common/rich-text.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { displayPrice, type FxTable } from './pricing.js';

/**
 * Prisma's Json columns are `unknown` at the type level; parse, do not cast.
 *
 * And sanitise on the way out, not only on the way in. These bodies came from
 * WordPress carrying `<style>`, `<link>` and `<xmp>` tags that the storefront
 * renders through `dangerouslySetInnerHTML` — cleaning them only when somebody
 * saves that product would leave all 73 of them intact indefinitely.
 */
function parseBlocks(value: Prisma.JsonValue | null): CatalogProduct['body'] {
  const parsed = blockDocumentSchema.safeParse(value ?? []);
  return parsed.success ? sanitizeBlocks(parsed.data) : [];
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

  /**
   * Everything on sale, paginated.
   *
   * The one page that has to work before a visitor knows any category name.
   * Sorted by the same `cardOrder` the collection pages use, so "newest" means
   * the same thing everywhere — a store whose sorts disagree with its category
   * sorts is a store where a product appears to move when it has not.
   */
  async store(query: CatalogQuery): Promise<CatalogStore> {
    const locale = this.localeFor(query);
    const status = this.statusFilter(query);

    const total = await this.prisma.client.product.count({ where: status });
    const products = await this.prisma.client.product.findMany({
      where: status,
      orderBy: this.productOrder(query),
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
      include: this.cardInclude(locale).product.include,
    });

    // Only the categories that actually hold something published: an empty
    // filter chip is a dead end a visitor has to discover by clicking it.
    const categories = await this.prisma.client.category.findMany({
      where: { products: { some: { product: status } } },
      orderBy: [{ position: 'asc' }, { slug: 'asc' }],
      include: {
        translations: { where: { locale } },
        products: { where: { product: status }, select: { productId: true } },
      },
    });

    const fx = await this.fxTable();

    return {
      products: products.map((product) => this.toCard(product, query.currency, fx)),
      total,
      page: query.page,
      perPage: query.perPage,
      collections: categories.map((category) => ({
        slug: category.slug,
        name: category.translations[0]?.name ?? category.slug,
        productCount: category.products.length,
      })),
    };
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

    /**
     * The rail. Top level only and stocked only, which is the same rule the
     * store index and the header menu apply — three places showing three
     * different category lists would be three answers to one question.
     */
    const siblings = await this.prisma.client.category
      .findMany({
        where: { parentId: null },
        orderBy: [{ position: 'asc' }, { slug: 'asc' }],
        include: {
          translations: { where: { locale } },
          products: { where: { product: status }, select: { productId: true } },
        },
      })
      .then((rows) =>
        rows.map((row) => ({
          slug: row.slug,
          name: row.translations[0]?.name ?? row.slug,
          productCount: row.products.length,
        })),
      );

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
      siblings: siblings
        .filter((entry) => entry.productCount > 0)
        .map((entry) => ({
          slug: entry.slug,
          name: entry.name,
          productCount: entry.productCount,
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

  // --- brand ----------------------------------------------------------------

  /**
   * One maker's shelf.
   *
   * The link has been on every product page and in the home page's brand strip
   * since the storefront was built, and there was nothing behind it: 71 of the
   * 72 published products carried a brand line that led to a 404.
   *
   * Not modelled on the collection. A brand has no tree, so there is no child
   * list and no parent breadcrumb to build; what a visitor wants sideways from
   * Norton is Adobe, not a sub-Norton. `intro` is the field the schema already
   * reserved for this page's body, unused until now — so a brand with nothing
   * written renders its grid and no empty prose block, rather than a heading
   * over white space.
   */
  async brand(slug: string, query: CatalogQuery): Promise<CatalogBrand> {
    const locale = this.localeFor(query);
    const status = this.statusFilter(query);

    const brand = await this.prisma.client.brand.findUnique({
      where: { slug },
      include: {
        translations: { where: { locale } },
        logo: { include: { alts: { where: { locale } } } },
      },
    });

    if (!brand) throw new NotFoundException(`No brand with slug "${slug}"`);

    const translation = brand.translations[0];
    const where = { brandId: brand.id, ...status };

    const total = await this.prisma.client.product.count({ where });
    const products = await this.prisma.client.product.findMany({
      where,
      orderBy: this.productOrder(query),
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
      include: this.cardInclude(locale).product.include,
    });

    const fx = await this.fxTable();

    // Only brands that have something published. An inactive maker still in
    // the table (this catalog has two with zero products) is a link to an
    // empty shelf, and a visitor discovers that by clicking it.
    const siblings = await this.prisma.client.brand.findMany({
      where: { id: { not: brand.id }, isActive: true, products: { some: status } },
      orderBy: [{ position: 'asc' }, { slug: 'asc' }],
      include: {
        translations: { where: { locale } },
        _count: { select: { products: { where: status } } },
      },
    });

    return {
      slug: brand.slug,
      locale: query.locale,
      name: translation?.name ?? brand.name,
      website: brand.website,
      logo: brand.logo
        ? {
            url: this.assetUrl(brand.logo.key),
            alt: brand.logo.alts[0]?.alt ?? (translation?.name ?? brand.name),
            width: brand.logo.width,
            height: brand.logo.height,
          }
        : null,
      intro: parseBlocks(translation?.intro ?? null),
      breadcrumbs: [
        { name: locale === Locale.AR ? 'الرئيسية' : 'Home', href: ROUTES.home },
        { name: locale === Locale.AR ? 'المتجر' : 'Store', href: ROUTES.store },
        { name: translation?.name ?? brand.name, href: ROUTES.brand(brand.slug) },
      ],
      siblings: siblings.map((entry) => ({
        slug: entry.slug,
        name: entry.translations[0]?.name ?? entry.name,
        productCount: entry._count.products,
      })),
      seo: {
        title: translation?.seoTitle ?? null,
        description: translation?.seoDescription ?? null,
      },
      products: products.map((product) => this.toCard(product, query.currency, fx)),
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

    const [categories, brands, productCount, bestSellers, newest, posts] = await Promise.all([
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
      /**
       * The newest posts, published only.
       *
       * No draft here even under a preview token, unlike every other list on
       * this page: the rest of the home page is catalog somebody is staging,
       * and an unfinished article on the front page is a different kind of
       * mistake from an unfinished product card.
       *
       * No cross-locale fallback either, for the same reason `/blog` has none.
       * The imported posts are Arabic; an English home page showing Arabic
       * headlines under "Latest articles" would promise a translation that
       * does not exist, so the row is simply absent there.
       */
      this.prisma.client.article.findMany({
        where: {
          kind: ArticleKind.POST,
          locale,
          status: PublishStatus.PUBLISHED,
        },
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        take: BLOG_MORE_SIZE,
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
      posts: posts.map(toArticleCard),
      productCount,
      isPreview: status.status === undefined,
    };
  }

  // --- product --------------------------------------------------------------

  async product(slug: string, query: CatalogQuery): Promise<CatalogProductWithRelated> {
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

    /**
     * The rest of the shelf.
     *
     * Ordered by the category's own `position` so it matches the order the
     * collection page puts them in — a visitor who clicks through from this row
     * to the category should not find the same products in a different order
     * and wonder whether they are looking at the same list.
     *
     * Draft rows follow the same status filter as everything else, so a preview
     * host shows drafts in the row and production never does. And this product
     * is excluded from its own row, which is the one recommendation nobody
     * needs.
     */
    const related: CatalogCard[] = [];
    if (primary) {
      const siblings = await this.prisma.client.productCategory.findMany({
        where: {
          categoryId: primary.id,
          productId: { not: product.id },
          product: this.statusFilter(query),
        },
        orderBy: { position: 'asc' },
        take: RELATED_SIZE,
        include: this.cardInclude(locale),
      });
      for (const link of siblings) related.push(this.toCard(link.product, query.currency, fx));
    }

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

    /**
     * Posts that name this product.
     *
     * A scalar-array containment query rather than a join table, because that
     * is what `Article.relatedProductIds` is. Published only, and in the
     * product's own locale: an Arabic product page offering an English article
     * would be offering a page that does not exist.
     */
    const articles = await this.prisma.client.article.findMany({
      where: {
        kind: ArticleKind.POST,
        status: PublishStatus.PUBLISHED,
        locale,
        relatedProductIds: { has: product.id },
      },
      orderBy: [{ publishedAt: 'desc' }],
      take: BLOG_MORE_SIZE,
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
      warnings: parseWarnings(translation?.warnings ?? null),
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
      // The denormalised pair, rewritten by the reviews module from approved
      // rows on every moderation decision. Null below one, so a product with
      // nothing published shows no stars rather than zero of them — an
      // invented rating is what earned the legacy store its 565 synthetic
      // reviews, and an empty one is a Google penalty rather than a neutral.
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
      related,
      articles: articles.map(toArticleCard),
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

    // Same rule as a category: a maker with nothing published renders an empty
    // shelf, and this catalog has two of those.
    const brands = await this.prisma.client.brand.findMany({
      where: { isActive: true, products: { some: { status: PublishStatus.PUBLISHED } } },
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
      brands: brands.map((brand) => ({
        path: ROUTES.brand(brand.slug),
        lastModified: brand.updatedAt.toISOString(),
      })),
    };
  }

  private assetUrl(key: string): string {
    const base = process.env.S3_PUBLIC_BASE_URL;
    return base ? new URL(key, base).toString() : `/media/${key}`;
  }

  /**
   * The same sorts as `cardOrder`, expressed over Product rows.
   *
   * Price is missing from both on purpose: a product's price is the cheapest of
   * its variants, which Postgres cannot order by without a join and an
   * aggregate. Sorting a page of 24 in memory would order that page and not the
   * catalog, which is worse than not offering it — so the storefront offers the
   * three sorts that are real.
   */
  private productOrder(query: CatalogQuery): Prisma.ProductOrderByWithRelationInput[] {
    switch (query.sort) {
      case 'newest':
        return [{ publishedAt: 'desc' }, { slug: 'asc' }];
      case 'best-selling':
        return [{ salesCount: 'desc' }, { slug: 'asc' }];
      default:
        return [{ salesCount: 'desc' }, { slug: 'asc' }];
    }
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

  /**
   * Cards for a set of ids, keyed by id.
   *
   * Exists for search, which ranks ids and then needs them drawn. Going back
   * through the catalog rather than building a card in the search service is
   * the whole point: price, stock, the golden-warranty flag and the currency
   * conversion are decided in one place, so a result and the grid it links to
   * cannot disagree about what something costs.
   */
  async cardsByIds(ids: string[], query: CatalogQuery): Promise<Map<string, CatalogCard>> {
    if (ids.length === 0) return new Map();

    const locale = this.localeFor(query);
    const products = await this.prisma.client.product.findMany({
      where: { id: { in: ids }, ...this.statusFilter(query) },
      include: this.cardInclude(locale).product.include,
    });

    const fx = await this.fxTable();
    return new Map(
      products.map((product) => [product.id, this.toCard(product, query.currency, fx)]),
    );
  }

  /**
   * Cards for a set of products, in the order asked for.
   *
   * Public because the account area needs to draw the same tile the catalog
   * draws — the price in the reader's currency, the hero image, the stock line
   * — and the alternative was a second card builder that would disagree with
   * this one about a sale price within a month.
   *
   * Published only: a suggestion is a link, and a link to a draft is a 404.
   *
   * Keyed by product id rather than returned as a list, because an unpublished
   * one simply is not in the answer — and a caller matching a list back to its
   * own ranking by position would silently attach the wrong reason to the
   * wrong product the first time that happened.
   */
  async cardsForProducts(
    productIds: string[],
    query: CatalogQuery,
  ): Promise<Map<string, CatalogCard>> {
    if (productIds.length === 0) return new Map();

    const locale = query.locale === 'en' ? Locale.EN : Locale.AR;
    const [products, fx] = await Promise.all([
      this.prisma.client.product.findMany({
        where: { id: { in: productIds }, status: PublishStatus.PUBLISHED },
        include: this.cardInclude(locale).product.include,
      }),
      this.fxTable(),
    ]);

    return new Map(
      products.map((product) => [product.id, this.toCard(product, query.currency, fx)]),
    );
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
      // Offered for one-click adding only where there is genuinely nothing to
      // choose. `buyable` is already the list that can be sold right now, so a
      // product whose second variant is out of stock still qualifies.
      buyableVariantId: buyable.length === 1 ? (buyable[0]?.variant.id ?? null) : null,
      hasGoldenWarranty: product.hasGoldenWarranty,
      // Below the floor a count is noise, not proof.
      salesCount: product.salesCount >= SALES_PROOF_THRESHOLD ? product.salesCount : 0,
      brand: product.brand?.translations[0]?.name ?? product.brand?.name ?? null,
      isDraft: product.status !== PublishStatus.PUBLISHED,
    };
  }
}

/**
 * Product warnings, as the page shows them.
 *
 * Anything without text is dropped rather than rendered empty: a warning box
 * containing nothing reads as a warning the shopper failed to understand.
 */
function parseWarnings(value: unknown): { text: string; severity: 'note' | 'critical' }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    if (text === '') return [];
    return [{ text, severity: record.severity === 'critical' ? 'critical' : 'note' }];
  });
}
