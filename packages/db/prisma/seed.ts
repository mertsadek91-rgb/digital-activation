/**
 * Seed: reference data only.
 *
 * Catalog content comes from the WordPress import (a separate script), not from
 * here. What this file creates is the scaffolding that import needs to exist
 * first — currencies, customer groups, the category tree, brands, navigation
 * and the Organization block.
 *
 * Categories and brands are the real ones from the legacy store, with two
 * changes: slugs are short Latin strings instead of 300-character
 * percent-encoded Arabic, and every category gets Arabic and English
 * translations with a real headline, because in the legacy store not one
 * category page had a meta description and not one ever received a search
 * impression.
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

import { prisma, Locale, PublishStatus, CustomerGroupKind } from '../src/index.js';

const CURRENCIES = [
  {
    code: 'USD',
    symbol: '$',
    symbolPosition: 'left',
    decimals: 2,
    roundingRule: 'none',
    sortOrder: 0,
  },
  {
    code: 'SAR',
    symbol: 'ر.س',
    symbolPosition: 'right',
    decimals: 2,
    roundingRule: 'nearest_0_95',
    sortOrder: 1,
  },
  {
    code: 'AED',
    symbol: 'د.إ',
    symbolPosition: 'right',
    decimals: 2,
    roundingRule: 'nearest_0_95',
    sortOrder: 2,
  },
  {
    code: 'KWD',
    symbol: 'د.ك',
    symbolPosition: 'right',
    decimals: 3,
    roundingRule: 'none',
    sortOrder: 3,
  },
  {
    code: 'QAR',
    symbol: 'ر.ق',
    symbolPosition: 'right',
    decimals: 2,
    roundingRule: 'nearest_0_95',
    sortOrder: 4,
  },
  {
    code: 'EGP',
    symbol: 'ج.م',
    symbolPosition: 'right',
    decimals: 2,
    roundingRule: 'nearest_9',
    sortOrder: 5,
  },
  {
    code: 'TRY',
    symbol: '₺',
    symbolPosition: 'right',
    decimals: 2,
    roundingRule: 'nearest_0_95',
    sortOrder: 6,
  },
];

const GROUPS = [
  {
    kind: CustomerGroupKind.RETAIL,
    name: 'أفراد',
    discountPercent: '0',
    allowInvoicePayment: false,
  },
  {
    kind: CustomerGroupKind.B2B,
    name: 'شركات',
    discountPercent: '5',
    allowInvoicePayment: true,
  },
  {
    kind: CustomerGroupKind.VIP,
    name: 'عملاء مميّزون',
    discountPercent: '7',
    allowInvoicePayment: false,
  },
  {
    kind: CustomerGroupKind.RESELLER,
    name: 'موزّعون',
    discountPercent: '15',
    allowInvoicePayment: true,
  },
];

const BRANDS = [
  {
    slug: 'microsoft',
    ar: 'مايكروسوفت',
    en: 'Microsoft',
    website: 'https://microsoft.com',
  },
  { slug: 'windows', ar: 'ويندوز', en: 'Windows' },
  { slug: 'microsoft-office', ar: 'مايكروسوفت أوفيس', en: 'Microsoft Office' },
  { slug: 'adobe', ar: 'أدوبي', en: 'Adobe', website: 'https://adobe.com' },
  {
    slug: 'autodesk',
    ar: 'أوتوديسك',
    en: 'Autodesk',
    website: 'https://autodesk.com',
  },
  { slug: 'eset', ar: 'ايست', en: 'ESET', website: 'https://eset.com' },
  { slug: 'norton', ar: 'نورتن', en: 'Norton' },
  { slug: 'mcafee', ar: 'مكافي', en: 'McAfee' },
  { slug: 'coreldraw', ar: 'كوريل درو', en: 'CorelDRAW' },
  { slug: 'ccleaner', ar: 'سي كلينر', en: 'CCleaner' },
  { slug: 'elementor', ar: 'إليمنتور', en: 'Elementor' },
];

interface CategorySeed {
  slug: string;
  ar: string;
  en: string;
  headlineAr: string;
  headlineEn: string;
  children?: CategorySeed[];
}

const CATEGORIES: CategorySeed[] = [
  {
    slug: 'windows',
    ar: 'ويندوز',
    en: 'Windows',
    headlineAr: 'مفاتيح تفعيل ويندوز أصلية بجميع الإصدارات',
    headlineEn: 'Genuine Windows activation keys, every edition',
    children: [
      {
        slug: 'windows-11',
        ar: 'ويندوز 11',
        en: 'Windows 11',
        headlineAr: 'مفاتيح تفعيل ويندوز 11 هوم وبرو، تفعيل أونلاين مدى الحياة',
        headlineEn: 'Windows 11 Home and Pro keys, lifetime online activation',
      },
      {
        slug: 'windows-10',
        ar: 'ويندوز 10',
        en: 'Windows 10',
        headlineAr: 'مفاتيح تفعيل ويندوز 10 هوم وبرو بضمان التفعيل',
        headlineEn: 'Windows 10 Home and Pro keys with an activation guarantee',
      },
      {
        slug: 'windows-server',
        ar: 'ويندوز سيرفر',
        en: 'Windows Server',
        headlineAr: 'تراخيص ويندوز سيرفر ستاندارد وداتا سنتر واسينشيال',
        headlineEn: 'Windows Server Standard, Datacenter and Essentials licences',
      },
      {
        slug: 'windows-server-cal',
        ar: 'تراخيص Windows Server CAL',
        en: 'Windows Server CAL',
        headlineAr: 'تراخيص وصول العميل CAL لمستخدم أو لجهاز',
        headlineEn: 'Client Access Licences, per user or per device',
      },
      {
        slug: 'windows-server-rds-cal',
        ar: 'تراخيص RDS CAL',
        en: 'Windows Server RDS CAL',
        headlineAr: 'تراخيص خدمات سطح المكتب البعيد بحزم 50 ترخيصاً',
        headlineEn: 'Remote Desktop Services CALs in packs of 50',
      },
    ],
  },
  {
    slug: 'office',
    ar: 'أوفيس',
    en: 'Office',
    headlineAr: 'أوفيس 365 وأوفيس 2016 و2019 و2021 و2024 بتراخيص أصلية',
    headlineEn: 'Office 365 and Office 2016 / 2019 / 2021 / 2024, genuine licences',
  },
  {
    slug: 'antivirus',
    ar: 'برامج الحماية',
    en: 'Antivirus',
    headlineAr: 'ESET و Norton و McAfee — اشتراكات حماية بمدد وأعداد أجهزة مختلفة',
    headlineEn: 'ESET, Norton and McAfee subscriptions across durations and device counts',
  },
  {
    slug: 'adobe',
    ar: 'أدوبي',
    en: 'Adobe',
    headlineAr: 'اشتراكات Creative Cloud و Acrobat Pro',
    headlineEn: 'Creative Cloud and Acrobat Pro subscriptions',
  },
  {
    slug: 'autodesk',
    ar: 'أوتوديسك',
    en: 'Autodesk',
    headlineAr: 'الحزمة الكاملة All Apps لسنة أو ثلاث سنوات',
    headlineEn: 'Autodesk All Apps, one-year and three-year terms',
  },
  {
    slug: 'coreldraw',
    ar: 'كوريل درو',
    en: 'CorelDRAW',
    headlineAr: 'Graphics Suite و Technical Suite لويندوز والماك',
    headlineEn: 'Graphics Suite and Technical Suite for Windows and Mac',
  },
  {
    slug: 'visual-studio',
    ar: 'فيجوال ستوديو',
    en: 'Visual Studio',
    headlineAr: 'Visual Studio Professional و Enterprise مدى الحياة',
    headlineEn: 'Visual Studio Professional and Enterprise, lifetime',
  },
  {
    slug: 'subscriptions',
    ar: 'اشتراكات',
    en: 'Subscriptions',
    headlineAr: 'Canva و CCleaner و Nitro PDF وحزم جاهزة',
    headlineEn: 'Canva, CCleaner, Nitro PDF and ready-made bundles',
  },
  {
    slug: 'developer-tools',
    ar: 'أدوات المطوّرين',
    en: 'Developer Tools',
    headlineAr: 'VMware و Parallels وأدوات التطوير والأتمتة',
    headlineEn: 'VMware, Parallels and development and automation tools',
  },
  {
    slug: 'wordpress',
    ar: 'سوق ووردبريس',
    en: 'WordPress Market',
    headlineAr: 'إضافات وقوالب ووردبريس بتراخيص سنوية',
    headlineEn: 'WordPress plugins and themes with annual licences',
  },
];

async function seedCategory(node: CategorySeed, parentId: string | null, position: number) {
  const category = await prisma.category.upsert({
    where: { slug: node.slug },
    update: { parentId, position },
    create: {
      slug: node.slug,
      parentId,
      position,
      status: PublishStatus.DRAFT,
    },
  });

  for (const [locale, name, headline] of [
    [Locale.AR, node.ar, node.headlineAr],
    [Locale.EN, node.en, node.headlineEn],
  ] as const) {
    await prisma.categoryTranslation.upsert({
      where: { categoryId_locale: { categoryId: category.id, locale } },
      update: { name, headline },
      create: { categoryId: category.id, locale, name, headline },
    });
  }

  let childPosition = 0;
  for (const child of node.children ?? []) {
    await seedCategory(child, category.id, childPosition++);
  }
}

async function main(): Promise<void> {
  for (const currency of CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: currency,
      create: currency,
    });
  }
  console.log(`currencies: ${CURRENCIES.length}`);

  for (const group of GROUPS) {
    await prisma.customerGroup.upsert({
      where: { name: group.name },
      update: group,
      create: group,
    });
  }
  console.log(`customer groups: ${GROUPS.length}`);

  for (const brand of BRANDS) {
    const record = await prisma.brand.upsert({
      where: { slug: brand.slug },
      update: { name: brand.en, website: brand.website ?? null },
      create: {
        slug: brand.slug,
        name: brand.en,
        website: brand.website ?? null,
      },
    });
    for (const [locale, name] of [
      [Locale.AR, `${brand.ar} ${brand.en}`],
      [Locale.EN, brand.en],
    ] as const) {
      await prisma.brandTranslation.upsert({
        where: { brandId_locale: { brandId: record.id, locale } },
        update: { name },
        create: { brandId: record.id, locale, name },
      });
    }
  }
  console.log(`brands: ${BRANDS.length}`);

  let position = 0;
  for (const category of CATEGORIES) {
    await seedCategory(category, null, position++);
  }
  const categoryCount = await prisma.category.count();
  console.log(`categories: ${categoryCount}`);

  // The Organization block, editable by the team rather than baked into a build.
  await prisma.seoSetting.upsert({
    where: { key: 'organization' },
    update: {},
    create: {
      key: 'organization',
      value: {
        name: 'متجر التفعيل الرقمي',
        nameEn: 'Digital Activation',
        url: 'https://digital-activation.com',
        logoUrl: 'https://digital-activation.com/logo.svg',
        email: 'help@digital-activation.com',
        // Fill in once the Trustpilot and Google Business profiles are live:
        // external citations are what answer engines actually weigh.
        sameAs: [],
      },
    },
  });

  for (const locale of [Locale.AR, Locale.EN] as const) {
    await prisma.navigation.upsert({
      where: { key_locale: { key: 'header', locale } },
      update: {},
      create: { key: 'header', locale, items: [] },
    });
  }

  console.log('seed complete');
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
