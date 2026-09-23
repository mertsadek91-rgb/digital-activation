import { Injectable, NotFoundException } from '@nestjs/common';

import type {
  AdminCustomerDetail,
  AdminCustomerList,
  AdminCustomerRow,
  MarketingConsentState,
} from '@da/contracts';
import { Locale, OrderStatus, type Prisma } from '@da/db';

import { CSV_BOM, csvRow } from '../common/csv.js';
import { say } from '../common/panel-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * What counts as money a customer spent: paid, and not handed back in full.
 * A partial refund still leaves a purchase, so it stays in.
 */
const PAID: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.FULFILLING,
  OrderStatus.FULFILLED,
  OrderStatus.COMPLETED,
  OrderStatus.PARTIALLY_REFUNDED,
];

const EXPORT_BATCH = 500;

/**
 * The latest recorded choice wins.
 *
 * Both timestamps are kept rather than one flag, so the order they were
 * written in decides: opted in, then out, is out — and opted out, then back
 * in through a new signup, is in. Neither set is NONE, which is not consent.
 */
export function consentState(
  optInAt: Date | null,
  optOutAt: Date | null,
): MarketingConsentState {
  if (optInAt && (!optOutAt || optInAt > optOutAt)) return 'OPTED_IN';
  if (optOutAt) return 'OPTED_OUT';
  return 'NONE';
}

type CustomerBase = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: Date;
  marketingOptInAt: Date | null;
  marketingOptOutAt: Date | null;
};

const baseSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  createdAt: true,
  marketingOptInAt: true,
  marketingOptOutAt: true,
} satisfies Prisma.CustomerSelect;

/**
 * Customers, for the panel.
 *
 * Until now a customer was something the panel could only reach through one
 * of their orders, so "has this person bought from us before?" — the first
 * question on any support message and any held payment — meant searching the
 * orders list by email and counting by eye.
 *
 * Totals are computed from orders on every read rather than taken from the
 * customer row's aggregates, which nothing keeps current (`totalSpentUsd` is
 * never written). One grouped query per page, so it stays cheap.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: { q?: string; page: number; limit: number }): Promise<AdminCustomerList> {
    const customers = await this.prisma.client.customer.findMany({
      where: this.where(input.q),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.limit,
      take: input.limit + 1,
      select: baseSelect,
    });
    const hasMore = customers.length > input.limit;
    const page = customers.slice(0, input.limit);
    const totals = await this.totals(page.map((customer) => customer.id));

    return {
      rows: page.map((customer) => this.toRow(customer, totals.get(customer.id))),
      page: input.page,
      hasMore,
    };
  }

  async detail(id: string): Promise<AdminCustomerDetail> {
    const customer = await this.prisma.client.customer.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...baseSelect,
        phone: true,
        company: true,
        locale: true,
        emailVerifiedAt: true,
        riskLevel: true,
        referral: { select: { code: true } },
        orders: {
          orderBy: { placedAt: 'desc' },
          take: 100,
          select: { number: true, status: true, currency: true, totalUsd: true, placedAt: true },
        },
      },
    });
    if (!customer) {
      throw new NotFoundException(say('لا يوجد عميل بهذا المعرّف.', 'No customer with that id.'));
    }

    const [totals, lines] = await Promise.all([
      this.totals([customer.id]),
      // Vault ids only: the count is the question, and the keys stay in the
      // vault schema this client cannot read anyway.
      this.prisma.client.orderItem.findMany({
        where: { order: { customerId: customer.id } },
        select: { assignedKeyIds: true },
      }),
    ]);

    return {
      ...this.toRow(customer, totals.get(customer.id)),
      phone: customer.phone,
      company: customer.company,
      locale: customer.locale === Locale.EN ? 'en' : 'ar',
      emailVerifiedAt: customer.emailVerifiedAt?.toISOString() ?? null,
      riskLevel: customer.riskLevel,
      consent: {
        marketingOptInAt: customer.marketingOptInAt?.toISOString() ?? null,
        marketingOptOutAt: customer.marketingOptOutAt?.toISOString() ?? null,
      },
      referralCode: customer.referral?.code ?? null,
      licenceCount: lines.reduce((sum, line) => sum + line.assignedKeyIds.length, 0),
      orders: customer.orders.map((order) => ({
        number: order.number,
        status: order.status,
        currency: order.currency,
        totalUsd: order.totalUsd.toFixed(2),
        placedAt: order.placedAt.toISOString(),
      })),
    };
  }

  /**
   * Every customer as CSV, in batches so the list never sits in memory whole.
   *
   * All customers, not only those who agreed to marketing: this export is
   * also the customer ledger (support, accounting, a data-subject request),
   * and a list silently missing most people is wrong for all of those. The
   * consent state is a column of its own, and `consent=opted-in` narrows the
   * file to the people a campaign may write to — which is the filter a
   * mailing list must be built with.
   */
  async *exportCsv(input: { q?: string; optedInOnly: boolean }): AsyncGenerator<string> {
    yield CSV_BOM;
    yield csvRow([
      'email',
      'name',
      'created_at',
      'paid_orders',
      'total_spent_usd',
      'last_order_at',
      'marketing_consent',
      'marketing_opt_in_at',
      'marketing_opt_out_at',
    ]);

    const where: Prisma.CustomerWhereInput = {
      AND: [
        this.where(input.q),
        // Never opted in cannot be consent. Whether a later opt-out cancels
        // it compares two columns, so that half is `consentState`, per row.
        input.optedInOnly ? { marketingOptInAt: { not: null } } : {},
      ],
    };

    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.client.customer.findMany({
        where,
        orderBy: { id: 'asc' },
        take: EXPORT_BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: baseSelect,
      });
      if (batch.length === 0) return;
      const totals = await this.totals(batch.map((customer) => customer.id));
      let chunk = '';
      for (const customer of batch) {
        const row = this.toRow(customer, totals.get(customer.id));
        if (input.optedInOnly && row.marketingEmail !== 'OPTED_IN') continue;
        chunk += csvRow([
          row.email,
          row.name,
          row.createdAt,
          row.paidOrders,
          row.totalSpentUsd,
          row.lastOrderAt,
          row.marketingEmail,
          customer.marketingOptInAt,
          customer.marketingOptOutAt,
        ]);
      }
      yield chunk;
      cursor = batch[batch.length - 1]?.id;
      if (batch.length < EXPORT_BATCH) return;
    }
  }

  /**
   * Search by email or name. Each word must match somewhere, so "sara ali"
   * finds Sara Ali without matching every Sara and every Ali. Erased
   * customers are left out: a deleted account is not somebody to look up.
   */
  private where(q: string | undefined): Prisma.CustomerWhereInput {
    const words = (q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
    return {
      deletedAt: null,
      AND: words.map((word) => ({
        OR: [
          { email: { contains: word, mode: 'insensitive' as const } },
          { firstName: { contains: word, mode: 'insensitive' as const } },
          { lastName: { contains: word, mode: 'insensitive' as const } },
        ],
      })),
    };
  }

  private async totals(
    ids: string[],
  ): Promise<Map<string, { paid: number; spent: string; last: Date | null }>> {
    const result = new Map<string, { paid: number; spent: string; last: Date | null }>();
    if (ids.length === 0) return result;

    const [paid, last] = await Promise.all([
      this.prisma.client.order.groupBy({
        by: ['customerId'],
        where: { customerId: { in: ids }, status: { in: PAID } },
        _sum: { totalUsd: true },
        _count: { _all: true },
      }),
      this.prisma.client.order.groupBy({
        by: ['customerId'],
        where: { customerId: { in: ids } },
        _max: { placedAt: true },
      }),
    ]);
    for (const row of last) {
      if (!row.customerId) continue;
      result.set(row.customerId, { paid: 0, spent: '0.00', last: row._max.placedAt });
    }
    for (const row of paid) {
      if (!row.customerId) continue;
      const entry = result.get(row.customerId) ?? { paid: 0, spent: '0.00', last: null };
      entry.paid = row._count._all;
      entry.spent = row._sum.totalUsd?.toFixed(2) ?? '0.00';
      result.set(row.customerId, entry);
    }
    return result;
  }

  private toRow(
    customer: CustomerBase,
    totals: { paid: number; spent: string; last: Date | null } | undefined,
  ): AdminCustomerRow {
    const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ');
    return {
      id: customer.id,
      email: customer.email,
      name: name.length > 0 ? name : null,
      paidOrders: totals?.paid ?? 0,
      totalSpentUsd: totals?.spent ?? '0.00',
      lastOrderAt: totals?.last?.toISOString() ?? null,
      marketingEmail: consentState(customer.marketingOptInAt, customer.marketingOptOutAt),
      createdAt: customer.createdAt.toISOString(),
    };
  }
}
