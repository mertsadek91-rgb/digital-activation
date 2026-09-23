import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Object storage for catalog images.
 *
 * The same bucket and the same quirks as the one-off migration in
 * `packages/db/scripts/media` — the two were written months apart against the
 * same R2 account, and the three settings at the bottom of the client are the
 * expensive half of that script's history rather than boilerplate. They are
 * repeated here rather than shared because that script is a dev-time tool with
 * dev-time dependencies, and this is the live path a person uses.
 */
export interface Storage {
  client: S3Client;
  bucket: string;
  publicBaseUrl: string;
}

/** Thrown when the bucket is not configured, with what to do about it. */
export class StorageNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `رفع الصور غير مهيّأ: ${missing.join('، ')} غير مضبوط في .env — ` +
        `من لوحة Cloudflare: R2 ← Manage API tokens ← Create API token، ` +
        `صلاحية Object Read & Write على هذا المخزن وحده.`,
    );
    this.name = 'StorageNotConfiguredError';
  }
}

export function storage(): Storage {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL;

  const missing = (
    [
      ['S3_ENDPOINT', endpoint],
      ['S3_BUCKET', bucket],
      ['S3_ACCESS_KEY_ID', accessKeyId],
      ['S3_SECRET_ACCESS_KEY', secretAccessKey],
      ['S3_PUBLIC_BASE_URL', publicBaseUrl],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (
    missing.length > 0 ||
    !endpoint ||
    !bucket ||
    !accessKeyId ||
    !secretAccessKey ||
    !publicBaseUrl
  ) {
    throw new StorageNotConfiguredError(missing);
  }

  return {
    bucket,
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ''),
    client: new S3Client({
      endpoint,
      region: process.env.S3_REGION ?? 'auto',
      credentials: { accessKeyId, secretAccessKey },
      // R2 does not support the virtual-host style for arbitrary bucket names.
      forcePathStyle: true,
      // From v3.729 the SDK adds a CRC32 trailer to every upload and switches
      // to aws-chunked encoding for it, which R2 rejects. WHEN_REQUIRED turns
      // that off without affecting a checksum passed explicitly.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }),
  };
}

/**
 * Puts the bytes, then reads the object back before anything is recorded.
 *
 * The key is the SHA-256 of these exact bytes, so a matching length at that
 * key is the whole integrity story — and an upload nobody checked is an upload
 * nobody knows happened. The migration script learned this the same way.
 */
export async function put(
  store: Storage,
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  await store.client.send(
    new PutObjectCommand({
      Bucket: store.bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      // Safe to cache forever: the key is the hash of the bytes, so changed
      // content is a different key and can never be stale.
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  const head = await store.client.send(new HeadObjectCommand({ Bucket: store.bucket, Key: key }));
  if (head.ContentLength !== bytes.byteLength) {
    throw new Error(
      `${key} came back as ${String(head.ContentLength ?? 0)} bytes, expected ${String(bytes.byteLength)}.`,
    );
  }
}

/** Where a stored key is served from. */
export function publicUrl(store: Storage, key: string): string {
  return `${store.publicBaseUrl}/${key}`;
}
