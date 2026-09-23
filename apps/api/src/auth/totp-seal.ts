import crypto from 'node:crypto';

import type { KekService } from '../vault/kek.js';

/**
 * TOTP secrets at rest, sealed the way the vault seals a licence.
 *
 * A staff member's TOTP secret is the second factor for every step-up action —
 * revealing a licence among them — so it deserves the vault's protection, not
 * a weaker one. It used to be AES-GCM under `KEK_LOCAL_BASE64` directly, which
 * put the key in an environment variable on the same host as the rows: exactly
 * what production forbids for the vault. Now each secret gets its own data key,
 * and the data key is wrapped by whatever KEK provider is configured (AWS KMS
 * in production).
 *
 * The column is a single `Bytes`, so everything travels in one blob:
 *
 *   "TOTP" | format=1 | kekVersion u32 | dekLen u16 | wrappedDek | iv(12) | tag(16) | ciphertext
 *
 * The magic and format byte are what tell a sealed row from a legacy one
 * (`iv | tag | ciphertext`, no header). A legacy iv is random, so it starts
 * with the same five bytes once in 2^40 rows — and even then the length check
 * below has to agree, and a failed open still falls back to the legacy reader.
 */
const MAGIC = Buffer.from('TOTP', 'ascii');
const FORMAT = 1;
const HEADER = MAGIC.length + 1 + 4 + 2;
const IV = 12;
const TAG = 16;

export interface OpenedTotpSecret {
  secret: string;
  /**
   * True when the row should be rewritten: it is in the legacy format, or it
   * was wrapped by an older KEK generation. The caller re-seals after a code
   * has been verified, so migration happens one successful login at a time and
   * never needs a batch job with every secret in memory.
   */
  stale: boolean;
}

export async function sealTotpSecret(
  secret: string,
  kek: KekService,
): Promise<Uint8Array<ArrayBuffer>> {
  const dek = crypto.randomBytes(32);
  try {
    const iv = crypto.randomBytes(IV);
    const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const { wrapped, version } = await kek.wrap(dek);

    const header = Buffer.alloc(HEADER);
    MAGIC.copy(header, 0);
    header.writeUInt8(FORMAT, MAGIC.length);
    header.writeUInt32BE(version, MAGIC.length + 1);
    header.writeUInt16BE(wrapped.length, MAGIC.length + 5);

    return Uint8Array.from(Buffer.concat([header, wrapped, iv, cipher.getAuthTag(), ciphertext]));
  } finally {
    dek.fill(0);
  }
}

interface Envelope {
  kekVersion: number;
  wrappedDek: Buffer;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

/** Parses the header, or returns null for anything that is not a sealed row. */
export function parseEnvelope(payload: Uint8Array): Envelope | null {
  const buf = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  if (buf.length < HEADER) return null;
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  if (buf.readUInt8(MAGIC.length) !== FORMAT) return null;

  const kekVersion = buf.readUInt32BE(MAGIC.length + 1);
  const dekLength = buf.readUInt16BE(MAGIC.length + 5);
  const ivAt = HEADER + dekLength;
  // At least one byte of ciphertext: an empty secret was never written.
  if (dekLength === 0 || buf.length <= ivAt + IV + TAG) return null;

  return {
    kekVersion,
    wrappedDek: buf.subarray(HEADER, ivAt),
    iv: buf.subarray(ivAt, ivAt + IV),
    tag: buf.subarray(ivAt + IV, ivAt + IV + TAG),
    ciphertext: buf.subarray(ivAt + IV + TAG),
  };
}

export async function openTotpSecret(
  payload: Uint8Array,
  kek: KekService,
): Promise<OpenedTotpSecret> {
  const envelope = parseEnvelope(payload);
  if (!envelope) return { secret: openLegacy(payload), stale: true };

  try {
    const dek = await kek.unwrap(envelope.wrappedDek, envelope.kekVersion);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', dek, envelope.iv);
      decipher.setAuthTag(envelope.tag);
      const secret = Buffer.concat([
        decipher.update(envelope.ciphertext),
        decipher.final(),
      ]).toString('utf8');
      return { secret, stale: envelope.kekVersion !== kek.version };
    } finally {
      dek.fill(0);
    }
  } catch (error) {
    // The 2^-40 case: a legacy row whose random iv happens to look like a
    // header. If the legacy reader cannot open it either, the original error
    // is the one worth reporting — most likely KMS being unreachable.
    try {
      return { secret: openLegacy(payload), stale: true };
    } catch {
      throw error;
    }
  }
}

/**
 * Reads a row written before envelopes: AES-256-GCM directly under
 * `KEK_LOCAL_BASE64`, laid out `iv | tag | ciphertext`.
 *
 * Only reading remains. Keep `KEK_LOCAL_BASE64` set until every enrolled staff
 * member has signed in once after this change; after that no row needs it.
 */
function openLegacy(payload: Uint8Array): string {
  const base64 = process.env.KEK_LOCAL_BASE64;
  if (!base64) {
    throw new Error(
      'This TOTP secret predates envelope encryption and KEK_LOCAL_BASE64 is not set to read it.',
    );
  }
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('KEK_LOCAL_BASE64 must decode to exactly 32 bytes.');

  const buf = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, IV));
  decipher.setAuthTag(buf.subarray(IV, IV + TAG));
  return Buffer.concat([decipher.update(buf.subarray(IV + TAG)), decipher.final()]).toString(
    'utf8',
  );
}
