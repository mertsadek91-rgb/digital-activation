import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';

import { Locale, NotificationChannel } from '@da/db';

import { PrismaService } from '../prisma/prisma.service.js';

import type { Rendered } from './templates.js';

export type Transport = 'smtp' | 'resend' | 'capture';

export interface SendResult {
  ok: boolean;
  /** Provider-side id where there is one. */
  ref: string | null;
  error: string | null;
}

/**
 * Outbound mail.
 *
 * One rule shapes this file, and it comes from what the legacy store did: it
 * delivered licence keys by pasting them into WooCommerce order notes, which is
 * why its own backup is a file of customer keys and Office 365 passwords. So
 * here, a message body never reaches a log, a Sentry breadcrumb or a
 * NotificationLog payload. What is recorded is that a template was sent to an
 * address and whether it arrived — never what it said.
 *
 * Three transports, chosen by `MAIL_TRANSPORT`:
 *
 *   smtp     — mailpit in development, or any host that gives SMTP.
 *   resend   — production.
 *   capture  — writes the rendered message to a gitignored directory and sends
 *              nothing. For reviewing wording without mailing anyone. Refused
 *              in production, like the local KEK, because a captured licence
 *              email is a plaintext key sitting in a file.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly prisma: PrismaService) {}

  get transport(): Transport {
    const raw = process.env.MAIL_TRANSPORT ?? 'smtp';
    if (raw === 'resend' || raw === 'capture') return raw;
    return 'smtp';
  }

  private from(kind: 'transactional' | 'marketing'): string {
    // Separate domains on purpose: a marketing blast that gets a domain
    // filtered must not take the licence-delivery mail down with it.
    return kind === 'marketing'
      ? (process.env.MAIL_FROM_MARKETING ?? 'news@mail.digital-activation.com')
      : (process.env.MAIL_FROM_TRANSACTIONAL ?? 'orders@digital-activation.com');
  }

  get supportEmail(): string {
    return process.env.MAIL_FROM_TRANSACTIONAL ?? 'orders@digital-activation.com';
  }

  /**
   * Sends one message and records that it was sent.
   *
   * `payload` is the only thing written to the log row, and the caller is
   * expected to put template variables in it — an order number, a product
   * name. Never a key. The type cannot enforce that, so the rule is stated
   * here and at every call site that handles a licence.
   */
  async send(input: {
    to: string;
    template: string;
    locale: 'ar' | 'en';
    rendered: Rendered;
    kind?: 'transactional' | 'marketing';
    customerId?: string | undefined;
    /**
     * Template variables for the audit trail. Never secret material.
     *
     * Scalars only, and that is the point as much as the typing: a payload
     * that accepts an object graph is a payload somebody eventually passes a
     * whole order item into, keys and all.
     */
    payload?: Record<string, string | number | boolean | null>;
  }): Promise<SendResult> {
    const result = await this.deliver(input.to, input.rendered, input.kind ?? 'transactional');

    await this.prisma.client.notificationLog.create({
      data: {
        customerId: input.customerId ?? null,
        channel: NotificationChannel.EMAIL,
        template: input.template,
        locale: input.locale === 'en' ? Locale.EN : Locale.AR,
        toAddress: input.to,
        payload: input.payload ?? {},
        // `sentAt` defaults to now and stays, even on failure: the attempt
        // happened, and a row that only exists on success cannot answer "did
        // we ever try to send this customer their key".
        deliveredAt: result.ok ? new Date() : null,
        error: result.error,
      },
    });

    // Subject, not body. A subject line is safe; a body may be the product.
    if (result.ok) {
      this.logger.log(`Sent ${input.template} to ${redact(input.to)}`);
    } else {
      this.logger.error(
        `Failed to send ${input.template} to ${redact(input.to)}: ${result.error ?? 'unknown'}`,
      );
    }

    return result;
  }

  private async deliver(
    to: string,
    rendered: Rendered,
    kind: 'transactional' | 'marketing',
  ): Promise<SendResult> {
    try {
      switch (this.transport) {
        case 'resend':
          return await this.viaResend(to, rendered, kind);
        case 'capture':
          return this.viaCapture(to, rendered);
        default:
          return await this.viaSmtp(to, rendered, kind);
      }
    } catch (error) {
      // A failed send is a result, not an exception to propagate: the caller
      // is usually mid-fulfilment and needs to decide whether to mark a line
      // delivered, which it cannot do if this throws past it.
      return {
        ok: false,
        ref: null,
        error: error instanceof Error ? error.message : 'send failed',
      };
    }
  }

  private async viaSmtp(
    to: string,
    rendered: Rendered,
    kind: 'transactional' | 'marketing',
  ): Promise<SendResult> {
    const url = process.env.SMTP_URL;
    if (!url) throw new ServiceUnavailableException('SMTP_URL is not set.');

    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport(url);
    const info = await transporter.sendMail({
      from: this.from(kind),
      to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    transporter.close();

    return { ok: true, ref: info.messageId, error: null };
  }

  private async viaResend(
    to: string,
    rendered: Rendered,
    kind: 'transactional' | 'marketing',
  ): Promise<SendResult> {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new ServiceUnavailableException('RESEND_API_KEY is not set.');

    const { Resend } = await import('resend');
    const resend = new Resend(key);
    const { data, error } = await resend.emails.send({
      from: this.from(kind),
      to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });

    if (error) return { ok: false, ref: null, error: error.message };
    return { ok: true, ref: data?.id ?? null, error: null };
  }

  /**
   * Writes the message to disk instead of sending it.
   *
   * For looking at what a licence email actually says without mailing a real
   * address. The directory is gitignored and this transport is refused in
   * production, because a captured licence email is a plaintext key in a file.
   */
  private viaCapture(to: string, rendered: Rendered): SendResult {
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException(
        'MAIL_TRANSPORT=capture is a development transport and writes message bodies to disk.',
      );
    }

    const dir = path.join(process.cwd(), '..', '..', '.cache', 'mail');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = to.replace(/[^a-zA-Z0-9@._-]/g, '_');
    const file = path.join(dir, `${stamp}_${safe}.html`);

    fs.writeFileSync(
      file,
      `<!-- to: ${to}\n     subject: ${rendered.subject}\n\n${rendered.text}\n-->\n${rendered.html}`,
      'utf8',
    );
    return { ok: true, ref: file, error: null };
  }

  /** Was this template already sent to this address for this order? */
  async alreadySent(input: {
    template: string;
    to: string;
    orderNumber: string;
  }): Promise<boolean> {
    const found = await this.prisma.client.notificationLog.findFirst({
      where: {
        template: input.template,
        toAddress: input.to,
        deliveredAt: { not: null },
        payload: { path: ['orderNumber'], equals: input.orderNumber },
      },
      select: { id: true },
    });
    return found !== null;
  }
}

/**
 * Partly masks an address for a log line.
 *
 * A log full of customer addresses is a mailing list waiting to leak, and the
 * only thing a log actually needs to answer is "which customer roughly" when
 * reading it next to an order number.
 */
function redact(address: string): string {
  const [user, domain] = address.split('@');
  if (!user || !domain) return '***';
  const head = user.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}
