/**
 * Splices the new sections into the three thin posts.
 *
 *   pnpm db:blog-expand          report only, writes nothing
 *   pnpm db:blog-expand --apply  write
 *
 * Each article is still one imported `richText` block, so the insertion point
 * is a string in that block's HTML rather than a block index. The script cuts
 * the block in two at the closing section's `<h2>`, puts the new blocks between
 * the halves, and leaves the conclusion where a conclusion belongs.
 *
 * It refuses rather than guesses. If the marker is not found — because somebody
 * has edited the article in the panel since — nothing is written for that post
 * and the run says so, because appending to the end instead would put four new
 * sections after the closing paragraph.
 *
 * It also refuses to run twice: if the article already contains the first new
 * heading, the post is left alone. The reading time is recomputed either way.
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '..', '..', '..', '.env'), quiet: true });

import { prisma } from '../../../../src/index.js';

import { EXPANSIONS } from './expand.js';

/** Artefacts of broken WordPress shortcodes, visible as text on the page. */
const JUNK: [RegExp, string][] = [
  [/>\s*Array\s*</g, '><'],
  [/&nbsp;/g, ' '],
];

function countWords(html: string): number {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1).length;
}

/**
 * Every string a block carries, for counting words and for detecting a second
 * run. Takes `unknown[]` because it is handed both the stored blocks and the
 * spliced result, and those are different shapes — narrowing here is cheaper
 * than a union the callers have to satisfy.
 */
function textOf(blocks: readonly unknown[]): string {
  return blocks
    .map((block) => {
      if (block === null || typeof block !== 'object') return '';
      const record = block as Record<string, unknown>;
      if (typeof record.html === 'string') return record.html;
      if (typeof record.text === 'string') return record.text;
      return JSON.stringify(record.rows ?? '');
    })
    .join(' ');
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  let changed = 0;

  for (const [slug, expansion] of Object.entries(EXPANSIONS)) {
    const article = await prisma.article.findFirst({ where: { slug } });
    if (!article) {
      console.log(`SKIPPED ${slug} — no such article`);
      continue;
    }

    const blocks = article.blocks as { type: string; html?: string }[];
    if (!Array.isArray(blocks)) {
      console.log(`SKIPPED ${slug} — blocks is not an array`);
      continue;
    }

    const firstNew = expansion.blocks.find((block) => block.type === 'heading');
    const marker = typeof firstNew?.text === 'string' ? firstNew.text : '';
    if (marker && textOf(blocks).includes(marker)) {
      console.log(`SKIPPED ${slug} — already expanded`);
      continue;
    }

    const at = blocks.findIndex(
      (block) => typeof block.html === 'string' && block.html.includes(expansion.insertBefore),
    );
    if (at === -1) {
      console.log(`REFUSED ${slug} — closing section not found; nothing written`);
      process.exitCode = 1;
      continue;
    }

    const target = blocks[at];
    const html = target?.html ?? '';
    const cut = html.indexOf(expansion.insertBefore);

    let head = html.slice(0, cut);
    let tail = html.slice(cut);
    for (const [pattern, replacement] of JUNK) {
      head = head.replace(pattern, replacement);
      tail = tail.replace(pattern, replacement);
    }

    const next = [
      ...blocks.slice(0, at),
      { ...target, html: head.trim() },
      ...expansion.blocks,
      { type: 'richText', html: tail.trim() },
      ...blocks.slice(at + 1),
    ];

    const wordsBefore = countWords(textOf(blocks));
    const wordsAfter = countWords(textOf(next));
    const minutes = Math.max(1, Math.round(wordsAfter / 200));

    console.log(slug);
    console.log(
      `   ${String(wordsBefore)} → ${String(wordsAfter)} words` +
        `  (+${String(expansion.blocks.length)} blocks)` +
        `  ${String(article.readingMinutes)} → ${String(minutes)} min`,
    );
    changed += 1;

    if (!apply) continue;
    await prisma.article.update({
      where: { id: article.id },
      data: { blocks: next as never, readingMinutes: minutes },
    });
  }

  console.log('');
  console.log(
    apply ? `expanded ${String(changed)} articles` : `WOULD EXPAND ${String(changed)} (dry run)`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
