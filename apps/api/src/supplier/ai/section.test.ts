import { sectionResultSchema } from '@da/contracts';
import { describe, expect, it } from 'vitest';

import { sectionSystemPrompt, sectionUserPrompt } from './section-prompts.js';

const facts = {
  nameAr: 'ويندوز 11 برو',
  nameEn: 'Windows 11 Pro',
  brand: 'Microsoft',
  categories: ['Windows'],
  kind: 'KEY',
  variants: [
    {
      terms: 'lifetime licence, 1 device(s)',
      platform: 'WINDOWS',
      activationMethod: 'RETAIL_ONLINE',
      deliveryMinutes: 1,
      warrantyDays: null,
    },
  ],
  supplierLines: [],
};

describe('section prompts (CR-0005)', () => {
  it('asks for each section in its own shape', () => {
    for (const [section, shape] of [
      ['seo', '"seoTitle"'],
      ['activation', '"steps":["'],
      ['faq', '"items"'],
      ['steps', '"steps":[{"text"'],
      ['specTable', '"rows"'],
    ] as const) {
      const prompt = sectionUserPrompt({
        section,
        locale: 'ar',
        facts,
        pageText: '',
        current: null,
        instructions: '',
        focusKeywords: '',
      });
      expect(prompt).toMatch(/Write this section of the Arabic product page/);
      expect(prompt).toContain(shape);
      expect(sectionSystemPrompt(section, '')).toMatch(/Use ONLY the facts provided/);
    }
  });

  it('improves when there is current content, with the page for context', () => {
    const prompt = sectionUserPrompt({
      section: 'faq',
      locale: 'en',
      facts,
      pageText: 'A genuine key.',
      current: '{"items":[{"q":"Old?","a":"Yes."}]}',
      instructions: 'focus on businesses',
      focusKeywords: 'windows 11 pro key',
    });
    expect(prompt).toMatch(/Improve this section of the English product page/);
    expect(prompt).toContain('A genuine key.');
    expect(prompt).toContain('Old?');
    expect(prompt).toContain('focus on businesses');
    expect(prompt).toContain('windows 11 pro key');
  });

  it('accepts each section shape and refuses a wrong one', () => {
    expect(
      sectionResultSchema.parse({
        section: 'faq',
        block: { type: 'faq', title: 'FAQ', items: [{ q: 'Q?', a: 'A.' }] },
      }).section,
    ).toBe('faq');
    expect(
      sectionResultSchema.parse({ section: 'activation', steps: ['Open Settings'] }).section,
    ).toBe('activation');
    expect(() =>
      sectionResultSchema.parse({ section: 'steps', block: { type: 'steps', steps: [] } }),
    ).toThrow();
    expect(() => sectionResultSchema.parse({ section: 'seo', seoTitle: 'x' })).toThrow();
  });
});
