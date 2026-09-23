import { type ContentBlock, type EditableBlock, ROUTES, blockDocumentSchema } from '@da/contracts';

import { sanitizeRichText } from '../common/rich-text.js';

/**
 * The pure half of editing pages, posts and brand hubs.
 *
 * Kept out of the service so every rule that decides what reaches the
 * storefront can be tested without a database: what counts as editable, what a
 * save is allowed to store, which SEO keys survive, which slugs a page may not
 * take, and when a post's date is stamped.
 */

// --- reading a stored document ------------------------------------------------

/**
 * A stored block document, as the editor can hold it — without loss.
 *
 * The product editor shapes six block types and treats everything else as
 * opaque. That is right for product bodies and subtly wrong here: the
 * storefront's vocabulary allows an H4, an anchor `id` on a heading and an
 * image on a step, and the product editor's shapes have no room for any of
 * them. Shaping such a block would drop the extra on the next save — a deep
 * link from a guide stops working, and nobody touched the heading.
 *
 * So a block is offered for editing only when the editor's shape of it is
 * exactly the stored JSON. Anything the form cannot hold whole goes through as
 * `{ type, raw }` and comes back untouched.
 */
export function toEditableDocument(stored: unknown): ContentBlock[] {
  if (!Array.isArray(stored)) return [];

  const out: ContentBlock[] = [];
  for (const entry of stored) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const block = entry as Record<string, unknown>;
    const type = typeof block.type === 'string' ? block.type : 'unknown';

    const shaped = shape(type, block);
    if (shaped && sameJson(comparable(shaped), comparable(block))) {
      out.push(
        // Cleaned on the way into the panel, which renders it live in the
        // preview: the imported bodies never passed the save-time sanitiser,
        // and an `<img onerror>` there runs with a staff session.
        shaped.type === 'richText' ? { ...shaped, html: sanitizeRichText(shaped.html) } : shaped,
      );
    } else {
      out.push({ type, raw: entry });
    }
  }
  return out;
}

/** The editor's shape of one block, or null for a type it does not draw. */
function shape(type: string, block: Record<string, unknown>): EditableBlock | null {
  const title = typeof block.title === 'string' ? { title: block.title } : {};
  switch (type) {
    case 'richText':
      return typeof block.html === 'string' ? { type, html: block.html } : null;
    case 'heading':
      if (block.level !== 2 && block.level !== 3) return null;
      return typeof block.text === 'string' ? { type, level: block.level, text: block.text } : null;
    case 'answerFirst':
      return typeof block.text === 'string' ? { type, text: block.text } : null;
    case 'steps':
      return {
        type,
        ...title,
        steps: list(block.steps).map((step) => ({ text: read(step, 'text') })),
      };
    case 'faq':
      return {
        type,
        ...title,
        items: list(block.items).map((item) => ({ q: read(item, 'q'), a: read(item, 'a') })),
      };
    case 'specTable':
      return {
        type,
        ...title,
        rows: list(block.rows).map((row) => ({
          label: read(row, 'label'),
          value: read(row, 'value'),
        })),
      };
    default:
      return null;
  }
}

/**
 * The richText body is compared by presence, not content: it is sanitised on
 * the way out, and a body that differs only by what the sanitiser strips is
 * still the same block.
 */
function comparable(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.type === 'richText' && typeof record.html === 'string') {
      return { ...record, html: '' };
    }
  }
  return value;
}

/** Deep equality over JSON, independent of key order. */
export function sameJson(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** One key off something that may be anything, as a string — never "[object Object]". */
function read(value: unknown, key: string): string {
  if (value === null || typeof value !== 'object') return '';
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'string' ? found : '';
}

// --- writing one --------------------------------------------------------------

export type StoredDocument =
  { ok: true; blocks: unknown[] } | { ok: false; index: number; type: string };

/**
 * The document a save may store, or the block that stops it.
 *
 * The storefront parses Page.blocks, Article.blocks and BrandTranslation.intro
 * with `blockDocumentSchema`, and a document that fails renders as *nothing* —
 * the parse is all-or-nothing, and the fallback is an empty array. So one
 * malformed block saved from this panel would blank the whole refund policy,
 * silently, with a 200. Checking the same schema here turns that into a refusal
 * that names the block.
 *
 * Opaque blocks are checked too. They came from the database and are sent back
 * by the browser, and "it was already there" is not proof — a `raw` field is
 * whatever the request says it is. Every richText, opaque or not, is sanitised.
 */
export function toStoredDocument(blocks: ContentBlock[]): StoredDocument {
  const stored = blocks.map((block) => {
    const value: unknown = 'raw' in block ? block.raw : block;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (record.type === 'richText' && typeof record.html === 'string') {
        return { ...record, html: sanitizeRichText(record.html) };
      }
    }
    return value;
  });

  for (const [index, value] of stored.entries()) {
    const parsed = blockDocumentSchema.safeParse([value]);
    if (!parsed.success) {
      const type =
        value !== null &&
        typeof value === 'object' &&
        typeof (value as { type?: unknown }).type === 'string'
          ? String((value as { type: string }).type)
          : 'unknown';
      return { ok: false, index, type };
    }
  }
  return { ok: true, blocks: stored };
}

/**
 * Words a reader will read, for the "N min" on the card.
 *
 * Everything a visitor sees as prose counts — headings, steps, table cells,
 * FAQ — unlike the publish gate's counter, which deliberately measures only the
 * body. 200 words a minute is what `db:blog` used when it last recomputed these,
 * so a post saved here keeps the number it had.
 */
export function readingMinutes(blocks: unknown[]): number {
  let text = '';
  const add = (value: unknown): void => {
    if (typeof value === 'string') text += ` ${value}`;
  };
  for (const entry of blocks) {
    if (entry === null || typeof entry !== 'object') continue;
    const block = entry as Record<string, unknown>;
    if (typeof block.html === 'string') add(block.html.replace(/<[^>]+>/g, ' '));
    add(block.text);
    add(block.title);
    for (const step of list(block.steps)) add(read(step, 'text'));
    for (const item of list(block.items)) {
      add(read(item, 'q'));
      add(read(item, 'a'));
    }
    for (const row of list(block.rows)) {
      add(read(row, 'label'));
      add(read(row, 'value'));
    }
  }
  const words = text.split(/\s+/).filter(Boolean).length;
  return words === 0 ? 0 : Math.max(1, Math.round(words / 200));
}

// --- SEO ----------------------------------------------------------------------

/**
 * The `seo` column after an edit to its title or description.
 *
 * Merged, never replaced: the column also carries `robots`, `canonicalOverride`
 * and `ogImageAssetId`, which this panel does not edit, and a save that wrote
 * `{ title, description }` over them would quietly reindex a page somebody had
 * set to noindex. An empty string removes the key, so "no SEO title" is one
 * state rather than two.
 */
export function mergeSeo(
  stored: unknown,
  patch: { title?: string | undefined; description?: string | undefined },
): Record<string, unknown> {
  const base =
    stored !== null && typeof stored === 'object' && !Array.isArray(stored)
      ? { ...(stored as Record<string, unknown>) }
      : {};
  for (const key of ['title', 'description'] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === '') delete base[key];
    else base[key] = value;
  }
  return base;
}

export function seoField(stored: unknown, key: 'title' | 'description'): string {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return '';
  const value = (stored as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

// --- addresses ----------------------------------------------------------------

/**
 * Where each kind lives, without the `/en` prefix.
 *
 * Redirects are stored locale-less on purpose: the storefront looks up the
 * unprefixed path and puts the visitor's locale back on the destination, so one
 * row covers `/blog/old` and `/en/blog/old` both.
 */
export const contentPath = {
  page: (slug: string) => `/${slug}`,
  post: ROUTES.post,
  brand: ROUTES.brand,
};

/**
 * Pages a dedicated storefront route reads by name.
 *
 * `/golden-warranty` and `/contact` are real routes that call
 * `getPage('golden-warranty')` and `getPage('contact')`. Renaming either row
 * would leave its route rendering without its copy — and the redirect written
 * for the rename would never fire, because the route still answers 200.
 */
export const PINNED_PAGE_SLUGS: readonly string[] = ['golden-warranty', 'contact'];

/**
 * First path segments the catch-all never sees.
 *
 * A page is served by `[...slug]`, which is last in the routing order: any
 * segment a real route owns wins. A page created as `store` or `blog` would be
 * a row nobody can ever reach, so it is refused at the door. `en` is the locale
 * prefix, and the future ROUTES prefixes are reserved before they exist.
 */
const RESERVED_PAGE_SLUGS = new Set([
  'ar',
  'en',
  'api',
  'store',
  'cart',
  'checkout',
  'account',
  'search',
  'blog',
  'brands',
  'collections',
  'orders',
  'guides',
  'compare',
  'glossary',
  'tools',
  'deals',
  'product-tag',
]);

export function isReservedPageSlug(slug: string): boolean {
  return RESERVED_PAGE_SLUGS.has(slug);
}

// --- dates --------------------------------------------------------------------

/**
 * When a post or page says it was published.
 *
 * An explicit date wins, including null to clear it on a draft. Otherwise the
 * first move to PUBLISHED stamps now, and every later save keeps what is there —
 * unpublishing and republishing a correction must not move a 2021 post to the
 * top of the blog as if it were new.
 */
export function publishedAtAfter(input: {
  current: Date | null;
  nextStatus: string;
  requested?: string | null | undefined;
  now: Date;
}): Date | null {
  if (input.requested !== undefined) {
    return input.requested === null ? null : new Date(input.requested);
  }
  if (input.current) return input.current;
  return input.nextStatus === 'PUBLISHED' ? input.now : null;
}

/** A stored document's shape, for the audit log: the types, in order. */
export function blockTypes(stored: unknown): string[] {
  if (!Array.isArray(stored)) return [];
  return stored.map((block: unknown) =>
    block !== null &&
    typeof block === 'object' &&
    typeof (block as { type?: unknown }).type === 'string'
      ? String((block as { type: string }).type)
      : 'unknown',
  );
}
