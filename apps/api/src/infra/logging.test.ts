import { describe, expect, it } from 'vitest';

import { maskEmails, requestIdFor, scrubUrl } from './logging.js';

function idFor(requestId?: string): string {
  return requestIdFor({ headers: requestId === undefined ? {} : { 'x-request-id': requestId } });
}

describe('maskEmails', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmails('Sent receipt to someone.else@example.co.uk twice')).toBe(
      'Sent receipt to s***@example.co.uk twice',
    );
  });

  it('leaves text without an address alone', () => {
    expect(maskEmails('Order DA-1001 paid')).toBe('Order DA-1001 paid');
  });
});

describe('scrubUrl', () => {
  it('blanks credential query values and masks addresses', () => {
    expect(scrubUrl('/v1/orders/DA-1?token=abc.def&locale=ar&email=a%40b.com')).toBe(
      '/v1/orders/DA-1?token=%5Bredacted%5D&locale=ar&email=%5Bredacted%5D',
    );
  });

  it('leaves a URL without a query as it is', () => {
    expect(scrubUrl('/v1/catalog/home')).toBe('/v1/catalog/home');
  });
});

describe('requestIdFor', () => {
  it('honours a well-formed incoming id', () => {
    expect(idFor('abc-123')).toBe('abc-123');
  });

  it('replaces a malformed one rather than writing it into the log', () => {
    expect(idFor('line\nbreak {"level":60}')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('generates one when none is sent', () => {
    expect(idFor()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
