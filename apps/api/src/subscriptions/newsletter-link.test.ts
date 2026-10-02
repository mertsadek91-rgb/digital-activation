import crypto from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LEGACY_LINK_CUTOFF } from '../common/link-secret.js';
import {
  NEWSLETTER_LINK_TTL_MS,
  newsletterToken,
  readNewsletterToken,
  type NewsletterPurpose,
} from './newsletter-link.js';

/**
 * Guards the newsletter links (TASK-0098). A token that verified when it
 * should not would subscribe or unsubscribe an address its holder does not
 * own; one that stopped verifying too soon would break an opt-out promise.
 *
 * Secrets are random per run: a literal reads as a leaked key to the secret
 * scanner, and nothing here depends on the value.
 */
const DAY = 86_400_000;
const BEFORE_CUTOFF = new Date(LEGACY_LINK_CUTOFF.getTime() - 10 * DAY);
const AFTER_CUTOFF = new Date(LEGACY_LINK_CUTOFF.getTime() + DAY);
const YEARS_LATER = new Date(LEGACY_LINK_CUTOFF.getTime() + 5 * 365 * DAY);
const EMAIL = 'a@example.com';

let access: string;
let link: string;

/** How tokens were minted before TASK-0098 — written out, not imported. */
function v1Token(secret: string, email: string, purpose: NewsletterPurpose): string {
  const payload = Buffer.from(email).toString('base64url');
  const mac = crypto
    .createHmac('sha256', secret)
    .update(`${purpose}:v1:${payload}`)
    .digest('base64url');
  return `${payload}.${mac}`;
}

beforeEach(() => {
  access = crypto.randomBytes(48).toString('base64url');
  link = crypto.randomBytes(48).toString('base64url');
  vi.stubEnv('JWT_ACCESS_SECRET', access);
  vi.stubEnv('LINK_SIGNING_SECRET', link);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('newsletter links — v2', () => {
  it('round-trips the address it was issued for, per purpose', () => {
    for (const purpose of Object.keys(NEWSLETTER_LINK_TTL_MS) as NewsletterPurpose[]) {
      const token = newsletterToken(EMAIL, purpose, BEFORE_CUTOFF);
      expect(token).toMatch(/^v2\.[A-Za-z0-9_-]+\.\d+\.[A-Za-z0-9_-]{43}$/);
      expect(readNewsletterToken(token, purpose, BEFORE_CUTOFF)).toBe(EMAIL);
    }
  });

  it('is signed with LINK_SIGNING_SECRET, not the access secret', () => {
    const token = newsletterToken(EMAIL, 'newsletter-confirm', BEFORE_CUTOFF);
    vi.stubEnv('LINK_SIGNING_SECRET', crypto.randomBytes(48).toString('base64url'));
    expect(readNewsletterToken(token, 'newsletter-confirm', BEFORE_CUTOFF)).toBeNull();
  });

  it('never passes for another purpose', () => {
    const purposes = Object.keys(NEWSLETTER_LINK_TTL_MS) as NewsletterPurpose[];
    for (const issued of purposes) {
      const token = newsletterToken(EMAIL, issued, BEFORE_CUTOFF);
      for (const used of purposes.filter((p) => p !== issued)) {
        expect(readNewsletterToken(token, used, BEFORE_CUTOFF)).toBeNull();
      }
    }
  });

  it('refuses a token whose address or expiry was swapped', () => {
    const [, , digits = '', mac = ''] = newsletterToken(EMAIL, 'newsletter-confirm').split('.');
    const otherAddress = Buffer.from('b@example.com').toString('base64url');
    expect(
      readNewsletterToken(`v2.${otherAddress}.${digits}.${mac}`, 'newsletter-confirm'),
    ).toBeNull();
    const own = Buffer.from(EMAIL).toString('base64url');
    const later = String(Number(digits) + 365 * 86_400);
    expect(readNewsletterToken(`v2.${own}.${later}.${mac}`, 'newsletter-confirm')).toBeNull();
  });

  it('refuses an expiry written with leading zeros', () => {
    const token = newsletterToken(EMAIL, 'newsletter-unsubscribe');
    expect(readNewsletterToken(token.replace('.0.', '.00.'), 'newsletter-unsubscribe')).toBeNull();
  });

  it('fits the longest address the form accepts within the 1000-character token limit', () => {
    const long = `${'a'.repeat(64)}@${'b'.repeat(251)}.com`;
    expect(long).toHaveLength(320);
    for (const purpose of Object.keys(NEWSLETTER_LINK_TTL_MS) as NewsletterPurpose[]) {
      const token = newsletterToken(long, purpose, BEFORE_CUTOFF);
      expect(token.length).toBeLessThanOrEqual(1000);
      expect(readNewsletterToken(token, purpose, BEFORE_CUTOFF)).toBe(long);
    }
  });

  it('honours a confirm link signed with the fallback key only until the cutoff', () => {
    vi.stubEnv('LINK_SIGNING_SECRET', '');
    const issued = new Date(LEGACY_LINK_CUTOFF.getTime() - 2 * DAY);
    const token = newsletterToken(EMAIL, 'newsletter-confirm', issued);
    vi.stubEnv('LINK_SIGNING_SECRET', link);
    expect(readNewsletterToken(token, 'newsletter-confirm', issued)).toBe(EMAIL);
    expect(readNewsletterToken(token, 'newsletter-confirm', LEGACY_LINK_CUTOFF)).toBeNull();
  });

  it('refuses garbage', () => {
    for (const token of ['nope', 'v2.x.1', 'v2..0.abc', 'v2.YQ.abc.def', 'a.b.c', '']) {
      expect(readNewsletterToken(token, 'newsletter-unsubscribe')).toBeNull();
    }
  });
});

describe('confirm links expire after 7 days', () => {
  it.each(['newsletter-confirm', 'welcome-confirm'] as const)('%s', (purpose) => {
    expect(NEWSLETTER_LINK_TTL_MS[purpose]).toBe(7 * DAY);
    const issued = new Date('2026-10-02T12:00:00Z');
    const token = newsletterToken(EMAIL, purpose, issued);
    expect(readNewsletterToken(token, purpose, new Date(issued.getTime() + 7 * DAY - 1000))).toBe(
      EMAIL,
    );
    expect(readNewsletterToken(token, purpose, new Date(issued.getTime() + 7 * DAY + 1000))).toBe(
      null,
    );
  });

  it('cannot be stretched by re-signing a confirm payload as never-expiring', () => {
    // A confirm purpose signed with expiry 0 would be a forever-confirm; only
    // the issuer could make one, but the reader refuses it all the same.
    const payload = Buffer.from(EMAIL).toString('base64url');
    const mac = crypto
      .createHmac('sha256', link)
      .update(`newsletter-link:v2:newsletter-confirm:${payload}|0`)
      .digest('base64url');
    expect(readNewsletterToken(`v2.${payload}.0.${mac}`, 'newsletter-confirm')).toBeNull();
  });
});

describe('unsubscribe links never expire', () => {
  it('is signed without an expiry and still works years later', () => {
    expect(NEWSLETTER_LINK_TTL_MS['newsletter-unsubscribe']).toBeNull();
    const token = newsletterToken(EMAIL, 'newsletter-unsubscribe', BEFORE_CUTOFF);
    expect(token.split('.')[2]).toBe('0');
    expect(readNewsletterToken(token, 'newsletter-unsubscribe', YEARS_LATER)).toBe(EMAIL);
  });

  it('keeps links signed with the derived fallback working after the real key is added', () => {
    vi.stubEnv('LINK_SIGNING_SECRET', '');
    const token = newsletterToken(EMAIL, 'newsletter-unsubscribe', BEFORE_CUTOFF);
    vi.stubEnv('LINK_SIGNING_SECRET', link);
    expect(readNewsletterToken(token, 'newsletter-unsubscribe', YEARS_LATER)).toBe(EMAIL);
  });

  it('would refuse a signed expiry it was never issued with', () => {
    const payload = Buffer.from(EMAIL).toString('base64url');
    const seconds = Math.floor(YEARS_LATER.getTime() / 1000);
    const mac = crypto
      .createHmac('sha256', link)
      .update(`newsletter-link:v2:newsletter-unsubscribe:${payload}|${String(seconds)}`)
      .digest('base64url');
    expect(
      readNewsletterToken(`v2.${payload}.${String(seconds)}.${mac}`, 'newsletter-unsubscribe'),
    ).toBeNull();
  });
});

describe('legacy (v1) links', () => {
  it('accepts a v1 confirm link until the cutoff, and refuses it from then on', () => {
    for (const purpose of ['newsletter-confirm', 'welcome-confirm'] as const) {
      const token = v1Token(access, EMAIL, purpose);
      expect(readNewsletterToken(token, purpose, BEFORE_CUTOFF)).toBe(EMAIL);
      expect(readNewsletterToken(token, purpose, LEGACY_LINK_CUTOFF)).toBeNull();
      expect(readNewsletterToken(token, purpose, AFTER_CUTOFF)).toBeNull();
    }
  });

  it('accepts a v1 unsubscribe link before and long after the cutoff', () => {
    const token = v1Token(access, EMAIL, 'newsletter-unsubscribe');
    expect(readNewsletterToken(token, 'newsletter-unsubscribe', BEFORE_CUTOFF)).toBe(EMAIL);
    expect(readNewsletterToken(token, 'newsletter-unsubscribe', YEARS_LATER)).toBe(EMAIL);
  });

  it('keeps v1 purposes apart', () => {
    const confirm = v1Token(access, EMAIL, 'newsletter-confirm');
    expect(readNewsletterToken(confirm, 'newsletter-unsubscribe', BEFORE_CUTOFF)).toBeNull();
    const unsubscribe = v1Token(access, EMAIL, 'newsletter-unsubscribe');
    expect(readNewsletterToken(unsubscribe, 'newsletter-confirm', BEFORE_CUTOFF)).toBeNull();
  });

  it('refuses a v1 link under any key but the access secret', () => {
    const token = v1Token(link, EMAIL, 'newsletter-unsubscribe');
    expect(readNewsletterToken(token, 'newsletter-unsubscribe', BEFORE_CUTOFF)).toBeNull();
  });

  it('refuses a v1 link whose address was swapped', () => {
    const [, mac] = v1Token(access, EMAIL, 'newsletter-unsubscribe').split('.');
    const forged = `${Buffer.from('b@example.com').toString('base64url')}.${mac ?? ''}`;
    expect(readNewsletterToken(forged, 'newsletter-unsubscribe', BEFORE_CUTOFF)).toBeNull();
  });
});
