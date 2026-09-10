import crypto from 'node:crypto';

import argon2 from 'argon2';

/**
 * Password hashing and token handling for staff accounts.
 */

/**
 * Argon2id, with parameters above the library defaults.
 *
 * These are the OWASP-recommended settings for interactive logins: 19 MiB of
 * memory and two iterations. Staff logins are rare, so the ~100ms cost is
 * invisible to a person and expensive to an attacker with a stolen table.
 */
const ARGON_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed hash in the database is a failed login, not a 500.
    return false;
  }
}

/**
 * Refresh tokens are stored as a hash, never in the clear.
 *
 * A database read therefore cannot mint a session — which matters because the
 * legacy store's own backup is sitting on a laptop with customer credentials in
 * it, and the same mistake must not be available to make twice.
 */
export function newRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(48).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Encrypts a TOTP secret at the application layer before it is stored.
 *
 * The row is useless on its own: an attacker with the database still cannot
 * generate codes. Uses the same local KEK the licence vault uses in
 * development; production supplies it from KMS.
 */
export function encryptSecret(plaintext: string, keyBase64: string): Uint8Array<ArrayBuffer> {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('KEK must decode to exactly 32 bytes');

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  // iv | authTag | ciphertext, so one column holds everything needed.
  return Uint8Array.from(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]));
}

export function decryptSecret(payload: Uint8Array, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('KEK must decode to exactly 32 bytes');

  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
