import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AdminProductList,
  type AdminProductQuery,
  type AdminProductRow,
  countBodyWords,
  type CredentialKind,
  type ProductCopy,
  type Readiness,
  type SetProductCopy,
} from '@da/contracts';
import { FulfillmentMode, Locale, type Prisma, PublishStatus, StockMovementReason } from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { parseActivationSteps } from '../common/activation-steps.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { VaultService } from '../vault/vault.service.js';

import { say } from '../common/panel-locale.js';
import { assessProduct, bodyText } from './readiness.js';
import { readBody, writeBody } from './rich-text.js';

/**
 * The admin API.
 *
 * Two kinds of message come out of here, and they used to follow different
 * rules. A readiness *detail* describes content in a particular locale; an
 * operational refusal — not ready to publish, no such SKU, stock below what
 * carts hold — is panel chrome. The chrome was Arabic on the grounds that the
 * team reading it was, and the readiness details followed the locale being
 * assessed.
 *
 * Both now follow the reader instead, through `say()` and `panelLocale()`.
 * The old split only held while there was one kind of reader: it meant an
 * English-speaking editor auditing the Arabic catalog got the refusal and the
 * reason in a language they could not act on, which is the same failure the
 * publish gate exists to prevent.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    /**
     * Only to count what the vault already holds before the delivery shape of
     * a variant is changed underneath it. No plaintext crosses this boundary.
     */
    private readonly vault: VaultService,
  ) {}

  private localeFor(query: { locale: string }): Locale {
    return query.locale === 'en' ? Locale.EN : Locale.AR;
  }

  private readonly include = {
    translations: true,
    brand: true,
    variants: { include: { inventory: true } },
    media: { select: { id: true } },
    categories: { where: { isPrimary: true }, include: { category: true } },
  } satisfies Prisma.ProductInclude;

  async list(query: AdminProductQuery): Promise<AdminProductList> {
    const locale = this.localeFor(query);

    const search: Prisma.ProductWhereInput = query.q
      ? {
          OR: [
            { slug: { contains: query.q, mode: 'insensitive' } },
            { translations: { some: { name: { contains: query.q, mode: 'insensitive' } } } },
            { variants: { some: { sku: { contains: query.q, mode: 'insensitive' } } } },
          ],
        }
      : {};

    // "blocked" and "out-of-stock" cannot be expressed as a database filter:
    // readiness is computed and stock is a sum across variants. Those two views
    // filter after loading, which is affordable on a catalog this size and
    // honest about what it is doing.
    const statusWhere: Prisma.ProductWhereInput =
      query.status === 'draft' || query.status === 'ready'
        ? { status: PublishStatus.DRAFT }
        : query.status === 'published'
          ? { status: PublishStatus.PUBLISHED }
          : {};

    const where: Prisma.ProductWhereInput = { AND: [search, statusWhere] };
    const postFilter =
      query.status === 'blocked' || query.status === 'out-of-stock' || query.status === 'ready';

    const products = await this.prisma.client.product.findMany({
      where,
      orderBy: [{ status: 'asc' }, { slug: 'asc' }],
      ...(postFilter ? {} : { skip: (query.page - 1) * query.perPage, take: query.perPage }),
      include: this.include,
    });

    let rows = products.map((product) => this.toRow(product, locale));

    if (query.status === 'blocked') rows = rows.filter((row) => row.blockers > 0);
    // Ready means a draft the publish gate would accept right now. The gate is
    // the same one the publish button consults, so a row listed here cannot be
    // refused by the button beside it.
    if (query.status === 'ready') rows = rows.filter((row) => row.blockers === 0);
    // Out of stock means a product that is held in hand and has none left.
    // A made-to-order product has `stock: null` and cannot be out of stock.
    if (query.status === 'out-of-stock') rows = rows.filter((row) => row.stock === 0);

    const total = postFilter ? rows.length : await this.prisma.client.product.count({ where });

    if (postFilter) {
      rows = rows.slice((query.page - 1) * query.perPage, query.page * query.perPage);
    }

    return {
      rows,
      total,
      page: query.page,
      perPage: query.perPage,
      counts: await this.counts(locale, search),
    };
  }

  /**
   * The chips are filters as well as figures, so they count within the current
   * search rather than across the whole catalog — "39 blocked" next to three
   * search results would be a number nothing on screen agrees with.
   */
  private async counts(
    locale: Locale,
    search: Prisma.ProductWhereInput,
  ): Promise<AdminProductList['counts']> {
    const all = await this.prisma.client.product.findMany({
      where: search,
      include: this.include,
    });
    const rows = all.map((product) => this.toRow(product, locale));

    return {
      all: rows.length,
      draft: rows.filter((row) => row.status === 'DRAFT').length,
      published: rows.filter((row) => row.status === 'PUBLISHED').length,
      outOfStock: rows.filter((row) => row.stock === 0).length,
      blocked: rows.filter((row) => row.blockers > 0).length,
      ready: rows.filter((row) => row.status === 'DRAFT' && row.blockers === 0).length,
    };
  }

  private toRow(
    product: Prisma.ProductGetPayload<{ include: AdminService['include'] }>,
    locale: Locale,
  ): AdminProductRow {
    const readiness = assessProduct(product, locale);
    const stocked = product.variants.filter(
      (variant) => variant.fulfillmentMode === FulfillmentMode.FROM_STOCK,
    );
    const ar = product.translations.find((entry) => entry.locale === Locale.AR);
    const en = product.translations.find((entry) => entry.locale === Locale.EN);

    const prices = product.variants.map((variant) => variant.priceUsd);
    const cheapest = prices.length
      ? prices.reduce((low, price) => (price.lessThan(low) ? price : low))
      : null;

    return {
      slug: product.slug,
      nameAr: ar?.name ?? product.slug,
      nameEn: en?.name ?? null,
      status: product.status,
      kind: product.kind,
      brand: product.brand?.name ?? null,
      primaryCategory: product.categories[0]?.category.slug ?? null,
      variantCount: product.variants.length,
      // Only the stocked variants are counted, and null when there are none.
      // Summing every variant's empty inventory as zero is what made 67 of 72
      // products read "out of stock" while all of them were sellable.
      stock:
        stocked.length > 0
          ? stocked.reduce((total, variant) => total + (variant.inventory?.onHand ?? 0), 0)
          : null,
      stockedVariantCount: stocked.length,
      priceFromUsd: cheapest?.toFixed(2) ?? null,
      hasGoldenWarranty: product.hasGoldenWarranty,
      salesCount: product.salesCount,
      imageCount: product.media.length,
      activationSteps: {
        ar: parseActivationSteps(ar?.activationSteps).length,
        en: parseActivationSteps(en?.activationSteps).length,
      },
      blockers: readiness.checks.filter((check) => check.severity === 'blocker' && !check.passed)
        .length,
      warnings: readiness.checks.filter((check) => check.severity === 'warning' && !check.passed)
        .length,
    };
  }

  async readiness(slug: string, locale: string): Promise<Readiness> {
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      include: this.include,
    });
    if (!product)
      throw new NotFoundException(
        say(`لا يوجد منتج بالرابط "${slug}"`, `No product with the slug "${slug}"`),
      );
    return assessProduct(product, this.localeFor({ locale }));
  }

  /**
   * One product, in the list's own shape.
   *
   * The editor page opens on a single product and needs the same summary the
   * list draws for it — status, stock, blocker count — without loading the
   * whole list to find one row in it. Same `toRow`, so the two screens can
   * never disagree about what a product's state is.
   */
  async row(slug: string, locale: string): Promise<AdminProductRow> {
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      include: this.include,
    });
    if (!product)
      throw new NotFoundException(
        say(`لا يوجد منتج بالرابط "${slug}"`, `No product with the slug "${slug}"`),
      );
    return this.toRow(product, this.localeFor({ locale }));
  }

  /**
   * Publishing refuses while a blocker stands, and says which.
   *
   * Variants are published with the product: a published product whose variants
   * are all drafts renders as "nothing to buy", which is the state the legacy
   * store's highest-traffic page was in.
   */
  async setStatus(
    slug: string,
    status: PublishStatus,
    locale: string,
    actorId: string,
    context: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<{ status: PublishStatus; readiness: Readiness }> {
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      include: this.include,
    });
    if (!product)
      throw new NotFoundException(
        say(`لا يوجد منتج بالرابط "${slug}"`, `No product with the slug "${slug}"`),
      );

    const readiness = assessProduct(product, this.localeFor({ locale }));

    if (status === PublishStatus.PUBLISHED && !readiness.publishable) {
      // `detail` is null on a check that passed, and these are the ones that
      // did not — but narrowing it here beats asserting it, because the only
      // cost is a filter and the alternative is a `null` in the sentence the
      // editor reads.
      const blockers = readiness.checks
        .filter((check) => check.severity === 'blocker' && !check.passed)
        .map((check) => check.detail)
        .filter((detail): detail is string => detail !== null);
      throw new BadRequestException({
        message: say('هذا المنتج غير جاهز للنشر.', 'This product is not ready to publish.'),
        blockers,
      });
    }

    const updated = await this.prisma.client.product.update({
      where: { id: product.id },
      data: {
        status,
        publishedAt:
          status === PublishStatus.PUBLISHED ? (product.publishedAt ?? new Date()) : null,
        seoReady: readiness.publishable,
      },
    });

    await this.prisma.client.variant.updateMany({
      where: { productId: product.id },
      data: { status },
    });

    await this.audit.record({
      actorId,
      entity: 'Product',
      entityId: product.id,
      action: `product.status.${status.toLowerCase()}`,
      before: { status: product.status },
      after: { status },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return { status: updated.status, readiness };
  }

  /**
   * Sets stock, and records the change as a movement.
   *
   * The counter alone cannot answer "where did that key go", which is the
   * question that matters when a licence is missing. Every adjustment therefore
   * writes an immutable StockMovement row with a stated reason.
   */
  async setInventory(
    sku: string,
    onHand: number,
    reason: StockMovementReason,
    note: string | undefined,
    actorId: string,
    context: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<{ sku: string; onHand: number; reserved: number }> {
    const variant = await this.prisma.client.variant.findUnique({
      where: { sku },
      include: { inventory: true },
    });
    if (!variant)
      throw new NotFoundException(
        say(`لا يوجد متغيّر بالرمز "${sku}"`, `No variant with the SKU "${sku}"`),
      );

    const previous = variant.inventory?.onHand ?? 0;
    const reserved = variant.inventory?.reserved ?? 0;

    if (onHand < reserved) {
      throw new BadRequestException(
        say(
          `${String(reserved)} من هذا المتغيّر محجوزة في سلات قيد الشراء، فلا يمكن أن ينزل المخزون دون هذا الرقم.`,
          `${String(reserved)} of this variant are reserved in carts being checked out, so stock cannot go below that number.`,
        ),
      );
    }

    const level = await this.prisma.client.inventoryLevel.upsert({
      where: { variantId: variant.id },
      update: { onHand },
      create: { variantId: variant.id, onHand },
    });

    if (onHand !== previous) {
      await this.prisma.client.stockMovement.create({
        data: {
          variantId: variant.id,
          delta: onHand - previous,
          reason,
          actorId,
          note: note ?? null,
        },
      });
    }

    await this.audit.record({
      actorId,
      entity: 'Variant',
      entityId: variant.id,
      action: 'inventory.set',
      before: { onHand: previous },
      after: { onHand, reason, note: note ?? null },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return { sku: variant.sku, onHand: level.onHand, reserved: level.reserved };
  }

  /**
   * A product's copy in one locale, with that locale's readiness beside it.
   *
   * Both in one response because they are one question. 35 of the 73 products
   * are held out of the store by a missing SEO title and meta description and
   * nothing else, and whoever is fixing that needs to see the refusal clear as
   * they type rather than after a save and a reload.
   */
  async productCopy(slug: string, locale: string): Promise<ProductCopy> {
    const target = this.localeFor({ locale });
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      include: this.include,
    });
    if (!product)
      throw new NotFoundException(
        say(`لا يوجد منتج بالرابط "${slug}"`, `No product with the slug "${slug}"`),
      );

    const translation = product.translations.find((entry) => entry.locale === target);
    if (!translation)
      throw new NotFoundException(
        say(
          `لا توجد ترجمة ${target} لهذا المنتج بعد.`,
          `This product has no ${target} translation yet.`,
        ),
      );

    const body = readBody(translation.body);

    return {
      locale: target === Locale.EN ? 'en' : 'ar',
      name: translation.name,
      shortDesc: translation.shortDesc ?? '',
      seoTitle: translation.seoTitle ?? '',
      seoDescription: translation.seoDescription ?? '',
      body: body.html,
      bodyEditable: body.editable,
      otherBlocks: body.otherBlocks,
      readiness: assessProduct(product, target),
    };
  }

  /**
   * Writes the two fields the gate refuses on, plus the body it measures.
   *
   * The updated readiness comes back with them, so the drawer that asked for
   * the change is also the thing that reports whether it worked — a save that
   * returns "ok" while the product is still blocked is how 43 legacy products
   * ended up published with no description at all.
   */
  async setProductCopy(
    slug: string,
    input: SetProductCopy,
    actorId: string,
    context: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<ProductCopy> {
    const target = this.localeFor({ locale: input.locale });
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!product)
      throw new NotFoundException(
        say(`لا يوجد منتج بالرابط "${slug}"`, `No product with the slug "${slug}"`),
      );

    const translation = await this.prisma.client.productTranslation.findUnique({
      where: { productId_locale: { productId: product.id, locale: target } },
      select: { id: true, body: true, seoTitle: true, seoDescription: true, shortDesc: true },
    });
    if (!translation)
      throw new NotFoundException(
        say(
          `لا توجد ترجمة ${target} لهذا المنتج بعد.`,
          `This product has no ${target} translation yet.`,
        ),
      );

    const existing = readBody(translation.body);
    if (input.body !== undefined && !existing.editable) {
      throw new BadRequestException(
        say(
          `وصف هذا المنتج يحتوي على كتل لا يحرّرها هذا الصندوق (${existing.otherBlocks.join('، ')}). عدّل بقية الحقول، واترك الوصف كما هو.`,
          `This product's description holds blocks this box cannot edit (${existing.otherBlocks.join(', ')}). Edit the other fields and leave the description as it is.`,
        ),
      );
    }

    const data: Prisma.ProductTranslationUpdateInput = {
      // Empty clears the column rather than storing "". A null is what the
      // gate reads as "missing", and the two must not be different things.
      seoTitle: input.seoTitle.length > 0 ? input.seoTitle : null,
      seoDescription: input.seoDescription.length > 0 ? input.seoDescription : null,
      shortDesc: input.shortDesc.length > 0 ? input.shortDesc : null,
      ...(input.body === undefined ? {} : { body: writeBody(input.body) }),
    };

    await this.prisma.client.productTranslation.update({
      where: { id: translation.id },
      data,
    });

    // Lengths, not text. The audit table is read far more widely than the
    // catalog is — support and finance both live in it — and a product body
    // copied into it is the same words stored in a second place that nobody
    // will remember to update. What a reader needs is which field moved and
    // by how much.
    await this.audit.record({
      actorId,
      entity: 'ProductTranslation',
      entityId: translation.id,
      action: 'productCopy.set',
      before: {
        locale: target,
        seoTitle: (translation.seoTitle ?? '').length,
        seoDescription: (translation.seoDescription ?? '').length,
        shortDesc: (translation.shortDesc ?? '').length,
        bodyWords: countBodyWords(bodyText(translation.body)),
      },
      after: {
        locale: target,
        seoTitle: input.seoTitle.length,
        seoDescription: input.seoDescription.length,
        shortDesc: input.shortDesc.length,
        bodyWords:
          input.body === undefined
            ? countBodyWords(bodyText(translation.body))
            : countBodyWords(bodyText(writeBody(input.body))),
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return this.productCopy(slug, input.locale);
  }

  /** The activation how-to as it stands, for the editor to load. */
  async activationSteps(slug: string, locale: string): Promise<{ steps: string[] }> {
    const target = locale.toUpperCase() === 'EN' ? Locale.EN : Locale.AR;
    const translation = await this.prisma.client.productTranslation.findFirst({
      where: { product: { slug }, locale: target },
      select: { activationSteps: true },
    });
    if (!translation)
      throw new NotFoundException(
        say(
          `لا توجد ترجمة ${target} لهذا المنتج بعد.`,
          `This product has no ${target} translation yet.`,
        ),
      );
    return { steps: parseActivationSteps(translation.activationSteps) };
  }

  /**
   * Sets what a variant is delivered as.
   *
   * Refused once the vault holds keys for it under the other shape. Flipping
   * the field alone would leave stored rows describing themselves one way and
   * the variant claiming another, and the email would then label a password as
   * an activation key. Emptying or revoking the stock first is the honest
   * path, and it is a decision for a person, not a silent migration.
   */
  async setCredentialKind(
    sku: string,
    credentialKind: CredentialKind,
    actorId: string,
    context: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<{ sku: string; credentialKind: CredentialKind }> {
    const variant = await this.prisma.client.variant.findUnique({
      where: { sku },
      select: { id: true, sku: true, credentialKind: true },
    });
    if (!variant)
      throw new NotFoundException(
        say(`لا يوجد متغيّر بالرمز "${sku}"`, `No variant with the SKU "${sku}"`),
      );
    if (variant.credentialKind === credentialKind) {
      return { sku: variant.sku, credentialKind };
    }

    const held = await this.vault.stockReport([variant.id]);
    const live = held
      .filter((row) => row.state === 'AVAILABLE' || row.state === 'ASSIGNED')
      .reduce((sum, row) => sum + row.count, 0);
    if (live > 0) {
      throw new BadRequestException(
        say(
          `الخزنة تحتفظ بـ${String(live)} مفتاحاً لهذا المتغيّر بالشكل الحالي. اسحبها أو ألغِها قبل تغيير نوع التسليم.`,
          `The vault still holds ${String(live)} keys for this variant in its current shape. Withdraw or revoke them before changing the delivery kind.`,
        ),
      );
    }

    await this.prisma.client.variant.update({
      where: { id: variant.id },
      data: { credentialKind },
    });

    await this.audit.record({
      actorId,
      entity: 'Variant',
      entityId: variant.id,
      action: 'variant.credentialKind',
      before: { credentialKind: variant.credentialKind },
      after: { credentialKind },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return { sku: variant.sku, credentialKind };
  }

  /**
   * Sets the activation how-to for one product in one locale.
   *
   * Stored as `[{ step, text }]`, which is the shape the product page, the
   * licence email and the customer's order page already read. Plain lines in,
   * numbered steps out — the text goes into an email body, so it must not
   * carry markup.
   */
  async setActivationSteps(
    slug: string,
    locale: string,
    steps: string[],
    actorId: string,
    context: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<{ slug: string; locale: string; steps: string[] }> {
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException(
        say(`لا يوجد منتج بالمُعرّف "${slug}"`, `No product with the id "${slug}"`),
      );
    }

    const target = locale.toUpperCase() === 'EN' ? Locale.EN : Locale.AR;
    const translation = await this.prisma.client.productTranslation.findUnique({
      where: { productId_locale: { productId: product.id, locale: target } },
      select: { id: true, activationSteps: true },
    });
    if (!translation) {
      throw new NotFoundException(
        say(
          `لا توجد ترجمة ${target} لهذا المنتج بعد.`,
          `This product has no ${target} translation yet.`,
        ),
      );
    }

    const payload = steps.map((text, index) => ({ step: index + 1, text }));
    await this.prisma.client.productTranslation.update({
      where: { id: translation.id },
      data: { activationSteps: payload },
    });

    await this.audit.record({
      actorId,
      entity: 'ProductTranslation',
      entityId: translation.id,
      action: 'activationSteps.set',
      // Counts, not the text: the audit table is read far more widely than
      // the catalog is, and a step list is content that belongs in one place.
      before: {
        steps: Array.isArray(translation.activationSteps) ? translation.activationSteps.length : 0,
      },
      after: { steps: payload.length },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return { slug, locale: target.toLowerCase(), steps };
  }
}
