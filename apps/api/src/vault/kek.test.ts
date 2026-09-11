import crypto from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { KekService, fingerprint, open, seal } from './kek.js';

/**
 * Guards the envelope: seal → open must return the licence byte for byte, and
 * the fingerprint must behave like the unique index depends on it.
 *
 * Both failures are silent and expensive. A seal/open that loses a character
 * hands the customer a key that does not activate, and nobody finds out until
 * they try. A fingerprint that collides makes the duplicate index reject a
 * licence that is not a duplicate — a key bought and paid for that can never be
 * loaded into the vault.
 *
 * Everything runs on a throwaway KEK generated here. The real one is never read:
 * a test that passes because of an operator's `.env` is a test that fails on
 * every other machine.
 */
const ENV_KEYS = [
  'KEK_PROVIDER',
  'KEK_LOCAL_BASE64',
  'KEK_VERSION',
  'VAULT_FINGERPRINT_SALT',
] as const;

const saved = new Map<string, string | undefined>();

beforeAll(() => {
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
  process.env.KEK_PROVIDER = 'local';
  process.env.KEK_LOCAL_BASE64 = crypto.randomBytes(32).toString('base64');
  process.env.KEK_VERSION = '1';
  process.env.VAULT_FINGERPRINT_SALT = 'test-salt-not-the-real-one';
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('seal and open', () => {
  it('returns the exact licence that was sealed', async () => {
    const kek = new KekService();
    const plaintext = 'NKJFK-GPHP7-G8C3J-P6JXR-HQRJR';

    expect(await open(await seal(plaintext, kek), kek)).toBe(plaintext);
  });

  it('survives a two-line account payload, colons, spaces and Arabic alike', async () => {
    const kek = new KekService();
    const plaintext = 'user@example.com\npa:ss word — كلمة المرور';

    expect(await open(await seal(plaintext, kek), kek)).toBe(plaintext);
  });

  it('gives every row its own iv and ciphertext even for identical plaintext', async () => {
    const kek = new KekService();
    const first = await seal('NKJFK-GPHP7-G8C3J', kek);
    const second = await seal('NKJFK-GPHP7-G8C3J', kek);

    expect(Buffer.from(first.iv).equals(Buffer.from(second.iv))).toBe(false);
    expect(Buffer.from(first.ciphertext).equals(Buffer.from(second.ciphertext))).toBe(false);
    // …but the fingerprint is the same, which is what catches the duplicate.
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it('stamps the current KEK version on the row, so a rotation can find it', async () => {
    const kek = new KekService();
    expect((await seal('NKJFK-GPHP7-G8C3J', kek)).kekVersion).toBe(1);
  });

  it('refuses to open a row whose ciphertext was altered, rather than returning garbage', async () => {
    const kek = new KekService();
    const sealed = await seal('NKJFK-GPHP7-G8C3J-P6JXR-HQRJR', kek);
    const tampered = Uint8Array.from(sealed.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;

    await expect(open({ ...sealed, ciphertext: tampered }, kek)).rejects.toThrow();
  });

  it('cannot open a row sealed under a different KEK', async () => {
    const kek = new KekService();
    const sealed = await seal('NKJFK-GPHP7-G8C3J-P6JXR-HQRJR', kek);

    const previous = process.env.KEK_LOCAL_BASE64;
    process.env.KEK_LOCAL_BASE64 = crypto.randomBytes(32).toString('base64');
    try {
      await expect(open(sealed, kek)).rejects.toThrow();
    } finally {
      process.env.KEK_LOCAL_BASE64 = previous;
    }
  });
});

describe('KekService', () => {
  it('refuses to operate with no local KEK configured, instead of inventing one', async () => {
    const kek = new KekService();
    const previous = process.env.KEK_LOCAL_BASE64;
    delete process.env.KEK_LOCAL_BASE64;
    try {
      await expect(kek.wrap(crypto.randomBytes(32))).rejects.toThrow(ServiceUnavailableException);
    } finally {
      process.env.KEK_LOCAL_BASE64 = previous;
    }
  });

  it('refuses a local KEK that is not exactly 32 bytes', async () => {
    const kek = new KekService();
    const previous = process.env.KEK_LOCAL_BASE64;
    process.env.KEK_LOCAL_BASE64 = crypto.randomBytes(16).toString('base64');
    try {
      await expect(kek.wrap(crypto.randomBytes(32))).rejects.toThrow(ServiceUnavailableException);
    } finally {
      process.env.KEK_LOCAL_BASE64 = previous;
    }
  });

  it('wraps and unwraps a data key without altering a byte of it', async () => {
    const kek = new KekService();
    const dek = crypto.randomBytes(32);
    const { wrapped, version } = await kek.wrap(Buffer.from(dek));

    expect(Buffer.from(await kek.unwrap(wrapped, version)).equals(dek)).toBe(true);
  });

  it('falls back to local rather than reaching for KMS when the provider is unset', () => {
    const kek = new KekService();
    const previous = process.env.KEK_PROVIDER;
    delete process.env.KEK_PROVIDER;
    try {
      expect(kek.provider).toBe('local');
    } finally {
      process.env.KEK_PROVIDER = previous;
    }
  });

  it('treats a non-numeric or zero KEK_VERSION as version 1 rather than NaN', () => {
    const kek = new KekService();
    const previous = process.env.KEK_VERSION;
    try {
      process.env.KEK_VERSION = 'nonsense';
      expect(kek.version).toBe(1);
      process.env.KEK_VERSION = '0';
      expect(kek.version).toBe(1);
      process.env.KEK_VERSION = '7';
      expect(kek.version).toBe(7);
    } finally {
      process.env.KEK_VERSION = previous;
    }
  });
});

describe('fingerprint', () => {
  it('is stable for the same plaintext, which is what makes the unique index work', () => {
    expect(fingerprint('NKJFK-GPHP7-G8C3J')).toBe(fingerprint('NKJFK-GPHP7-G8C3J'));
  });

  it('differs for two different licences, so one is never mistaken for a duplicate', () => {
    expect(fingerprint('NKJFK-GPHP7-G8C3J')).not.toBe(fingerprint('NKJFK-GPHP7-G8C3K'));
  });

  it('ignores the whitespace a paste leaves around a key', () => {
    expect(fingerprint('  NKJFK-GPHP7-G8C3J \n')).toBe(fingerprint('NKJFK-GPHP7-G8C3J'));
  });

  it('is case-sensitive, because licence keys are', () => {
    expect(fingerprint('nkjfk-gphp7')).not.toBe(fingerprint('NKJFK-GPHP7'));
  });

  it('does not put the plaintext anywhere in its output', () => {
    const digest = fingerprint('NKJFK-GPHP7-G8C3J');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain('NKJFK');
  });

  it('changes with the salt, so a leaked table cannot be checked against a guess list', () => {
    const withSalt = fingerprint('NKJFK-GPHP7-G8C3J');
    const previous = process.env.VAULT_FINGERPRINT_SALT;
    process.env.VAULT_FINGERPRINT_SALT = 'a-different-salt';
    try {
      expect(fingerprint('NKJFK-GPHP7-G8C3J')).not.toBe(withSalt);
    } finally {
      process.env.VAULT_FINGERPRINT_SALT = previous;
    }
  });

  it('does not let a salt boundary be forged by a key that starts with a space', () => {
    // The salt and the plaintext are hashed as separate updates with a space
    // between them. Two different (salt, key) pairs must not produce one digest.
    const previous = process.env.VAULT_FINGERPRINT_SALT;
    try {
      process.env.VAULT_FINGERPRINT_SALT = 'ab';
      const first = fingerprint('cd');
      process.env.VAULT_FINGERPRINT_SALT = 'a';
      const second = fingerprint('b cd');
      expect(first).not.toBe(second);
    } finally {
      process.env.VAULT_FINGERPRINT_SALT = previous;
    }
  });
});
