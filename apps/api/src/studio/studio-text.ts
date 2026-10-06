import type { EditableBlock } from '@da/contracts';

/**
 * The article checks (CR-0006), pure so tests pin them: the length of the
 * body, the summary's length, and which links survive.
 */

const ANCHOR = /<a\b[^>]*\bhref\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

/** Words in a string: anything between spaces with a letter or digit in it. */
export function countWords(text: string): number {
  return text
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/**
 * Words in an article body, as a reader meets them: paragraphs, lists,
 * headings, steps, table cells and the FAQ. The summary is counted apart.
 */
export function bodyWordCount(blocks: EditableBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    switch (block.type) {
      case 'richText':
        total += countWords(block.html);
        break;
      case 'heading':
      case 'answerFirst':
        total += countWords(block.text);
        break;
      case 'steps':
        total += countWords(block.title ?? '');
        for (const step of block.steps) total += countWords(step.text);
        break;
      case 'specTable':
        total += countWords(block.title ?? '');
        for (const row of block.rows) total += countWords(`${row.label} ${row.value}`);
        break;
      case 'faq':
        total += countWords(block.title ?? '');
        for (const item of block.items) total += countWords(`${item.q} ${item.a}`);
        break;
    }
  }
  return total;
}

/**
 * A link's path on this site, or null: "https://digital-activation.com/store/x/"
 * and "/store/x" are the same path; another host is not this site.
 */
export function sitePath(href: string, siteHosts: string[]): string | null {
  const value = href.trim();
  if (value.startsWith('/') && !value.startsWith('//'))
    return value.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
  try {
    const url = new URL(value);
    if (!siteHosts.includes(url.hostname)) return null;
    return url.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return null;
  }
}

/**
 * Keeps only links to paths that exist on the site, written as relative
 * paths; any other link becomes its plain anchor text. Returns the paths kept.
 */
export function keepKnownLinks(
  html: string,
  allowed: ReadonlySet<string>,
  siteHosts: string[],
): { html: string; kept: string[]; dropped: number } {
  const kept: string[] = [];
  let dropped = 0;
  const out = html.replace(ANCHOR, (_match, href: string, text: string) => {
    const path = sitePath(href, siteHosts);
    if (path && allowed.has(path)) {
      kept.push(path);
      return `<a href="${path}">${text}</a>`;
    }
    dropped += 1;
    return text;
  });
  return { html: out, kept, dropped };
}
