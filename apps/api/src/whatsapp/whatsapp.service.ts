import { Injectable, Logger } from '@nestjs/common';

import { Locale, NotificationChannel, Prisma } from '@da/db';

import { PrismaService } from '../prisma/prisma.service.js';

import {
  type MetaErrorKind,
  classifyMetaError,
  isDeliveryStatus,
  isStopKeyword,
  looksArabic,
  statusPatch,
} from './rules.js';

/**
 * WhatsApp through Meta's Cloud API, directly — no reseller in between.
 *
 * Two kinds of message leave here. Templates, which Meta has approved in
 * advance and which are the only thing a business may send to somebody who
 * has not written to it in the last 24 hours; and one free-form line, the
 * confirmation after a STOP, which is allowed because the customer has just
 * written to us.
 *
 * As with email, the log records that a template went to a number and what
 * became of it — never what it said beyond the scalar variables in `payload`.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';
const TIMEOUT_MS = 10_000;

/** What an admin's test send is logged as, so it stays out of the channel's numbers. */
export const TEST_TEMPLATE = 'whatsapp.test';

export interface WhatsappSendResult {
  ok: boolean;
  /** Meta's `wamid`, which the status callbacks refer back to. */
  messageId: string | null;
  error: string | null;
  errorCode: number | null;
  errorKind: MetaErrorKind | null;
}

interface LogInput {
  /** Our own name for what was sent (`cart.recovery.2`), as the email path writes it. */
  template: string;
  locale: 'ar' | 'en';
  customerId?: string | null | undefined;
  /** Template variables for the audit trail. Scalars only, never secret material. */
  payload?: Record<string, string | number | boolean | null>;
}

/** The parts of a webhook `value` this handles. Everything is optional: Meta adds fields. */
interface WebhookValue {
  metadata?: { phone_number_id?: string };
  statuses?: {
    id?: string;
    status?: string;
    timestamp?: string;
    recipient_id?: string;
    errors?: { code?: number; title?: string }[];
  }[];
  messages?: {
    id?: string;
    from?: string;
    timestamp?: string;
    type?: string;
    text?: { body?: string };
    button?: { payload?: string; text?: string };
    interactive?: { button_reply?: { id?: string; title?: string } };
  }[];
}

export interface WebhookBody {
  object?: string;
  entry?: { changes?: { field?: string; value?: WebhookValue }[] }[];
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Credentials to send with. Without them the sweeps keep to email. */
  get configured(): boolean {
    return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  }

  get appSecret(): string {
    return process.env.WHATSAPP_APP_SECRET ?? '';
  }

  get verifyToken(): string {
    return process.env.WHATSAPP_VERIFY_TOKEN ?? '';
  }

  /**
   * Sends one approved template and records the attempt.
   *
   * `buttonUrlSuffix` fills a URL button's `{{1}}`: the template fixes the
   * store's address and only the path after it varies per message.
   */
  async sendTemplate(input: {
    to: string;
    template: string;
    language: string;
    bodyParams: string[];
    buttonUrlSuffix?: string;
    log: LogInput;
  }): Promise<WhatsappSendResult> {
    const components: unknown[] = [];
    if (input.bodyParams.length > 0) {
      components.push({
        type: 'body',
        parameters: input.bodyParams.map((text) => ({ type: 'text', text })),
      });
    }
    if (input.buttonUrlSuffix !== undefined) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: input.buttonUrlSuffix }],
      });
    }
    return this.post(
      input.to,
      {
        type: 'template',
        template: { name: input.template, language: { code: input.language }, components },
      },
      input.log,
    );
  }

  /**
   * A free-form text. Only valid inside the 24-hour window after the customer
   * last wrote to us — Meta refuses it otherwise (131047) — so the only caller
   * is the STOP confirmation, sent in answer to the STOP itself.
   */
  async sendText(to: string, body: string, log: LogInput): Promise<WhatsappSendResult> {
    return this.post(to, { type: 'text', text: { preview_url: false, body } }, log);
  }

  private async post(
    to: string,
    message: Record<string, unknown>,
    log: LogInput,
  ): Promise<WhatsappSendResult> {
    const result = await this.deliver(to, message);

    await this.prisma.client.notificationLog.create({
      data: {
        customerId: log.customerId ?? null,
        channel: NotificationChannel.WHATSAPP,
        template: log.template,
        locale: log.locale === 'en' ? Locale.EN : Locale.AR,
        toAddress: to,
        payload: log.payload ?? {},
        // Accepted, not delivered: `deliveredAt` is set by the status
        // callback when the phone actually has it.
        providerMessageId: result.messageId,
        deliveryStatus: result.ok ? 'sent' : 'failed',
        bouncedAt: result.ok ? null : new Date(),
        error: result.error,
      },
    });

    if (result.ok) {
      this.logger.log(`Sent ${log.template} on WhatsApp to ${redactPhone(to)}`);
    } else {
      this.logger.warn(
        `WhatsApp ${log.template} to ${redactPhone(to)} failed (${result.errorKind ?? 'unknown'}): ${result.error ?? ''}`,
      );
      // Blocked marketing from us inside WhatsApp: consent withdrawn, and
      // recorded as such so no sweep tries this number again.
      if (result.errorKind === 'opted-out') await this.optOut(to);
    }
    return result;
  }

  private async deliver(to: string, message: Record<string, unknown>): Promise<WhatsappSendResult> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) {
      return failure('WhatsApp is not configured.', null);
    }
    try {
      const response = await fetch(`${GRAPH}/${encodeURIComponent(phoneNumberId)}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          // Meta takes the number without the plus.
          to: to.replace(/^\+/, ''),
          ...message,
        }),
        // A Graph API that accepts the socket and never answers would hold a
        // sweep's advisory lock for as long as it liked.
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await response.json().catch(() => null)) as {
        messages?: { id?: string }[];
        error?: { code?: number; message?: string; error_data?: { details?: string } };
      } | null;

      if (!response.ok || body?.error) {
        const code = body?.error?.code ?? null;
        const detail = body?.error?.error_data?.details ?? body?.error?.message;
        return failure(
          `${code === null ? `HTTP ${String(response.status)}` : String(code)}: ${detail ?? 'refused'}`,
          code,
        );
      }
      const id = body?.messages?.[0]?.id ?? null;
      if (!id) return failure('No message id in the response.', null);
      return { ok: true, messageId: id, error: null, errorCode: null, errorKind: null };
    } catch (error) {
      // A failed send is a result, as in MailService: the sweep decides what
      // to do about it, which it cannot if this throws past it.
      return failure(error instanceof Error ? error.message : 'send failed', null);
    }
  }

  /** WhatsApp consent withdrawn for every customer on this number. */
  async optOut(phone: string, at: Date = new Date()): Promise<number> {
    const e164 = phone.startsWith('+') ? phone : `+${phone}`;
    const updated = await this.prisma.client.customer.updateMany({
      where: { whatsappPhone: e164 },
      data: { whatsappOptInAt: null, whatsappOptOutAt: at },
    });
    return updated.count;
  }

  /**
   * The last month on the channel, for the admin screen.
   *
   * Tests and STOP confirmations are left out: the numbers are there to say
   * whether cart and renewal messages reach people, and a staff member's own
   * phone receiving a test says nothing about that.
   */
  async stats(days = 30): Promise<{
    windowDays: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    optOuts: number;
  }> {
    const since = new Date(Date.now() - days * 86_400_000);
    const where: Prisma.NotificationLogWhereInput = {
      channel: NotificationChannel.WHATSAPP,
      sentAt: { gte: since },
      template: { notIn: [TEST_TEMPLATE, 'whatsapp.stop-confirmation'] },
    };
    const [sent, delivered, read, failed, optOuts] = await Promise.all([
      this.prisma.client.notificationLog.count({
        where: { ...where, providerMessageId: { not: null } },
      }),
      this.prisma.client.notificationLog.count({ where: { ...where, deliveredAt: { not: null } } }),
      this.prisma.client.notificationLog.count({ where: { ...where, openedAt: { not: null } } }),
      this.prisma.client.notificationLog.count({ where: { ...where, bouncedAt: { not: null } } }),
      this.prisma.client.customer.count({ where: { whatsappOptOutAt: { gte: since } } }),
    ]);
    return { windowDays: days, sent, delivered, read, failed, optOuts };
  }

  // --- webhook ---------------------------------------------------------------

  /**
   * Everything in one (already verified) webhook delivery.
   *
   * Safe to receive twice: a status only moves a log row forward, and an
   * inbound message is handled once per Meta message id.
   */
  async handleWebhook(body: WebhookBody): Promise<{ statuses: number; messages: number }> {
    let statuses = 0;
    let messages = 0;
    const ours = process.env.WHATSAPP_PHONE_NUMBER_ID;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;
        // One Meta app can hold several numbers; only this store's is ours to act on.
        if (ours && value.metadata?.phone_number_id && value.metadata.phone_number_id !== ours) {
          continue;
        }
        for (const status of value.statuses ?? []) {
          if (await this.applyStatus(status)) statuses += 1;
        }
        for (const message of value.messages ?? []) {
          if (await this.handleInbound(message)) messages += 1;
        }
      }
    }
    return { statuses, messages };
  }

  /** One status callback onto its log row. True when the row changed. */
  async applyStatus(status: NonNullable<WebhookValue['statuses']>[number]): Promise<boolean> {
    if (!status.id || !isDeliveryStatus(status.status)) return false;
    const row = await this.prisma.client.notificationLog.findUnique({
      where: { providerMessageId: status.id },
      select: {
        id: true,
        deliveryStatus: true,
        deliveredAt: true,
        openedAt: true,
        bouncedAt: true,
      },
    });
    if (!row) return false;

    const at = status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date();
    const firstError = status.errors?.[0];
    const patch = statusPatch(
      row,
      status.status,
      Number.isNaN(at.getTime()) ? new Date() : at,
      firstError ? `${String(firstError.code ?? '')}: ${firstError.title ?? ''}` : null,
    );
    if (!patch) return false;
    await this.prisma.client.notificationLog.update({ where: { id: row.id }, data: patch });

    if (status.status === 'failed' && classifyMetaError(firstError?.code) === 'opted-out') {
      // 131050 usually arrives here rather than on the send: Meta accepts the
      // message and reports later that the customer had blocked marketing.
      if (status.recipient_id) await this.optOut(status.recipient_id);
    }
    return true;
  }

  /**
   * One inbound message. Only STOP is acted on; anything else is a customer
   * writing to the shop, which a person answers in WhatsApp Business.
   */
  async handleInbound(message: NonNullable<WebhookValue['messages']>[number]): Promise<boolean> {
    if (!message.id || !message.from) return false;
    const text =
      message.text?.body ??
      message.button?.payload ??
      message.button?.text ??
      message.interactive?.button_reply?.id ??
      message.interactive?.button_reply?.title ??
      '';
    const stop =
      isStopKeyword(text) ||
      isStopKeyword(message.button?.text) ||
      isStopKeyword(message.interactive?.button_reply?.title);

    try {
      await this.prisma.client.whatsappInbound.create({
        data: { id: message.id, fromPhone: `+${message.from}`, kind: stop ? 'stop' : 'other' },
      });
    } catch (error) {
      // Seen before: Meta redelivered it. Whatever it asked for was done then.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
    if (!stop) return true;

    const phone = `+${message.from}`;
    await this.optOut(phone);

    // One confirmation, and only inside the service window — which this is,
    // since the customer has just written. A STOP that somehow arrives stale
    // (a delivery retried for a day) gets no reply rather than a refused one.
    const sentAt = message.timestamp ? Number(message.timestamp) * 1000 : Date.now();
    if (Date.now() - sentAt < 24 * 3_600_000) {
      const arabic = looksArabic(text);
      await this.sendText(
        phone,
        arabic
          ? 'تم إيقاف رسائل واتساب من ديجيتال أكتيفيشن. لن نراسلك هنا بعد الآن، وتصلك رسائل طلباتك على بريدك.'
          : 'You will no longer get WhatsApp messages from Digital Activation. Order emails still reach your inbox.',
        { template: 'whatsapp.stop-confirmation', locale: arabic ? 'ar' : 'en' },
      );
    }
    return true;
  }
}

function failure(error: string, code: number | null): WhatsappSendResult {
  return {
    ok: false,
    messageId: null,
    error,
    errorCode: code,
    errorKind: code === null ? null : classifyMetaError(code),
  };
}

/** Enough of a number to tell two apart in a log, not enough to dial. */
function redactPhone(phone: string): string {
  return phone.length > 6 ? `${phone.slice(0, 4)}…${phone.slice(-2)}` : '…';
}
