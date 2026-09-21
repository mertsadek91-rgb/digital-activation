/**
 * Cleaning the seven imported blog posts, and giving them search copy.
 *
 *   pnpm db:articles          report only, writes nothing
 *   pnpm db:blog --apply  write
 *
 * These came over from WordPress as one `richText` block each, and the block
 * is rendered as markup rather than converted — deliberately, because turning
 * two years of Elementor output into structured blocks is an editorial pass
 * and guessing at it during an import loses content silently. That was the
 * right call. What it left behind is four things worth removing.
 *
 * **Dead WooCommerce product blocks.** Three articles have a product listing
 * baked into the prose — 14,586 characters of it in one 28,360-character post,
 * more than half the article. It carries 19 `?add-to-cart=` links that do
 * nothing on this store, 40 links to percent-encoded legacy WordPress product
 * URLs, 19 "Rated 0 out of 5" strings, and **prices from the old store**: $4.00
 * beside Office 2021 Pro Plus, which sells here for $19.95 or $37.45. A live
 * article quoting a price four years stale is worse than one quoting none.
 *
 * The replacement already exists and already works. `Article.relatedProductIds`
 * is populated on all seven posts, and the article page renders a live product
 * grid from it under "المنتجات في هذا المقال" — current names, current prices,
 * working links. The baked-in section was a stale duplicate of a section
 * rendered below it.
 *
 * **Stylesheets.** Three articles carry 28,058 characters of CSS in `<style>`
 * blocks. The API's sanitiser drops those subtrees on the way out, so nothing
 * renders — but they inflate every word count taken from the raw column,
 * including the reading estimates, and `office-365-vs-office-2021` reads as
 * 1,276 words when 569 of them are prose.
 *
 * **Editor instructions.** Fourteen HTML comments, several of which are notes
 * to whoever was pasting the article into Elementor.
 *
 * **Four spelling mistakes** that have been live for years: أشتراك for اشتراك,
 * بأستخدام for باستخدام, أغتنم for اغتنم, أنتهاء for انتهاء.
 *
 * And then the thing none of the seven had: a search title and a meta
 * description. Written from each article's own headings, which is why this file
 * reads them rather than inventing a summary.
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '..', '..', '.env'), quiet: true });

import { prisma } from '../../../src/index.js';

const MAX = { title: 60, description: 160 } as const;

/**
 * Written from the headings each article actually has.
 *
 * The three comparison posts get the keyword the query uses — "مقارنة",
 * "الفرق", "أيهما" — because that is the shape of the search, and the shortcut
 * posts get the task rather than a count, since neither article promises a
 * number and a description should not invent one.
 */
const SEO: Record<string, { title: string; description: string }> = {
  'windows-10-vs-windows-11': {
    title: 'ويندوز 10 أم ويندوز 11؟ مقارنة 2026',
    description:
      'الفروق العملية في الواجهة والأداء، ومتطلّبات TPM 2.0 التي تمنع الترقية، وما يعنيه انتهاء دعم ويندوز 10 — ومتى تبقى ومتى تنتقل.',
  },
  'office-365-vs-office-2021': {
    title: 'أوفيس 365 أم أوفيس 2021؟ الفرق والتكلفة',
    description:
      'اشتراك يتجدّد مقابل ترخيص يُشترى مرّة: ما تحصل عليه في كلٍّ منهما، وحساب التكلفة الفعلية على ثلاث سنوات، ولمن يناسب كل إصدار.',
  },
  'eset-vs-norton-vs-mcafee': {
    title: 'ESET أم Norton أم McAfee؟ مقارنة 2026',
    description:
      'مقارنة بين ESET وNorton وMcAfee: كيف قيّمناها، ونقاط القوة في كلٍّ منها، وجدول شامل، وتوصية بحسب نوع المستخدم والجهاز.',
  },
  'genuine-windows-10-11-keys': {
    title: 'نسخ ويندوز 10 و11 الأصلية: كيف تشتريها',
    description:
      'لماذا تهمّ النسخة الأصلية، وكيف تشتريها بسعر تنافسي، وخطوات التفعيل، وأي إصدار يناسب جهازك بين ويندوز 10 و11.',
  },
  'activate-office-365-on-multiple-devices': {
    title: 'تفعيل أوفيس 365 على أجهزة متعدّدة',
    description:
      'اختيار الخطّة، وخطوات تفعيل اشتراك Office 365 على أكثر من جهاز، وإدارة عدد الأجهزة المسموح بها والتخزين السحابي والتحديثات.',
  },
  'excel-keyboard-shortcuts': {
    title: 'اختصارات Excel: أهمّها وكيف تستخدمها',
    description:
      'لماذا تهمّ اختصارات Excel، وأهمّ ما يجب أن تعرفه منها، ونصائح عملية لتحسين إنتاجيتك في الجداول اليومية.',
  },
  'word-keyboard-shortcuts': {
    title: 'اختصارات Word: أهمّها وكيف تستخدمها',
    description:
      'أهمّ اختصارات لوحة المفاتيح في Word، وتعليمات عملية للتنسيق والقوائم والجداول، لتسريع تحرير المستندات الطويلة.',
  },
};

/** Spelling mistakes carried over from the old store, in body text and headings. */
const TYPOS: [RegExp, string][] = [
  [/أشتراك/g, 'اشتراك'],
  [/بأستخدام/g, 'باستخدام'],
  [/أغتنم/g, 'اغتنم'],
  [/أنتهاء/g, 'انتهاء'],
];

/**
 * Removes the baked-in WooCommerce product listing.
 *
 * The span runs from the `<h2>` that introduces it to the next `<h2>`, and it
 * is only removed when that span actually contains `add-to-cart` — so a heading
 * that merely mentions products, in an article with no dead block, is left
 * alone. Returns the html unchanged when there is nothing to remove.
 */
function stripProductBlock(html: string): { html: string; removed: number } {
  const headings = [...html.matchAll(/<h2[^>]*>/g)].map((match) => match.index);
  let out = html;
  let removed = 0;

  // Backwards, so an earlier removal cannot move a later offset.
  for (let index = headings.length - 1; index >= 0; index -= 1) {
    const start = headings[index];
    if (start === undefined) continue;
    const end = index + 1 < headings.length ? headings[index + 1] : out.length;
    if (end === undefined) continue;
    const span = out.slice(start, end);
    if (!span.includes('add-to-cart')) continue;
    out = out.slice(0, start) + out.slice(end);
    removed += span.length;
  }

  return { html: out, removed };
}

/**
 * Removes product cards that sit inside a list rather than under a heading.
 *
 * One survived the pass above, because it was never introduced by an `<h2>`:
 * a WooCommerce card in a `<ul>` mid-article, carrying a legacy image URL, a
 * percent-encoded link to the old WordPress product page, and "Original price
 * was: $10.00. Current price is: $5.00" for a subscription that sells here for
 * $12.95. A wrong price beside a dead link is the worst thing on the page.
 *
 * Matched on `Original price was:` and on a legacy upload URL next to a price,
 * both of which are signatures no editorial list item carries. A plain link to
 * a product is left alone — it is the card that is the problem, not the link.
 */
function stripProductCards(html: string): { html: string; removed: number } {
  let removed = 0;
  const out = html.replace(/<li\b[\s\S]*?<\/li>/g, (item) => {
    const isCard =
      item.includes('Original price was:') ||
      (item.includes('wp-content/uploads') && item.includes('<bdi>'));
    if (!isCard) return item;
    removed += item.length;
    return '';
  });
  return { html: out, removed };
}

function countWords(html: string): number {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1).length;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const articles = await prisma.article.findMany({ orderBy: { slug: 'asc' } });

  let changed = 0;

  for (const article of articles) {
    const blocks = article.blocks as { type: string; html?: string }[];
    if (!Array.isArray(blocks)) {
      console.log(`SKIPPED ${article.slug} — blocks is not an array`);
      continue;
    }

    const before = blocks.map((block) => block.html ?? '').join('').length;
    let styles = 0;
    let comments = 0;
    let products = 0;
    let typos = 0;

    const next = blocks.map((block) => {
      if (block.type !== 'richText' || typeof block.html !== 'string') return block;
      let html = block.html;

      const styleMatches = [...html.matchAll(/<style[\s\S]*?<\/style>/g)];
      styles += styleMatches.reduce((total, match) => total + match[0].length, 0);
      html = html.replace(/<style[\s\S]*?<\/style>/g, '');

      const commentMatches = [...html.matchAll(/<!--[\s\S]*?-->/g)];
      comments += commentMatches.length;
      html = html.replace(/<!--[\s\S]*?-->/g, '');

      const stripped = stripProductBlock(html);
      products += stripped.removed;
      html = stripped.html;

      const cards = stripProductCards(html);
      products += cards.removed;
      html = cards.html;
      // A list emptied of its only items is a list with nothing in it.
      html = html.replace(/<ul>\s*<\/ul>/g, '');

      for (const [pattern, correct] of TYPOS) {
        const hits = html.match(pattern);
        if (hits) typos += hits.length;
        html = html.replace(pattern, correct);
      }

      // Left behind by removing a block from the middle of the markup.
      html = html
        .replace(/(\s*<br\s*\/?>\s*){3,}/g, '<br />')
        .replace(/\s{3,}/g, ' ')
        .trim();

      return { ...block, html };
    });

    const afterHtml = next.map((block) => block.html ?? '').join('');
    const words = countWords(afterHtml);
    const minutes = Math.max(1, Math.round(words / 200));

    const seo = SEO[article.slug];
    const currentSeo = (article.seo ?? {}) as Record<string, unknown>;
    const needsSeo =
      seo !== undefined &&
      (currentSeo.title !== seo.title || currentSeo.description !== seo.description);

    if (seo !== undefined) {
      if (seo.title.length > MAX.title) {
        console.log(`REFUSED ${article.slug} title — ${String(seo.title.length)} chars`);
        process.exitCode = 1;
        continue;
      }
      if (seo.description.length > MAX.description) {
        console.log(
          `REFUSED ${article.slug} description — ${String(seo.description.length)} chars`,
        );
        process.exitCode = 1;
        continue;
      }
    }

    const touched =
      styles > 0 ||
      comments > 0 ||
      products > 0 ||
      typos > 0 ||
      needsSeo ||
      minutes !== article.readingMinutes;
    if (!touched) {
      console.log(`${article.slug.padEnd(42)} nothing to do`);
      continue;
    }

    console.log(article.slug);
    console.log(
      `   ${String(before)} → ${String(afterHtml.length)} chars` +
        `  (css ${String(styles)}, products ${String(products)}, comments ${String(comments)}, typos ${String(typos)})`,
    );
    console.log(
      `   ${String(words)} words, ${String(minutes)} min (was ${String(article.readingMinutes)})`,
    );
    if (needSeoLine(needsSeo)) {
      console.log(`   title: ${seo?.title ?? ''}`);
      console.log(`   meta:  ${seo?.description ?? ''}`);
    }
    changed += 1;

    if (!apply) continue;
    await prisma.article.update({
      where: { id: article.id },
      data: {
        blocks: next as never,
        readingMinutes: minutes,
        ...(seo === undefined
          ? {}
          : { seo: { ...currentSeo, title: seo.title, description: seo.description } as never }),
      },
    });
  }

  console.log('');
  console.log(
    apply
      ? `updated ${String(changed)} articles`
      : `WOULD UPDATE ${String(changed)} articles (dry run)`,
  );
}

/** Keeps the noisy conditional out of the log block above. */
function needSeoLine(needsSeo: boolean): boolean {
  return needsSeo;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
