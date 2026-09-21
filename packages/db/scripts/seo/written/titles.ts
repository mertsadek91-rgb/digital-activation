/**
 * Arabic search titles and meta descriptions, written rather than generated.
 *
 *   pnpm db:titles          report only, writes nothing
 *   pnpm db:titles --apply  write
 *
 * `pnpm db:seo --tighten` found 24 Arabic titles and 6 descriptions above the
 * width a search result shows, and proposed shorter ones. Reading those
 * proposals is what stopped them being applied: 20 of the current titles carry
 * the product's name in Arabic script — ويندوز سيرفر ستاندرد, أوفيس ٢٠٢١ برو
 * بلس, نورتن انتي فايروس — and the generator, working from the Latin name by
 * design, dropped every one of them. For a shop selling into Arabic queries
 * that trades a real matching signal for a cosmetic length fix.
 *
 * So these are written by hand to keep both, which is the thing a generator
 * could not do: the Latin name, which is what the publisher calls it and what
 * half the searches use, and the Arabic transliteration, which is what the
 * other half type. What gets cut instead is everything that was never a
 * keyword — the term and device count repeated from the specification table,
 * the delivery promise, and the adjectives.
 *
 * `اشتراك` or `مفتاح` stays at the front of the Arabic half wherever it was
 * there, because it is the word an Arabic buyer actually searches with and the
 * one that says which kind of product this is before the click.
 *
 * Two titles are left alone deliberately. `claude-skills` keeps the shop's own
 * "500 مهارة" claim, trimmed but not reworded, because that number is theirs
 * and not mine to restate. Nothing here invents a claim: every replacement is
 * the existing title with the non-keywords removed.
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '..', '..', '.env'), quiet: true });

import { Locale, prisma, PublishStatus } from '../../../src/index.js';

const MAX = { title: 60, description: 160 } as const;
const MIN = { title: 20, description: 70 } as const;

/** Both scripts, inside sixty characters. */
const AR_TITLE: Record<string, string> = {
  'adobe-acrobat-pro-dc': 'Adobe Acrobat Pro DC | اشتراك أكروبات برو لتحرير PDF',
  'adobe-creative-cloud': 'Adobe Creative Cloud | اشتراك أدوبي كريتف كلاود',
  'autodesk-all-apps': 'Autodesk All Apps | حزمة أوتوديسك الكاملة',
  'ccleaner-professional': 'CCleaner Professional | تنظيف وتسريع الكمبيوتر',
  'ccleaner-professional-plus': 'CCleaner Professional Plus | مع Recuva وSpeccy',
  // Their claim, trimmed — not reworded.
  'claude-skills': 'حزمة Claude Skills — 500 مهارة للذكاء الاصطناعي',
  'elementor-pro': 'Elementor Pro | إضافة تصميم مواقع ووردبريس',
  'eset-internet-security-nod32': 'ESET Internet Security NOD32 | حماية من الفيروسات',
  'mcafee-internet-security-10-deivce': 'McAfee Internet Security | حماية 10 أجهزة',
  'norton-security-premium': 'Norton Security Premium | نورتن انتي فايروس',
  'office-2019-pro-plus': 'Office 2019 Pro Plus | مفتاح أوفيس 2019 برو بلس',
  'office-2021-pro-plus': 'Office 2021 Pro Plus | مفتاح أوفيس 2021 برو بلس',
  'office-365-pro-plus': 'Office 365 Pro Plus | اشتراك أوفيس 365 برو بلس',
  'protection-bundle-windows-11-pro-office-365-mcafee': 'باقة Windows 11 Pro + Office 365 + McAfee',
  'windows-server-2016-datacenter': 'Windows Server 2016 Datacenter | ويندوز سيرفر داتا سنتر',
  'windows-server-2016-standard': 'Windows Server 2016 Standard | ويندوز سيرفر ستاندرد',
  'windows-server-2019-datacenter': 'Windows Server 2019 Datacenter | ويندوز سيرفر داتا سنتر',
  'windows-server-2019-essential': 'Windows Server 2019 Essential | ويندوز سيرفر إسنشال',
  'windows-server-2019-standard': 'Windows Server 2019 Standard | ويندوز سيرفر ستاندرد',
  'windows-server-2022-datacenter': 'Windows Server 2022 Datacenter | ويندوز سيرفر داتا سنتر',
  'windows-server-2022-essential': 'Windows Server 2022 Essential | ويندوز سيرفر إسنشال',
  'windows-server-2022-standard': 'Windows Server 2022 Standard | ويندوز سيرفر ستاندرد',
  'windows-server-2025-datacenter': 'Windows Server 2025 Datacenter | ويندوز سيرفر داتا سنتر',
  'windows-server-2025-standard': 'Windows Server 2025 Standard | ويندوز سيرفر ستاندرد',
};

/**
 * The six descriptions that were being cut off.
 *
 * The cut always fell on the tail, and the tail was always the same three
 * things: a delivery promise, a warranty mention, and an adjective. What
 * replaces them is a concrete detail from the page — the feature somebody is
 * choosing this product for — because a description is the sentence that
 * decides the click and it has room for exactly one reason.
 */
const AR_DESCRIPTION: Record<string, string> = {
  'adobe-acrobat-pro-dc':
    'اشتراك Adobe Acrobat Pro DC لسنة: تحرير النصوص والصور داخل ملف PDF جاهز، وOCR للمستندات الممسوحة، وتنقيح يحذف المعلومة فعلاً، وتوقيع إلكتروني.',
  'autodesk-all-apps':
    'اشتراك Autodesk All Apps لسنة: AutoCAD وRevit وCivil 3D وInventor و3ds Max وMaya في ترخيص واحد، بكود استرداد على حساب أوتوديسك تحدّده أنت.',
  'ccleaner-professional':
    'مفتاح CCleaner Professional: تنظيف مجدول يعمل وحده، ومراقبة فورية، ومحدّث للتعريفات ومحدّث للبرامج — والثاني إجراء أمني أكثر منه راحة.',
  'ccleaner-professional-plus':
    'مفتاح CCleaner Professional Plus: التنظيف المجدول مع Recuva لاسترجاع الملفات المحذوفة، وDefraggler، وSpeccy لقراءة مكوّنات الجهاز وحرارته.',
  'protection-bundle-windows-11-pro-office-365-mcafee':
    'ويندوز 11 برو مع حساب أوفيس 365 واشتراك McAfee يغطّي ويندوز وماك وأندرويد وiOS. ثلاثة تراخيص، وكلٌّ منها يُفعَّل في مكانه الخاص.',
  'windows-server-2025-datacenter':
    'مفتاح Windows Server 2025 Datacenter مدى الحياة: أجهزة افتراضية بلا حدّ، وHotpatching للتحديث بلا إعادة تشغيل، وStorage Spaces Direct.',
};

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const slugs = [...new Set([...Object.keys(AR_TITLE), ...Object.keys(AR_DESCRIPTION)])];

  const products = await prisma.product.findMany({
    where: { slug: { in: slugs } },
    include: { translations: { where: { locale: Locale.AR } } },
    orderBy: { slug: 'asc' },
  });

  for (const slug of slugs.filter((s) => !products.some((p) => p.slug === s))) {
    console.log(`SKIPPED ${slug} — no such product`);
  }

  const seen = new Map<string, string[]>();
  let titles = 0;
  let descriptions = 0;
  let refused = 0;

  for (const product of products) {
    if (product.status !== PublishStatus.PUBLISHED) {
      console.log(`SKIPPED ${product.slug} — ${product.status}, not on sale`);
      continue;
    }
    const translation = product.translations[0];
    if (!translation) {
      console.log(`SKIPPED ${product.slug} — no Arabic translation row`);
      continue;
    }

    const title = AR_TITLE[product.slug];
    const description = AR_DESCRIPTION[product.slug];

    if (title !== undefined) {
      // The gate's floor and the result's ceiling, both checked here rather
      // than trusted: a hand-written line is as capable of being 61 characters
      // as a generated one.
      if (title.length > MAX.title || title.length < MIN.title) {
        console.log(`REFUSED ${product.slug} title — ${String(title.length)} chars`);
        refused += 1;
      } else {
        const was = (translation.seoTitle ?? '').trim();
        console.log(`title  ${product.slug}`);
        console.log(`   was [${String(was.length).padStart(2)}] ${was}`);
        console.log(`   now [${String(title.length).padStart(2)}] ${title}`);
        (seen.get(title) ?? seen.set(title, []).get(title)!).push(product.slug);
        titles += 1;
        if (apply) {
          await prisma.productTranslation.update({
            where: { id: translation.id },
            data: { seoTitle: title },
          });
        }
      }
    }

    if (description !== undefined) {
      if (description.length > MAX.description || description.length < MIN.description) {
        console.log(`REFUSED ${product.slug} description — ${String(description.length)} chars`);
        refused += 1;
      } else {
        const was = (translation.seoDescription ?? '').trim();
        console.log(`meta   ${product.slug}`);
        console.log(`   was [${String(was.length)}] ${was}`);
        console.log(`   now [${String(description.length)}] ${description}`);
        descriptions += 1;
        if (apply) {
          await prisma.productTranslation.update({
            where: { id: translation.id },
            data: { seoDescription: description },
          });
        }
      }
    }
  }

  // Two products with one title are two pages bidding for one query — the
  // failure this catalog was rebuilt to undo, and the easiest one to
  // reintroduce by hand while shortening twenty-four lines at once.
  for (const [text, list] of seen) {
    if (list.length > 1) {
      console.log(`COLLISION  ${list.join(', ')} — ${text}`);
      refused += 1;
    }
  }

  console.log('');
  console.log(
    apply
      ? `wrote ${String(titles)} titles and ${String(descriptions)} descriptions`
      : `WOULD WRITE ${String(titles)} titles and ${String(descriptions)} descriptions (dry run)`,
  );
  if (refused > 0) {
    console.log(`${String(refused)} refused or colliding — nothing above is safe to apply.`);
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
