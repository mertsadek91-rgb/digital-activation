import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { canonical, fieldCount, parse, parseBlock } from './credential.js';

/**
 * Guards the sealed-payload format.
 *
 * Everything here is about one class of failure: a credential that comes out of
 * the vault different from the way it went in. That failure is not visible from
 * the code — the blob decrypts, the email sends, and the customer is the one who
 * discovers that the password is missing its last six characters. Every case
 * below is a way the payload could be silently cut in the wrong place.
 */
describe('canonical', () => {
  it('keeps a password that contains colons and spaces intact through the round trip', () => {
    const sealed = canonical({
      kind: 'ACCOUNT_CREDENTIALS',
      username: 'user@example.com',
      password: 'pa:ss word',
    });

    expect(parse('ACCOUNT_CREDENTIALS', sealed)).toEqual({
      kind: 'ACCOUNT_CREDENTIALS',
      key: null,
      username: 'user@example.com',
      password: 'pa:ss word',
    });
  });

  it('round-trips an activation key unchanged', () => {
    const key = 'NKJFK-GPHP7-G8C3J-P6JXR-HQRJR';
    expect(parse('ACTIVATION_KEY', canonical({ kind: 'ACTIVATION_KEY', key }))).toEqual({
      kind: 'ACTIVATION_KEY',
      key,
      username: null,
      password: null,
    });
  });

  it('trims the surrounding whitespace a paste from a supplier email carries', () => {
    expect(canonical({ kind: 'ACTIVATION_KEY', key: '  ABCD-1234  ' })).toBe('ABCD-1234');
    expect(
      canonical({
        kind: 'ACCOUNT_CREDENTIALS',
        username: ' user@example.com ',
        password: ' hunter2 ',
      }),
    ).toBe('user@example.com\nhunter2');
  });

  it('refuses a newline inside a password, which would split the payload in two', () => {
    expect(() =>
      canonical({
        kind: 'ACCOUNT_CREDENTIALS',
        username: 'user@example.com',
        password: 'first\nsecond',
      }),
    ).toThrow(BadRequestException);
  });

  it('refuses a carriage return too, because a Windows paste carries them', () => {
    expect(() =>
      canonical({
        kind: 'ACCOUNT_CREDENTIALS',
        username: 'user@example.com',
        password: 'first\r\nsecond',
      }),
    ).toThrow(BadRequestException);
    expect(() => canonical({ kind: 'ACTIVATION_KEY', key: 'ABCD\r\n1234' })).toThrow(
      BadRequestException,
    );
  });

  it('refuses a newline inside a username as well as inside a password', () => {
    expect(() =>
      canonical({ kind: 'ACCOUNT_CREDENTIALS', username: 'a\nb', password: 'hunter2' }),
    ).toThrow(BadRequestException);
  });

  it('refuses an activation key too short to be one', () => {
    expect(() => canonical({ kind: 'ACTIVATION_KEY', key: 'abc' })).toThrow(BadRequestException);
  });
});

describe('parse', () => {
  it('splits on the first newline only, so a password may itself be multi-part', () => {
    // The payload is written by `canonical`, which refuses newlines — but a row
    // sealed before that check existed could still hold one, and cutting it at
    // the last newline instead of the first would hand back a truncated user.
    expect(parse('ACCOUNT_CREDENTIALS', 'user@example.com\npass:word:with:colons')).toEqual({
      kind: 'ACCOUNT_CREDENTIALS',
      key: null,
      username: 'user@example.com',
      password: 'pass:word:with:colons',
    });
  });

  it('returns a one-line account row as a key rather than an account with an empty password', () => {
    // An empty password field in a customer's inbox reads as "there is no
    // password". Showing the raw string is worse-looking and far less harmful.
    expect(parse('ACCOUNT_CREDENTIALS', 'legacy-blob-with-no-newline')).toEqual({
      kind: 'ACTIVATION_KEY',
      key: 'legacy-blob-with-no-newline',
      username: null,
      password: null,
    });
  });

  it('treats a trailing newline with nothing after it as no password at all', () => {
    expect(parse('ACCOUNT_CREDENTIALS', 'user@example.com\n').password).toBeNull();
  });

  it('never reads a username out of an activation-key row', () => {
    expect(parse('ACTIVATION_KEY', 'a\nb')).toEqual({
      kind: 'ACTIVATION_KEY',
      key: 'a\nb',
      username: null,
      password: null,
    });
  });
});

describe('fieldCount', () => {
  it('records two fields for an account and one for a key, so a reader need not decrypt', () => {
    expect(fieldCount('ACCOUNT_CREDENTIALS')).toBe(2);
    expect(fieldCount('ACTIVATION_KEY')).toBe(1);
  });
});

describe('parseBlock', () => {
  it('splits an account line on the first separator, so the password keeps its colons', () => {
    const { secrets, invalid } = parseBlock('ACCOUNT_CREDENTIALS', 'user@example.com:pa:ss word');

    expect(invalid).toBe(0);
    expect(secrets).toEqual([
      { kind: 'ACCOUNT_CREDENTIALS', username: 'user@example.com', password: 'pa:ss word' },
    ]);
  });

  it('counts a line with no separator invalid instead of storing a username with no password', () => {
    const { secrets, invalid } = parseBlock('ACCOUNT_CREDENTIALS', 'user@example.com');

    expect(secrets).toEqual([]);
    expect(invalid).toBe(1);
  });

  it('accepts the other separators suppliers use, and whitespace as a last resort', () => {
    const { secrets, invalid } = parseBlock(
      'ACCOUNT_CREDENTIALS',
      [
        'a@example.com|pass1234',
        'b@example.com,pass1234',
        'c@example.com\tpass1234',
        'd@example.com pass1234',
      ].join('\n'),
    );

    expect(invalid).toBe(0);
    expect(
      secrets.map((secret) => (secret.kind === 'ACCOUNT_CREDENTIALS' ? secret.password : null)),
    ).toEqual(['pass1234', 'pass1234', 'pass1234', 'pass1234']);
  });

  it('skips blank lines rather than counting them against the import', () => {
    const { secrets, invalid } = parseBlock(
      'ACTIVATION_KEY',
      '\n  \nNKJFK-GPHP7\n\r\nP6JXR-HQRJR\n',
    );

    expect(invalid).toBe(0);
    expect(secrets).toHaveLength(2);
  });

  it('counts a too-short key invalid, so the import does not report a success it did not have', () => {
    const { secrets, invalid } = parseBlock('ACTIVATION_KEY', 'abc\nNKJFK-GPHP7-G8C3J');

    expect(invalid).toBe(1);
    expect(secrets).toEqual([{ kind: 'ACTIVATION_KEY', key: 'NKJFK-GPHP7-G8C3J' }]);
  });

  it('counts an account line whose password is too short invalid rather than storing it', () => {
    const { secrets, invalid } = parseBlock('ACCOUNT_CREDENTIALS', 'user@example.com:abc');

    expect(secrets).toEqual([]);
    expect(invalid).toBe(1);
  });

  it('feeds every parsed account back through canonical and parse without loss', () => {
    const block = 'user@example.com:pa:ss word\nother@example.com|s3cr3t p@ss';
    const { secrets } = parseBlock('ACCOUNT_CREDENTIALS', block);

    const roundTripped = secrets.map((secret) => parse('ACCOUNT_CREDENTIALS', canonical(secret)));

    expect(roundTripped).toEqual([
      {
        kind: 'ACCOUNT_CREDENTIALS',
        key: null,
        username: 'user@example.com',
        password: 'pa:ss word',
      },
      {
        kind: 'ACCOUNT_CREDENTIALS',
        key: null,
        username: 'other@example.com',
        password: 's3cr3t p@ss',
      },
    ]);
  });
});
