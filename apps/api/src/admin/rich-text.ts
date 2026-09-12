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
 * The sanitiser itself lives in `common/rich-text.ts`, because saving is not
 * the only way markup reaches the storefront — the WordPress import already
 * put `<style>`, `<link>` and `<xmp>` tags in these columns, and the catalog
 * and content services clean them on the way out.
 */
import { sanitizeRichText } from '../common/rich-text.js';

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
