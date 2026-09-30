import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { say } from '../common/panel-locale.js';
import { finalProcessorConfigured } from '../config/env.js';

import {
  type CreatePaymentInput,
  type CreatedPayment,
  FinalProcessor,
  FinalProcessorError,
  type Payment,
  type PaymentMethod,
  type Refund,
  type WebhookEvent,
} from './final-processor.js';

/**
 * Final Processor, the owner's own payment processor.
 *
 * The SDK (`final-processor.ts`) is the reference file, copied unchanged; this
 * is the only thing that constructs it. It lives in the API alone: the
 * storefront and the admin are separate Next.js apps that call the API, so
 * FP_SECRET is never in a bundle, a Client Component or a browser — which is
 * what the reference's `import 'server-only'` guards in a Next.js monolith.
 *
 * The secret is read from process.env when first needed and never stored
 * anywhere else, logged, or returned: an SDK error carries a code, a status
 * and a field name, none of which is the secret.
 */

/** Where the processor delivers webhooks, under the API's public origin. */
export const FP_WEBHOOK_PATH = '/v1/webhooks/final-processor';

/** B.3: the method list is refreshed from the processor at most this often. */
export const FP_METHODS_TTL_MS = 5 * 60 * 1000;
/** A failed lookup is remembered briefly, so a processor outage is not hammered. */
const FP_FAILURE_TTL_MS = 30 * 1000;

/** A test double replaces the SDK through this token; production never provides it. */
export const FP_CLIENT = Symbol('FP_CLIENT');

/** The part of the SDK this API uses. */
export type FpClient = Pick<
  FinalProcessor,
  'connect' | 'listMethods' | 'createPayment' | 'getPayment' | 'refund' | 'verifyWebhook'
>;

export type FpMethodsResult =
  | { ok: true; methods: PaymentMethod[]; checkedAt: Date }
  | { ok: false; code: string; checkedAt: Date };

@Injectable()
export class FinalProcessorService {
  private readonly logger = new Logger(FinalProcessorService.name);
  private client: FpClient | null;
  private cache: { result: FpMethodsResult; expiresAt: number } | null = null;
  private inflight: Promise<FpMethodsResult> | null = null;

  constructor(@Optional() @Inject(FP_CLIENT) client?: FpClient | null) {
    this.client = client ?? null;
  }

  /** All three of FP_BASE_URL, FP_SITE_ID and FP_SECRET are set (or a client was given). */
  get configured(): boolean {
    return this.client !== null || finalProcessorConfigured(process.env);
  }

  /** Presence only — never a value. For the panel (B.2). */
  envPresence(): {
    baseUrl: boolean;
    siteId: boolean;
    secret: boolean;
    siteUrl: boolean;
    configured: boolean;
  } {
    return {
      baseUrl: Boolean(process.env.FP_BASE_URL),
      siteId: Boolean(process.env.FP_SITE_ID),
      secret: Boolean(process.env.FP_SECRET),
      siteUrl: Boolean(process.env.SITE_URL),
      configured: this.configured,
    };
  }

  /** The processor URL and site id may be shown; the secret never is. */
  get baseUrl(): string | null {
    return process.env.FP_BASE_URL || null;
  }

  get siteId(): string | null {
    return process.env.FP_SITE_ID || null;
  }

  /** The storefront origin return and cancel pages are built on, without a trailing slash. */
  get siteUrl(): string | null {
    const value = process.env.SITE_URL;
    return value ? value.replace(/\/+$/, '') : null;
  }

  /** The URL "Test connection" registers: the API's public origin plus FP_WEBHOOK_PATH. */
  get webhookUrl(): string | null {
    const apiBase = process.env.API_PUBLIC_URL || process.env.NEXT_PUBLIC_API_URL;
    return apiBase ? new URL(FP_WEBHOOK_PATH, apiBase).toString() : null;
  }

  private sdk(): FpClient {
    if (this.client) return this.client;
    if (!finalProcessorConfigured(process.env)) {
      throw new FinalProcessorError('not_configured', 0);
    }
    this.client = FinalProcessor.fromEnv(process.env);
    return this.client;
  }

  /**
   * The methods the processor offers this site, cached up to five minutes.
   *
   * Never throws: a failure is an answer (`ok: false` with the code), because
   * the checkout must still render — without Final Processor — and the panel
   * must say why. `fresh` skips the cache (the settings page's refresh).
   */
  async methods(options: { fresh?: boolean } = {}): Promise<FpMethodsResult> {
    if (!this.configured) {
      return { ok: false, code: 'not_configured', checkedAt: new Date() };
    }
    if (!options.fresh && this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.result;
    }
    if (this.inflight) return this.inflight;

    this.inflight = (async (): Promise<FpMethodsResult> => {
      let result: FpMethodsResult;
      try {
        result = { ok: true, methods: await this.sdk().listMethods(), checkedAt: new Date() };
      } catch (error) {
        const code = fpErrorCode(error);
        this.logger.warn(`Final Processor method list failed: ${code}`);
        result = { ok: false, code, checkedAt: new Date() };
      }
      this.cache = {
        result,
        expiresAt: Date.now() + (result.ok ? FP_METHODS_TTL_MS : FP_FAILURE_TTL_MS),
      };
      return result;
    })();
    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  /** Forgets the cached method list, e.g. after a successful connect. */
  invalidate(): void {
    this.cache = null;
  }

  /**
   * Registers the webhook URL and checks the keys (B.2). The methods it returns
   * replace the cached list, so the settings page is current right after.
   */
  async connect(): Promise<
    Awaited<ReturnType<FinalProcessor['connect']>> & { webhookUrl: string }
  > {
    const webhookUrl = this.webhookUrl;
    if (!webhookUrl) throw new FinalProcessorError('webhook_url_unknown', 0);
    const result = await this.sdk().connect(webhookUrl, 'NestJS');
    this.cache = {
      result: { ok: true, methods: result.methods, checkedAt: new Date() },
      expiresAt: Date.now() + FP_METHODS_TTL_MS,
    };
    return { ...result, webhookUrl };
  }

  createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    return this.sdk().createPayment(input);
  }

  getPayment(paymentId: string): Promise<Payment> {
    return this.sdk().getPayment(paymentId);
  }

  refund(paymentId: string, input: { refundRef: string; amountMinor: string }): Promise<Refund> {
    return this.sdk().refund(paymentId, input);
  }

  /** Throws `FinalProcessorError('invalid_signature')` on anything that does not verify. */
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookEvent {
    return this.sdk().verifyWebhook(rawBody, headers);
  }
}

// --- error codes (A.6) --------------------------------------------------------

/** The processor's error code, or `internal_error` for anything that is not one. */
export function fpErrorCode(error: unknown): string {
  return error instanceof FinalProcessorError ? error.code : 'internal_error';
}

/** Codes worth retrying later with the same idempotency key: the outcome is unknown. */
export function isTransientFpCode(code: string): boolean {
  return (
    code === 'network_error' ||
    code === 'rate_limited' ||
    code === 'internal_error' ||
    /^http_5\d\d$/.test(code)
  );
}

/**
 * What a code means, for staff (B.2, B.4), in the panel's language. The code
 * itself is shown beside it. Never includes a value from the environment.
 */
export function fpAdminMessage(code: string, field?: string): string {
  switch (code) {
    case 'not_configured':
      return say(
        'Final Processor غير مهيّأ: عيّن FP_BASE_URL وFP_SITE_ID وFP_SECRET على الخادم.',
        'Final Processor is not configured: set FP_BASE_URL, FP_SITE_ID and FP_SECRET on the server.',
      );
    case 'webhook_url_unknown':
      return say(
        'عنوان الـ API العام غير معروف: عيّن API_PUBLIC_URL ليُسجَّل عنوان الـ webhook.',
        'The API’s public address is unknown: set API_PUBLIC_URL so the webhook URL can be registered.',
      );
    case 'invalid_signature':
      return say(
        'التوقيع مرفوض: FP_SECRET لا يطابق هذا الموقع في المعالج (سرّ خاطئ).',
        'Signature rejected: FP_SECRET does not match this site in the processor (wrong secret).',
      );
    case 'stale_timestamp':
      return say(
        'ساعة الخادم منحرفة بأكثر من 5 دقائق. صحّح الوقت (NTP) ثم أعد المحاولة.',
        'The server clock is off by more than 5 minutes. Fix the time (NTP) and try again.',
      );
    case 'replayed_request':
      return say(
        'رفض المعالج طلباً مكرراً. أعد المحاولة.',
        'The processor refused a replayed request. Try again.',
      );
    case 'unknown_site':
      return say(
        'FP_SITE_ID غير معروف لدى المعالج.',
        'The processor does not know this FP_SITE_ID.',
      );
    case 'invalid_request':
      return say(
        `طلب غير صالح${field ? ` (الحقل ${field})` : ''}.`,
        `Invalid request${field ? ` (field ${field})` : ''}.`,
      );
    case 'unsupported_currency':
      return say(
        'العملة غير مدعومة لهذا الموقع. هذا المتجر يدفع بالدولار فقط.',
        'The currency is not supported for this site. This shop charges in USD only.',
      );
    case 'amount_out_of_range':
      return say(
        'المبلغ خارج الحدود التي يقبلها المعالج.',
        'The amount is outside what the processor accepts.',
      );
    case 'method_unavailable':
      return say(
        'طريقة الدفع لم تعد متاحة لدى المعالج.',
        'The payment method is no longer available at the processor.',
      );
    case 'invalid_return_url':
      return say(
        'صفحة العودة مرفوضة: نطاق SITE_URL غير مسجّل لهذا الموقع أو ليس https.',
        'Return page rejected: the SITE_URL domain is not registered for this site, or is not https.',
      );
    case 'invalid_webhook_url':
      return say(
        'عنوان الـ webhook مرفوض: النطاق غير مسجّل لهذا الموقع أو ليس https.',
        'Webhook URL rejected: the domain is not registered for this site, or is not https.',
      );
    case 'order_ref_conflict':
      return say(
        'للطلب دفعة مفتوحة بمبلغ آخر. يُنشأ طلب جديد.',
        'The order has an open payment for a different amount. A new order is needed.',
      );
    case 'already_paid':
      return say('هذه الدفعة مدفوعة من قبل.', 'This payment is already paid.');
    case 'not_found':
      return say('المعالج لا يعرف هذه الدفعة.', 'The processor does not know this payment.');
    case 'refund_not_allowed':
      return say(
        'لا يمكن استرداد هذه الدفعة في حالتها الحالية.',
        'This payment cannot be refunded in its current state.',
      );
    case 'refund_not_supported':
      return say(
        'طريقة الدفع هذه لا تدعم الاسترداد (أو لا تدعم الاسترداد الجزئي).',
        'This payment method does not support refunds (or not partial ones).',
      );
    case 'refund_exceeds_balance':
      return say(
        'المبلغ أكبر من الرصيد القابل للاسترداد.',
        'The amount is more than the refundable balance.',
      );
    case 'refund_ref_conflict':
      return say(
        'مرجع الاسترداد مستخدم لمبلغ آخر.',
        'The refund reference was already used for a different amount.',
      );
    case 'refund_failed':
      return say('رفضت بوابة الدفع الاسترداد.', 'The payment gateway rejected the refund.');
    case 'rate_limited':
      return say('طلبات كثيرة. أعد المحاولة بعد قليل.', 'Too many requests. Try again shortly.');
    case 'internal_error':
      return say(
        'خطأ مؤقت لدى المعالج. أعد المحاولة لاحقاً.',
        'A temporary processor error. Try again later.',
      );
    case 'network_error':
      return say(
        'تعذّر الوصول إلى المعالج (شبكة أو مهلة). أعد المحاولة.',
        'The processor could not be reached (network or timeout). Try again.',
      );
    default:
      return say(`خطأ من المعالج: ${code}.`, `Processor error: ${code}.`);
  }
}

/**
 * What a customer is told (A.6): short and generic, never the code, in the
 * order's language.
 */
export function fpCustomerMessage(
  locale: 'ar' | 'en',
  kind: 'unavailable' | 'retry' | 'order_changed' | 'failed',
): string {
  const messages = {
    unavailable: {
      ar: 'الدفع الإلكتروني غير متاح مؤقتاً. جرّب لاحقاً أو اختر طريقة أخرى.',
      en: 'Online payment is temporarily unavailable. Try again later or choose another method.',
    },
    retry: {
      ar: 'تعذّر بدء الدفع. حاول مرة أخرى بعد قليل.',
      en: 'The payment could not be started. Please try again in a moment.',
    },
    order_changed: {
      ar: 'تغيّر طلبك منذ بدء الدفع. راجعه ثم ادفع من جديد.',
      en: 'Your order changed since the payment was started. Review it and pay again.',
    },
    failed: {
      ar: 'فشل الدفع، يرجى المحاولة مرة أخرى.',
      en: 'Payment failed, please try again.',
    },
  } as const;
  return messages[kind][locale];
}
