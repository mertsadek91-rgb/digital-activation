/**
 * WordPress catalog import.
 *
 *   pnpm db:import            report only, writes nothing
 *   pnpm db:import --apply    write to the database
 *
 * Imports products, variants, translations, category and brand links, and a
 * LegacyMap row per legacy product so the 301 map can be generated later.
 *
 * Deliberately NOT imported yet, and each for a reason:
 *
 *   media      the 192 attachments live on the old host; they move to R2 in a
 *              separate pass, so the URLs are recorded rather than guessed
 *   orders     185 orders and 224 customers come after the catalog is settled
 *   reviews    565 of them are synthetic, and none are migrated at all
 *   licence keys  they need the encrypted vault and a scrub of the order notes
 *                 they are currently sitting in as plaintext
 *
 * Two rules the whole script follows:
 *
 *   Everything lands as DRAFT. Nothing this script writes goes live without a
 *   human publishing it, because the legacy SEO fields are missing on 43 of the
 *   101 products and the publish gate will refuse them anyway.
 *
 *   An unrecognised value is reported, never defaulted. A silent default would
 *   bake a wrong licence term into a product page, and the customer would find
 *   out after paying.
 */
import fs from 'node:fs';
import path from 'node:path';

import { config as loadEnv } from 'dotenv';
import { XMLParser } from 'fast-xml-parser';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '..', '.env'), quiet: true });

import {
  ActivationMethod,
  type FulfillmentMode,
  LicensePeriodUnit,
  Locale,
  type Platform,
  PublishStatus,
  prisma,
  refreshProductPrice,
} from '../../src/index.js';
import {
  ACTIVATION_METHOD,
  BRAND_SLUG,
  CATEGORY_SLUG,
  classifyFulfillment,
  classifyKind,
  classifyPlatform,
  DELIVERY_SLA_SECONDS,
  DEVICE_COUNT,
  LICENSE_PERIOD,
  refineActivationFromTitle,
  requiresActivationEmail,
} from './normalize.js';
import {
  arabicProductName,
  groupSlug,
  NAME_OVERRIDES_EN,
  productName,
  variantSuffix,
} from './naming.js';

const XML_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'Old Website',
  'Backup XML Products + Pages + Full Website From Wordpress',
  'WordPress.2026-09-09.xml',
);

// --- parsing ----------------------------------------------------------------

interface LegacyProduct {
  id: string;
  title: string;
  slug: string;
  status: string;
  link: string;
  body: string;
  excerpt: string;
  meta: Record<string, string>;
  categories: string[];
  brands: string[];
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function parseXml(): LegacyProduct[] {
  if (!fs.existsSync(XML_PATH)) {
    throw new Error(`WordPress export not found at ${XML_PATH}`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    cdataPropName: '__cdata',
    trimValues: false,
    parseTagValue: false,
    parseAttributeValue: false,
  });

  const doc = parser.parse(fs.readFileSync(XML_PATH, 'utf8')) as Record<string, unknown>;
  const channel = (doc.rss as Record<string, unknown>).channel as Record<string, unknown>;
  const items = asArray(channel.item as Record<string, unknown>[]);

  // Narrowing, not coercion: String() on a non-primitive yields
  // "[object Object]", which would import silently as a product title.
  const text = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (value !== null && typeof value === 'object' && '__cdata' in value) {
      const inner: unknown = (value as Record<string, unknown>).__cdata;
      if (typeof inner === 'string') return inner;
      if (typeof inner === 'number') return String(inner);
    }
    return '';
  };

  const products: LegacyProduct[] = [];

  for (const item of items) {
    if (text(item['wp:post_type']) !== 'product') continue;

    const meta: Record<string, string> = {};
    for (const entry of asArray(item['wp:postmeta'] as Record<string, unknown>[])) {
      meta[text(entry['wp:meta_key'])] = text(entry['wp:meta_value']);
    }

    const categories: string[] = [];
    const brands: string[] = [];
    for (const category of asArray(item.category as Record<string, unknown>[])) {
      const domain = text(category['@domain']);
      const name = text(category);
      if (domain === 'product_cat') categories.push(name);
      else if (domain === 'pa_brand') brands.push(name);
    }

    products.push({
      id: text(item['wp:post_id']),
      title: text(item.title),
      slug: text(item['wp:post_name']),
      status: text(item['wp:status']),
      link: text(item.link),
      body: text(item['content:encoded']),
      excerpt: text(item['excerpt:encoded']),
      meta,
      categories,
      brands,
    });
  }

  return products;
}

// --- reporting --------------------------------------------------------------

const problems: { kind: string; detail: string }[] = [];
function problem(kind: string, detail: string): void {
  problems.push({ kind, detail });
}

// --- normalisation with reporting ------------------------------------------

interface NormalizedVariant {
  legacy: LegacyProduct;
  periodValue: number | null;
  periodUnit: LicensePeriodUnit;
  deviceCount: number;
  platform: Platform;
  activationMethod: ActivationMethod;
  deliverySlaSeconds: number;
  priceUsd: string;
  stock: number;
  sku: string | null;
  fulfillmentMode: FulfillmentMode;
  requiresActivationEmail: boolean;
  /** True when the row carries no price and imports only to be visible. */
  needsPrice: boolean;
}

function normalizeVariant(legacy: LegacyProduct): NormalizedVariant | null {
  const label = `${legacy.id} "${legacy.title.slice(0, 46)}"`;

  // A row with no price used to be dropped, which made it invisible: the only
  // trace was a line in this report, and nobody reads a report for a product
  // they have forgotten exists. It now imports at zero, as a draft the
  // readiness gate already refuses to publish ("a variant is priced at zero"),
  // so the gap shows up in the admin panel where the fix belongs.
  const rawPrice = (legacy.meta._regular_price || legacy.meta._price || '').trim();
  const needsPrice = !rawPrice || Number.isNaN(Number(rawPrice));
  if (needsPrice) {
    problem(
      'no price',
      `${label} — imported at 0.00 and blocked from publishing until it is priced`,
    );
  }

  const rawPeriod = (legacy.meta.license_period ?? '').trim();
  let period = LICENSE_PERIOD[rawPeriod];

  if (!period && rawPeriod === 'متعدد') {
    // "متعدد" — mixed — is the honest answer for a bundle of Windows
    // (perpetual) and Office 365 (annual): there is no single term. Skipping
    // the product would drop real revenue, so it imports as LIFETIME with the
    // discrepancy recorded for an editor to state per component on the page.
    period = { value: null, unit: LicensePeriodUnit.LIFETIME };
    problem(
      'mixed licence term',
      `${label} — bundle with no single term; imported as LIFETIME, state each component's term on the page`,
    );
  }

  if (!period) {
    // An empty period is a row nobody finished filling in, not a row to drop.
    // It imports as LIFETIME, which is the commonest term in this catalog, and
    // the gap is reported — the product is already unpublishable for want of a
    // price, so nothing wrong can reach a customer.
    if (rawPeriod === '') {
      period = { value: null, unit: LicensePeriodUnit.LIFETIME };
      problem('licence period', `${label} — no period set; imported as LIFETIME, confirm the term`);
    } else {
      problem('licence period', `${label} — unmapped period ${JSON.stringify(rawPeriod)}`);
      return null;
    }
  }

  const rawDevices = (legacy.meta.no_of_devices ?? '').trim();
  let devices = DEVICE_COUNT[rawDevices];
  if (!devices && rawDevices === '') {
    devices = { count: 1 };
    problem('device count', `${label} — no device count set; imported as 1, confirm it`);
  }
  if (!devices) {
    problem('device count', `${label} — unmapped devices ${JSON.stringify(rawDevices)}`);
    return null;
  }

  const rawActivation = (legacy.meta.activation_method ?? '').trim();
  let activation = ACTIVATION_METHOD[rawActivation];
  if (!activation && rawActivation === '') {
    activation = ActivationMethod.RETAIL_ONLINE;
    problem(
      'activation',
      `${label} — no activation method set; imported as RETAIL_ONLINE, confirm it`,
    );
  }
  if (!activation) {
    problem('activation', `${label} — unmapped method ${JSON.stringify(rawActivation)}`);
    return null;
  }

  const rawDelivery = (legacy.meta.delivery ?? '').trim();
  let sla = DELIVERY_SLA_SECONDS[rawDelivery];
  if (sla === undefined && rawDelivery === '') {
    // Six hours, not a minute. An unfinished row must not inherit the fastest
    // promise in the catalog — an SLA is something a customer is told, and
    // guessing generously is a guess the store has to keep.
    sla = 6 * 3600;
    problem('delivery', `${label} — no delivery time set; imported as 6 hours, confirm it`);
  }
  if (sla === undefined) {
    problem('delivery', `${label} — unmapped delivery ${JSON.stringify(rawDelivery)}`);
    return null;
  }

  return {
    legacy,
    periodValue: period.value,
    periodUnit: period.unit,
    deviceCount: devices.count,
    platform: devices.platform ?? classifyPlatform(legacy.title),
    activationMethod: refineActivationFromTitle(legacy.title, activation),
    deliverySlaSeconds: sla,
    priceUsd: needsPrice ? '0.00' : Number(rawPrice).toFixed(2),
    // Stock only means something for a line held in hand. WooCommerce left
    // `_stock` blank on the 91 made-to-order rows, and reading that as zero is
    // what turned "made to order" into "out of stock".
    stock: Number.parseInt(legacy.meta._stock || '0', 10) || 0,
    sku: legacy.meta._sku?.trim() || null,
    fulfillmentMode: classifyFulfillment(legacy.meta),
    requiresActivationEmail: requiresActivationEmail(legacy.meta),
    needsPrice,
  };
}

/** A short hint distinguishing variants that share period and device count. */
function activationHint(method: ActivationMethod): string | undefined {
  switch (method) {
    case ActivationMethod.RETAIL_PHONE:
    case ActivationMethod.VOLUME_MAK:
      return 'phone';
    case ActivationMethod.ACCOUNT_CREDENTIALS:
      return 'account';
    case ActivationMethod.PANEL_INVITE:
      return 'panel';
    case ActivationMethod.REDEEM_CODE:
      return 'redeem';
    case ActivationMethod.BIND_MICROSOFT_ACCOUNT:
      return 'bind';
    default:
      return undefined;
  }
}

// --- main -------------------------------------------------------------------

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const legacyProducts = parseXml();
  console.log(`parsed ${legacyProducts.length} products from the WordPress export`);

  // Group by derived product name.
  const groups = new Map<string, LegacyProduct[]>();
  for (const legacy of legacyProducts) {
    const slug = groupSlug(legacy.id, legacy.title);
    if (!slug) {
      problem(
        'no slug',
        `${legacy.id} "${legacy.title.slice(0, 50)}" — add a SLUG_OVERRIDES entry`,
      );
      continue;
    }
    groups.set(slug, [...(groups.get(slug) ?? []), legacy]);
  }

  console.log(`grouped into ${groups.size} products`);

  // Resolve the category and brand ids we will need.
  const categoryIds = new Map<string, string>();
  for (const slug of new Set(Object.values(CATEGORY_SLUG))) {
    const category = await prisma.category.findUnique({ where: { slug } });
    if (!category) {
      problem('category', `${slug} is not seeded — run pnpm db:seed first`);
      continue;
    }
    categoryIds.set(slug, category.id);
  }

  const brandIds = new Map<string, string>();
  for (const slug of new Set(Object.values(BRAND_SLUG))) {
    const brand = await prisma.brand.findUnique({ where: { slug } });
    if (brand) brandIds.set(slug, brand.id);
  }

  let productsWritten = 0;
  let variantsWritten = 0;
  let variantsSkipped = 0;
  const byMode: Record<FulfillmentMode, number> = {
    FROM_STOCK: 0,
    ON_DEMAND: 0,
    MANUAL_SETUP: 0,
  };
  let needsEmail = 0;

  // Two rows can reduce to the same variant descriptor — that is the
  // "duplicate config" case reported below. Their generated SKUs would then
  // collide and the second upsert would silently overwrite the first, losing a
  // variant while the report still counted it. Suffix the repeats instead.
  const usedSkus = new Set<string>();
  const uniqueSku = (candidate: string): string => {
    if (!usedSkus.has(candidate)) {
      usedSkus.add(candidate);
      return candidate;
    }
    for (let n = 2; ; n += 1) {
      const next = `${candidate}-${String(n)}`;
      if (!usedSkus.has(next)) {
        usedSkus.add(next);
        return next;
      }
    }
  };

  for (const [slug, members] of groups) {
    const normalized = members
      .map((legacy) => normalizeVariant(legacy))
      .filter((variant): variant is NormalizedVariant => variant !== null);

    variantsSkipped += members.length - normalized.length;
    if (normalized.length === 0) continue;

    // Flag configurations that appear twice in one group: two rows with the
    // same term, device count and activation are the same thing sold twice at
    // different prices, which is a catalog error rather than a variant.
    const seenConfig = new Map<string, NormalizedVariant>();
    for (const variant of normalized) {
      const key = `${String(variant.periodValue)}-${variant.periodUnit}-${variant.deviceCount}-${variant.activationMethod}`;
      const previous = seenConfig.get(key);
      if (previous) {
        problem(
          'duplicate config',
          `${slug} — legacy ${previous.legacy.id} ($${previous.priceUsd}) and ${variant.legacy.id} ($${variant.priceUsd}) are the same configuration`,
        );
      }
      seenConfig.set(key, variant);
    }

    // Flag prices that fall as the entitlement grows.
    const byDevices = [...normalized]
      .filter((variant) => variant.periodUnit !== 'LIFETIME')
      .sort((a, b) => a.deviceCount - b.deviceCount);
    for (let i = 1; i < byDevices.length; i += 1) {
      const lower = byDevices[i - 1];
      const higher = byDevices[i];
      if (!lower || !higher) continue;
      if (
        lower.periodValue === higher.periodValue &&
        lower.periodUnit === higher.periodUnit &&
        higher.deviceCount > lower.deviceCount &&
        Number(higher.priceUsd) < Number(lower.priceUsd)
      ) {
        problem(
          'price inversion',
          `${slug} — ${higher.deviceCount} devices ($${higher.priceUsd}) costs less than ${lower.deviceCount} devices ($${lower.priceUsd})`,
        );
      }
    }

    const primary = normalized[0];
    if (!primary) continue;

    // A single-variant product keeps its full title; a grouped one must not
    // wear one variant's term and device count as the product name.
    const nameAr =
      normalized.length > 1
        ? arabicProductName(
            primary.legacy.title,
            Object.keys(LICENSE_PERIOD),
            Object.keys(DEVICE_COUNT),
          )
        : primary.legacy.title.trim();
    const nameEn =
      NAME_OVERRIDES_EN[primary.legacy.id] ?? productName(primary.legacy.title) ?? slug;

    const legacyCategories = [...new Set(members.flatMap((member) => member.categories))];
    const categorySlugs = legacyCategories
      .map((name) => {
        const mapped = CATEGORY_SLUG[name];
        if (!mapped) problem('category', `unmapped legacy category ${JSON.stringify(name)}`);
        return mapped;
      })
      .filter((value): value is string => Boolean(value));

    const legacyBrands = [...new Set(members.flatMap((member) => member.brands))];
    const brandSlug = legacyBrands.map((name) => BRAND_SLUG[name]).find(Boolean);
    if (legacyBrands.length > 0 && !brandSlug) {
      problem('brand', `${slug} — unmapped brand ${JSON.stringify(legacyBrands)}`);
    }

    const hasWarranty = members.some((member) =>
      (member.meta.guarantee ?? '').includes('الضمان الذهبي'),
    );
    const salesCount = members.reduce(
      (total, member) => total + (Number.parseInt(member.meta.total_sales || '0', 10) || 0),
      0,
    );

    for (const variant of normalized) {
      byMode[variant.fulfillmentMode] += 1;
      if (variant.requiresActivationEmail) needsEmail += 1;
    }

    if (!apply) {
      productsWritten += 1;
      variantsWritten += normalized.length;
      continue;
    }

    const product = await prisma.product.upsert({
      where: { slug },
      update: {
        kind: classifyKind(nameAr),
        brandId: brandSlug ? (brandIds.get(brandSlug) ?? null) : null,
        hasGoldenWarranty: hasWarranty,
        salesCount,
      },
      create: {
        slug,
        kind: classifyKind(nameAr),
        status: PublishStatus.DRAFT,
        brandId: brandSlug ? (brandIds.get(brandSlug) ?? null) : null,
        hasGoldenWarranty: hasWarranty,
        salesCount,
      },
    });
    productsWritten += 1;

    // The legacy body is Elementor/WooCommerce HTML. It is preserved verbatim
    // as a single richText block rather than guessed into structured blocks —
    // that conversion is an editorial pass, not an import concern.
    const bodyBlocks = primary.legacy.body.trim()
      ? [{ type: 'richText', html: primary.legacy.body.trim() }]
      : [];

    await prisma.productTranslation.upsert({
      where: { productId_locale: { productId: product.id, locale: Locale.AR } },
      update: {
        name: nameAr,
        shortDesc: primary.legacy.meta.short_text?.trim() || null,
        body: bodyBlocks,
        seoTitle: primary.legacy.meta.rank_math_title?.trim() || null,
        seoDescription: primary.legacy.meta.rank_math_description?.trim() || null,
      },
      create: {
        productId: product.id,
        locale: Locale.AR,
        name: nameAr,
        shortDesc: primary.legacy.meta.short_text?.trim() || null,
        body: bodyBlocks,
        seoTitle: primary.legacy.meta.rank_math_title?.trim() || null,
        seoDescription: primary.legacy.meta.rank_math_description?.trim() || null,
      },
    });

    // The English name is the store's own Latin text, not a translation. The
    // English body stays empty on purpose: machine-translating 72 product
    // descriptions would produce pages worse than having none.
    await prisma.productTranslation.upsert({
      where: { productId_locale: { productId: product.id, locale: Locale.EN } },
      update: { name: nameEn },
      create: { productId: product.id, locale: Locale.EN, name: nameEn },
    });

    for (const [index, slugCategory] of categorySlugs.entries()) {
      const categoryId = categoryIds.get(slugCategory);
      if (!categoryId) continue;
      await prisma.productCategory.upsert({
        where: { productId_categoryId: { productId: product.id, categoryId } },
        update: { isPrimary: index === 0, position: index },
        create: { productId: product.id, categoryId, isPrimary: index === 0, position: index },
      });
      if (index === 0) {
        await prisma.product.update({
          where: { id: product.id },
          data: { primaryCategoryId: categoryId },
        });
      }
    }

    const multi = normalized.length > 1;
    for (const [index, variant] of normalized.entries()) {
      const suffix = variantSuffix({
        periodValue: variant.periodValue,
        periodUnit: variant.periodUnit,
        deviceCount: variant.deviceCount,
        activationHint: activationHint(variant.activationMethod),
      });
      const sku = uniqueSku(variant.sku ?? (multi ? `${slug}-${suffix}` : slug));

      const saved = await prisma.variant.upsert({
        where: { sku },
        update: {
          productId: product.id,
          licensePeriodValue: variant.periodValue,
          licensePeriodUnit: variant.periodUnit,
          deviceCount: variant.deviceCount,
          platform: variant.platform,
          activationMethod: variant.activationMethod,
          deliverySlaSeconds: variant.deliverySlaSeconds,
          fulfillmentMode: variant.fulfillmentMode,
          requiresActivationEmail: variant.requiresActivationEmail,
          priceUsd: variant.priceUsd,
          isDefault: index === 0,
          position: index,
        },
        create: {
          sku,
          productId: product.id,
          licensePeriodValue: variant.periodValue,
          licensePeriodUnit: variant.periodUnit,
          deviceCount: variant.deviceCount,
          platform: variant.platform,
          activationMethod: variant.activationMethod,
          deliverySlaSeconds: variant.deliverySlaSeconds,
          fulfillmentMode: variant.fulfillmentMode,
          requiresActivationEmail: variant.requiresActivationEmail,
          priceUsd: variant.priceUsd,
          isDefault: index === 0,
          position: index,
          status: PublishStatus.DRAFT,
        },
      });
      variantsWritten += 1;

      // Inventory is written only for a line held in hand. An on-demand
      // variant gets no row at all, so nothing can read a blank `_stock` as
      // zero and call a made-to-order product sold out.
      if (variant.fulfillmentMode === 'FROM_STOCK') {
        await prisma.inventoryLevel.upsert({
          where: { variantId: saved.id },
          update: { onHand: Math.max(0, variant.stock) },
          create: { variantId: saved.id, onHand: Math.max(0, variant.stock) },
        });
      } else {
        await prisma.inventoryLevel.deleteMany({ where: { variantId: saved.id } });
      }

      // The 301 map is generated from these rows at cutover.
      await prisma.legacyMap.upsert({
        where: { legacyType_legacyId: { legacyType: 'product', legacyId: variant.legacy.id } },
        update: {
          legacyUrl: variant.legacy.link,
          entity: 'Variant',
          entityId: saved.id,
        },
        create: {
          legacyType: 'product',
          legacyId: variant.legacy.id,
          legacyUrl: variant.legacy.link,
          entity: 'Variant',
          entityId: saved.id,
        },
      });
    }

    // A re-import rewrites prices on variants that may already be published,
    // so the price-sort column is recomputed from what is now in the table.
    await refreshProductPrice(prisma, product.id);
  }

  // --- report ---------------------------------------------------------------
  console.log('');
  console.log(
    apply
      ? `WROTE ${productsWritten} products, ${variantsWritten} variants`
      : `WOULD WRITE ${productsWritten} products, ${variantsWritten} variants (dry run)`,
  );
  if (variantsSkipped > 0) {
    console.log(`${variantsSkipped} legacy rows skipped — see the report below`);
  }
  console.log(
    `fulfilment: ${String(byMode.FROM_STOCK)} from stock, ${String(byMode.ON_DEMAND)} on demand, ` +
      `${String(byMode.MANUAL_SETUP)} manual setup — ${String(needsEmail)} need the customer's activation email`,
  );

  if (problems.length > 0) {
    const byKind = new Map<string, string[]>();
    for (const item of problems) {
      byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item.detail]);
    }
    console.log('');
    console.log('=== needs attention ===');
    for (const [kind, details] of [...byKind.entries()].sort()) {
      console.log('');
      console.log(`${kind} (${details.length})`);
      for (const detail of details) console.log(`  ${detail}`);
    }
  }

  if (!apply) {
    console.log('');
    console.log('Nothing was written. Re-run with --apply once the report looks right.');
  }
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
