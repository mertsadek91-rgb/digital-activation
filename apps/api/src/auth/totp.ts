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
 */
export function verifyTotp(token: string, secret: string): boolean {
  const result = verifySync({ token, secret, crypto, base32, epochTolerance: 30 });
  return result.valid;
}
