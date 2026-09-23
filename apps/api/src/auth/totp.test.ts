import { generateSync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import { describe, expect, it } from 'vitest';

import { createEnrollment, verifyTotp } from './totp.js';

const crypto = new NobleCryptoPlugin();
const base32 = new ScureBase32Plugin();

/**
 * A code accepted once must be refused for the rest of its window; that is
 * the whole of the replay protection, and it hangs on the step round-tripping.
 */
describe('verifyTotp', () => {
  it('accepts a fresh code and returns its time step', async () => {
    const { secret } = await createEnrollment('staff@example.com', 'Test');
    const token = generateSync({ secret, crypto, base32 });
    expect(verifyTotp(token, secret)).toEqual(expect.any(Number));
  });

  it('refuses the same code once its step has been spent', async () => {
    const { secret } = await createEnrollment('staff@example.com', 'Test');
    const token = generateSync({ secret, crypto, base32 });
    const step = verifyTotp(token, secret);
    expect(step).not.toBeNull();
    expect(verifyTotp(token, secret, step)).toBeNull();
  });

  it('refuses a wrong code', async () => {
    const { secret } = await createEnrollment('staff@example.com', 'Test');
    expect(verifyTotp('000000', secret) === null || verifyTotp('111111', secret) === null).toBe(
      true,
    );
  });
});
