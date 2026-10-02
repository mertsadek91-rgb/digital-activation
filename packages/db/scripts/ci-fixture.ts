/**
 * A small, fixed catalogue for the CI performance budget (TASK-0089).
 *
 *   pnpm --filter @da/db ci-fixture
 *
 * Lighthouse has to measure a product page and a category page, and those
 * only exist when the API has something published to return. This writes the
 * least that makes both pages render the way a real one does: one published
 * category, two published products in it (so the category has a grid and the
 * product page has a "related" row), each with a published default variant and
 * a USD price, and both locales.
 *
 * The slugs are what `apps/storefront/lighthouserc.json` lists. Change one and
 * change the other.
 *
 * CI only. It refuses any database that is not on this machine: the database
 * in the repo-root `.env` is the live staging store, and nothing here belongs
 * in it. It deliberately does not load that file either — every connection
 * value must be passed in the environment.
 *
 * Idempotent: upserts by slug and SKU, so a second run changes nothing.
 */
import { prisma, Locale, PublishStatus, Prisma, refreshProductPrice } from '../src/index.js';

const CI_CATEGORY = 'ci-fixture-category';
const CI_PRODUCTS = ['ci-fixture-product', 'ci-fixture-product-two'] as const;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', 'postgres']);

function assertLocalDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set. This script never reads .env.');
  const host = new URL(raw).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to write the CI fixture to "${host}": it only runs against a local, disposable database.`,
    );
  }
}

/** Enough body that the page is shaped like a real product page, not an empty shell. */
function body(locale: Locale, name: string): Prisma.InputJsonValue {
  const ar = locale === Locale.AR;
  return [
    {
      type: 'heading',
      level: 2,
      text: ar ? `ما الذي تحصل عليه مع ${name}` : `What ${name} includes`,
    },
    {
      type: 'richText',
      html: ar
        ? '<p>مفتاح ترخيص أصلي يصلك بالبريد خلال دقائق من الدفع، مع خطوات التفعيل باللغة العربية ودعم فني عند الحاجة.</p><p>يعمل الترخيص على جهاز واحد مدى الحياة، ويمكن نقله عند تغيير الجهاز وفق شروط الشركة المصنّعة.</p>'
        : '<p>A genuine licence key delivered by email within minutes of payment, with activation steps and support if you need it.</p><p>The licence covers one device for life and can be moved to a new device under the vendor’s terms.</p>',
    },
  ];
}

function faq(locale: Locale): Prisma.InputJsonValue {
  return locale === Locale.AR
    ? [
        { q: 'متى يصلني المفتاح؟', a: 'خلال دقائق من تأكيد الدفع، على بريدك وفي صفحة طلبك.' },
        { q: 'هل الترخيص أصلي؟', a: 'نعم، ومشمول بضمان الاستبدال طوال مدة الترخيص.' },
      ]
    : [
        {
          q: 'When does the key arrive?',
          a: 'Within minutes of payment, by email and on your order page.',
        },
        {
          q: 'Is the licence genuine?',
          a: 'Yes, and it is covered by replacement for its whole term.',
        },
      ];
}

async function main(): Promise<void> {
  assertLocalDatabase();

  // The store's base currency. The seed creates it too; upserted here so the
  // fixture does not depend on the seed having run first.
  await prisma.currency.upsert({
    where: { code: 'USD' },
    update: {},
    create: { code: 'USD', symbol: '$', symbolPosition: 'left', decimals: 2, roundingRule: 'none' },
  });

  const category = await prisma.category.upsert({
    where: { slug: CI_CATEGORY },
    update: { status: PublishStatus.PUBLISHED },
    create: { slug: CI_CATEGORY, status: PublishStatus.PUBLISHED, position: 0 },
  });
  for (const [locale, name, headline] of [
    [Locale.AR, 'برامج الحماية', 'مفاتيح أصلية تصلك خلال دقائق'],
    [Locale.EN, 'Security software', 'Genuine keys, delivered in minutes'],
  ] as const) {
    const data = {
      name,
      headline,
      body: body(locale, name),
      faq: faq(locale),
      seoTitle: name,
      seoDescription: headline,
    };
    await prisma.categoryTranslation.upsert({
      where: { categoryId_locale: { categoryId: category.id, locale } },
      update: data,
      create: { categoryId: category.id, locale, ...data },
    });
  }

  const publishedAt = new Date('2026-01-01T00:00:00Z');
  for (const [index, slug] of CI_PRODUCTS.entries()) {
    const product = await prisma.product.upsert({
      where: { slug },
      update: { status: PublishStatus.PUBLISHED, primaryCategoryId: category.id },
      create: {
        slug,
        status: PublishStatus.PUBLISHED,
        publishedAt,
        seoReady: true,
        primaryCategoryId: category.id,
      },
    });

    for (const [locale, name] of [
      [Locale.AR, index === 0 ? 'برنامج حماية تجريبي' : 'برنامج حماية تجريبي ٢'],
      [Locale.EN, index === 0 ? 'Fixture Security' : 'Fixture Security 2'],
    ] as const) {
      const data = {
        name,
        shortDesc: locale === Locale.AR ? '⚡ يصلك خلال دقائق' : '⚡ Delivered in minutes',
        body: body(locale, name),
        faq: faq(locale),
        seoTitle: name,
        seoDescription:
          locale === Locale.AR
            ? `${name}: مفتاح ترخيص أصلي يصلك خلال دقائق.`
            : `${name}: a genuine licence key, delivered in minutes.`,
      };
      await prisma.productTranslation.upsert({
        where: { productId_locale: { productId: product.id, locale } },
        update: data,
        create: { productId: product.id, locale, ...data },
      });
    }

    const sku = `CI-FIXTURE-${String(index + 1)}`;
    const priceUsd = new Prisma.Decimal(index === 0 ? '19.90' : '29.90');
    await prisma.variant.upsert({
      where: { sku },
      update: { priceUsd, status: PublishStatus.PUBLISHED },
      create: {
        productId: product.id,
        sku,
        priceUsd,
        compareAtUsd: new Prisma.Decimal(index === 0 ? '39.90' : '49.90'),
        status: PublishStatus.PUBLISHED,
        isDefault: true,
      },
    });

    await prisma.productCategory.upsert({
      where: { productId_categoryId: { productId: product.id, categoryId: category.id } },
      update: { isPrimary: true, position: index },
      create: { productId: product.id, categoryId: category.id, isPrimary: true, position: index },
    });

    await refreshProductPrice(prisma, product.id);
  }

  console.log(`ci fixture: category /collections/${CI_CATEGORY}`);
  for (const slug of CI_PRODUCTS) console.log(`ci fixture: product  /store/${slug}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
