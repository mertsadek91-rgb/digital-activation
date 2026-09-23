import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import {
  type ContentBlock,
  type ProductContent,
  type ProductWarning,
  READINESS_RULES,
  type SetProductContent,
  blockDocumentSchema,
  countBodyWords,
} from '@da/contracts';
import { Locale, Prisma } from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { say } from '../common/panel-locale.js';
import { sanitizeRichText } from '../common/rich-text.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { bodyText } from './readiness.js';

/**
 * The product description, the FAQ, the warnings and the download link.
 *
 * The old copy editor could edit a body only while it was a single `richText`
 * block, and refused anything richer rather than flatten it. That refusal was
 * right and it became total: once `db:bodies` wrote real descriptions, 77 of
 * the 146 translations held a heading, an opening answer, a table, the steps
 * and an FAQ — so the editor worked on exactly the products with nothing to
 * edit and refused every product that had something.
 *
 * This reads the document as blocks and writes blocks back. A block type it
 * does not know is carried through untouched, because a save that drops what
 * the form cannot draw is a silent deletion of somebody's work.
 */
@Injectable()
export class ProductContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async content(slug: string, locale: Locale): Promise<ProductContent> {
    const translation = await this.load(slug, locale);
    const blocks = toEditable(translation.body);

    return {
      locale: locale === Locale.EN ? 'en' : 'ar',
      name: translation.name,
      blocks,
      warnings: toWarnings(translation.warnings),
      downloadUrl: translation.downloadUrl ?? '',
      // Counted through the gate's own flattener, so the number beside the
      // editor is the number that decides whether the product can publish —
      // not a second opinion that disagrees at the boundary.
      bodyWords: countBodyWords(bodyText(translation.body)),
      bodyMinWords: READINESS_RULES.bodyMinWords,
    };
  }

  async setContent(
    slug: string,
    input: SetProductContent,
    actorId: string | undefined,
  ): Promise<ProductContent> {
    const locale = input.locale === 'en' ? Locale.EN : Locale.AR;
    const translation = await this.load(slug, locale);

    const data: Prisma.ProductTranslationUpdateInput = {};

    if (input.blocks) {
      const stored = toStored(input.blocks);
      // The same check the content screens make. The storefront parses the
      // body all-or-nothing, so one block the loose editor schema let through
      // — an answer too short, stored with its text stripped — rendered the
      // whole description as nothing, after a save that said it worked.
      const bad = stored.findIndex((block) => !blockDocumentSchema.safeParse([block]).success);
      if (bad >= 0) {
        const type =
          typeof (stored[bad] as { type?: unknown } | null)?.type === 'string'
            ? String((stored[bad] as { type: string }).type)
            : 'unknown';
        throw new BadRequestException(
          say(
            `الكتلة رقم ${String(bad + 1)} (${type}) غير مكتملة. أكملها أو احذفها ثم احفظ.`,
            `Block ${String(bad + 1)} (${type}) is incomplete. Finish or remove it, then save.`,
          ),
        );
      }
      data.body = stored as Prisma.InputJsonValue;
    }
    if (input.warnings) {
      // An empty list clears the column rather than storing `[]`, so "no
      // warnings" is one state in the database instead of two.
      data.warnings = input.warnings.length === 0 ? Prisma.DbNull : input.warnings;
    }
    if (input.downloadUrl !== undefined) {
      data.downloadUrl = input.downloadUrl === '' ? null : input.downloadUrl;
    }

    await this.prisma.client.productTranslation.update({
      where: { id: translation.id },
      data,
    });

    const after = await this.content(slug, locale);

    await this.audit.record({
      actorId,
      action: 'product.content_changed',
      entity: 'ProductTranslation',
      entityId: translation.id,
      // Word counts and shape, not the prose: the audit log answers "who
      // changed the description and when", and a second copy of every product
      // body in an append-only table is a table nobody can read.
      before: {
        productSlug: slug,
        locale: input.locale,
        blocks: toEditable(translation.body).map((block) => block.type),
        words: countBodyWords(bodyText(translation.body)),
        warnings: toWarnings(translation.warnings).length,
        hadDownloadUrl: Boolean(translation.downloadUrl),
      },
      after: {
        blocks: after.blocks.map((block) => block.type),
        words: after.bodyWords,
        warnings: after.warnings.length,
        hadDownloadUrl: after.downloadUrl !== '',
      },
    });

    return after;
  }

  private async load(slug: string, locale: Locale) {
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!product) throw new NotFoundException(say('لا يوجد منتج بهذا الرابط.', 'No such product.'));

    // Created on demand: an English translation may simply not exist yet, and
    // the editor is where it gets written for the first time.
    return this.prisma.client.productTranslation.upsert({
      where: { productId_locale: { productId: product.id, locale } },
      update: {},
      create: { productId: product.id, locale, name: '' },
    });
  }
}

/**
 * A stored document, as the editor can hold it.
 *
 * Every block keeps its type. The six the form draws come back shaped; anything
 * else comes back as `{ type, raw }` and goes home unchanged.
 */
function toEditable(body: unknown): ContentBlock[] {
  if (!Array.isArray(body)) return [];

  const out: ContentBlock[] = [];
  for (const entry of body) {
    if (entry === null || typeof entry !== 'object') continue;
    const block = entry as Record<string, unknown>;
    const type = typeof block.type === 'string' ? block.type : 'unknown';

    switch (type) {
      case 'richText':
        // Cleaned on the way into the editor as well as on the way out of it.
        // The admin renders this HTML live, and bodies written by the WordPress
        // import or straight into the database never passed the save-time
        // sanitiser — one `<img onerror>` there runs as a staff member, with
        // their session, inside the panel that can edit bank details.
        out.push({ type: 'richText', html: sanitizeRichText(str(block.html)) });
        break;
      case 'heading':
        out.push({
          type: 'heading',
          level: block.level === 3 ? 3 : 2,
          text: str(block.text),
        });
        break;
      case 'answerFirst':
        out.push({ type: 'answerFirst', text: str(block.text) });
        break;
      case 'steps':
        out.push({
          type: 'steps',
          ...(typeof block.title === 'string' ? { title: block.title } : {}),
          steps: asArray(block.steps).map((step) => ({ text: readString(step, 'text') })),
        });
        break;
      case 'faq':
        out.push({
          type: 'faq',
          ...(typeof block.title === 'string' ? { title: block.title } : {}),
          items: asArray(block.items).map((item) => ({
            q: readString(item, 'q'),
            a: readString(item, 'a'),
          })),
        });
        break;
      case 'specTable':
        out.push({
          type: 'specTable',
          ...(typeof block.title === 'string' ? { title: block.title } : {}),
          rows: asArray(block.rows).map((row) => ({
            label: readString(row, 'label'),
            value: readString(row, 'value'),
          })),
        });
        break;
      default:
        out.push({ type, raw: entry });
    }
  }
  return out;
}

/** Back to the stored shape. Opaque blocks are returned exactly as they came. */
function toStored(blocks: ContentBlock[]): unknown[] {
  return blocks.map((block) => {
    if ('raw' in block) return block.raw;
    if (block.type === 'richText') {
      // Sanitised on the way in as well as the way out. The import already put
      // `<style>` and `<xmp>` in these columns once; a panel that pastes from
      // a word processor will do it again.
      return { type: 'richText', html: sanitizeRichText(block.html) };
    }
    return block;
  });
}

function toWarnings(value: unknown): ProductWarning[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text : '';
    if (text.trim() === '') return [];
    return [{ text, severity: record.severity === 'critical' ? 'critical' : 'note' }];
  });
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * One key of an object that may be anything, as a string.
 *
 * `String(x)` on an `unknown` is how "[object Object]" gets written into a
 * product page: a malformed block whose `text` is itself an object would be
 * stored back as that literal. Non-strings become empty here instead, which is
 * visibly missing rather than quietly wrong.
 */
function readString(value: unknown, key: string): string {
  if (value === null || typeof value !== 'object') return '';
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'string' ? found : '';
}

/** The same rule for a key read straight off a block. */
function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
