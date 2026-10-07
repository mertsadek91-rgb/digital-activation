import type { EditableBlock } from '@da/contracts';

/**
 * The article checks (CR-0006), pure so tests pin them: the length of the
 * body, the summary's length, and which links survive.
 */

/** An anchor and its text; the href is read from the attributes apart. */
const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
/** An href in any of the three ways HTML allows: "…", '…' or bare (REV-0174). */
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
/** A private-use character marking a kept anchor while stray tags are removed. */
const HOLD = String.fromCharCode(0xe000);
const HELD = new RegExp(`${HOLD}(\\d+)${HOLD}`, 'g');
/** Anchor tags left over once the closed anchors are handled. */
const STRAY_ANCHOR_TAG = /<\/?a\b[^>]*>/gi;

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
  const anchors: string[] = [];
  let dropped = 0;
  const out = html
    .replace(ANCHOR, (_match, attributes: string, text: string) => {
      const found = HREF.exec(attributes);
      const href = found ? (found[1] ?? found[2] ?? found[3] ?? '') : '';
      const path = sitePath(href, siteHosts);
      if (path && allowed.has(path)) {
        kept.push(path);
        // Held aside so the stray-tag pass below cannot touch it.
        // Its text keeps no anchor of its own: a nested <a> is not a link.
        anchors.push(`<a href="${path}">${text.replace(STRAY_ANCHOR_TAG, '')}</a>`);
        return `${HOLD}${String(anchors.length - 1)}${HOLD}`;
      }
      dropped += 1;
      return text;
    })
    // An anchor never closed is no link a reader should follow: its tag goes
    // and its text stays.
    .replace(STRAY_ANCHOR_TAG, () => {
      dropped += 1;
      return '';
    })
    .replace(HELD, (_match, index: string) => anchors[Number(index)] ?? '');
  return { html: out, kept, dropped };
}
