import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { KekService } from '../vault/kek.js';

import { openTotpSecret, parseEnvelope, sealTotpSecret } from './totp-seal.js';

/**
 * TOTP secrets are sealed like vault licences, and rows written before that
 * must still open — a staff member locked out of the panel by a deploy has no
 * way back in but a database edit.
 *
 * Runs on a throwaway local KEK, never the operator's.
 */
const ENV_KEYS = ['KEK_PROVIDER', 'KEK_LOCAL_BASE64', 'KEK_VERSION'] as const;
const saved = new Map<string, string | undefined>();

beforeAll(() => {
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
  process.env.KEK_PROVIDER = 'local';
  process.env.KEK_LOCAL_BASE64 = crypto.randomBytes(32).toString('base64');
  process.env.KEK_VERSION = '1';
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** The pre-envelope format, reproduced here because the writer is gone. */
function legacySeal(plaintext: string): Uint8Array<ArrayBuffer> {
  const key = Buffer.from(process.env.KEK_LOCAL_BASE64 ?? '', 'base64');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Uint8Array.from(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]));
}

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

describe('sealTotpSecret / openTotpSecret', () => {
  it('round-trips a secret and reports it as current', async () => {
    const kek = new KekService();
    const sealed = await sealTotpSecret(SECRET, kek);

    expect(await openTotpSecret(sealed, kek)).toEqual({ secret: SECRET, stale: false });
  });

  it('writes a versioned envelope with the KEK generation in the header', async () => {
    const kek = new KekService();
    const sealed = Buffer.from(await sealTotpSecret(SECRET, kek));

    expect(sealed.subarray(0, 4).toString('ascii')).toBe('TOTP');
    expect(parseEnvelope(sealed)?.kekVersion).toBe(1);
    // The plaintext is nowhere in the blob.
    expect(sealed.includes(Buffer.from(SECRET))).toBe(false);
  });

  it('uses a fresh data key and iv per row', async () => {
    const kek = new KekService();
    const first = Buffer.from(await sealTotpSecret(SECRET, kek));
    const second = Buffer.from(await sealTotpSecret(SECRET, kek));

    expect(first.equals(second)).toBe(false);
  });

  it('refuses a tampered envelope rather than returning garbage', async () => {
    const kek = new KekService();
    const sealed = await sealTotpSecret(SECRET, kek);
    const last = sealed.length - 1;
    sealed[last] = (sealed[last] ?? 0) ^ 0xff;

    await expect(openTotpSecret(sealed, kek)).rejects.toThrow();
  });

  it('marks a row wrapped by an older KEK generation as stale', async () => {
    const kek = new KekService();
    const sealed = await sealTotpSecret(SECRET, kek);
    process.env.KEK_VERSION = '2';
    try {
      expect(await openTotpSecret(sealed, kek)).toEqual({ secret: SECRET, stale: true });
    } finally {
      process.env.KEK_VERSION = '1';
    }
  });
});

describe('legacy rows', () => {
  it('are not mistaken for an envelope', () => {
    expect(parseEnvelope(legacySeal(SECRET))).toBeNull();
  });

  it('still open, and are reported stale so the caller re-seals them', async () => {
    const kek = new KekService();

    expect(await openTotpSecret(legacySeal(SECRET), kek)).toEqual({
      secret: SECRET,
      stale: true,
    });
  });

  it('say why when the local key needed to read them is gone', async () => {
    const kek = new KekService();
    const legacy = legacySeal(SECRET);
    const previous = process.env.KEK_LOCAL_BASE64;
    delete process.env.KEK_LOCAL_BASE64;
    try {
      await expect(openTotpSecret(legacy, kek)).rejects.toThrow(/predates envelope/);
    } finally {
      process.env.KEK_LOCAL_BASE64 = previous;
    }
  });

  it('open even when the random iv happens to spell the envelope magic', async () => {
    const kek = new KekService();
    const legacy = legacySeal(SECRET);
    // Forge the collision: an iv that is a whole plausible header — magic,
    // format, version 1, a 4-byte "wrapped key" — so the envelope parser
    // accepts it and only the unwrap fails.
    const key = Buffer.from(process.env.KEK_LOCAL_BASE64 ?? '', 'base64');
    const iv = Buffer.concat([
      Buffer.from('TOTP', 'ascii'),
      Buffer.from([1, 0, 0, 0, 1, 0, 4]),
      crypto.randomBytes(1),
    ]);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(SECRET, 'utf8'), cipher.final()]);
    const colliding = Uint8Array.from(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]));

    expect(legacy.length).toBe(colliding.length);
    expect(parseEnvelope(colliding)).not.toBeNull();
    expect((await openTotpSecret(colliding, kek)).secret).toBe(SECRET);
  });
});
