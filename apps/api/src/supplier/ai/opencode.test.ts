import { generatedLocaleCopySchema } from '@da/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OpenCodeClient,
  OpenCodeError,
  buildRequest,
  extractJson,
  protocolFor,
  readText,
} from './opencode.js';
import { copySystemPrompt, copyUserPrompt, draftUserPrompt } from './prompts.js';
import { normaliseCopy, slugify } from './supplier-ai.service.js';

describe('protocolFor', () => {
  it.each([
    ['claude-sonnet-5-5', 'messages'],
    ['gpt-6-sol', 'responses'],
    ['grok-4.7', 'responses'],
    ['gemini-3.8-flash', 'gemini'],
    ['kimi-k3', 'chat'],
    ['deepseek-v4-pro', 'chat'],
  ])('%s speaks %s', (model, protocol) => {
    expect(protocolFor(model)).toBe(protocol);
  });
});

describe('buildRequest', () => {
  const base = { model: 'm', system: 'S', prompt: 'P', maxTokens: 100, temperature: 0.2 };

  it('sends Anthropic messages with x-api-key and a version', () => {
    const wire = buildRequest({ ...base, protocol: 'messages' }, 'KEY');
    expect(wire.path).toBe('/messages');
    expect(wire.headers['x-api-key']).toBe('KEY');
    expect(wire.headers['anthropic-version']).toBe('2023-06-01');
    expect(wire.body).toMatchObject({
      system: 'S',
      messages: [{ role: 'user', content: 'P' }],
      max_tokens: 100,
    });
  });

  it('sends OpenAI responses with instructions and input', () => {
    const wire = buildRequest({ ...base, protocol: 'responses' }, 'KEY');
    expect(wire.path).toBe('/responses');
    expect(wire.headers.authorization).toBe('Bearer KEY');
    expect(wire.body).toMatchObject({ instructions: 'S', input: 'P', max_output_tokens: 100 });
  });

  it('sends Gemini generateContent on the model path', () => {
    const wire = buildRequest({ ...base, model: 'gemini-3.8-flash', protocol: 'gemini' }, 'KEY');
    expect(wire.path).toBe('/models/gemini-3.8-flash:generateContent');
    expect(wire.headers['x-goog-api-key']).toBe('KEY');
  });

  it('sends chat completions with a system message', () => {
    const wire = buildRequest({ ...base, protocol: 'chat' }, 'KEY');
    expect(wire.path).toBe('/chat/completions');
    expect((wire.body as { messages: unknown[] }).messages).toHaveLength(2);
  });
});

describe('readText', () => {
  it('reads each protocol', () => {
    expect(
      readText('messages', {
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      }),
    ).toBe('ab');
    expect(readText('responses', { output_text: 'x' })).toBe('x');
    expect(
      readText('responses', {
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'y' }] }],
      }),
    ).toBe('y');
    expect(readText('gemini', { candidates: [{ content: { parts: [{ text: 'g' }] } }] })).toBe('g');
    expect(readText('chat', { choices: [{ message: { content: 'c' } }] })).toBe('c');
    expect(readText('chat', {})).toBe('');
  });
});

describe('extractJson', () => {
  it('finds the object inside prose or a code fence', () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```\nThanks')).toEqual({ a: 1 });
    expect(extractJson('noise {"a":{"b":2}} trailing')).toEqual({ a: { b: 2 } });
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('normaliseCopy', () => {
  it('keeps valid blocks, drops the rest, and puts the answer first', () => {
    const notes: string[] = [];
    const raw = {
      shortDesc: 'x'.repeat(250),
      seoTitle: 'Windows 11 Pro key – instant delivery',
      seoDescription:
        'Buy a genuine Windows 11 Pro retail key with instant email delivery and support.',
      keywords: ['windows 11 pro key', 7, ''],
      blocks: [
        { type: 'heading', level: 2, text: 'What you get' },
        { type: 'image', src: 'x' },
        {
          type: 'answerFirst',
          text: 'A genuine Windows 11 Pro retail key, delivered by email within minutes of payment.',
        },
        { type: 'richText', html: '<p>Body</p>' },
      ],
    };
    const copy = generatedLocaleCopySchema.parse(normaliseCopy(raw, notes, 'en'));
    expect(copy.shortDesc).toHaveLength(200);
    expect(copy.keywords).toEqual(['windows 11 pro key']);
    expect(copy.blocks.map((block) => block.type)).toEqual(['answerFirst', 'heading', 'richText']);
    expect(notes).toEqual(['en: dropped a "image" block that did not fit']);
  });
});

describe('prompts', () => {
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
    supplierLines: [{ name: 'Windows 11/10 Pro Retail Key 1 PC', warranty: '7 days' }],
  };

  it('forbids invented claims and the supplier, and carries the house notes', () => {
    const system = copySystemPrompt('Never say cheap.');
    expect(system).toMatch(/Use ONLY the facts provided/);
    expect(system).toMatch(/Do not mention the supplier/);
    expect(system).toMatch(/Never say cheap\./);
  });

  it('hands over the facts and the requested language', () => {
    const prompt = copyUserPrompt({
      locale: 'ar',
      facts,
      focusKeywords: 'مفتاح ويندوز 11',
      sample: null,
    });
    expect(prompt).toMatch(/Write the Arabic product page copy/);
    expect(prompt).toMatch(/Microsoft/);
    expect(prompt).toMatch(/مفتاح ويندوز 11/);
    expect(draftUserPrompt({ name: 'X Key 1 PC', category: null, warranty: null })).toMatch(
      /Supplier line: X Key 1 PC/,
    );
  });
});

describe('slugify', () => {
  it('makes a latin slug', () => {
    expect(slugify('Windows 11/10 Pro Retail Key — 1 PC')).toBe(
      'windows-11-10-pro-retail-key-1-pc',
    );
    expect(slugify('ويندوز')).toBe('');
  });
});

describe('OpenCodeClient temperature fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ok = (text: string) =>
    new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });
  const refused = () =>
    new Response(
      JSON.stringify({
        error: {
          message:
            'Upstream request failed: [invalid_request_error] `temperature` is deprecated for this model.',
        },
      }),
      { status: 400 },
    );

  it('retries once without temperature, then leaves it out for that model', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      bodies.push(body);
      return Promise.resolve('temperature' in body ? refused() : ok('hello'));
    });
    const client = new OpenCodeClient('KEY', 'https://example.test/v1');
    const input = {
      model: 'model-without-temperature',
      protocol: 'messages' as const,
      system: 'S',
      prompt: 'P',
      maxTokens: 10,
      temperature: 0.5,
    };

    expect(await client.complete(input)).toBe('hello');
    expect(bodies.map((body) => 'temperature' in body)).toEqual([true, false]);

    // The next call for the same model goes straight out without it.
    expect(await client.complete(input)).toBe('hello');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect('temperature' in (bodies[2] ?? {})).toBe(false);
  });

  it('does not retry other 400s', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'max_tokens too large' } }), { status: 400 }),
    );
    const client = new OpenCodeClient('KEY', 'https://example.test/v1');
    await expect(
      client.complete({
        model: 'other-model',
        protocol: 'chat',
        system: 'S',
        prompt: 'P',
        maxTokens: 10,
        temperature: 0.2,
      }),
    ).rejects.toBeInstanceOf(OpenCodeError);
  });

  it('omits temperature from every protocol when it is undefined', () => {
    for (const protocol of ['messages', 'chat'] as const) {
      const wire = buildRequest(
        { model: 'm', protocol, system: 'S', prompt: 'P', maxTokens: 1, temperature: undefined },
        'KEY',
      );
      expect('temperature' in (wire.body as Record<string, unknown>)).toBe(false);
    }
  });
});
