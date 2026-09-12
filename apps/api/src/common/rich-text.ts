/**
 * Sanitising the HTML that the storefront renders as HTML.
 *
 * `blocks.tsx` renders every `richText` block through `dangerouslySetInnerHTML`,
 * so whatever is in that column is markup on a page, not text on a page. Two
 * different things put markup in that column, and both of them need this:
 *
 *   - The panel, when somebody with a CATALOG session saves a body. That is a
 *     direct path from a staff account to a script tag on every product page,
 *     and an account here can already reveal a licence key — it does not also
 *     need to be able to publish JavaScript.
 *   - The WordPress import, which is where the bodies already came from. Those
 *     73 Arabic bodies carry 29 `<img>`, 4 `<link>`, 2 `<style>` and 1 `<xmp>`
 *     between them. The stylesheets can restyle the entire page around them,
 *     and `<xmp>` changes how the browser parses everything after it — which is
 *     enough on its own to smuggle markup past a tag filter.
 *
 * Which is why this runs on read as well as on save. Sanitising only on save
 * would leave every one of those in place until somebody happened to edit that
 * particular product, and nobody is going to edit all 73 to fix a `<style>`
 * tag they cannot see.
 */

/**
 * Tags that survive with their markup intact.
 *
 * Generous on purpose: the legacy bodies are real copy with headings, lists,
 * tables and code samples in them, and a list that dropped `<table>` would
 * take the spec tables with it.
 */
const KEPT_TAGS = new Set([
  'p',
  'br',
  'hr',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'sub',
  'sup',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'img',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'code',
  'pre',
  'span',
  'div',
  'section',
]);

/**
 * Tags whose *contents* go too.
 *
 * An unknown tag is unwrapped so its text survives; these are the ones where
 * the text is the problem. `<xmp>` and `<plaintext>` are in the list because
 * both change how a browser parses everything after them, which is enough on
 * its own to smuggle markup past a tag filter.
 */
const DROPPED_SUBTREES = [
  'script',
  'style',
  'link',
  'meta',
  'base',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'noscript',
  'svg',
  'math',
  'xmp',
  'plaintext',
  'template',
];

/** Attributes that carry meaning rather than presentation or behaviour. */
const KEPT_ATTRIBUTES = new Set([
  'href',
  'src',
  'alt',
  'title',
  'id',
  'dir',
  'lang',
  'colspan',
  'rowspan',
  'width',
  'height',
]);

/** Attributes naming a URL, which is where `javascript:` would arrive. */
const URL_ATTRIBUTES = new Set(['href', 'src']);

function safeUrl(value: string): boolean {
  const url = value.trim().toLowerCase();
  if (url.startsWith('/') || url.startsWith('#') || url.startsWith('./')) return true;
  return url.startsWith('https://') || url.startsWith('http://') || url.startsWith('mailto:');
}

function cleanAttributes(raw: string): string {
  const kept: string[] = [];

  for (const match of raw.matchAll(
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g,
  )) {
    const name = match[1]!.toLowerCase();
    if (!KEPT_ATTRIBUTES.has(name)) continue;

    const quoted = match[2]!;
    const value = quoted.startsWith('"') || quoted.startsWith("'") ? quoted.slice(1, -1) : quoted;
    if (URL_ATTRIBUTES.has(name) && !safeUrl(value)) continue;

    kept.push(`${name}="${value.replace(/"/g, '&quot;')}"`);
  }

  return kept.length > 0 ? ` ${kept.join(' ')}` : '';
}

/**
 * Strips what the storefront must not be made to render.
 *
 * Deliberately an allowlist for tags and a second one for attributes, with
 * unknown tags unwrapped rather than deleted: an allowlist that guesses wrong
 * loses copy, and unwrapping means the worst case is a paragraph that lost its
 * styling rather than a paragraph that vanished.
 */
export function sanitizeRichText(html: string): string {
  let out = html;

  for (const tag of DROPPED_SUBTREES) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi'), '');
    // A self-closing or unterminated one — `<link rel=…>` never has a closer.
    out = out.replace(new RegExp(`<\\s*/?${tag}\\b[^>]*>`, 'gi'), '');
  }

  // Comments can hide a conditional that a browser still parses.
  out = out.replace(/<!--[\s\S]*?-->/g, '');

  return out.replace(
    /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g,
    (_whole, slash, name, attrs) => {
      const tag = String(name).toLowerCase();
      if (!KEPT_TAGS.has(tag)) return '';
      if (slash === '/') return `</${tag}>`;

      const selfClosing = String(attrs).trimEnd().endsWith('/');
      return `<${tag}${cleanAttributes(String(attrs))}${selfClosing ? ' /' : ''}>`;
    },
  );
}

/**
 * Sanitises every `richText` block in a document, on the way out.
 *
 * Generic over the block type rather than importing the contracts union: this
 * is called from two services whose documents are typed differently
 * (`CatalogProduct['body']` and `ContentPage['blocks']`) and both are arrays of
 * the same union. Only `richText` carries raw HTML; every other block is
 * rendered as data by `blocks.tsx` and React escapes it.
 */
export function sanitizeBlocks<T extends { type: string }>(blocks: T[]): T[] {
  return blocks.map((block) =>
    block.type === 'richText' && typeof (block as { html?: unknown }).html === 'string'
      ? { ...block, html: sanitizeRichText((block as unknown as { html: string }).html) }
      : block,
  );
}
