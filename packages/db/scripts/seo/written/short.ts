/**
 * Short descriptions — the line under the product name on a card and above
 * the body on the page.
 *
 *   pnpm db:short          report only, writes nothing
 *   pnpm db:short --apply  write
 *
 * Two different problems, so two different methods.
 *
 * **English had none at all** — 71 of 71 empty, which is why the store index
 * and every category grid showed a name, a price and nothing else. These are
 * derived rather than written: the opening clause of each page's `answerFirst`
 * block, which was written to stand alone for exactly this kind of lifting.
 * That makes them unique by construction, because the blocks they come from
 * are, and it means the card and the page can never say different things about
 * the same product.
 *
 * **Arabic had them, and most are fine.** 71 present, 56 distinct — written by
 * hand in the old store over years, and outside a script's business to rewrite.
 * What is replaced is only what says nothing: fourteen products sharing
 * "⚡️يصلك في ثواني", which is a delivery promise rather than a description and
 * appears identically under fourteen different product names; two pairs sharing
 * a line; and four with a typo that has been on the live site for years
 * ("متفاح" for "مفتاح", "أشتراك" for "اشتراك"). Everything else is left alone.
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '..', '..', '.env'), quiet: true });

import { Locale, prisma, PublishStatus } from '../../../src/index.js';

/**
 * The Arabic lines that needed writing, and only those.
 *
 * Kept in the register the shop already uses — short, concrete, no verb where
 * a noun will do — because a card full of sentences beside sixty fragments
 * would read as two different shops.
 */
const AR_SHORT: Record<string, string> = {
  // Fourteen products shared a delivery promise instead of a description.
  'windows-11-pro': 'ترخيص دائم + BitLocker وHyper-V وسطح مكتب بعيد',
  'windows-10-pro': 'ترخيص دائم بمزايا Pro لأجهزة لا تقبل ويندوز 11',
  'windows-11-home': 'ترخيص دائم للاستخدام الشخصي على جهاز واحد',
  'windows-10-home': 'ترخيص دائم لجهاز لا يقبل ويندوز 11',
  'windows-server-2016-standard': 'سيرفر 2016 — خادم واحد وجهازان افتراضيان',
  'windows-server-2016-datacenter': 'سيرفر 2016 — أجهزة افتراضية بلا حدّ',
  'windows-server-2019-standard': 'سيرفر 2019 — خادم واحد وجهازان افتراضيان',
  'windows-server-2019-datacenter': 'سيرفر 2019 — أجهزة افتراضية بلا حدّ',
  'windows-server-2019-essential': 'سيرفر 2019 — حتى 25 مستخدماً بلا رخص CAL',
  'windows-server-2022-standard': 'سيرفر 2022 — خادم واحد وجهازان افتراضيان',
  'windows-server-2022-datacenter': 'سيرفر 2022 — أجهزة افتراضية بلا حدّ',
  'windows-server-2022-essential': 'سيرفر 2022 — حتى 25 مستخدماً بلا رخص CAL',
  'starter-bundle-windows-11-pro-office-365': 'ويندوز 11 برو + أوفيس 365 لجهاز جديد',
  'protection-bundle-windows-11-pro-office-365-mcafee': 'ويندوز 11 برو + أوفيس 365 + مكافي',

  // Two pairs that shared a line.
  'ccleaner-professional': 'تنظيف مجدول وتحديث للتعريفات والبرامج',
  'ccleaner-professional-plus': 'يضمّ Recuva لاسترجاع الملفات وDefraggler وSpeccy',

  // Typos carried over from the old store.
  'office-2016-pro-plus': 'مفتاح تفعيل أوفيس 2016 برو بلس أصلي',
  'office-2019-pro-plus': 'مفتاح تفعيل أوفيس 2019 برو بلس أصلي',
  'office-2021-pro-plus': 'مفتاح تفعيل أوفيس 2021 برو بلس أصلي',
  'autodesk-all-apps': 'اشتراك أوتوديسك بالحزمة الكاملة',
};

/**
 * The opening clause of a written page, cut at the first colon, em dash or
 * sentence end.
 *
 * Every `answerFirst` in the written set opens by naming what the product is
 * before it starts listing, so the clause before the first break is a complete
 * description on its own. Anything longer belongs on the page, not on a card.
 */
function lede(text: string): string {
  const cut = text.search(/[:—]|\.\s/);
  const head = (cut > 0 ? text.slice(0, cut) : text).trim();
  return head.replace(/[,;]$/, '');
}

const MAX = 160;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const products = await prisma.product.findMany({
    where: { status: PublishStatus.PUBLISHED },
    include: { translations: true },
    orderBy: { slug: 'asc' },
  });

  let english = 0;
  let arabic = 0;
  let skipped = 0;

  for (const product of products) {
    const en = product.translations.find((entry) => entry.locale === Locale.EN);
    const ar = product.translations.find((entry) => entry.locale === Locale.AR);

    // --- English: derived, and only where it is missing ----------------------
    if (en && !en.shortDesc?.trim()) {
      const blocks = Array.isArray(en.body) ? (en.body as { type: string; text?: string }[]) : [];
      const opening = blocks.find((block) => block.type === 'answerFirst')?.text;

      if (!opening) {
        console.log(`SKIPPED ${product.slug} (en) — no answerFirst to derive from`);
        skipped += 1;
      } else {
        const text = lede(opening);
        // A page still on generated copy opens with the generator's sentence,
        // which is the same for every product it wrote. Deriving from that
        // would put one line under several different names — the exact fault
        // this is fixing.
        if (text.includes('is a genuine lifetime licence')) {
          console.log(`SKIPPED ${product.slug} (en) — page is still generated copy`);
          skipped += 1;
        } else if (text.length > MAX) {
          console.log(
            `SKIPPED ${product.slug} (en) — derived line is ${String(text.length)} chars`,
          );
          skipped += 1;
        } else {
          console.log(`en  ${product.slug.padEnd(44)} ${text}`);
          english += 1;
          if (apply) {
            await prisma.productTranslation.update({
              where: { id: en.id },
              data: { shortDesc: text },
            });
          }
        }
      }
    }

    // --- Arabic: only the lines listed above --------------------------------
    const replacement = AR_SHORT[product.slug];
    if (ar && replacement !== undefined && ar.shortDesc?.trim() !== replacement) {
      console.log(`ar  ${product.slug.padEnd(44)} ${ar.shortDesc ?? '(empty)'}  →  ${replacement}`);
      arabic += 1;
      if (apply) {
        await prisma.productTranslation.update({
          where: { id: ar.id },
          data: { shortDesc: replacement },
        });
      }
    }
  }

  console.log('');
  console.log(
    apply
      ? `wrote ${String(english)} English and ${String(arabic)} Arabic short descriptions`
      : `WOULD WRITE ${String(english)} English and ${String(arabic)} Arabic (dry run)`,
  );
  if (skipped > 0) console.log(`${String(skipped)} skipped — see above.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
