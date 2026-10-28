import { BadRequestException } from '@nestjs/common';
import { startAgentBatchSchema } from '@da/contracts';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { OpenCodeError } from '../supplier/ai/opencode.js';
import { logoPalette } from '../supplier/card/card.js';

import { MAX_LOG, appendLog, checkPlan, isTransient, plainName, readLog } from './agent-rules.js';
import {
  findLogo,
  logoCandidates,
  manifestCandidates,
  manifestUrl,
  normaliseDomain,
  safeSvg,
  toLogoPng,
} from './logo-finder.js';
import { planUserPrompt } from './plan-prompts.js';
import { FetchRefusedError, checkUrl, isPublicAddress } from './safe-fetch.js';

const square = (colour: string, size = 128) =>
  sharp({ create: { width: size, height: size, channels: 4, background: colour } })
    .png()
    .toBuffer();

/** A logo-like picture: a coloured mark on white. */
async function logo(colour: string, accent?: string): Promise<Buffer> {
  const layers = [{ input: await square(colour, 60), left: 10, top: 34 }];
  if (accent) layers.push({ input: await square(accent, 30), left: 80, top: 49 });
  return sharp({ create: { width: 128, height: 128, channels: 4, background: '#ffffff' } })
    .composite(layers)
    .png()
    .toBuffer();
}

describe('safe fetch', () => {
  it('refuses private, loopback, link-local and mapped addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '::ffff:7f00:1',
      '64:ff9b::a00:1',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    for (const address of ['8.8.8.8', '104.16.1.1', '2606:4700::6810:1']) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it('allows only https URLs naming a host on the standard port', () => {
    expect(checkUrl('https://eset.com/').hostname).toBe('eset.com');
    for (const bad of [
      'http://eset.com/',
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://user:pw@eset.com/',
      'https://eset.com:8443/',
      'https://localhost/',
      'https://printer.local/',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(() => checkUrl(bad), bad).toThrow(FetchRefusedError);
    }
  });
});

describe('logo finder', () => {
  it('reduces what the model wrote to a bare host', () => {
    expect(normaliseDomain('https://www.Eset.com/int/home?x=1')).toBe('www.eset.com');
    expect(normaliseDomain('microsoft.com.')).toBe('microsoft.com');
    expect(normaliseDomain('autodesk.com:443')).toBe('autodesk.com');
    expect(normaliseDomain('not a domain')).toBeNull();
    expect(normaliseDomain('localhost')).toBeNull();
    expect(normaliseDomain(null)).toBeNull();
  });

  it('ranks a header logo above icons, and large icons above small ones', () => {
    const html = `
      <link rel="icon" href="/favicon-16.png" sizes="16x16">
      <link rel="icon" type="image/png" href="/icon-192.png" sizes="192x192">
      <link rel="apple-touch-icon" href="/apple.png" sizes="180x180">
      <link rel="manifest" href="/site.webmanifest">
      <img class="site-logo" src="/img/brand.svg" alt="ESET">
      <img src="/hero.jpg" alt="A happy family">
      <meta property="og:image" content="https://cdn.eset.com/og.jpg">`;
    const ranked = logoCandidates(html, 'https://eset.com/home');
    expect(ranked[0]?.url).toBe('https://eset.com/img/brand.svg');
    expect(ranked.map((c) => c.url)).not.toContain('https://eset.com/hero.jpg');
    expect(ranked.map((c) => c.url)).not.toContain('https://cdn.eset.com/og.jpg');
    const order = ranked.map((c) => c.url);
    expect(order.indexOf('https://eset.com/apple.png')).toBeLessThan(
      order.indexOf('https://eset.com/favicon-16.png'),
    );
    expect(manifestUrl(html, 'https://eset.com/home')).toBe('https://eset.com/site.webmanifest');
  });

  it('reads manifest icons and skips maskable and small ones', () => {
    const icons = manifestCandidates(
      {
        icons: [
          { src: '/a-512.png', sizes: '512x512' },
          { src: '/b-96.png', sizes: '96x96' },
          { src: '/c-mask.png', sizes: '512x512', purpose: 'maskable' },
        ],
      },
      'https://eset.com/site.webmanifest',
    );
    expect(icons.map((icon) => icon.url)).toEqual(['https://eset.com/a-512.png']);
  });

  it('refuses SVG that can reach outside the file', () => {
    expect(safeSvg('<svg><rect width="10" height="10" fill="#f00"/></svg>')).toBe(true);
    expect(safeSvg('<svg><use href="#mark"/></svg>')).toBe(true);
    expect(safeSvg('<svg><image href="https://evil.test/x.png"/></svg>')).toBe(false);
    expect(safeSvg('<svg><image xlink:href="file:///etc/passwd"/></svg>')).toBe(false);
    expect(safeSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>')).toBe(false);
    expect(safeSvg('<svg><script>alert(1)</script></svg>')).toBe(false);
    expect(safeSvg('<svg><rect style="fill:url(https://evil.test/p)"/></svg>')).toBe(false);
  });

  it('turns a usable image into a PNG and rejects blank or tiny ones', async () => {
    const good = await toLogoPng({
      url: 'x',
      contentType: 'image/png',
      body: await logo('#e8410a'),
    });
    expect(good).not.toBeNull();
    const blank = await toLogoPng({
      url: 'x',
      contentType: 'image/png',
      body: await square('#ffffff'),
    });
    expect(blank).toBeNull();
    const tiny = await toLogoPng({
      url: 'x',
      contentType: 'image/png',
      body: await square('#e8410a', 16),
    });
    expect(tiny).toBeNull();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="40" height="32" fill="#0a7cff"/></svg>',
    );
    expect(await toLogoPng({ url: 'x', contentType: 'image/svg+xml', body: svg })).not.toBeNull();
    expect(
      await toLogoPng({ url: 'x', contentType: 'text/html', body: Buffer.from('<html>') }),
    ).toBeNull();
  });

  it('walks the candidates until one is a real logo, then takes its colours', async () => {
    const png = await logo('#e8410a', '#0a7cff');
    const pages: Record<string, { contentType: string; body: Buffer }> = {
      'https://eset.com/': {
        contentType: 'text/html',
        body: Buffer.from(
          '<img class="logo" src="/broken.png"><link rel="apple-touch-icon" href="/touch.png" sizes="180x180">',
        ),
      },
      'https://eset.com/broken.png': {
        contentType: 'image/png',
        body: Buffer.from('not an image'),
      },
      'https://eset.com/touch.png': { contentType: 'image/png', body: png },
    };
    const asked: string[] = [];
    const found = await findLogo('eset.com', (url) => {
      asked.push(url);
      const page = pages[url];
      return page ? Promise.resolve({ url, ...page }) : Promise.reject(new Error('HTTP 404'));
    });
    expect(found?.sourceUrl).toBe('https://eset.com/touch.png');
    expect(found?.palette[0]).toMatch(/^#e[0-9a-f]4[0-9a-f]0[0-9a-f]$/);
    expect(found?.palette).toHaveLength(2);
    expect(asked).not.toContain('https://www.eset.com/');
  });

  it('returns null rather than throwing when nothing answers', async () => {
    expect(await findLogo('eset.com', () => Promise.reject(new Error('down')))).toBeNull();
  });
});

describe('logo palette', () => {
  it('keeps distinct colours, most used first, and merges near shades', async () => {
    const palette = await logoPalette(await logo('#e8410a', '#0a7cff'));
    expect(palette).toHaveLength(2);
    expect(palette[0]).toMatch(/^#e/);
    expect(await logoPalette(await square('#000000'))).toEqual([]);
  });
});

describe('agent rules', () => {
  it('treats rate limits, overload and timeouts as worth retrying, and nothing else', () => {
    expect(isTransient(new OpenCodeError('x', 429))).toBe(true);
    expect(isTransient(new OpenCodeError('x', 503))).toBe(true);
    expect(isTransient(new OpenCodeError('x', 400))).toBe(false);
    expect(
      isTransient(new BadRequestException('OpenCode 429 for claude-x (messages): slow down')),
    ).toBe(true);
    expect(isTransient(new BadRequestException('OpenCode did not answer: ECONNRESET'))).toBe(true);
    expect(isTransient(new BadRequestException('لم يُكمل النموذج x الجواب خلال 3 دقائق.'))).toBe(
      true,
    );
    expect(isTransient(new BadRequestException('Another product already has that URL.'))).toBe(
      false,
    );
  });

  it('keeps the newest log lines and drops entries that do not parse', () => {
    let log: unknown = [{ nonsense: true }];
    for (let i = 0; i < MAX_LOG + 5; i += 1) log = appendLog(log, 'planned', 'info', String(i));
    const read = readLog(log);
    expect(read).toHaveLength(MAX_LOG);
    expect(read.at(-1)?.detail).toBe(String(MAX_LOG + 4));
  });

  const plan = (category: Record<string, unknown>) => ({
    category,
    names: { ar: 'ويندوز 11 برو', en: 'Windows 11 Pro' },
    brand: { name: 'Microsoft', domain: 'microsoft.com' },
    card: {
      title: 'Windows 11 Pro',
      ribbon: ['مدى', 'الحياة'],
      chips: [
        { label: 'تسليم فوري', icon: 'clock' },
        { label: 'مفتاح أصلي', icon: 'nonsense' },
      ],
    },
  });
  const known = new Set(['c1', 'c2']);

  it('drops section ids that do not exist and falls back sensibly', () => {
    const assigned = checkPlan(
      plan({ action: 'assign', categoryIds: ['c2', 'ghost', 'c2'] }),
      known,
      [],
      true,
    );
    expect('plan' in assigned && assigned.plan.category).toMatchObject({
      action: 'assign',
      categoryIds: ['c2'],
    });
    if ('plan' in assigned) expect(assigned.plan.card.chips[1]?.icon).toBe('key');

    const nothing = checkPlan(
      plan({ action: 'assign', categoryIds: ['ghost'] }),
      known,
      ['c1'],
      true,
    );
    expect('plan' in nothing && nothing.plan.category.action).toBe('keep');

    const create = {
      nameAr: 'برامج التصميم',
      nameEn: 'Design software',
      slug: 'design',
      parentId: 'ghost',
    };
    const off = checkPlan(plan({ action: 'create', create }), known, ['c1'], false);
    expect('plan' in off && off.plan.category.action).toBe('keep');
    const on = checkPlan(plan({ action: 'create', create }), known, [], true);
    expect('plan' in on && on.plan.category.create?.parentId).toBeNull();
  });

  it('reports why a plan does not fit', () => {
    const bad = checkPlan({ category: { action: 'move' } }, known, [], true);
    expect('error' in bad && bad.error).toMatch(/category\.action/);
  });
});

describe('plan prompt', () => {
  it('lists the sections and says when creating is off', () => {
    const prompt = planUserPrompt({
      facts: {
        nameAr: 'ويندوز 11 برو',
        nameEn: 'Windows 11 Pro',
        brand: 'Microsoft',
        categories: [],
        kind: 'KEY',
        variants: [],
        supplierLines: [{ name: 'Win 11 Pro Retail', warranty: null }],
      },
      currentCategoryIds: [],
      categories: [
        {
          id: 'c1',
          nameAr: 'أنظمة التشغيل',
          nameEn: 'Operating systems',
          parentId: null,
          products: 4,
        },
      ],
      allowCreate: false,
      supplierCategory: 'Windows',
    });
    expect(prompt).toContain('c1 | أنظمة التشغيل | Operating systems');
    expect(prompt).toContain('creating sections is switched off');
    expect(prompt).toContain("Supplier's section for the line: Windows");
    expect(prompt).toContain('Current section ids: none');
  });
});

describe('start batch contract', () => {
  it('defaults the options and cooldown, and refuses duplicates and oversize batches', () => {
    const parsed = startAgentBatchSchema.parse({ kind: 'REWRITE', ids: ['a', 'b'] });
    expect(parsed.cooldownSeconds).toBe(90);
    expect(parsed.options).toMatchObject({
      copy: true,
      category: true,
      card: 'missing',
      publish: true,
    });
    expect(startAgentBatchSchema.safeParse({ kind: 'REWRITE', ids: ['a', 'a'] }).success).toBe(
      false,
    );
    expect(
      startAgentBatchSchema.safeParse({
        kind: 'CREATE',
        ids: Array.from({ length: 201 }, (_, i) => String(i)),
      }).success,
    ).toBe(false);
    expect(
      startAgentBatchSchema.safeParse({ kind: 'CREATE', ids: ['a'], cooldownSeconds: 5 }).success,
    ).toBe(false);
  });
});

describe('review fixes (REV-0232)', () => {
  it('refuses the IPv6 ranges that carry or hide an IPv4 address', () => {
    for (const address of [
      '::7f00:1',
      '::127.0.0.1',
      '2002:7f00:1::1',
      '2001:0:4136:e378:8000:63bf:3fff:fdd2',
      '64:ff9b:1::a00:1',
      'fec0::1',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2001:4860:4860::8888')).toBe(true);
  });

  it('treats a trailing dot as the same host', () => {
    expect(() => checkUrl('https://localhost./')).toThrow(FetchRefusedError);
    expect(() => checkUrl('https://metadata.google.internal./')).toThrow(FetchRefusedError);
    expect(checkUrl('https://eset.com./').hostname).toBe('eset.com.');
  });

  it('refuses SVG imports, stylesheets and any doctype', () => {
    expect(safeSvg('<svg><style>@import "file:///etc/passwd";</style></svg>')).toBe(false);
    expect(safeSvg('<?xml-stylesheet href="x.css"?><svg/>')).toBe(false);
    expect(safeSvg('<!DOCTYPE svg SYSTEM "file:///etc/passwd"><svg/>')).toBe(false);
  });

  it('keeps a model-written name to plain text', () => {
    expect(plainName('  Windows <b>11</b>' + String.fromCharCode(0x202e) + ' Pro\n\tKey ')).toBe(
      'Windows b 11 /b Pro Key',
    );
    expect(plainName('ويندوز 11 برو')).toBe('ويندوز 11 برو');
    expect(plainName('x'.repeat(300))).toHaveLength(200);
  });
});
