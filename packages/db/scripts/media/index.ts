/**
 * Media import: the legacy product images into Cloudflare R2.
 *
 *   pnpm db:media                 # report only, writes nothing
 *   pnpm db:media -- --apply      # upload to R2 and write Asset rows
 *
 * The source is the local backup tarball, not the live site. digital-activation.com
 * is still serving customers, and a 404 from it would silently drop a product's
 * only image — whereas a file missing from the backup is a fact this script can
 * report. The tarball is extracted once into a gitignored cache and reused.
 *
 * What the legacy store actually has, measured rather than assumed:
 *
 *   192 attachments in the media library, of which 68 distinct files are used
 *   as a product's featured image. 73 of the 101 legacy products have one; 28
 *   have no image at all. Not one product has a WooCommerce gallery — the
 *   `_product_image_gallery` meta is empty on all 101 — so every image here is
 *   a featured image, and a product page wanting a second view needs a new
 *   photograph rather than a migration. Only 22 attachments carry alt text.
 *
 * Grouping the legacy variants does gather several images under one product,
 * but they are mostly one box shot repeated with a different corner badge, so
 * they are compared and the repeats dropped. That leaves 53 products with an
 * image and exactly one of them — Adobe Creative Cloud — with a second view
 * that is genuinely a different picture.
 *
 * The badge those repeats carry names the licence term, which the variant
 * selector already states. When per-variant images are worth curating,
 * `ProductMedia.variantId` is where they belong; nothing here sets it.
 *
 * Keys are content-addressed: `catalog/<sha256 prefix>.webp`. That makes a
 * re-run idempotent, collapses images shared between two different products
 * into one object, and sidesteps a legacy filename containing an en dash.
 */
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config as loadEnv } from 'dotenv';
import { XMLParser } from 'fast-xml-parser';
import sharp from 'sharp';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
loadEnv({ path: path.join(ROOT, '.env'), quiet: true });

import { Locale, prisma } from '../../src/index.js';
import { groupSlug } from '../import/naming.js';

const run = promisify(execFile);

const LEGACY = path.join(ROOT, 'Old Website');
const XML_PATH = path.join(
  LEGACY,
  'Backup XML Products + Pages + Full Website From Wordpress',
  'WordPress.2026-09-09.xml',
);
const BACKUP_DIR = path.join(LEGACY, 'Full Backup');
const CACHE_DIR = path.join(ROOT, '.cache', 'uploads');
const OUT_DIR = path.join(ROOT, '.cache', 'media-out');

/**
 * Long edge cap.
 *
 * The product hero renders at roughly 800 CSS pixels, so 1600 covers a 2×
 * screen and anything beyond it is bytes nobody sees. As it happens no legacy
 * image reaches it — they top out at 1254px square — so this is a guard for
 * whatever gets uploaded next, not the reason the files get smaller. That is
 * the WebP re-encode, which takes 27.8 MB down to 2.6 MB on its own.
 *
 * `withoutEnlargement` matters more than the cap here: several of these are
 * only 1000px, and upscaling them would add weight and no detail.
 */
const MAX_EDGE = 1600;
const WEBP_QUALITY = 82;

// --- parsing ----------------------------------------------------------------

interface Attachment {
  id: string;
  /** Path relative to wp-content/uploads, e.g. "2024/07/Office-2016.jpg". */
  file: string;
  alt: string;
  title: string;
}

interface LegacyProduct {
  id: string;
  title: string;
  slug: string;
  status: string;
  thumbnailId: string;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Narrowing, not coercion: String() on a node yields "[object Object]". */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value !== null && typeof value === 'object' && '__cdata' in value) {
    const inner: unknown = (value as Record<string, unknown>).__cdata;
    if (typeof inner === 'string') return inner;
    if (typeof inner === 'number') return String(inner);
  }
  return '';
}

function parseXml(): { attachments: Map<string, Attachment>; products: LegacyProduct[] } {
  if (!fs.existsSync(XML_PATH)) {
    throw new Error(`WordPress export not found at ${XML_PATH}`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    cdataPropName: '__cdata',
    trimValues: false,
    parseTagValue: false,
    parseAttributeValue: false,
  });

  const doc = parser.parse(fs.readFileSync(XML_PATH, 'utf8')) as Record<string, unknown>;
  const channel = (doc.rss as Record<string, unknown>).channel as Record<string, unknown>;
  const items = asArray(channel.item as Record<string, unknown>[]);

  const attachments = new Map<string, Attachment>();
  const products: LegacyProduct[] = [];

  for (const item of items) {
    const type = text(item['wp:post_type']);
    if (type !== 'attachment' && type !== 'product') continue;

    const meta: Record<string, string> = {};
    for (const entry of asArray(item['wp:postmeta'] as Record<string, unknown>[])) {
      meta[text(entry['wp:meta_key'])] = text(entry['wp:meta_value']);
    }

    const id = text(item['wp:post_id']);

    if (type === 'attachment') {
      attachments.set(id, {
        id,
        file: (meta._wp_attached_file ?? '').trim(),
        alt: (meta._wp_attachment_image_alt ?? '').trim(),
        title: text(item.title).trim(),
      });
    } else {
      products.push({
        id,
        title: text(item.title),
        slug: text(item['wp:post_name']),
        status: text(item['wp:status']),
        thumbnailId: (meta._thumbnail_id ?? '').trim(),
      });
    }
  }

  return { attachments, products };
}

// --- the uploads cache ------------------------------------------------------

/**
 * Extracts wp-content/uploads out of the backup, once.
 *
 * Three things here are deliberate, each of them a way tar goes wrong:
 *
 *  - The archive is named by its bare filename with `cwd` set to its directory.
 *    GNU tar reads an argument whose colon precedes any slash as `host:path`
 *    and tries to open an rsh connection, so an absolute Windows path fails
 *    with "Cannot connect to D:".
 *  - The member path is read out of the archive rather than guessed, and the
 *    strip depth counted from it. `--wildcards` is GNU-only; bsdtar, which is
 *    what a stock Windows has, does not accept it.
 *  - The whole directory is extracted rather than 68 named members, which keeps
 *    the legacy filenames out of argv. One of them contains an en dash, and a
 *    layer that mangles it would leave that product looking imageless for no
 *    visible reason.
 */
async function ensureUploads(explicit: string | undefined): Promise<string> {
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`--uploads path does not exist: ${explicit}`);
    return explicit;
  }

  if (fs.existsSync(CACHE_DIR) && fs.readdirSync(CACHE_DIR).length > 0) {
    return CACHE_DIR;
  }

  const archives = fs.existsSync(BACKUP_DIR)
    ? fs.readdirSync(BACKUP_DIR).filter((name) => name.endsWith('.tar.gz'))
    : [];
  const archive = archives[0];
  if (!archive) {
    throw new Error(
      `No .tar.gz found in ${BACKUP_DIR}.\n` +
        `Either restore the backup there, or pass --uploads <dir> pointing at an\n` +
        `already-extracted wp-content/uploads directory.`,
    );
  }

  const tar = async (args: string[]): Promise<string> => {
    try {
      const { stdout } = await run('tar', args, {
        cwd: BACKUP_DIR,
        maxBuffer: 64 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      throw new Error(
        `tar failed: tar ${args.join(' ')}\n` +
          `It ships with Windows 10+, macOS and Linux; if it is missing or refuses\n` +
          `this archive, extract wp-content/uploads by hand and pass --uploads <dir>.\n` +
          `${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  };

  console.log(`reading ${archive} to locate wp-content/uploads`);
  const listing = await tar(['-tzf', archive]);

  const marker = 'wp-content/uploads/';
  const sample = listing.split('\n').find((line) => line.includes(marker));
  if (!sample) {
    throw new Error(`${archive} contains no wp-content/uploads directory.`);
  }

  // "./domains/<host>/public_html/wp-content/uploads/" — everything up to and
  // including the marker is the prefix, and its segment count is the strip
  // depth that leaves "<year>/<month>/<file>".
  //
  // The leading "." counts. tar treats it as a component like any other, so
  // dropping it from the tally strips one level too few and every file lands
  // one directory deeper than the paths the export refers to — which reads as
  // all 68 images missing rather than as a path being wrong.
  const member = sample.slice(0, sample.indexOf(marker) + marker.length);
  const strip = member.split('/').filter((segment) => segment !== '').length;

  console.log(`extracting ${member} (${String(strip)} leading components stripped)`);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  await tar([
    '-xzf',
    archive,
    '-C',
    CACHE_DIR,
    `--strip-components=${String(strip)}`,
    member.replace(/\/$/, ''),
  ]);

  return CACHE_DIR;
}

// --- planning ---------------------------------------------------------------

interface PlannedImage {
  attachmentId: string;
  sourceFile: string;
  /** Legacy alt text, empty when the media library had none. */
  legacyAlt: string;
}

interface PlannedProduct {
  slug: string;
  nameAr: string;
  /** Every legacy row's status, so an orphan can say why it is one. */
  statuses: string[];
  images: PlannedImage[];
}

const problems: { kind: string; detail: string }[] = [];
function problem(kind: string, detail: string): void {
  problems.push({ kind, detail });
}

function plan(
  attachments: Map<string, Attachment>,
  legacyProducts: LegacyProduct[],
): PlannedProduct[] {
  // Group the legacy rows exactly as the product import did, so an image lands
  // on the product that row became rather than on a slug that does not exist.
  const groups = new Map<string, LegacyProduct[]>();
  for (const legacy of legacyProducts) {
    const slug = groupSlug(legacy.id, legacy.title);
    if (!slug) {
      problem('no slug', `${legacy.id} "${legacy.title.slice(0, 48)}"`);
      continue;
    }
    groups.set(slug, [...(groups.get(slug) ?? []), legacy]);
  }

  const planned: PlannedProduct[] = [];

  for (const [slug, members] of groups) {
    const images: PlannedImage[] = [];
    const seen = new Set<string>();

    for (const legacy of members) {
      if (!legacy.thumbnailId) continue;

      const attachment = attachments.get(legacy.thumbnailId);
      if (!attachment) {
        problem(
          'dangling thumbnail',
          `${slug} — legacy ${legacy.id} points at attachment ${legacy.thumbnailId}, which is not in the export`,
        );
        continue;
      }
      if (!attachment.file) {
        problem('no file', `${slug} — attachment ${attachment.id} has no _wp_attached_file`);
        continue;
      }
      // Variants of one product routinely share a box shot; one copy is enough.
      if (seen.has(attachment.file)) continue;
      seen.add(attachment.file);

      images.push({
        attachmentId: attachment.id,
        sourceFile: attachment.file,
        legacyAlt: attachment.alt,
      });
    }

    planned.push({
      slug,
      nameAr: members[0]?.title.trim() ?? slug,
      statuses: members.map((member) => member.status),
      images,
    });
  }

  return planned;
}

// --- processing -------------------------------------------------------------

interface Processed {
  key: string;
  bytes: Buffer;
  width: number;
  height: number;
  checksum: string;
  sourceBytes: number;
  /** 256-bit average hash, for spotting the same box shot twice. */
  fingerprint: number[];
}

/**
 * Near-duplicate threshold, in differing bits out of 256.
 *
 * Measured rather than picked. Grouping the legacy variants brings several
 * copies of one product's box shot together — Autodesk All Apps carried five,
 * ESET Internet Security seven — and every one of those pairs came out at a
 * distance of 0 to 5. The single pair that is genuinely two different pictures,
 * on Adobe Creative Cloud, came out at 70. Anything between 5 and 70 would
 * separate this data, so 12 sits in the gap with room on both sides.
 */
const NEAR_DUPLICATE_BITS = 12;

/**
 * Average hash: 16×16 greyscale, each pixel a bit for above or below the mean.
 * Crude, and exactly strong enough for "is this the same picture again".
 */
async function fingerprint(source: Buffer): Promise<number[]> {
  // toBuffer() without resolveWithObject returns the raw bytes themselves,
  // not { data, info } — one greyscale byte per pixel, so 256 of them.
  const pixels = await sharp(source).greyscale().resize(16, 16, { fit: 'fill' }).raw().toBuffer();
  const mean = pixels.reduce((total, value) => total + value, 0) / pixels.length;
  return Array.from(pixels, (value) => (value > mean ? 1 : 0));
}

function distance(a: number[], b: number[]): number {
  return a.reduce((total, value, index) => total + (value === b[index] ? 0 : 1), 0);
}

/**
 * Resize, re-encode as WebP, drop metadata.
 *
 * Metadata goes because sharp only keeps it on request, and that is the right
 * default here: these files came from vendor press kits and screenshots, and
 * nothing downstream reads their EXIF.
 */
async function processImage(absolute: string): Promise<Processed> {
  const source = await fs.promises.readFile(absolute);

  const pipeline = sharp(source, { failOn: 'error' })
    .rotate() // honour EXIF orientation before stripping it
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY, effort: 5 });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  const checksum = crypto.createHash('sha256').update(data).digest('hex');

  return {
    key: `catalog/${checksum.slice(0, 16)}.webp`,
    bytes: data,
    width: info.width,
    height: info.height,
    checksum,
    sourceBytes: source.byteLength,
    fingerprint: await fingerprint(data),
  };
}

// --- storage ----------------------------------------------------------------

function storage(): { client: S3Client; bucket: string } {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  const missing = [
    ['S3_ENDPOINT', endpoint],
    ['S3_BUCKET', bucket],
    ['S3_ACCESS_KEY_ID', accessKeyId],
    ['S3_SECRET_ACCESS_KEY', secretAccessKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name as string);

  if (missing.length > 0 || !endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      `Cannot upload: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set in .env.\n\n` +
        `In the Cloudflare dashboard, R2 → Manage API tokens → Create API token:\n` +
        `  • Permission: Object Read & Write\n` +
        `  • Scope: the ${bucket ?? 'media'} bucket only\n` +
        `That gives an Access Key ID and a Secret Access Key.\n` +
        `Also set S3_PUBLIC_BASE_URL to the custom domain bound to the bucket —\n` +
        `the r2.dev URL is rate limited and unsuitable for serving a storefront.`,
    );
  }

  return {
    bucket,
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

// --- main -------------------------------------------------------------------

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const uploadsArgIndex = process.argv.indexOf('--uploads');
  const uploadsArg = uploadsArgIndex === -1 ? undefined : process.argv[uploadsArgIndex + 1];

  const { attachments, products: legacyProducts } = parseXml();
  console.log(
    `parsed ${String(attachments.size)} attachments and ${String(legacyProducts.length)} products from the export`,
  );

  const planned = plan(attachments, legacyProducts);
  const withImages = planned.filter((entry) => entry.images.length > 0);
  const distinctFiles = new Set(planned.flatMap((p) => p.images.map((i) => i.sourceFile)));

  console.log(
    `grouped into ${String(planned.length)} products — ${String(withImages.length)} with an image, ` +
      `${String(planned.length - withImages.length)} without`,
  );
  console.log(`${String(distinctFiles.size)} distinct source files`);

  // Check the slugs against the catalog now rather than at write time. The
  // product import drops a legacy row whose variant cannot be normalised, so a
  // group can exist here and have no product — and an image with nowhere to go
  // should be a line in the report, not a surprise two minutes into an upload.
  const existingSlugs = new Set(
    (await prisma.product.findMany({ select: { slug: true } })).map((row) => row.slug),
  );
  for (const entry of planned) {
    if (existingSlugs.has(entry.slug)) continue;
    const allDrafts = entry.statuses.every((status) => status === 'draft');
    problem(
      'orphaned image',
      `${entry.slug} (${String(entry.images.length)} image) — no product row. ` +
        (allDrafts
          ? 'Every legacy row in this group is an unfinished draft with no price, so the ' +
            'product import refused it. Nothing to fix; the image has nowhere to go.'
          : 'Run pnpm db:import, or check why the import skipped it.'),
    );
  }

  const uploadsDir = await ensureUploads(uploadsArg);

  // Resolve every planned file on disk before touching the network or the
  // database, so a missing file is a report rather than a half-finished import.
  const resolved = new Map<string, string>();
  for (const file of distinctFiles) {
    const absolute = path.join(uploadsDir, file);
    if (fs.existsSync(absolute)) resolved.set(file, absolute);
    else problem('missing file', `${file} is referenced by the export but not in the backup`);
  }
  console.log(`${String(resolved.size)} of ${String(distinctFiles.size)} files found on disk`);

  // --- transform ---
  const processedByFile = new Map<string, Processed>();
  let sourceTotal = 0;
  let outputTotal = 0;

  for (const [file, absolute] of resolved) {
    try {
      const result = await processImage(absolute);
      processedByFile.set(file, result);
      sourceTotal += result.sourceBytes;
      outputTotal += result.bytes.byteLength;
    } catch (error) {
      problem('unreadable', `${file} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  console.log(
    `processed ${String(processedByFile.size)} images — ` +
      `${mb(sourceTotal)} in, ${mb(outputTotal)} out ` +
      `(${String(Math.round((1 - outputTotal / Math.max(sourceTotal, 1)) * 100))}% smaller). ` +
      `Nothing needed resizing: the legacy originals top out at 1254px, under the ` +
      `${String(MAX_EDGE)}px cap, so the saving is the WebP re-encode alone.`,
  );

  // Drop the same picture twice.
  //
  // Grouping the legacy variants gathers a product's box shots together, and
  // they are usually one image repeated — the seven ESET rows carried the same
  // file, Autodesk five. A gallery of five identical boxes is worse than one
  // box, so a planned image is kept only if it actually looks different from
  // everything already kept for that product.
  let collapsed = 0;
  for (const entry of withImages) {
    const kept: PlannedImage[] = [];
    const keptPrints: number[][] = [];

    for (const image of entry.images) {
      const result = processedByFile.get(image.sourceFile);
      if (!result) continue;

      const duplicate = keptPrints.some(
        (print) => distance(print, result.fingerprint) <= NEAR_DUPLICATE_BITS,
      );
      if (duplicate) {
        collapsed += 1;
        continue;
      }

      kept.push(image);
      keptPrints.push(result.fingerprint);
    }

    entry.images = kept;
  }

  const objects = new Map<string, Processed>();
  for (const entry of withImages) {
    for (const image of entry.images) {
      const result = processedByFile.get(image.sourceFile);
      if (result) objects.set(result.key, result);
    }
  }

  const links = withImages.reduce((total, entry) => total + entry.images.length, 0);
  console.log(
    `after dropping ${String(collapsed)} repeat(s) of the same picture: ` +
      `${String(objects.size)} objects, ${String(links)} product images`,
  );

  // Alt text: carried over where the media library had it, otherwise the
  // product name. The product name is true of a product hero — it says which
  // product this is, which is what the attribute is for — and nothing here
  // invents a description of an image it has not looked at.
  let altCarried = 0;
  let altDerived = 0;
  for (const entry of withImages) {
    for (const image of entry.images) {
      if (image.legacyAlt) altCarried += 1;
      else altDerived += 1;
    }
  }
  console.log(
    `alt text: ${String(altCarried)} carried from the export, ${String(altDerived)} set to the product name`,
  );

  if (problems.length > 0) {
    console.log(`\n${String(problems.length)} problem(s):`);
    const byKind = new Map<string, string[]>();
    for (const { kind, detail } of problems) {
      byKind.set(kind, [...(byKind.get(kind) ?? []), detail]);
    }
    for (const [kind, details] of byKind) {
      console.log(`  ${kind} (${String(details.length)})`);
      for (const detail of details.slice(0, 8)) console.log(`    ${detail}`);
      if (details.length > 8) console.log(`    … ${String(details.length - 8)} more`);
    }
  }

  if (!apply) {
    // Write the processed files out so they can be looked at before anything
    // is uploaded. A transform nobody has seen the output of is a guess.
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(path.join(OUT_DIR, 'catalog'), { recursive: true });
    for (const [key, result] of objects) {
      fs.writeFileSync(path.join(OUT_DIR, key), result.bytes);
    }

    const manifest = withImages.map((entry) => ({
      slug: entry.slug,
      images: entry.images.map((image, index) => {
        const result = processedByFile.get(image.sourceFile);
        return {
          source: image.sourceFile,
          key: result?.key ?? null,
          size: result ? `${String(result.width)}×${String(result.height)}` : null,
          bytes: result?.bytes.byteLength ?? null,
          isHero: index === 0,
          alt: image.legacyAlt || entry.nameAr,
          altFrom: image.legacyAlt ? 'export' : 'product name',
        };
      }),
    }));
    fs.writeFileSync(
      path.join(OUT_DIR, 'manifest.json'),
      `${JSON.stringify({ withoutImages: planned.filter((p) => p.images.length === 0).map((p) => p.slug), products: manifest }, null, 2)}\n`,
    );

    console.log(`\nDry run. Nothing uploaded, nothing written to the database.`);
    console.log(`Processed images and manifest.json are in ${OUT_DIR}`);
    console.log(`Re-run with --apply to upload and record them.`);
    return;
  }

  // --- upload ---
  const { client, bucket } = storage();
  let uploaded = 0;

  for (const [key, result] of objects) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: result.bytes,
        ContentType: 'image/webp',
        // Safe to cache forever: the key is the hash of the bytes, so changed
        // content is a different key and can never be stale.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    // Read it back rather than trusting a 200. The key is the SHA-256 of these
    // exact bytes, so a matching length at that key is the whole integrity
    // story — and an upload nobody checked is an upload nobody knows happened.
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (head.ContentLength !== result.bytes.byteLength) {
      throw new Error(
        `${key} came back as ${String(head.ContentLength ?? 0)} bytes, expected ${String(result.bytes.byteLength)}. ` +
          `Stopping before anything is recorded against it.`,
      );
    }

    uploaded += 1;
    if (uploaded % 10 === 0) console.log(`  uploaded ${String(uploaded)}/${String(objects.size)}`);
  }
  console.log(`uploaded and verified ${String(uploaded)} objects in ${bucket}`);

  // --- record ---
  const assetIdByKey = new Map<string, string>();
  for (const [key, result] of objects) {
    const asset = await prisma.asset.upsert({
      where: { key },
      update: {
        mime: 'image/webp',
        bytes: result.bytes.byteLength,
        width: result.width,
        height: result.height,
        checksum: result.checksum,
      },
      create: {
        key,
        mime: 'image/webp',
        bytes: result.bytes.byteLength,
        width: result.width,
        height: result.height,
        checksum: result.checksum,
      },
    });
    assetIdByKey.set(key, asset.id);
  }

  let linked = 0;
  let skipped = 0;

  for (const entry of withImages) {
    const product = await prisma.product.findUnique({
      where: { slug: entry.slug },
      select: { id: true, translations: { select: { locale: true, name: true } } },
    });
    if (!product) {
      problem('no product', `${entry.slug} has images but no row — run pnpm db:import first`);
      skipped += entry.images.length;
      continue;
    }

    const nameAr = product.translations.find((t) => t.locale === Locale.AR)?.name ?? entry.nameAr;
    const nameEn = product.translations.find((t) => t.locale === Locale.EN)?.name ?? nameAr;

    for (const [index, image] of entry.images.entries()) {
      const result = processedByFile.get(image.sourceFile);
      const assetId = result ? assetIdByKey.get(result.key) : undefined;
      if (!assetId) {
        skipped += 1;
        continue;
      }

      for (const [locale, fallback] of [
        [Locale.AR, nameAr],
        [Locale.EN, nameEn],
      ] as const) {
        const alt = image.legacyAlt || fallback;
        await prisma.assetAlt.upsert({
          where: { assetId_locale: { assetId, locale } },
          update: { alt },
          create: { assetId, locale, alt },
        });
      }

      // Not an upsert. The generated compound-unique input types variantId as
      // a plain string, because a nullable column in a unique index is not
      // addressable through it — the same reason the real guard for a
      // product-level image is a partial index rather than that constraint.
      const existing = await prisma.productMedia.findFirst({
        where: { productId: product.id, assetId, variantId: null },
        select: { id: true },
      });

      if (existing) {
        await prisma.productMedia.update({
          where: { id: existing.id },
          data: { position: index, isHero: index === 0 },
        });
      } else {
        await prisma.productMedia.create({
          data: { productId: product.id, assetId, position: index, isHero: index === 0 },
        });
      }
      linked += 1;
    }
  }

  console.log(
    `linked ${String(linked)} images to products${skipped > 0 ? `, skipped ${String(skipped)}` : ''}`,
  );

  const stillWithout = await prisma.product.count({ where: { media: { none: {} } } });
  console.log(`${String(stillWithout)} products still have no image`);
}

void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
