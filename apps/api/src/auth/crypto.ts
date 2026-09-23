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

let decoy: Promise<string> | undefined;

/**
 * Spends the time a password check would, for an account that does not exist.
 *
 * Skipping argon2 for an unknown email answers in microseconds where a real
 * account takes ~100ms, and that difference alone says which addresses have
 * staff accounts. The decoy is hashed once per process and verified against
 * whatever was typed; the answer is always "no".
 */
export async function verifyAgainstDecoy(plain: string): Promise<false> {
  decoy ??= hashPassword(crypto.randomBytes(32).toString('base64url'));
  await verifyPassword(await decoy, plain);
  return false;
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
