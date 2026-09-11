import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { RedirectsView } from '@da/contracts';

import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The redirect map, for the panel.
 *
 * The screen exists so the person running the store can answer a 404 without
 * a developer, which matters most in the fortnight after a cutover: the
 * generated map covers what the export knows about, and what it cannot know
 * about is every link somebody else ever published — an old forum post, a
 * printed invoice, a partner's page. Those arrive as 404s, and each one is a
 * redirect waiting to be written.
 *
 * Generated rows and hand-written ones are kept apart by `source`. A
 * regeneration overwrites its own and never touches a manual fix, and the
 * screen labels both so nobody wonders why their edit came back.
 */
@Injectable()
export class RedirectsService {
  constructor(private readonly prisma: PrismaService) {}

  async view(limit: number): Promise<RedirectsView> {
    const redirects = await this.prisma.client.redirect.findMany({
      // Most-followed first: the rows that carry traffic are the ones worth
      // checking, and a map sorted alphabetically hides them among ninety.
      orderBy: [{ hits: 'desc' }, { from: 'asc' }],
      take: limit,
    });

    const notFound = await this.prisma.client.notFoundLog.findMany({
      where: { resolvedAt: null },
      orderBy: [{ hits: 'desc' }, { lastSeenAt: 'desc' }],
      take: limit,
    });

    return {
      redirects: redirects.map((row) => ({
        id: row.id,
        from: row.from,
        to: row.to,
        code: row.code,
        isActive: row.isActive,
        source: row.source,
        hits: row.hits,
        lastHitAt: row.lastHitAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      notFound: notFound.map((row) => ({
        id: row.id,
        path: row.path,
        hits: row.hits,
        referer: row.referer,
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
      })),
      counts: {
        redirects: await this.prisma.client.redirect.count(),
        active: await this.prisma.client.redirect.count({ where: { isActive: true } }),
        unresolved404: await this.prisma.client.notFoundLog.count({ where: { resolvedAt: null } }),
      },
    };
  }

  /**
   * Adds a redirect by hand, and marks the 404 it answers as resolved.
   *
   * Pasting a whole URL is the normal case — somebody copies it out of Search
   * Console — so a URL is reduced to its path rather than refused. A loop is
   * refused outright: a path that redirects to itself is a browser error page,
   * and it is the single easiest mistake to make on this screen.
   */
  async create(input: {
    from: string;
    to: string;
    code: number;
    staffId: string;
  }): Promise<{ id: string }> {
    const from = this.toPath(input.from);
    const to = this.toTarget(input.to);

    if (!from || !to) throw new BadRequestException('المسار غير صالح.');
    if (from === to) throw new BadRequestException('المسار يشير إلى نفسه.');

    const existing = await this.prisma.client.redirect.findUnique({ where: { from } });
    if (existing) {
      throw new BadRequestException(`هذا المسار موجّه بالفعل إلى ${existing.to}.`);
    }

    const row = await this.prisma.client.redirect.create({
      data: { from, to, code: input.code, source: 'manual', createdById: input.staffId },
    });

    // The 404 that prompted this is answered now, whether or not anybody
    // clicked "resolve" on it.
    await this.prisma.client.notFoundLog.updateMany({
      where: { path: from, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });

    return { id: row.id };
  }

  async update(input: {
    id: string;
    to?: string | undefined;
    code?: number | undefined;
    isActive?: boolean | undefined;
  }): Promise<{ id: string }> {
    const existing = await this.prisma.client.redirect.findUnique({ where: { id: input.id } });
    if (!existing) throw new NotFoundException('لا يوجد توجيه بهذا المعرّف.');

    const to = input.to ? this.toTarget(input.to) : existing.to;
    if (!to) throw new BadRequestException('الوجهة غير صالحة.');
    if (to === existing.from) throw new BadRequestException('المسار يشير إلى نفسه.');

    await this.prisma.client.redirect.update({
      where: { id: input.id },
      data: {
        to,
        ...(input.code === undefined ? {} : { code: input.code }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
    });

    return { id: input.id };
  }

  async remove(id: string): Promise<{ id: string }> {
    const existing = await this.prisma.client.redirect.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('لا يوجد توجيه بهذا المعرّف.');
    await this.prisma.client.redirect.delete({ where: { id } });
    return { id };
  }

  /** Dismisses a 404 without writing a redirect — a bot, or a dead link. */
  async resolveNotFound(id: string): Promise<{ id: string }> {
    await this.prisma.client.notFoundLog.update({
      where: { id },
      data: { resolvedAt: new Date() },
    });
    return { id };
  }

  /**
   * Where a redirect points: a path here, or a whole URL somewhere else.
   *
   * Our own host is recognised from the storefront URL rather than hard-coded,
   * so it is right on the staging host too — where somebody adding a redirect
   * would otherwise be quietly sending their own test traffic to production.
   */
  private toTarget(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed.startsWith('http')) return this.toPath(trimmed);

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }

    const ours = [process.env.STOREFRONT_URL, 'https://digital-activation.com']
      .filter((value): value is string => Boolean(value))
      .map((value) => {
        try {
          return new URL(value).host;
        } catch {
          return '';
        }
      });

    if (ours.includes(parsed.host)) {
      return this.toPath(`${parsed.pathname}${parsed.search}`);
    }
    return trimmed;
  }

  /**
   * A pasted URL or path, reduced to the shape the map is keyed by.
   *
   * A URL on this store's own host becomes a path, because that is almost
   * always what was meant: the value is copied out of Search Console, and
   * keeping it absolute would send the visitor off to the production host and
   * lose the locale prefix on the way. A URL on any other host stays whole —
   * pointing a dead page at a vendor's documentation is a real thing to want.
   */
  private toPath(value: string): string | null {
    let pathname = value.trim();
    if (pathname.startsWith('http')) {
      try {
        pathname = new URL(pathname).pathname;
      } catch {
        return null;
      }
    }
    if (!pathname.startsWith('/')) pathname = `/${pathname}`;

    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    const trimmed = pathname.replace(/\/+$/, '');
    return (trimmed === '' ? '/' : trimmed).toLowerCase();
  }
}
