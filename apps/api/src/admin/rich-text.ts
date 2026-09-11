/**
 * Reading and writing a product body through the panel.
 *
 * The body is a block document, but in this catalog it is one shape: all 73
 * imported Arabic bodies are a single `richText` block holding the WooCommerce
 * markup verbatim, and all 73 English ones are empty. So the editor reads that
 * HTML and writes it back, rather than pretending to be a block editor that
 * does not exist yet. Anything richer than richText — an `faq`, a `specTable`
 * — is refused rather than flattened: those two blocks are precisely what a
 * search or answer engine quotes, and losing one to save a meta description
 * would be a bad trade made silently.
 *
 * Everything written here is sanitised, because `blocks.tsx` renders richText
 * through `dangerouslySetInnerHTML`. That is a direct path from a CATALOG
 * session to a script tag on every storefront page, and an admin account on
 * this store can already reveal a licence key — it does not also need to be
 * able to publish JavaScript. The legacy bodies as they stand carry four
 * `<style>` blocks, four `<link>` tags and two `<xmp>` tags that are being
 * injected into the storefront right now; saving a body through this path is
 * the first thing that cleans one.
 */

/**
 * Tags that survive a save with their markup intact.
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

export interface BodyForEditing {
  html: string;
  editable: boolean;
  otherBlocks: string[];
}

/** Reads a stored block document into the one string the editor shows. */
export function readBody(body: unknown): BodyForEditing {
  if (!Array.isArray(body)) return { html: '', editable: true, otherBlocks: [] };

  const html: string[] = [];
  const otherBlocks: string[] = [];

  for (const block of body) {
    if (block === null || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;

    if (record.type === 'richText' && typeof record.html === 'string') {
      html.push(record.html);
      continue;
    }
    otherBlocks.push(typeof record.type === 'string' ? record.type : 'unknown');
  }

  return {
    html: html.join('\n'),
    editable: otherBlocks.length === 0,
    otherBlocks: [...new Set(otherBlocks)],
  };
}

/**
 * Turns the editor's HTML back into a block document.
 *
 * One richText block, which is what it came from. An empty box writes an empty
 * document rather than a block holding nothing — the gate then reports zero
 * words, which is the truth.
 */
export function writeBody(html: string): { type: 'richText'; html: string }[] {
  const clean = sanitizeRichText(html).trim();
  return clean.length === 0 ? [] : [{ type: 'richText', html: clean }];
}
