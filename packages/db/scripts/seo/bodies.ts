/**
 * Writes the product description the publish gate is waiting on.
 *
 *   pnpm db:bodies                 report only, writes nothing
 *   pnpm db:bodies --apply         write
 *   pnpm db:bodies --locale=en     one locale instead of both
 *
 * Measured against the gate: 73 of 73 English translations fail on `body` and
 * nothing else, and four Arabic ones fail the same way. One field, and it is
 * the whole of the English store.
 *
 * Three rules, the same three the SEO copy follows.
 *
 *   Dry run by default. Seventy products' worth of description is an editorial
 *   decision, not a migration, and it should be read before it lands.
 *
 *   It never overwrites a body that already clears the gate. Copy a person
 *   wrote outranks copy this file assembled, so the script can be re-run after
 *   an editor has been through the panel.
 *
 *   Every word comes from a column. Nothing is praised and nothing is claimed
 *   that the order would not honour.
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '..', '.env'), quiet: true });

import { Locale, prisma, PublishStatus } from '../../src/index.js';

import { buildBody } from './body.js';
import type { Lang, ProductFacts } from './copy.js';

/** The gate's own floor, copied for the reason `index.ts` gives. */
const BODY_MIN_WORDS = 120;

/** The same count the gate applies: single characters are not words. */
function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 1).length;
}

/**
 * Flattens a block document exactly as the gate does.
 *
 * Not "roughly as": the first version of this walked every string in the tree,
 * which counted the specification table's labels and the activation steps. The
 * gate counts neither — only `html`, `text`, and a FAQ's questions and answers —
 * so this script cheerfully wrote seventy-seven bodies it had measured at over
 * 120 words and the gate then refused every one of them. A checker that is
 * kinder than the check it stands in for is not a checker.
 *
 * Kept here rather than imported because `@da/db` does not depend on the API,
 * and the cost is stated plainly: if `readiness.ts` changes what it counts, this
 * has to change with it.
 */
function bodyText(body: unknown): string {
  if (!Array.isArray(body)) return '';

  let text = '';
  for (const block of body) {
    if (block === null || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    if (typeof record.html === 'string') text += ` ${record.html.replace(/<[^>]+>/g, ' ')}`;
    if (typeof record.text === 'string') text += ` ${record.text}`;
    if (Array.isArray(record.items)) {
      for (const item of record.items) {
        if (item !== null && typeof item === 'object') {
          const entry = item as Record<string, unknown>;
          if (typeof entry.q === 'string') text += ` ${entry.q}`;
          if (typeof entry.a === 'string') text += ` ${entry.a}`;
        }
      }
    }
  }
  return text;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const only = process.argv.find((arg) => arg.startsWith('--locale='))?.split('=')[1];

  const products = await prisma.product.findMany({
    include: { translations: true, brand: true, variants: true },
    orderBy: { slug: 'asc' },
  });

  const langs: Lang[] = only === 'ar' ? ['ar'] : only === 'en' ? ['en'] : ['ar', 'en'];
  let wrote = 0;
  let kept = 0;
  let short = 0;
  const samples: string[] = [];
  const seen = new Set<string>();

  for (const product of products) {
    const english = product.translations.find((t) => t.locale === Locale.EN);
    const name = english?.name ?? product.slug.replace(/-/g, ' ');

    const facts: ProductFacts = {
      slug: product.slug,
      kind: product.kind,
      name,
      brand: product.brand?.name ?? null,
      hasGoldenWarranty: product.hasGoldenWarranty,
      variants: product.variants.map((variant) => ({
        licensePeriodValue: variant.licensePeriodValue,
        licensePeriodUnit: variant.licensePeriodUnit,
        deviceCount: variant.deviceCount,
        platform: variant.platform,
        activationMethod: variant.activationMethod,
        credentialKind: variant.credentialKind,
        deliverySlaSeconds: variant.deliverySlaSeconds,
        warrantyDays: variant.warrantyDays,
      })),
    };

    for (const lang of langs) {
      const locale = lang === 'en' ? Locale.EN : Locale.AR;
      const translation = product.translations.find((t) => t.locale === locale);
      if (!translation) continue;

      // Never over a body that already passes. What is good is left alone.
      if (countWords(bodyText(translation.body)) >= BODY_MIN_WORDS) {
        kept += 1;
        continue;
      }

      const blocks = buildBody(facts, lang);
      if (!blocks) continue;

      const words = countWords(bodyText(blocks));
      if (words < BODY_MIN_WORDS) {
        short += 1;
        console.log(
          `  !! ${product.slug} (${lang}) — only ${String(words)} words, gate wants ${String(BODY_MIN_WORDS)}`,
        );
        continue;
      }

      // One sample of each language crossed with each thing this catalog
      // delivers — a key, and an account — because those two take different
      // sentences all the way through and a sample of one proves neither.
      const shape = `${lang}/${facts.variants[0]?.credentialKind ?? '?'}`;
      if (!seen.has(shape)) {
        seen.add(shape);
        samples.push(
          `[${shape}] ${product.slug}\n${bodyText(blocks).replace(/\s+/g, ' ').slice(0, 460)}…`,
        );
      }

      if (apply) {
        await prisma.productTranslation.update({
          where: { id: translation.id },
          data: { body: blocks as never },
        });
      }
      wrote += 1;
    }
  }

  console.log('');
  for (const sample of samples) console.log(`--- sample ---\n${sample}\n`);

  console.log(`${apply ? 'wrote' : 'would write'}: ${String(wrote)}`);
  console.log(`left alone (already clears the gate): ${String(kept)}`);
  if (short > 0) console.log(`too short to write: ${String(short)}`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply once the copy reads right.');
    console.log('A product description is the page a buyer reads. Read them, not just the counts.');
  } else {
    const published = await prisma.product.count({ where: { status: PublishStatus.PUBLISHED } });
    console.log(`published products: ${String(published)}`);
  }

  await prisma.$disconnect();
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
