import sharp from 'sharp';

import { logoPalette } from '../supplier/card/card.js';

import { type Fetched, type GetOptions, safeGet } from './safe-fetch.js';

/**
 * Finds a brand's logo on its official website (CR-0007).
 *
 * The domain comes from the model's plan, so everything fetched goes through
 * `safeGet`. The home page is read for what sites publish as their mark — the
 * header image named "logo", the touch icon, the web-app manifest's icons,
 * a large favicon — and the candidates are tried best first until one is an
 * image we can read, big enough, and not blank. Google's favicon service is
 * the last resort: it always answers, if only with a small icon.
 *
 * What comes back is a PNG no larger than 512 px, ready to be sent as the
 * card's uploaded logo, with the logo's main colours.
 */

export interface FoundLogo {
  png: Buffer;
  sourceUrl: string;
  palette: string[];
}

export interface LogoCandidate {
  url: string;
  score: number;
}

type Get = (url: string, options: GetOptions) => Promise<Fetched>;

const HTML = { maxBytes: 1_500_000, timeoutMs: 12_000, accept: 'text/html,application/xhtml+xml' };
const IMAGE = { maxBytes: 3_000_000, timeoutMs: 12_000, accept: 'image/*' };
const JSON_DOC = {
  maxBytes: 200_000,
  timeoutMs: 8_000,
  accept: 'application/manifest+json,application/json',
};
const MIN_SIDE = 64;
const MAX_TRIES = 6;

/** A bare host name from whatever the model wrote ("https://www.Eset.com/int/"). */
export function normaliseDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
  return /^(?=.{4,120}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)
    ? host
    : null;
}

/** The attributes of one HTML tag, lower-cased names, entity-light values. */
function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of tag.matchAll(
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g,
  )) {
    const name = (match[1] ?? '').toLowerCase();
    const value = (match[3] ?? match[4] ?? match[5] ?? '').replace(/&amp;/g, '&').trim();
    if (name && !(name in out)) out[name] = value;
  }
  return out;
}

function largestSize(sizes: string | undefined): number {
  if (!sizes) return 0;
  if (/any/i.test(sizes)) return 512;
  return Math.max(0, ...[...sizes.matchAll(/(\d+)x(\d+)/gi)].map((m) => Number(m[1])));
}

function absolute(href: string, base: string): string | null {
  if (!href || href.startsWith('data:') || href.startsWith('javascript:')) return null;
  try {
    const url = new URL(href, base);
    url.protocol = 'https:';
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Logo candidates in a page, best first. Pure, so the ranking is tested
 * without a network.
 */
export function logoCandidates(html: string, pageUrl: string): LogoCandidate[] {
  const found = new Map<string, number>();
  const add = (href: string | undefined, score: number) => {
    const url = href ? absolute(href, pageUrl) : null;
    if (url && score > (found.get(url) ?? 0)) found.set(url, score);
  };
  const head = html.slice(0, 400_000);

  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attributes(tag);
    const rel = (a.rel ?? '').toLowerCase();
    const size = largestSize(a.sizes);
    const svg = /\.svg(\?|$)/i.test(a.href ?? '') || /svg/i.test(a.type ?? '');
    if (rel.includes('apple-touch-icon')) add(a.href, 70 + Math.min(size, 512) / 32);
    else if (rel.split(/\s+/).includes('icon')) {
      add(a.href, svg ? 66 : size >= 128 ? 60 + size / 64 : 30 + size / 16);
    }
  }
  for (const [tag] of head.matchAll(/<img\b[^>]*>/gi)) {
    const a = attributes(tag);
    const src = a.src ?? a['data-src'] ?? '';
    const named = [src, a.alt, a.class, a.id].some((value) => /logo/i.test(value ?? ''));
    if (named) add(src, /\.svg(\?|$)/i.test(src) ? 92 : 88);
  }
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(tag);
    const key = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase();
    if (key === 'og:logo' || key === 'logo') add(a.content, 85);
    else if (key === 'og:image' && /logo/i.test(a.content ?? '')) add(a.content, 55);
  }
  return [...found.entries()]
    .map(([url, score]) => ({ url, score }))
    .sort((a, b) => b.score - a.score);
}

/** The web-app manifest's link, if the page has one. */
export function manifestUrl(html: string, pageUrl: string): string | null {
  for (const [tag] of html.slice(0, 400_000).matchAll(/<link\b[^>]*>/gi)) {
    const a = attributes(tag);
    if ((a.rel ?? '').toLowerCase().split(/\s+/).includes('manifest') && a.href) {
      return absolute(a.href, pageUrl);
    }
  }
  return null;
}

export function manifestCandidates(manifest: unknown, manifestUrlValue: string): LogoCandidate[] {
  const icons = (manifest as { icons?: unknown } | null)?.icons;
  if (!Array.isArray(icons)) return [];
  const out: LogoCandidate[] = [];
  for (const icon of icons as { src?: unknown; sizes?: unknown; purpose?: unknown }[]) {
    if (typeof icon.src !== 'string') continue;
    // A maskable icon is drawn with padding for a phone's mask: a poor logo.
    if (
      typeof icon.purpose === 'string' &&
      !/any/i.test(icon.purpose) &&
      /maskable/i.test(icon.purpose)
    )
      continue;
    const size = largestSize(typeof icon.sizes === 'string' ? icon.sizes : undefined);
    const url = absolute(icon.src, manifestUrlValue);
    if (url && size >= 128) out.push({ url, score: 74 + Math.min(size, 512) / 64 });
  }
  return out;
}

/**
 * SVG we are willing to rasterise: drawing only. Anything that can reach
 * outside the file — an external image, a script, an entity, a foreign
 * object — is refused rather than trusted to the renderer's own sandbox.
 */
export function safeSvg(text: string): boolean {
  if (text.length > 1_000_000) return false;
  if (
    /<!ENTITY|<!DOCTYPE|@import|<\?xml-stylesheet|<script|<foreignObject|<iframe|<use\b[^>]*href\s*=\s*["'](?!#)/i.test(
      text,
    )
  ) {
    return false;
  }
  // Any href/src that is not an in-file reference or embedded data.
  for (const match of text.matchAll(/(?:xlink:href|href|src)\s*=\s*["']([^"']*)["']/gi)) {
    const value = (match[1] ?? '').trim();
    if (!value.startsWith('#') && !/^data:image\/(png|jpeg|webp);base64,/i.test(value))
      return false;
  }
  return !/url\(\s*["']?(?!#)/i.test(text);
}

/** Raster PNG of a fetched image, or null when it is not a usable logo. */
export async function toLogoPng(fetched: Fetched): Promise<Buffer | null> {
  const looksSvg =
    fetched.contentType.includes('svg') ||
    /^\s*(<\?xml[^>]*>\s*)?<svg\b/i.test(fetched.body.subarray(0, 512).toString('utf8'));
  try {
    let image: sharp.Sharp;
    if (looksSvg) {
      if (!safeSvg(fetched.body.toString('utf8'))) return null;
      image = sharp(fetched.body, { density: 300, limitInputPixels: 40_000_000 });
    } else {
      const meta = await sharp(fetched.body).metadata();
      if (!['png', 'jpeg', 'webp', 'gif'].includes(meta.format ?? '')) return null;
      image = sharp(fetched.body, { limitInputPixels: 40_000_000 });
    }
    const png = await image
      .resize(512, 512, { fit: 'inside', withoutEnlargement: !looksSvg })
      .png()
      .toBuffer({ resolveWithObject: true });
    if (png.info.width < MIN_SIDE && png.info.height < MIN_SIDE) return null;
    // Blank or almost: a transparent pixel or a white box is not a logo.
    const stats = await sharp(png.data).stats();
    const spread = stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.stdev, 0);
    if (spread < 6) return null;
    return png.data;
  } catch {
    return null;
  }
}

/**
 * The brand's logo from its site, or null. Never throws: a site that will not
 * answer is a product card drawn with the brand's name instead.
 */
export async function findLogo(domain: string, get: Get = safeGet): Promise<FoundLogo | null> {
  const candidates: LogoCandidate[] = [];
  for (const home of [`https://${domain}/`, `https://www.${domain}/`]) {
    try {
      const page = await get(home, HTML);
      const html = page.body.toString('utf8');
      candidates.push(...logoCandidates(html, page.url));
      const manifest = manifestUrl(html, page.url);
      if (manifest) {
        try {
          const doc = await get(manifest, JSON_DOC);
          candidates.push(...manifestCandidates(JSON.parse(doc.body.toString('utf8')), doc.url));
        } catch {
          // A broken manifest is common and costs nothing but its icons.
        }
      }
      break;
    } catch {
      // Try the www. host before giving up on the site.
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  candidates.push({
    url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`,
    score: 1,
  });

  const tried = new Set<string>();
  for (const candidate of candidates) {
    if (tried.has(candidate.url) || tried.size >= MAX_TRIES) continue;
    tried.add(candidate.url);
    try {
      const fetched = await get(candidate.url, IMAGE);
      const png = await toLogoPng(fetched);
      if (!png) continue;
      return { png, sourceUrl: fetched.url, palette: await logoPalette(png) };
    } catch {
      // Next candidate.
    }
  }
  return null;
}
