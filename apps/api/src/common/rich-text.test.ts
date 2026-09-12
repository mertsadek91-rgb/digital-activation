import { describe, expect, it } from 'vitest';

import { sanitizeBlocks, sanitizeRichText } from './rich-text.js';

/**
 * Guards the one column the storefront renders as markup.
 *
 * Every case here except the last two is taken from what the WordPress import
 * actually left behind across the 73 Arabic product bodies: 29 `<img>`, 4
 * `<link>`, 2 `<style>` and 1 `<xmp>`. None of it was hostile — it is what a
 * page builder emits — but all of it is being handed to
 * `dangerouslySetInnerHTML`, and a stylesheet loaded from a product body can
 * restyle the checkout button on the same page.
 */
describe('sanitizeRichText', () => {
  it('keeps the copy, which is the whole point of not simply escaping it', () => {
    const html = '<p>مفتاح <strong>أصلي</strong> مدى الحياة</p><ul><li>ويندوز 11</li></ul>';
    expect(sanitizeRichText(html)).toBe(html);
  });

  it('drops a stylesheet link, which has no closing tag to look for', () => {
    expect(sanitizeRichText('<link rel="stylesheet" href="//x.test/a.css"><p>copy</p>')).toBe(
      '<p>copy</p>',
    );
  });

  it('drops a style block together with its rules', () => {
    expect(sanitizeRichText('<style>body{display:none}</style><p>copy</p>')).toBe('<p>copy</p>');
  });

  it('drops an xmp tag, which otherwise swallows the rest of the page', () => {
    expect(sanitizeRichText('<p>a</p><xmp><p>b</p></xmp><p>c</p>')).toBe('<p>a</p><p>c</p>');
  });

  it('drops a script even when its markup is the innocent kind', () => {
    expect(sanitizeRichText('<p>a</p><script>fetch("/x")</script>')).toBe('<p>a</p>');
  });

  it('refuses a javascript: href but keeps the link text', () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">اضغط</a>')).toBe('<a>اضغط</a>');
  });

  it('keeps an ordinary link and an image with the attributes that carry meaning', () => {
    expect(sanitizeRichText('<a href="/store" title="t" onclick="x()">go</a>')).toBe(
      '<a href="/store" title="t">go</a>',
    );
    expect(sanitizeRichText('<img src="https://cdn.test/a.png" alt="a" onerror="x()">')).toBe(
      '<img src="https://cdn.test/a.png" alt="a">',
    );
  });

  it('unwraps an unknown tag rather than deleting what it wrapped', () => {
    expect(sanitizeRichText('<marquee>نص مهم</marquee>')).toBe('نص مهم');
  });

  it('drops a comment, which can hide a conditional a browser still parses', () => {
    expect(
      sanitizeRichText('<p>a</p><!--[if IE]><script src=x></script><![endif]--><p>b</p>'),
    ).toBe('<p>a</p><p>b</p>');
  });
});

/**
 * The document-level wrapper, which is what the two read paths call.
 *
 * Only `richText` carries raw HTML; every other block is rendered as data and
 * React escapes it. A wrapper that touched the others would be rewriting copy
 * for no reason — so the test that matters most is that it leaves them alone.
 */
describe('sanitizeBlocks', () => {
  it('cleans a richText block in place', () => {
    expect(sanitizeBlocks([{ type: 'richText', html: '<style>x{}</style><p>a</p>' }])).toEqual([
      { type: 'richText', html: '<p>a</p>' },
    ]);
  });

  it('leaves every other block exactly as it was', () => {
    const blocks = [
      { type: 'faq', items: [{ q: '<b>؟</b>', a: 'ج' }] },
      { type: 'heading', text: '<b>عنوان</b>' },
    ];
    expect(sanitizeBlocks(blocks)).toEqual(blocks);
  });

  it('survives a richText block whose html is not a string', () => {
    const blocks = [{ type: 'richText', html: null }];
    expect(sanitizeBlocks(blocks)).toEqual(blocks);
  });
});
