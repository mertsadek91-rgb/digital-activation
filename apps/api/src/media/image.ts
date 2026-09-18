import crypto from 'node:crypto';

import sharp from 'sharp';

/**
 * Turns whatever was uploaded into the one shape this catalog stores.
 *
 * Every image is decoded and re-encoded, and that is the security boundary as
 * much as the size one. What arrives is a file from a vendor press kit, a
 * screenshot, or whatever a browser happened to produce — and re-encoding
 * through sharp keeps the pixels and discards everything else: EXIF, colour
 * profiles, trailing bytes, an SVG with a script in it, a polyglot that is a
 * PNG to one parser and something else to another. The bytes that reach the
 * bucket were written by this process from a decoded bitmap, so nothing the
 * uploader embedded survives.
 *
 * Metadata goes deliberately rather than incidentally: nothing downstream
 * reads it, and a phone photograph carries GPS coordinates.
 */

/** The long edge, in pixels. A product card is 400px wide at 2× on a phone. */
const MAX_EDGE = 1600;
const WEBP_QUALITY = 82;

/** What the bucket and the Asset row are built from. */
export interface ProcessedImage {
  /** Content-addressed, so identical bytes are always the same object. */
  key: string;
  bytes: Buffer;
  width: number;
  height: number;
  checksum: string;
  mime: 'image/webp';
  /** Bytes before processing, for the "we shrank this" line in the panel. */
  sourceBytes: number;
}

/** Anything sharp cannot read, said in a way a person can act on. */
export class UnreadableImageError extends Error {
  constructor(cause: string) {
    super(`تعذّر قراءة هذا الملف كصورة: ${cause}`);
    this.name = 'UnreadableImageError';
  }
}

export async function processImage(source: Buffer): Promise<ProcessedImage> {
  let data: Buffer;
  let width: number;
  let height: number;

  try {
    const result = await sharp(source, { failOn: 'error' })
      // Honour EXIF orientation before stripping it, or a phone photograph
      // arrives on its side.
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY, effort: 5 })
      .toBuffer({ resolveWithObject: true });
    data = result.data;
    width = result.info.width;
    height = result.info.height;
  } catch (error) {
    throw new UnreadableImageError(error instanceof Error ? error.message : 'سبب غير معروف');
  }

  const checksum = crypto.createHash('sha256').update(data).digest('hex');

  return {
    // Sixteen hex characters of a SHA-256 is 64 bits: at catalog scale the odds
    // of a collision are not worth the longer filename.
    key: `catalog/${checksum.slice(0, 16)}.webp`,
    bytes: data,
    width,
    height,
    checksum,
    mime: 'image/webp',
    sourceBytes: source.byteLength,
  };
}

/**
 * The ceiling on what the endpoint will decode, before sharp is asked.
 *
 * Set by Fastify, not chosen here: `main.ts` caps a request body at 2 MiB, and
 * base64 costs a third more than the bytes it carries, so 1.4 MiB decoded is
 * what actually fits through the door. Stating the real number here means the
 * refusal comes from this file, which can explain it, instead of a bare 413
 * from the framework.
 *
 * It is a generous ceiling in practice: the panel resizes on a canvas before
 * sending, and a 1600px WebP off that path is two to four hundred kilobytes.
 * Reaching this limit means the browser-side resize did not happen.
 */
export const MAX_UPLOAD_BYTES = Math.floor(1.4 * 1024 * 1024);

/**
 * Reads a `data:` URL into bytes.
 *
 * The panel sends images this way rather than as multipart: the browser has
 * already resized the picture on a canvas, so what crosses the wire is a few
 * hundred kilobytes of WebP and JSON costs a third more of a small number.
 * That keeps one body parser in the API instead of two, and the server still
 * re-encodes what it is given — the client-side resize is a kindness to the
 * network, never a thing this code trusts.
 */
export function decodeDataUrl(value: string): Buffer {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value);
  if (!match?.[2]) {
    throw new UnreadableImageError('ليس عنوان بيانات صورة صالحاً (data:image/…;base64,…)');
  }

  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.byteLength === 0) throw new UnreadableImageError('الملف فارغ');
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new UnreadableImageError(
      `الحجم ${String(Math.round(bytes.byteLength / 1024))} كيلوبايت وهو أكبر من الحدّ ` +
        `(${String(Math.round(MAX_UPLOAD_BYTES / 1024))} كيلوبايت). ` +
        `المتوقّع أن يصغّرها المتصفّح قبل الإرسال — أعد المحاولة، وإن تكرّر فالصورة لم تُصغَّر.`,
    );
  }
  return bytes;
}
