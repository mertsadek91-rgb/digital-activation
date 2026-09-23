import {
  generateSecret,
  generateURI,
  NobleCryptoPlugin,
  ScureBase32Plugin,
  verifySync,
} from 'otplib';
import QRCode from 'qrcode';

/**
 * TOTP for staff accounts.
 *
 * Mandatory, not optional. An admin session can reveal a licence key, and a
 * licence key is the product itself — a leaked one cannot be recalled. So an
 * account without TOTP is not refused at login, it is walked through enrolment
 * before it can do anything.
 *
 * otplib 13 takes its crypto and base32 implementations as plugins rather than
 * bundling them; both are constructed once here.
 */
const crypto = new NobleCryptoPlugin();
const base32 = new ScureBase32Plugin();

export interface TotpEnrollment {
  secret: string;
  otpauthUrl: string;
  /** PNG data URI of the otpauth URL. */
  qrDataUrl: string;
}

/**
 * The QR is rendered here rather than left to the client because enrolment is
 * mandatory, and a mandatory step people get wrong is a step that gets waived.
 * Transcribing a 32-character base32 secret by hand is where that goes wrong;
 * the secret is still shown beside the code for anyone who has to type it.
 */
export async function createEnrollment(email: string, issuer: string): Promise<TotpEnrollment> {
  const secret = generateSecret({ base32 });
  // generateURI takes the already-base32 secret, so it needs no plugin.
  const otpauthUrl = generateURI({ issuer, label: email, secret });

  return {
    secret,
    otpauthUrl,
    qrDataUrl: await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 200,
    }),
  };
}

/**
 * Tolerance is expressed in SECONDS here, not in time steps — 30 is one step
 * either side, which absorbs clock drift between the server and the phone.
 * Wider than that starts trading security for convenience.
 *
 * Returns the time step the code belongs to, or null. The caller records the
 * step and passes it back as `afterTimeStep` next time, so a code accepted
 * once is refused for the rest of its window — without that, anybody who saw
 * a code could use it again for about a minute and a half.
 */
export function verifyTotp(
  token: string,
  secret: string,
  afterTimeStep?: number | null,
): number | null {
  const result = verifySync({
    token,
    secret,
    crypto,
    base32,
    epochTolerance: 30,
    ...(afterTimeStep !== null && afterTimeStep !== undefined ? { afterTimeStep } : {}),
  });
  if (!result.valid) return null;
  // The generic `verifySync` is typed for HOTP as well, which has no time
  // step; for TOTP it is there, and the clock plus the matched offset is the
  // same number if it ever is not.
  if ('timeStep' in result && typeof result.timeStep === 'number') return result.timeStep;
  const delta = 'delta' in result && typeof result.delta === 'number' ? result.delta : 0;
  return Math.floor(Date.now() / 30_000) + delta;
}
