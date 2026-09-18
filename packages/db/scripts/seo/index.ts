/**
 * Proposes the SEO title and meta description the publish gate refuses on.
 *
 *   pnpm db:seo              report only, writes nothing
 *   pnpm db:seo --apply      write to the database
 *   pnpm db:seo --locale=en  one locale instead of both
 *   pnpm db:seo --tighten    also re-propose copy that is over the ceiling
 *
 * 35 of the 73 products in this catalog are held out of the store by nothing
 * but those two fields, and every English translation is missing both. The
 * legacy store is where that number comes from: 43 of its 101 products shipped
 * with no title and no description, and across 178 days its sixteen category
 * pages earned zero search impressions between them.
 *
 * Three rules this script follows.
 *
 *   Dry run by default, like pnpm db:import. Forty products' worth of copy is
 *   an editorial decision, not a migration, and it should be read before it
 *   lands.
 *
 *   It proposes per field, never per product. A product whose Arabic title
 *   survived the import but whose description did not gets a description and
 *   keeps its title — copy a person wrote outranks copy this file assembled.
 *
 *   It never overwrites anything that already clears the gate. What is already
 *   good is left exactly as it is, so the script can be re-run after an
 *   editor has been through the panel.
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '..', '.env'), quiet: true });

import { Locale, prisma } from '../../src/index.js';

import { type Lang, type ProductFacts, propose } from './copy.js';

/**
 * `--tighten` exists because the floor and the ceiling are different rules.
 *
 * The gate refuses an *absent* title, so this script only ever filled gaps —
 * anything above the floor was a person's words and was left alone, which is
 * the right default and is why it is still the default. But 25 Arabic titles
 * and 6 descriptions came through the WooCommerce import above the width a
 * search result shows, and a title Google cuts at 60 characters has lost its
 * tail whether a person wrote it or not. Truncation is not a matter of taste.
 *
 * So the ceiling is opt-in, prints the old text beside the new with both
 * lengths, and still writes nothing without --apply. What it must never do is
 * make things worse: a replacement is only offered when it is genuinely
 * shorter than what is there and still clears the floor.
 */

/**
 * The gate's thresholds, copied rather than imported.
 *
 * They belong to READINESS_RULES and SEO_LENGTH_GUIDE in
 * packages/contracts/src/admin.ts, and that is where they are authoritative.
 * @da/db does not depend on @da/contracts — the contracts describe the API's
 * shapes and the database package sits underneath them — and adding the
 * dependency for one script would invert that for the sake of three numbers.
 * The cost is honest: if the gate's floor moves, this line has to move with
 * it, and the script would otherwise cheerfully propose titles the gate now
 * refuses.
 */
const READINESS_RULES = {
  seoTitleMinLength: 20,
  seoDescriptionMinLength: 70,
} as const;
const SEO_LENGTH_GUIDE = { seoTitleMax: 60, seoDescriptionMax: 160 } as const;

interface Row {
  slug: string;
  lang: Lang;
  /** Which of the two fields this run would write. */
  fields: ('seoTitle' | 'seoDescription')[];
  seoTitle: string;
  seoDescription: string;
  /** What is already there and is being kept. */
  keptTitle: string | null;
  keptDescription: string | null;
  /** What is being replaced, on a --tighten run. Null when the field was empty. */
  replacedTitle: string | null;
  replacedDescription: string | null;
}

const problems: { kind: string; detail: string }[] = [];

function needs(value: string | null, min: number): boolean {
  return (value ?? '').trim().length < min;
}

/** Over the width a search result shows, so its tail is being cut off. */
function overflows(value: string | null, max: number): boolean {
  return (value ?? '').trim().length > max;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const tighten = process.argv.includes('--tighten');
  const only = process.argv.find((argument) => argument.startsWith('--locale='))?.slice(9);
  const langs: Lang[] = only === 'ar' ? ['ar'] : only === 'en' ? ['en'] : ['ar', 'en'];

  const products = await prisma.product.findMany({
    include: { brand: true, translations: true, variants: true },
    orderBy: { slug: 'asc' },
  });

  const rows: Row[] = [];

  for (const product of products) {
    const english = product.translations.find((entry) => entry.locale === Locale.EN);

    // The Latin name is the whole basis of the copy, and it lives on the
    // English translation. Without it there is nothing honest to write, so the
    // product is reported rather than given a slug-shaped title.
    const name = english?.name.trim().replace(/[\s–-]+$/, '') ?? '';
    if (name.length < 2) {
      problems.push({
        kind: 'no English product name',
        detail: `${product.slug} — nothing to build a title from`,
      });
      continue;
    }

    if (product.variants.length === 0) {
      problems.push({
        kind: 'no variants',
        detail: `${product.slug} — no term, device count or delivery window to describe`,
      });
      continue;
    }

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
      const translation = product.translations.find((entry) => entry.locale === locale);
      if (!translation) {
        problems.push({
          kind: 'no translation row',
          detail: `${product.slug} (${lang}) — the import never created one`,
        });
        continue;
      }

      const fields: Row['fields'] = [];
      if (needs(translation.seoTitle, READINESS_RULES.seoTitleMinLength)) fields.push('seoTitle');
      if (needs(translation.seoDescription, READINESS_RULES.seoDescriptionMinLength)) {
        fields.push('seoDescription');
      }

      const proposal = propose(facts, lang, READINESS_RULES, SEO_LENGTH_GUIDE);

      /*
       * The ceiling pass, and the two guards on it.
       *
       * Shorter, or it is not an improvement — `propose` fits to the ceiling
       * but a hand-written title can already be under it in a way the
       * generator cannot beat. And still above the floor, because a proposal
       * that would not publish is a bug rather than a suggestion; the gate is
       * re-run on the result below for exactly that reason.
       */
      if (tighten) {
        const currentTitle = (translation.seoTitle ?? '').trim();
        const currentMeta = (translation.seoDescription ?? '').trim();
        if (
          !fields.includes('seoTitle') &&
          overflows(currentTitle, SEO_LENGTH_GUIDE.seoTitleMax) &&
          proposal.seoTitle.length < currentTitle.length &&
          proposal.seoTitle.length >= READINESS_RULES.seoTitleMinLength
        ) {
          fields.push('seoTitle');
        }
        if (
          !fields.includes('seoDescription') &&
          overflows(currentMeta, SEO_LENGTH_GUIDE.seoDescriptionMax) &&
          proposal.seoDescription.length < currentMeta.length &&
          proposal.seoDescription.length >= READINESS_RULES.seoDescriptionMinLength
        ) {
          fields.push('seoDescription');
        }
      }

      if (fields.length === 0) continue;

      // The gate is the only test this script can run on itself, so it runs
      // it: a proposal that would not publish is a bug, not a suggestion.
      if (proposal.seoTitle.length < READINESS_RULES.seoTitleMinLength) {
        problems.push({
          kind: 'proposed title too short for the gate',
          detail: `${product.slug} (${lang}) — ${String(proposal.seoTitle.length)} chars: ${proposal.seoTitle}`,
        });
      }
      if (proposal.seoDescription.length < READINESS_RULES.seoDescriptionMinLength) {
        problems.push({
          kind: 'proposed description too short for the gate',
          detail: `${product.slug} (${lang}) — ${String(proposal.seoDescription.length)} chars`,
        });
      }

      rows.push({
        slug: product.slug,
        lang,
        fields,
        seoTitle: proposal.seoTitle,
        seoDescription: proposal.seoDescription,
        keptTitle: fields.includes('seoTitle') ? null : (translation.seoTitle?.trim() ?? null),
        keptDescription: fields.includes('seoDescription')
          ? null
          : (translation.seoDescription?.trim() ?? null),
        replacedTitle:
          fields.includes('seoTitle') && (translation.seoTitle ?? '').trim().length > 0
            ? (translation.seoTitle ?? '').trim()
            : null,
        replacedDescription:
          fields.includes('seoDescription') && (translation.seoDescription ?? '').trim().length > 0
            ? (translation.seoDescription ?? '').trim()
            : null,
      });

      if (!apply) continue;

      await prisma.productTranslation.update({
        where: { id: translation.id },
        data: {
          ...(fields.includes('seoTitle') ? { seoTitle: proposal.seoTitle } : {}),
          ...(fields.includes('seoDescription') ? { seoDescription: proposal.seoDescription } : {}),
        },
      });
    }
  }

  // Two products proposing the same title are two pages competing for one
  // query, which is the exact failure this catalog was built to undo: the
  // legacy store ran eight ESET products and six Autodesk ones against each
  // other. A collision here almost always means two near-duplicate imports.
  const seen = new Map<string, { title: string; lang: Lang; slugs: string[] }>();
  for (const row of rows) {
    if (!row.fields.includes('seoTitle')) continue;
    const key = `${row.lang} ${row.seoTitle}`;
    const entry = seen.get(key) ?? { title: row.seoTitle, lang: row.lang, slugs: [] };
    entry.slugs.push(row.slug);
    seen.set(key, entry);
  }
  for (const entry of seen.values()) {
    if (entry.slugs.length < 2) continue;
    problems.push({
      kind: 'same title proposed for more than one product',
      detail: `(${entry.lang}) ${entry.title} — ${entry.slugs.join(', ')}`,
    });
  }

  report(rows, apply);
}

/**
 * The full text of every proposal, then a summary.
 *
 * The text first and in full, because the whole point of a dry run here is
 * that somebody reads forty products' worth of Arabic before any of it becomes
 * the thing Google shows. The summary is for deciding whether to re-run.
 */
function report(rows: Row[], apply: boolean): void {
  let slug = '';
  for (const row of rows) {
    if (row.slug !== slug) {
      slug = row.slug;
      console.log('');
      console.log(slug);
    }

    const mark = (field: 'seoTitle' | 'seoDescription'): string =>
      row.fields.includes(field) ? '+' : ' ';

    // The replaced text above the replacement, because a tightening run is
    // read as a comparison — "is the shorter one still the right sentence" —
    // and that question cannot be answered from the new text alone.
    if (row.replacedTitle !== null) {
      console.log(
        `  ${row.lang}  - title  [${String(row.replacedTitle.length).padStart(3)}] ${row.replacedTitle}`,
      );
    }
    console.log(
      `  ${row.lang}  ${mark('seoTitle')} title  [${String(row.seoTitle.length).padStart(3)}] ${
        row.keptTitle ?? row.seoTitle
      }`,
    );
    if (row.replacedDescription !== null) {
      console.log(
        `      - meta   [${String(row.replacedDescription.length).padStart(3)}] ${row.replacedDescription}`,
      );
    }
    console.log(
      `      ${mark('seoDescription')} meta   [${String(row.seoDescription.length).padStart(3)}] ${
        row.keptDescription ?? row.seoDescription
      }`,
    );
  }

  const byLang = (lang: Lang): Row[] => rows.filter((row) => row.lang === lang);
  const fieldCount = (lang: Lang, field: 'seoTitle' | 'seoDescription'): number =>
    byLang(lang).filter((row) => row.fields.includes(field)).length;

  console.log('');
  console.log('slug'.padEnd(46) + 'locale  title  meta');
  for (const row of rows) {
    console.log(
      row.slug.padEnd(46) +
        row.lang.padEnd(8) +
        (row.fields.includes('seoTitle') ? 'write' : '  —  ').padEnd(7) +
        (row.fields.includes('seoDescription') ? 'write' : '  —  '),
    );
  }

  console.log('');
  for (const lang of ['ar', 'en'] as const) {
    if (byLang(lang).length === 0) continue;
    console.log(
      `${lang}: ${String(byLang(lang).length)} products — ` +
        `${String(fieldCount(lang, 'seoTitle'))} titles, ` +
        `${String(fieldCount(lang, 'seoDescription'))} meta descriptions`,
    );
  }

  /**
   * A title past the ceiling, which the report used to say nothing about.
   *
   * Descriptions were checked here and titles were not, and four titles were
   * running to 72 characters — cut in the result, and cut in the middle of the
   * one line a searcher reads. They are shortened at the source now; anything
   * still over is a product whose name alone exceeds the budget, which is a
   * naming decision rather than something this script should take.
   */
  const longTitles = rows.filter(
    (row) => row.fields.includes('seoTitle') && row.seoTitle.length > SEO_LENGTH_GUIDE.seoTitleMax,
  );
  if (longTitles.length > 0) {
    console.log(
      `${String(longTitles.length)} titles run past ${String(SEO_LENGTH_GUIDE.seoTitleMax)} characters — ` +
        'the product name alone is over budget:',
    );
    for (const row of longTitles) {
      console.log(`  (${row.lang}) [${String(row.seoTitle.length)}] ${row.slug}`);
    }
  }

  // Not a failure, a judgement call left to the reader: the gate has no
  // ceiling and a long description still ranks, but everything past this is
  // cut in the result somebody actually sees.
  const long = rows.filter(
    (row) =>
      row.fields.includes('seoDescription') &&
      row.seoDescription.length > SEO_LENGTH_GUIDE.seoDescriptionMax,
  );
  if (long.length > 0) {
    const longest = Math.max(...long.map((row) => row.seoDescription.length));
    console.log(
      `${String(long.length)} descriptions run past ${String(SEO_LENGTH_GUIDE.seoDescriptionMax)} characters ` +
        `(longest ${String(longest)}) and will be truncated in the result.`,
    );
  }
  console.log(
    apply
      ? `WROTE ${String(rows.length)} product/locale pairs`
      : `WOULD WRITE ${String(rows.length)} product/locale pairs (dry run)`,
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
      console.log(`${kind} (${String(details.length)})`);
      for (const detail of details) console.log(`  ${detail}`);
    }
  }

  if (!apply) {
    console.log('');
    console.log('Nothing was written. Re-run with --apply once the copy reads right.');
    console.log(
      'A meta description is the sentence a buyer reads before deciding to click. ' +
        'Read them, not just the counts.',
    );
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
