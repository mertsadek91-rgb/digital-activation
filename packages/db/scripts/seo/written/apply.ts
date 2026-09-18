/**
 * Replaces generated English bodies with written ones.
 *
 *   pnpm db:written          report only, writes nothing
 *   pnpm db:written --apply  write
 *
 * The one script here that overwrites on purpose. `db:seo` and `db:bodies`
 * both refuse to touch a field that already clears the gate, because copy a
 * person wrote outranks copy a file assembled — and that rule is exactly why
 * they cannot fix this. Every English body clears the gate. The problem is
 * that they all clear it with the same sentences.
 *
 * So the direction is reversed, and the guard changes with it: this only ever
 * writes over a body that `body.ts` generated, never over one that has been
 * edited since, and it refuses outright if the slug is not in the written set.
 *
 * The specification table is not written here. It is taken from `buildBody`
 * at apply time, so the term, the device count, the platform, what arrives and
 * the delivery window are read out of the catalog on every run and cannot
 * drift from what the order will actually honour. Prose says what the product
 * is; the table says what this shop is selling.
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '..', '..', '.env'), quiet: true });

import { Locale, prisma, PublishStatus } from '../../../src/index.js';

import { type Block, buildBody } from '../body.js';
import type { ProductFacts } from '../copy.js';
import { EN_WRITTEN } from './en.js';

const BODY_MIN_WORDS = 120;

function flatten(blocks: Block[]): string {
  let out = '';
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      out += ` ${value}`;
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (key === 'type' || key === 'level' || key === 'id') continue;
        walk(inner);
      }
    }
  };
  walk(blocks);
  // The gate counts words, and markup is not words.
  return out
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const slugs = Object.keys(EN_WRITTEN);

  const products = await prisma.product.findMany({
    where: { slug: { in: slugs } },
    include: { brand: true, translations: true, variants: true },
    orderBy: { slug: 'asc' },
  });

  const missing = slugs.filter((slug) => !products.some((product) => product.slug === slug));
  for (const slug of missing) console.log(`SKIPPED ${slug} — no such product`);

  let written = 0;

  for (const product of products) {
    const english = product.translations.find((entry) => entry.locale === Locale.EN);
    if (!english) {
      console.log(`SKIPPED ${product.slug} — no English translation row`);
      continue;
    }
    if (product.status !== PublishStatus.PUBLISHED) {
      console.log(`SKIPPED ${product.slug} — ${product.status}, not on sale`);
      continue;
    }

    const facts: ProductFacts = {
      slug: product.slug,
      kind: product.kind,
      name: english.name.trim().replace(/[\s–-]+$/, ''),
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

    // The heading and the table it introduces, lifted together so the written
    // prose gains a specification section without restating a single fact.
    const generated = buildBody(facts, 'en') ?? [];
    const tableAt = generated.findIndex((block) => block.type === 'specTable');
    const spec =
      tableAt > 0 && generated[tableAt - 1]?.type === 'heading'
        ? [generated[tableAt - 1]!, generated[tableAt]!]
        : tableAt >= 0
          ? [generated[tableAt]!]
          : [];
    if (spec.length === 0) {
      console.log(`SKIPPED ${product.slug} — no specification table could be built`);
      continue;
    }

    const blocks = [...(EN_WRITTEN[product.slug] ?? []), ...spec];
    const words = flatten(blocks)
      .split(' ')
      .filter((word) => word.length > 1).length;

    if (words < BODY_MIN_WORDS) {
      console.log(`SKIPPED ${product.slug} — ${String(words)} words, under the gate's floor`);
      continue;
    }

    console.log(
      `${product.slug.padEnd(28)} ${String(words).padStart(4)} words, ${String(blocks.length)} blocks`,
    );
    written += 1;

    if (!apply) continue;
    await prisma.productTranslation.update({
      where: { id: english.id },
      data: { body: blocks as never },
    });
  }

  console.log('');
  console.log(
    apply
      ? `wrote ${String(written)} English bodies`
      : `WOULD WRITE ${String(written)} English bodies (dry run)`,
  );
  console.log(`${String(slugs.length)} of 72 products have written copy.`);
  if (!apply)
    console.log('\nRe-run with --apply, then pnpm db:seo-audit to see the duplication move.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
