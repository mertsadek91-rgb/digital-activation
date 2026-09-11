import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PRODUCTION_ORIGIN, indexingPolicy, robotsMeta } from './indexing.js';

/**
 * Guards the one switch that decides whether the staging host gets indexed.
 *
 * The rebuild is served from `new.digital-activation.com` while the legacy
 * WordPress site still holds the apex, and the two carry near-identical content.
 * Letting Google index the subdomain costs twice: duplicate content competing
 * with the live store now, and a subdomain that keeps ranking after the cutover
 * and siphons from the apex it was meant to replace. Every case below is a way
 * the derivation could quietly say "yes" when it must say "no".
 */
let savedBlock: string | undefined;

beforeEach(() => {
  savedBlock = process.env.SEO_BLOCK_INDEXING;
  delete process.env.SEO_BLOCK_INDEXING;
});

afterEach(() => {
  if (savedBlock === undefined) delete process.env.SEO_BLOCK_INDEXING;
  else process.env.SEO_BLOCK_INDEXING = savedBlock;
});

describe('indexingPolicy', () => {
  it('indexes the production apex, and says so', () => {
    const policy = indexingPolicy(PRODUCTION_ORIGIN);

    expect(policy.index).toBe(true);
    expect(policy.reason).toContain(PRODUCTION_ORIGIN);
  });

  it('indexes when the configured URL carries a path, because only the origin decides', () => {
    expect(indexingPolicy('https://digital-activation.com/ar/store').index).toBe(true);
  });

  it('refuses the staging subdomain, which is the whole reason this is derived', () => {
    const policy = indexingPolicy('https://new.digital-activation.com');

    expect(policy.index).toBe(false);
    expect(policy.reason).toContain('https://new.digital-activation.com');
  });

  it('refuses a preview deployment nobody remembered to configure', () => {
    expect(indexingPolicy('https://da-git-main-xyz.vercel.app').index).toBe(false);
  });

  it('refuses localhost', () => {
    expect(indexingPolicy('http://localhost:3000').index).toBe(false);
  });

  it('refuses plain http on the production host, since the origin includes the scheme', () => {
    expect(indexingPolicy('http://digital-activation.com').index).toBe(false);
  });

  it('refuses the www host, which is a different origin and a duplicate of the apex', () => {
    expect(indexingPolicy('https://www.digital-activation.com').index).toBe(false);
  });

  it('refuses when the variable is unset, rather than assuming production', () => {
    const policy = indexingPolicy(undefined);

    expect(policy.index).toBe(false);
    expect(policy.reason).toContain('not set');
  });

  it('refuses an empty string the same way as an unset variable', () => {
    expect(indexingPolicy('').index).toBe(false);
  });

  it('refuses a malformed URL instead of throwing and taking the build down', () => {
    const policy = indexingPolicy('digital-activation.com');

    expect(policy.index).toBe(false);
    expect(policy.reason).toContain('not a valid URL');
  });

  it('lets SEO_BLOCK_INDEXING=true override even the production origin', () => {
    process.env.SEO_BLOCK_INDEXING = 'true';

    const policy = indexingPolicy(PRODUCTION_ORIGIN);

    expect(policy.index).toBe(false);
    expect(policy.reason).toBe('SEO_BLOCK_INDEXING=true');
  });

  it('treats anything but the exact string "true" as not blocking', () => {
    for (const value of ['false', '1', 'TRUE', 'yes', '']) {
      process.env.SEO_BLOCK_INDEXING = value;
      expect(indexingPolicy(PRODUCTION_ORIGIN).index).toBe(true);
    }
  });
});

describe('robotsMeta', () => {
  it('turns off follow and asks for nocache whenever indexing is off', () => {
    expect(robotsMeta('https://new.digital-activation.com')).toEqual({
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false },
    });
  });

  it('sets the Googlebot directives to match the general ones, never to contradict them', () => {
    const meta = robotsMeta(PRODUCTION_ORIGIN);

    expect(meta.index).toBe(true);
    expect(meta.googleBot).toEqual({ index: true, follow: true });
  });
});
