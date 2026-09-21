/**
 * Removes three unsupportable claims from the live Arabic articles.
 *
 *   pnpm db:blog-fix          report only, writes nothing
 *   pnpm db:blog-fix --apply  write
 *
 * The first two were opening sentences, which is the worst place for a number
 * that does not hold: it is what a reader reads first and what the meta
 * description quotes, so the summary carries it too and both change together.
 *
 * **"more than 60% of devices worldwide"** — true around 2023, and wrong now:
 * Windows 11 passed Windows 10 in global desktop share during 2025. The claim
 * the sentence was making does not need the figure, so the figure goes and the
 * claim stays.
 *
 * **"more than 4 million files are stolen every day worldwide"** — no source,
 * and none findable. It sat two paragraphs above a promise of "real numbers
 * from independent labs", where an unsourced statistic does the most damage to
 * the sourced ones. Replaced with the sentence it was decorating, which was
 * the actual point: people pick an antivirus from an advertisement rather than
 * from a test result.
 *
 * **"بعد آلاف الطلبات"** — after thousands of orders — in two articles, not
 * the one I first reported. Removed on the owner's instruction rather than on
 * my reading: it is a claim about the shop's own trading history, this system
 * records 145 units and four orders only because the legacy order history was
 * never imported, and he is the one who knows. The recommendation each
 * sentence introduces is untouched, because it never rested on the volume —
 * only the preamble did. The English versions never carried it.
 *
 * Exact-match or refuse. Every replacement names the string it expects, and a
 * string that is not found stops that edit and fails the run rather than
 * guessing at a near match — these are published articles, and a regex that
 * approximately matches Arabic prose is how a sentence quietly loses a word.
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '..', '..', '..', '.env'), quiet: true });

import { Locale, prisma } from '../../../../src/index.js';

interface Correction {
  slug: string;
  why: string;
  /** Applied to `summary` and to every richText block, wherever it appears. */
  edits: { from: string; to: string }[];
}

const CORRECTIONS: Correction[] = [
  {
    slug: 'windows-10-vs-windows-11',
    why: 'the 60% share figure is out of date',
    edits: [
      {
        // Keeps the feminine subject, so "مستخدميها" later in the sentence
        // still agrees with it.
        from: 'نسخة ويندوز 10 لا تزال مثبّتة على أكثر من 60% من الأجهزة في العالم',
        to: 'نسخة ويندوز 10 لا تزال تعمل على أعداد كبيرة من الأجهزة',
      },
    ],
  },
  {
    slug: 'eset-vs-norton-vs-mcafee',
    why: 'the 4-million-files statistic has no source',
    edits: [
      {
        from: 'كل يوم تُسرق بيانات أكثر من <strong>4 ملايين ملف</strong> حول العالم — ومع ذلك كثير من المستخدمين في الخليج لا يزالون يختارون برنامج الحماية بناءً على إعلان رأوه أو اسم سمعوه قديماً',
        to: 'كثير من المستخدمين في الخليج يختارون برنامج الحماية بناءً على إعلان رأوه أو اسم سمعوه قديماً — لا على نتيجة اختبار مستقلّ',
      },
      {
        from: 'كل يوم تُسرق بيانات أكثر من 4 ملايين ملف حول العالم — ومع ذلك كثير من المستخدمين في الخليج لا يزالون يختارون برنامج الحماية بناءً على إعلان رأوه أو اسم سمعوه قديماً',
        to: 'كثير من المستخدمين في الخليج يختارون برنامج الحماية بناءً على إعلان رأوه أو اسم سمعوه قديماً — لا على نتيجة اختبار مستقلّ',
      },
    ],
  },
  {
    slug: 'windows-10-vs-windows-11',
    why: 'the order-volume claim is not supportable from here',
    edits: [
      {
        // Keeps the shop's name in the sentence and drops only the quantity.
        from: 'بعد آلاف الطلبات في متجر التفعيل الرقمي، هذه أكثر الحالات شيوعاً:',
        to: 'في متجر التفعيل الرقمي، هذه أكثر الحالات شيوعاً:',
      },
    ],
  },
  {
    slug: 'office-365-vs-office-2021',
    why: 'the order-volume claim is not supportable from here',
    edits: [
      {
        from: 'بعد آلاف الطلبات، إليك التوصية الذهبية حسب وضعك:',
        to: 'إليك التوصية الذهبية حسب وضعك:',
      },
    ],
  },
];

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  let changed = 0;

  for (const correction of CORRECTIONS) {
    const article = await prisma.article.findFirst({
      where: { slug: correction.slug, locale: Locale.AR },
    });
    if (!article) {
      console.log(`SKIPPED ${correction.slug} — no Arabic article`);
      process.exitCode = 1;
      continue;
    }

    const blocks = article.blocks as { type: string; html?: string }[];
    if (!Array.isArray(blocks)) {
      console.log(`SKIPPED ${correction.slug} — blocks is not an array`);
      process.exitCode = 1;
      continue;
    }

    let summary = article.summary ?? '';
    let nextBlocks = blocks;
    let hits = 0;
    let alreadyDone = 0;

    for (const edit of correction.edits) {
      const inSummary = summary.includes(edit.from);
      const inBody = nextBlocks.some(
        (block) => typeof block.html === 'string' && block.html.includes(edit.from),
      );

      if (!inSummary && !inBody) {
        // Either the edit has run before, or the text has changed under us.
        // The second is the dangerous one, so it is reported either way.
        if (summary.includes(edit.to) || nextBlocks.some((b) => b.html?.includes(edit.to))) {
          alreadyDone += 1;
        } else {
          console.log(`   NOT FOUND in ${correction.slug}: "${edit.from.slice(0, 48)}…"`);
        }
        continue;
      }

      if (inSummary) {
        summary = summary.split(edit.from).join(edit.to);
        hits += 1;
      }
      if (inBody) {
        nextBlocks = nextBlocks.map((block) =>
          typeof block.html === 'string' && block.html.includes(edit.from)
            ? { ...block, html: block.html.split(edit.from).join(edit.to) }
            : block,
        );
        hits += 1;
      }
    }

    if (hits === 0) {
      console.log(
        `${correction.slug.padEnd(28)} ${alreadyDone > 0 ? 'already corrected' : 'NOTHING MATCHED'}`,
      );
      if (alreadyDone === 0) process.exitCode = 1;
      continue;
    }

    console.log(`${correction.slug} — ${correction.why}`);
    console.log(`   ${String(hits)} replacement(s), summary and body`);
    console.log(`   summary now: ${summary.slice(0, 96)}…`);
    changed += 1;

    if (!apply) continue;
    await prisma.article.update({
      where: { id: article.id },
      data: { summary, blocks: nextBlocks as never },
    });
  }

  console.log('');
  console.log(
    apply ? `corrected ${String(changed)} articles` : `WOULD CORRECT ${String(changed)} (dry run)`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
