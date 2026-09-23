import { describe, expect, it } from 'vitest';

import {
  PINNED_PAGE_SLUGS,
  blockTypes,
  contentPath,
  isReservedPageSlug,
  mergeSeo,
  publishedAtAfter,
  readingMinutes,
  sameJson,
  seoField,
  toEditableDocument,
  toStoredDocument,
} from './content-documents.js';

const ANSWER =
  'A direct answer long enough to clear the forty-character floor the storefront schema sets.';

/**
 * The rules between the panel and what the storefront renders.
 *
 * Each case is a way an edit could quietly damage a live page: a heading that
 * loses its anchor on a save nobody made to it, a malformed block that blanks
 * a whole policy, a `noindex` wiped by a meta-description fix.
 */
describe('toEditableDocument', () => {
  it('shapes the blocks the editor can hold whole', () => {
    const doc = [
      { type: 'heading', level: 2, text: 'Title' },
      { type: 'answerFirst', text: ANSWER },
      { type: 'faq', items: [{ q: 'Q?', a: 'A.' }] },
      { type: 'specTable', title: 'Specs', rows: [{ label: 'OS', value: 'Windows' }] },
      { type: 'steps', steps: [{ text: 'Do it' }] },
    ];
    expect(toEditableDocument(doc)).toEqual(doc);
  });

  it('keeps an H4 opaque rather than turning it into an H2', () => {
    const h4 = { type: 'heading', level: 4, text: 'Deep' };
    expect(toEditableDocument([h4])).toEqual([{ type: 'heading', raw: h4 }]);
  });

  it('keeps a heading with an anchor opaque, so the deep link survives a save', () => {
    const anchored = { type: 'heading', level: 2, text: 'Price', id: 'price' };
    expect(toEditableDocument([anchored])).toEqual([{ type: 'heading', raw: anchored }]);
  });

  it('keeps a step with an image opaque', () => {
    const steps = { type: 'steps', steps: [{ text: 'Open', assetId: 'a1' }] };
    expect(toEditableDocument([steps])).toEqual([{ type: 'steps', raw: steps }]);
  });

  it('carries a block type it does not draw through untouched', () => {
    const grid = { type: 'productGrid', source: { kind: 'bestSelling' }, limit: 8 };
    expect(toEditableDocument([grid])).toEqual([{ type: 'productGrid', raw: grid }]);
  });

  it('sanitises richText on the way into the panel', () => {
    const [block] = toEditableDocument([
      { type: 'richText', html: '<p>copy</p><img src=x onerror="alert(1)">' },
    ]);
    // The tag may stay; the handler may not.
    expect(block).toEqual({ type: 'richText', html: '<p>copy</p><img>' });
  });

  it('treats a non-array column as an empty document', () => {
    expect(toEditableDocument(null)).toEqual([]);
    expect(toEditableDocument({})).toEqual([]);
  });
});

describe('toStoredDocument', () => {
  it('round-trips what toEditableDocument produced, opaque blocks included', () => {
    const doc = [
      { type: 'heading', level: 4, text: 'Deep', id: 'deep' },
      { type: 'richText', html: '<p>copy</p>' },
      { type: 'trust', items: ['goldenWarranty'] },
    ];
    const result = toStoredDocument(toEditableDocument(doc));
    expect(result).toEqual({ ok: true, blocks: doc });
  });

  it('sanitises richText, including one smuggled in as an opaque block', () => {
    const result = toStoredDocument([
      { type: 'richText', raw: { type: 'richText', html: '<style>x</style><p>ok</p>' } },
    ]);
    expect(result).toEqual({ ok: true, blocks: [{ type: 'richText', html: '<p>ok</p>' }] });
  });

  it('refuses a block the storefront would reject, naming it', () => {
    // A CTA with no button: the storefront's parse fails, and the whole page
    // would render as nothing.
    const result = toStoredDocument([
      { type: 'richText', html: '<p>fine</p>' },
      { type: 'cta', raw: { type: 'cta', heading: 'Buy' } },
    ]);
    expect(result).toEqual({ ok: false, index: 1, type: 'cta' });
  });

  it('refuses an unknown block type', () => {
    expect(toStoredDocument([{ type: 'marquee', raw: { type: 'marquee' } }])).toEqual({
      ok: false,
      index: 0,
      type: 'marquee',
    });
  });

  it('accepts an empty document', () => {
    expect(toStoredDocument([])).toEqual({ ok: true, blocks: [] });
  });
});

describe('sameJson', () => {
  it('ignores key order and undefined keys', () => {
    expect(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1, d: undefined })).toBe(
      true,
    );
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('mergeSeo', () => {
  it('keeps the keys this panel does not edit', () => {
    const stored = { title: 'Old', robots: { index: false, follow: true } };
    expect(mergeSeo(stored, { title: 'New' })).toEqual({
      title: 'New',
      robots: { index: false, follow: true },
    });
  });

  it('removes a key set to an empty string, and leaves an omitted one alone', () => {
    expect(mergeSeo({ title: 'T', description: 'D' }, { title: '' })).toEqual({ description: 'D' });
  });

  it('starts from nothing when the column is not an object', () => {
    expect(mergeSeo(null, { description: 'D' })).toEqual({ description: 'D' });
    expect(mergeSeo([], { title: 'T' })).toEqual({ title: 'T' });
  });

  it('reads a field back as a string, never as undefined', () => {
    expect(seoField({ title: 'T' }, 'title')).toBe('T');
    expect(seoField({ title: 3 }, 'title')).toBe('');
    expect(seoField(null, 'description')).toBe('');
  });
});

describe('readingMinutes', () => {
  it('counts prose in every block a reader sees', () => {
    const words = (count: number) => Array.from({ length: count }, () => 'word').join(' ');
    expect(
      readingMinutes([
        { type: 'richText', html: `<p>${words(300)}</p>` },
        { type: 'faq', items: [{ q: words(50), a: words(50) }] },
      ]),
    ).toBe(2);
  });

  it('is zero for an empty body and at least one for any body', () => {
    expect(readingMinutes([])).toBe(0);
    expect(readingMinutes([{ type: 'heading', level: 2, text: 'One' }])).toBe(1);
  });
});

describe('page slugs and paths', () => {
  it('refuses slugs a real route owns', () => {
    for (const slug of ['store', 'blog', 'brands', 'en', 'checkout']) {
      expect(isReservedPageSlug(slug)).toBe(true);
    }
    expect(isReservedPageSlug('privacy')).toBe(false);
  });

  it('pins the pages a dedicated route reads by name', () => {
    expect(PINNED_PAGE_SLUGS).toContain('golden-warranty');
    expect(PINNED_PAGE_SLUGS).toContain('contact');
  });

  it('builds locale-less paths, the way the redirect map is keyed', () => {
    expect(contentPath.page('privacy')).toBe('/privacy');
    expect(contentPath.post('excel-shortcuts')).toBe('/blog/excel-shortcuts');
    expect(contentPath.brand('microsoft')).toBe('/brands/microsoft');
  });
});

describe('publishedAtAfter', () => {
  const now = new Date('2026-09-23T10:00:00Z');
  const earlier = new Date('2021-03-01T08:00:00Z');

  it('stamps now on the first publish', () => {
    expect(publishedAtAfter({ current: null, nextStatus: 'PUBLISHED', now })).toEqual(now);
  });

  it('keeps the original date through an unpublish and a republish', () => {
    expect(publishedAtAfter({ current: earlier, nextStatus: 'DRAFT', now })).toEqual(earlier);
    expect(publishedAtAfter({ current: earlier, nextStatus: 'PUBLISHED', now })).toEqual(earlier);
  });

  it('leaves a draft undated', () => {
    expect(publishedAtAfter({ current: null, nextStatus: 'DRAFT', now })).toBeNull();
  });

  it('lets an explicit date, or an explicit null, win', () => {
    expect(
      publishedAtAfter({
        current: earlier,
        nextStatus: 'PUBLISHED',
        requested: '2022-01-01T00:00:00Z',
        now,
      }),
    ).toEqual(new Date('2022-01-01T00:00:00Z'));
    expect(
      publishedAtAfter({ current: earlier, nextStatus: 'DRAFT', requested: null, now }),
    ).toBeNull();
  });
});

describe('blockTypes', () => {
  it('lists the types in order, and survives junk', () => {
    expect(blockTypes([{ type: 'faq' }, null, { nope: 1 }])).toEqual(['faq', 'unknown', 'unknown']);
    expect(blockTypes('x')).toEqual([]);
  });
});
