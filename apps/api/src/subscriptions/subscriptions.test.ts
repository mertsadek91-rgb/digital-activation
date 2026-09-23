import { beforeAll, describe, expect, it } from 'vitest';

import { newsletterToken, readNewsletterToken } from './subscriptions.service.js';

/**
 * Guards the newsletter links. A token that verified when it should not would
 * subscribe or unsubscribe an address its holder does not own.
 */
describe('newsletter tokens', () => {
  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'test-secret-with-plenty-of-distinct-characters-0123';
  });

  it('round-trips the address it was issued for', () => {
    const token = newsletterToken('a@example.com', 'newsletter-confirm');
    expect(readNewsletterToken(token, 'newsletter-confirm')).toBe('a@example.com');
  });

  it('refuses a confirm link replayed as an unsubscribe', () => {
    const token = newsletterToken('a@example.com', 'newsletter-confirm');
    expect(readNewsletterToken(token, 'newsletter-unsubscribe')).toBeNull();
  });

  it('refuses a token whose address was swapped', () => {
    const [, mac] = newsletterToken('a@example.com', 'newsletter-confirm').split('.');
    const forged = `${Buffer.from('b@example.com').toString('base64url')}.${mac ?? ''}`;
    expect(readNewsletterToken(forged, 'newsletter-confirm')).toBeNull();
  });

  it('refuses garbage', () => {
    expect(readNewsletterToken('nope', 'newsletter-confirm')).toBeNull();
  });
});
