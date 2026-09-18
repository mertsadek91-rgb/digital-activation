/**
 * Writes the product FAQs.
 *
 *   pnpm db:faq          report only, writes nothing
 *   pnpm db:faq --apply  write
 *
 * One rule decides what belongs in these, and it is the lesson from the bodies.
 *
 * Delivery time, the warranty, the refund policy and how to pay are the same
 * answer for all 71 products. They are already on every page — in the
 * specification table, in the trust block, and on the policy pages a footer
 * links to. Putting them in the FAQ as well would rebuild, in the most
 * machine-readable part of the page, exactly the duplication the bodies were
 * rewritten to remove: seventy-one identical question-and-answer pairs.
 *
 * So a product's FAQ answers only what that product raises and its neighbour
 * does not. "Will it run on my PC" belongs to Windows 11 and to nothing else in
 * this catalog. "Does it expire" belongs to a perpetual Office and is the wrong
 * question for a subscription. "Can I move it to another computer" is answered
 * differently by a retail key, an OEM key and an account.
 *
 * A note on what this is and is not worth. Google restricted FAQ rich results
 * in August 2023 to well-known authoritative government and health sites, so
 * these will not produce the expandable answers under a search listing for a
 * shop — that route closed. What they still do is answer the question on the
 * page for the person reading it, and give answer engines a passage they can
 * quote, which is where this kind of content is now read.
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '..', '..', '..', '.env'), quiet: true });

import { Locale, prisma, PublishStatus } from '../../../../src/index.js';

import { FAQ_OFFICE_2024 } from './office-2024.js';
import { FAQ_RDS_CALS } from './rds-cals.js';
import { FAQ_SECURITY } from './security.js';
import { FAQ_TOOLS } from './tools.js';
import { FAQ_WINDOWS_SERVER } from './windows-server.js';
import { WINDOWS_AND_OFFICE } from './windows-and-office.js';

const FAQ = {
  ...WINDOWS_AND_OFFICE,
  ...FAQ_OFFICE_2024,
  ...FAQ_WINDOWS_SERVER,
  ...FAQ_RDS_CALS,
  ...FAQ_SECURITY,
  ...FAQ_TOOLS,
};

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const slugs = Object.keys(FAQ);

  const products = await prisma.product.findMany({
    where: { slug: { in: slugs } },
    include: { translations: true },
    orderBy: { slug: 'asc' },
  });

  for (const slug of slugs.filter((s) => !products.some((p) => p.slug === s))) {
    console.log(`SKIPPED ${slug} — no such product`);
  }

  let written = 0;

  for (const product of products) {
    if (product.status !== PublishStatus.PUBLISHED) {
      console.log(`SKIPPED ${product.slug} — ${product.status}, not on sale`);
      continue;
    }
    const entry = FAQ[product.slug];
    if (!entry) continue;

    for (const [locale, items] of [
      [Locale.AR, entry.ar],
      [Locale.EN, entry.en],
    ] as const) {
      const translation = product.translations.find((row) => row.locale === locale);
      if (!translation) {
        console.log(`SKIPPED ${product.slug} (${locale}) — no translation row`);
        continue;
      }

      // Never over an FAQ somebody has already written in the panel. The same
      // rule the copy generators follow, and for the same reason.
      const existing = Array.isArray(translation.faq) ? translation.faq.length : 0;
      if (existing > 0) {
        console.log(`SKIPPED ${product.slug} (${locale}) — ${String(existing)} already there`);
        continue;
      }

      console.log(
        `${locale === Locale.AR ? 'ar' : 'en'}  ${product.slug.padEnd(30)} ${String(items.length)} questions`,
      );
      written += 1;

      if (!apply) continue;
      await prisma.productTranslation.update({
        where: { id: translation.id },
        data: { faq: items as never },
      });
    }
  }

  console.log('');
  console.log(
    apply
      ? `wrote ${String(written)} product/locale FAQs`
      : `WOULD WRITE ${String(written)} product/locale FAQs (dry run)`,
  );
  console.log(`${String(slugs.length)} of 71 products have a written FAQ.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
