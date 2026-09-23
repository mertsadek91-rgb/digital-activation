import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { CONTACT_REPLY_HOURS, type ContactList, type ContactTopic } from '@da/contracts';
import { ContactStatus as Status, ContactTopic as Topic, Locale } from '@da/db';

import { MailService } from '../mail/mail.service.js';
import { contactAck, contactToStore } from '../mail/templates.js';
import { say } from '../common/panel-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The contact form.
 *
 * Three rules, in order of how much they cost when broken.
 *
 * The row is written before either email is sent. A store whose only inbox is
 * an SMTP connection loses every message it fails to receive and never learns
 * that it did — which is what the legacy support page was, a form that mailed
 * one address and kept nothing.
 *
 * A failed send does not fail the submission. The person who wrote in has done
 * their part; telling them "something went wrong" when the message is already
 * stored would make them send it again, and the second copy is no more useful
 * than the first.
 *
 * A submission that trips the honeypot is accepted and dropped. Refusing it
 * teaches a bot what to change; answering exactly as if it had worked teaches
 * it nothing at all.
 */
const TOPIC_LABELS: Record<ContactTopic, string> = {
  ORDER: 'استفسار عن طلب',
  ACTIVATION: 'مشكلة تفعيل',
  PRESALE: 'سؤال قبل الشراء',
  BUSINESS: 'مبيعات الشركات',
  OTHER: 'أخرى',
};

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * The inbox.
   *
   * Unanswered first and oldest first within that, because the only ordering a
   * support queue can be worked by is the one that answers the person who has
   * waited longest. `includeHandled` exists for looking something up again,
   * not for working the list.
   */
  async list(input: { includeHandled: boolean; limit: number }): Promise<ContactList> {
    const where = input.includeHandled ? {} : { status: Status.NEW };

    const rows = await this.prisma.client.contactMessage.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: input.limit,
      include: {
        customer: { select: { id: true, orderCount: true, totalSpentUsd: true } },
        handledBy: { select: { name: true } },
      },
    });

    const waiting = await this.prisma.client.contactMessage.count({
      where: { status: Status.NEW },
    });
    const overdue = await this.prisma.client.contactMessage.count({
      where: {
        status: Status.NEW,
        createdAt: { lt: new Date(Date.now() - CONTACT_REPLY_HOURS * 3600 * 1000) },
      },
    });
    const total = await this.prisma.client.contactMessage.count({ where });

    const now = Date.now();

    return {
      rows: rows.map((row) => ({
        id: row.id,
        topic: row.topic,
        status: row.status,
        name: row.name,
        email: row.email,
        phone: row.phone,
        orderNumber: row.orderNumber,
        message: row.message,
        locale: row.locale === Locale.EN ? ('en' as const) : ('ar' as const),
        customer: row.customer
          ? {
              id: row.customer.id,
              orderCount: row.customer.orderCount,
              totalSpentUsd: row.customer.totalSpentUsd.toFixed(2),
            }
          : null,
        createdAt: row.createdAt.toISOString(),
        handledAt: row.handledAt?.toISOString() ?? null,
        handledBy: row.handledBy?.name ?? null,
        waitingSeconds: Math.max(0, Math.floor((now - row.createdAt.getTime()) / 1000)),
      })),
      waiting,
      overdue,
      total,
    };
  }

  /**
   * Marks a message answered, or puts it back.
   *
   * The name is recorded with it. Two people answering the same customer is
   * the failure mode of a shared inbox, and "who took this" is the only thing
   * that prevents it.
   */
  async setStatus(input: {
    id: string;
    status: 'NEW' | 'HANDLED';
    staffId: string;
  }): Promise<{ id: string; status: 'NEW' | 'HANDLED' }> {
    const existing = await this.prisma.client.contactMessage.findUnique({
      where: { id: input.id },
      select: { id: true },
    });
    if (!existing)
      throw new NotFoundException(say('لا توجد رسالة بهذا المعرّف.', 'No message with that id.'));

    const row = await this.prisma.client.contactMessage.update({
      where: { id: input.id },
      data:
        input.status === 'HANDLED'
          ? { status: Status.HANDLED, handledAt: new Date(), handledById: input.staffId }
          : // Reopening clears the name as well as the timestamp: a message
            // back in the queue has nobody on it, and leaving the old name
            // there is how it gets skipped a second time.
            { status: Status.NEW, handledAt: null, handledById: null },
    });

    return { id: row.id, status: row.status };
  }

  async submit(input: {
    topic: ContactTopic;
    name: string;
    email: string;
    phone?: string | undefined;
    orderNumber?: string | undefined;
    message: string;
    locale: 'ar' | 'en';
    website?: string | undefined;
    ip?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<void> {
    if (input.website && input.website.trim().length > 0) {
      // Counted, not stored and not answered. The count is the only way to
      // know whether the honeypot is doing anything.
      this.logger.log('Contact submission dropped: honeypot filled.');
      return;
    }

    // Linked when the address is already a customer, so whoever answers sees
    // who they are talking to without searching for them first.
    const customer = await this.prisma.client.customer.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    const row = await this.prisma.client.contactMessage.create({
      data: {
        topic: Topic[input.topic],
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        orderNumber: input.orderNumber ?? null,
        message: input.message,
        locale: input.locale === 'en' ? Locale.EN : Locale.AR,
        customerId: customer?.id ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });

    const toStore = await this.mail.send({
      to: this.mail.supportEmail,
      template: 'contact.received',
      locale: 'ar',
      rendered: contactToStore({
        topic: TOPIC_LABELS[input.topic],
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        orderNumber: input.orderNumber ?? null,
        message: input.message,
        locale: input.locale,
        id: row.id,
      }),
      // The message body is in the email and in the row. It is not repeated
      // into a NotificationLog payload, which is read far more widely.
      payload: { topic: input.topic, messageId: row.id },
    });

    if (!toStore.ok) {
      // Loud, because this is the one failure a customer cannot see and the
      // store cannot afford: the message is safe in the table, but nobody has
      // been told it arrived.
      this.logger.error(
        `Contact message ${row.id} is stored but the notification to the store failed: ${toStore.error ?? 'unknown'}`,
      );
    }

    await this.mail.send({
      to: input.email,
      template: 'contact.ack',
      locale: input.locale,
      customerId: customer?.id,
      // No name in it. The address is unverified, so whatever was typed into
      // the name field would arrive in a stranger's inbox under the store's
      // domain — the shape of a spam or phishing relay. The acknowledgement
      // says only what the store wrote.
      rendered: contactAck({
        locale: input.locale,
        hours: CONTACT_REPLY_HOURS,
        supportEmail: this.mail.supportEmail,
      }),
      payload: { messageId: row.id },
    });
  }
}
