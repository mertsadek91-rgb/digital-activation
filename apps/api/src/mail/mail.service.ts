import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';

import { Locale, NotificationChannel } from '@da/db';

import { say } from '../common/panel-locale.js';
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

  /**
   * Where a customer is told to write, and where the contact form lands.
   *
   * Its own setting, not the transactional From address. Those were the same
   * value until the contact page went in and pointed at `help@`, which is the
   * address the store has printed on its own site for years — while every
   * licence email was telling customers to reply to `orders@`. One of the two
   * was going to be a mailbox nobody watches.
   */
  get supportEmail(): string {
    return (
      process.env.SUPPORT_EMAIL ??
      process.env.MAIL_FROM_TRANSACTIONAL ??
      'help@digital-activation.com'
    );
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
    // The object form, because it is the one that takes connection settings
    // beside the URL. Without timeouts a mail host that accepts the socket and
    // never answers holds the request open indefinitely — and one of the
    // requests that sends mail is the Stripe webhook, which Stripe abandons
    // and retries after its own timeout.
    const transporter = nodemailer.createTransport({
      url,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
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

  /**
   * Whether mail can actually leave this machine right now.
   *
   * The distinction this draws is the one the launch checklist was getting
   * wrong: `MAIL_TRANSPORT=smtp` is a statement about configuration, and a
   * store whose SMTP host refuses the connection is configured perfectly and
   * delivers nothing. On a store whose product *is* an email, that is the
   * difference between open and quietly broken — and the symptom is an order
   * that looks fulfilled with a customer who never received anything.
   *
   * So it opens the connection. Short timeouts on purpose: this is read by a
   * screen somebody is waiting on, and "we could not tell within five seconds"
   * is itself the answer worth printing.
   */
  async selfTest(): Promise<{ ok: boolean; detail: string }> {
    if (this.transport === 'capture') {
      return {
        ok: false,
        detail: say(
          'MAIL_TRANSPORT=capture يكتب الرسالة إلى ملف ولا يرسلها.',
          'MAIL_TRANSPORT=capture writes the message to a file and never sends it.',
        ),
      };
    }

    if (this.transport === 'resend') {
      const key = process.env.RESEND_API_KEY;
      if (!key) {
        return {
          ok: false,
          detail: say('RESEND_API_KEY غير مضبوط.', 'RESEND_API_KEY is not set.'),
        };
      }
      try {
        const response = await fetch('https://api.resend.com/domains', {
          headers: { authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(5000),
        });
        return response.ok
          ? {
              ok: true,
              detail: say(
                'Resend يستجيب والمفتاح مقبول.',
                'Resend answers and the key is accepted.',
              ),
            }
          : {
              ok: false,
              detail: say(
                `Resend ردّ بـ ${String(response.status)}. راجِع المفتاح.`,
                `Resend answered ${String(response.status)}. Check the key.`,
              ),
            };
      } catch (error) {
        return {
          ok: false,
          detail: say(
            `تعذّر الوصول إلى Resend: ${reason(error)}`,
            `Could not reach Resend: ${reason(error)}`,
          ),
        };
      }
    }

    const url = process.env.SMTP_URL;
    if (!url) {
      return { ok: false, detail: say('SMTP_URL غير مضبوط.', 'SMTP_URL is not set.') };
    }

    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport(url);
      try {
        // Opens the connection, upgrades to TLS and signs in, without sending
        // anything — which is exactly the part that fails when the host is
        // gone, the port is wrong or the credentials have been rotated.
        //
        // Timed out here rather than through the transport's own options: the
        // URL form of `createTransport` takes message defaults as its second
        // argument, not connection settings, so passing them there is silently
        // ignored. A race is honest about what it is doing.
        await Promise.race([
          transporter.verify(),
          new Promise((_resolve, reject) => {
            setTimeout(() => {
              reject(
                new Error(
                  say(
                    `لم يردّ خلال ${String(VERIFY_TIMEOUT_MS / 1000)} ثانية`,
                    `No answer within ${String(VERIFY_TIMEOUT_MS / 1000)} seconds`,
                  ),
                ),
              );
            }, VERIFY_TIMEOUT_MS);
          }),
        ]);
        return {
          ok: true,
          detail: say(
            'خادم SMTP يستجيب والاعتماد مقبول.',
            'The SMTP server answers and the credentials are accepted.',
          ),
        };
      } finally {
        transporter.close();
      }
    } catch (error) {
      return {
        ok: false,
        detail: say(
          `خادم SMTP لا يقبل: ${reason(error)}`,
          `The SMTP server refuses: ${reason(error)}`,
        ),
      };
    }
  }
}

/**
 * How long to let `verify()` run before calling it dead.
 *
 * Five seconds was measured against mailpit on localhost, which answers in
 * single-digit milliseconds. A real provider does not: Office 365 connects in
 * 43ms and then spends the rest of seven and a half seconds on the TLS upgrade
 * and the sign-in. So the check reported "لم يردّ خلال خمس ثوانٍ" for a server
 * that was answering perfectly well and had a precise complaint to make —
 * `535 5.7.3 Authentication unsuccessful` — and the screen printed a stopwatch
 * instead. A timeout shorter than the thing it is timing does not measure
 * health, it manufactures failure.
 *
 * Fifteen leaves room for a slow handshake and still returns a page inside the
 * time somebody will wait for one.
 */
const VERIFY_TIMEOUT_MS = 15_000;

/**
 * The one line of an error worth showing on a screen.
 *
 * SMTP's own refusals are the useful ones and they arrive as a `response`
 * field — `535 5.7.3 Authentication unsuccessful` — while `message` wraps that
 * in "Invalid login:". The server's own words go first, because the numbers in
 * them are what an administrator searches for.
 */
function reason(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: unknown }).response;
    if (typeof response === 'string' && response.trim().length > 0) {
      return response.split('\n')[0] ?? '';
    }
  }
  return error instanceof Error
    ? (error.message.split('\n')[0] ?? '')
    : say('سبب غير معروف', 'reason unknown');
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
