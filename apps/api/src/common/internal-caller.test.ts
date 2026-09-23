import { describe, expect, it } from 'vitest';

import { internalKeyMatches, trackerFor } from './internal-caller.js';

const KEY = 'k'.repeat(16) + 'Zq8xV2mN7pL4rT9w';

describe('trackerFor', () => {
  it('counts the connecting address when no key is configured', () => {
    const request = { ip: '10.0.0.5', headers: { 'x-da-internal': KEY, 'x-da-client-ip': '1.2.3.4' } };
    expect(trackerFor(request, undefined)).toBe('10.0.0.5');
  });

  it('counts the forwarded visitor when the storefront presents the key', () => {
    const request = { ip: '10.0.0.5', headers: { 'x-da-internal': KEY, 'x-da-client-ip': '1.2.3.4' } };
    expect(trackerFor(request, KEY)).toBe('1.2.3.4');
  });

  it('ignores a forwarded address sent without the key, or with the wrong one', () => {
    expect(trackerFor({ ip: '9.9.9.9', headers: { 'x-da-client-ip': '1.2.3.4' } }, KEY)).toBe('9.9.9.9');
    expect(
      trackerFor({ ip: '9.9.9.9', headers: { 'x-da-internal': 'guess', 'x-da-client-ip': '1.2.3.4' } }, KEY),
    ).toBe('9.9.9.9');
  });

  it('ignores a forwarded value that is not an address', () => {
    const request = { ip: '10.0.0.5', headers: { 'x-da-internal': KEY, 'x-da-client-ip': 'anything' } };
    expect(trackerFor(request, KEY)).toBe('10.0.0.5');
  });

  it('accepts IPv6', () => {
    const request = { ip: '10.0.0.5', headers: { 'x-da-internal': KEY, 'x-da-client-ip': '2001:db8::1' } };
    expect(trackerFor(request, KEY)).toBe('2001:db8::1');
  });
});

describe('internalKeyMatches', () => {
  it('rejects empty, missing and repeated headers', () => {
    expect(internalKeyMatches('', KEY)).toBe(false);
    expect(internalKeyMatches(undefined, KEY)).toBe(false);
    expect(internalKeyMatches([KEY, KEY], KEY)).toBe(false);
  });
});
