import { describe, expect, it } from 'vitest';

import {
  articleSystemPrompt,
  articleUserPrompt,
  ideasSystemPrompt,
  ideasUserPrompt,
} from './studio-prompts.js';
import { shapeArticle } from './studio.service.js';
import { bodyWordCount, countWords, keepKnownLinks, sitePath } from './studio-text.js';

const hosts = ['digital-activation.com', 'new.digital-activation.com'];

describe('article checks (CR-0006)', () => {
  it('counts words in Arabic and English, ignoring markup', () => {
    expect(countWords('<p>مفتاح ويندوز 11 برو أصلي</p>')).toBe(5);
    expect(countWords('Buy a genuine — key')).toBe(4);
    expect(
      bodyWordCount([
        { type: 'heading', level: 2, text: 'What you get' },
        { type: 'richText', html: '<p>One genuine key.</p>' },
        { type: 'faq', title: 'FAQ', items: [{ q: 'Is it real?', a: 'Yes it is.' }] },
      ]),
    ).toBe(3 + 3 + 1 + 6);
  });

  it('reads site paths from relative and absolute links, and refuses other hosts', () => {
    expect(sitePath('/store/windows-11-pro/', hosts)).toBe('/store/windows-11-pro');
    expect(sitePath('https://new.digital-activation.com/blog/x?y=1', hosts)).toBe('/blog/x');
    expect(sitePath('https://example.com/store/x', hosts)).toBeNull();
    expect(sitePath('//evil.com/x', hosts)).toBeNull();
  });

  it('keeps links to pages that exist and unwraps the rest', () => {
    const allowed = new Set(['/store/windows-11-pro', '/blog/activate-windows']);
    const result = keepKnownLinks(
      '<p>Get <a href="https://digital-activation.com/store/windows-11-pro">Windows 11 Pro</a>, read <a href="/blog/activate-windows">this guide</a> or <a href="/store/made-up">that</a> and <a href="https://microsoft.com">Microsoft</a>.</p>',
      allowed,
      hosts,
    );
    expect(result.kept).toEqual(['/store/windows-11-pro', '/blog/activate-windows']);
    expect(result.dropped).toBe(2);
    expect(result.html).toContain('<a href="/store/windows-11-pro">Windows 11 Pro</a>');
    expect(result.html).not.toContain('made-up');
    expect(result.html).toContain('that and Microsoft');
  });

  it('reads every way of writing an href, and leaves no stray anchor (REV-0174)', () => {
    const allowed = new Set(['/store/windows-11-pro']);
    const result = keepKnownLinks(
      [
        "<p><a href='https://evil.com/x'>single</a>",
        '<a href=https://evil.com/y>bare</a>',
        "<a href='//evil.com'>protocol-relative</a>",
        "<a HREF='/store/windows-11-pro/'>kept</a>",
        '<a href="/store/windows-11-pro"><a href="https://evil.com">nested</a></a>',
        '<a href="https://evil.com/z">never closed</p>',
      ].join(' '),
      allowed,
      hosts,
    );
    expect(result.kept).toEqual(['/store/windows-11-pro', '/store/windows-11-pro']);
    expect(result.html).not.toMatch(/evil\.com/);
    expect(result.html).toContain('<a href="/store/windows-11-pro">kept</a>');
    expect(result.html).toContain('<a href="/store/windows-11-pro">nested</a>');
    expect(result.html).toContain('never closed');
    expect(result.dropped).toBeGreaterThanOrEqual(4);
  });

  it('shapes an answer: drops malformed blocks, checks links, counts words', () => {
    const shaped = shapeArticle(
      {
        title: 'How to activate Windows 11 Pro',
        slug: 'activate-windows-11-pro',
        summary: 'A short answer about activating Windows 11 Pro with a genuine key in minutes.',
        seoTitle: 'Activate Windows 11 Pro',
        seoDescription: 'Step by step activation of Windows 11 Pro with a genuine retail key.',
        relatedProductSlugs: ['windows-11-pro'],
        imagePrompt: 'A laptop on a desk',
        imageAlt: 'Laptop',
        blocks: [
          { type: 'heading', level: 2, text: 'Before you start' },
          { type: 'richText', html: '<p>Buy <a href="/store/windows-11-pro">the key</a>.</p>' },
          { type: 'image', src: 'x' },
        ],
      },
      new Set(['/store/windows-11-pro']),
      hosts,
    );
    expect(shaped.blocks).toHaveLength(2);
    expect(shaped.links).toEqual(['/store/windows-11-pro']);
    expect(shaped.words).toBe(3 + 3);
    expect(shaped.summaryWords).toBe(14);
    expect(shaped.notes.some((note) => note.includes('1'))).toBe(true);
  });
});

describe('studio prompts', () => {
  const inventory = {
    locale: 'ar' as const,
    products: [
      {
        slug: 'windows-11-pro',
        name: 'ويندوز 11 برو',
        brand: 'Microsoft',
        categories: ['Windows'],
        path: '/store/windows-11-pro',
      },
    ],
    articles: [
      {
        slug: 'activate-windows',
        title: 'تفعيل ويندوز',
        summary: null,
        published: true,
        path: '/blog/activate-windows',
      },
    ],
  };

  it('gives the model the inventory and forbids invented slugs', () => {
    expect(ideasSystemPrompt()).toMatch(/ONLY contain slugs from the lists given/);
    const prompt = ideasUserPrompt({
      inventory,
      thread: [{ role: 'user', text: 'focus on Office' }],
      message: 'more on Windows',
    });
    expect(prompt).toContain('windows-11-pro');
    expect(prompt).toContain('activate-windows');
    expect(prompt).toContain('focus on Office');
    expect(prompt).toContain('more on Windows');
    expect(prompt).toMatch(/Reply in Arabic/);
  });

  it('asks for the full article: length, summary, links, image prompt', () => {
    const system = articleSystemPrompt('');
    expect(system).toMatch(/1500–2000 words/);
    expect(system).toMatch(/about 50 words/);
    expect(system).toMatch(/using ONLY the paths given/);
    expect(system).toMatch(/imagePrompt/);
    const user = articleUserPrompt({
      inventory,
      idea: {
        title: 'كيف تفعّل ويندوز 11 برو',
        primaryKeyword: 'تفعيل ويندوز 11',
        secondaryKeywords: [],
        intent: 'how-to',
        outline: ['ما تحتاجه'],
        rationale: '',
      },
      links: [{ path: '/store/windows-11-pro', label: 'product: ويندوز 11 برو' }],
      instructions: '',
    });
    expect(user).toContain('/store/windows-11-pro — product');
    expect(user).toContain('تفعيل ويندوز 11');
  });
});
