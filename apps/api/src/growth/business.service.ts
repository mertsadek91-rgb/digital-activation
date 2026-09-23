import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { type BusinessQuote, type BusinessQuoteList, CONTACT_REPLY_HOURS } from '@da/contracts';
import { ContactStatus, ContactTopic, Locale } from '@da/db';

import { say } from '../common/panel-locale.js';
import { MailService } from '../mail/mail.service.js';
import { contactAck } from '../mail/templates.js';
import { MarketingSettingsService } from '../marketing/marketing-settings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { businessQuoteToStore } from './templates.js';

/**
 * Volume quotes from the product page.
 *
 * A quote request is a contact message with a shape: it lands in the same
 * inbox (topic BUSINESS) so support works one queue, and the structured
 * fields go into the body as labelled lines so they survive being read in an
 * email client, the panel, or a CSV export alike. The same three rules as the
 * contact form hold — see `ContactService`: row first, a failed send does not
 * fail the request, and a honeypot hit is answered as if it worked.
 */
@Injectable()
export class BusinessQuoteService {
  private readonly logger = new Logger(BusinessQuoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly settings: MarketingSettingsService,
  ) {}

  async submit(
    input: BusinessQuote,
    context: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<{ ok: true }> {
    const settings = await this.settings.get('business');
    // Off means the form is not on the page; a request anyway is a script.
    if (!settings.enabled) throw new NotFoundException('Not found.');

    if (input.website && input.website.trim().length > 0) {
      this.logger.log('Business quote dropped: honeypot filled.');
      return { ok: true };
    }

    // The product name is the store's, looked up from the slug, never typed.
    const product = input.productSlug
      ? await this.prisma.client.product.findUnique({
          where: { slug: input.productSlug },
          select: { slug: true, translations: { select: { locale: true, name: true } } },
        })
      : null;
    const productName = product
      ? (product.translations.find((entry) => entry.locale === Locale.AR)?.name ??
        product.translations[0]?.name ??
        product.slug)
      : null;

    const lines = [
      `Company: ${input.company}`,
      `Seats: ${String(input.seats)}`,
      ...(productName ? [`Product: ${productName} (${product?.slug ?? ''})`] : []),
      ...(input.vatNumber ? [`VAT: ${input.vatNumber}`] : []),
    ];
    const message = `${lines.join('\n')}\n\n${input.message ?? ''}`.trim();

    const customer = await this.prisma.client.customer.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    const row = await this.prisma.client.contactMessage.create({
      data: {
        topic: ContactTopic.BUSINESS,
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        message,
        locale: input.locale === 'en' ? Locale.EN : Locale.AR,
        customerId: customer?.id ?? null,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      },
    });

    const rendered = businessQuoteToStore({
      company: input.company,
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      vatNumber: input.vatNumber ?? null,
      product: productName,
      seats: input.seats,
      message: input.message ?? '',
      id: row.id,
    });
    // The support inbox always; the sales address too when one is set.
    const recipients = [...new Set([this.mail.supportEmail, settings.notifyEmail].filter(Boolean))];
    for (const to of recipients) {
      const sent = await this.mail.send({
        to,
        template: 'business.quote-received',
        locale: 'ar',
        rendered,
        payload: { messageId: row.id, seats: input.seats },
      });
      if (!sent.ok) {
        this.logger.error(`Business quote ${row.id} stored but the notice to the store failed.`);
      }
    }

    // The same acknowledgement as the contact form, and for the same reason
    // without the typed name: the address is unverified.
    await this.mail.send({
      to: input.email,
      template: 'business.quote-ack',
      locale: input.locale,
      customerId: customer?.id,
      rendered: contactAck({
        locale: input.locale,
        hours: CONTACT_REPLY_HOURS,
        supportEmail: this.mail.supportEmail,
      }),
      payload: { messageId: row.id },
    });
    return { ok: true };
  }

  /** The panel's view: the latest requests and how many wait. */
  async recent(): Promise<BusinessQuoteList> {
    const where = { topic: ContactTopic.BUSINESS };
    const [rows, waiting, last30Days] = await Promise.all([
      this.prisma.client.contactMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, email: true, name: true, status: true, message: true, createdAt: true },
      }),
      this.prisma.client.contactMessage.count({ where: { ...where, status: ContactStatus.NEW } }),
      this.prisma.client.contactMessage.count({
        where: { ...where, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      }),
    ]);
    return {
      rows: rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        status: row.status,
        summary: summaryOf(row.message) || say('رسالة بلا تفاصيل', 'Message without details'),
        createdAt: row.createdAt.toISOString(),
      })),
      waiting,
      last30Days,
    };
  }
}

/** "Acme · 25 seats · Office 2021" from the labelled lines `submit` wrote. */
export function summaryOf(message: string): string {
  const field = (label: string): string | undefined =>
    message
      .split('\n')
      .find((line) => line.startsWith(`${label}: `))
      ?.slice(label.length + 2);
  return [field('Company'), field('Seats'), field('Product')].filter(Boolean).join(' · ');
}
