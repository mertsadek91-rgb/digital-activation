/**
 * Final Processor — server-side client for Next.js (Node 18+). No dependencies.
 *
 * NEVER import this file from a Client Component: the secret must stay on the server.
 * In a Next.js app, add `import 'server-only';` at the top of the file that re-exports it.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type FinalProcessorConfig = {
  /** Processor base URL, e.g. https://pr.example.com (no trailing slash needed). */
  baseUrl: string;
  /** Site ID from the processor admin, e.g. site_abcd1234efgh5678. */
  siteId: string;
  /** Site secret from the processor admin (fpsec_...). Server only. */
  secret: string;
  /** Per-request timeout in milliseconds. Default 15000. */
  timeoutMs?: number;
};

export type PaymentMethod = {
  id: string;
  label: string;
  labels: { ar?: string; en?: string };
  icon_url: string;
  currencies: string[];
  refunds: 'none' | 'full' | 'partial';
  test_mode: boolean;
};

export type CreatePaymentInput = {
  /** Your own order id. Letters, digits and . _ : - only, max 100. Idempotency key. */
  orderRef: string;
  /**
   * The order number the customer sees, shown on the payment page after the product label
   * ("Service #1234"). Letters, digits, - and _ only, max 32. Optional.
   */
  orderNumber?: string;
  /** Amount in minor units as a string: "2550" = 25.50 USD. Compute it on the server. */
  amountMinor: string;
  currency: string;
  /** A method id returned by listMethods(). */
  method: string;
  customerEmail?: string;
  /** Where the customer lands after paying. Must be on the domain registered for this site. */
  returnUrl: string;
  /** Where the customer lands after cancelling or failing. Same domain rule. */
  cancelUrl: string;
  /** Optional note shown only in the processor admin (max 140 chars). */
  description?: string;
};

export type CreatedPayment = {
  payment_id: string;
  status: 'pending';
  redirect_url: string;
  expires_at: string;
};

export type Refund = {
  refund_id: string;
  refund_ref: string;
  amount_minor: string;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
  created_at: string;
};

export type Payment = {
  payment_id: string;
  order_ref: string;
  order_number: string | null;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  amount_minor: string;
  currency: string;
  method: string;
  refunded_minor: string;
  test_mode: boolean;
  created_at: string;
  expires_at: string;
  succeeded_at: string | null;
  refunds: Refund[];
};

export type WebhookEvent = {
  event_id: string;
  type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded' | 'refund.failed';
  created_at: string;
  data: {
    payment_id: string;
    order_ref: string;
    status: Payment['status'];
    amount_minor: string;
    currency: string;
    method: string;
    refunded_minor: string;
    test_mode: boolean;
    refund?: {
      refund_id: string;
      refund_ref: string;
      amount_minor: string;
      status: Refund['status'];
    };
  };
};

export class FinalProcessorError extends Error {
  /** Stable error code, e.g. "invalid_return_url", "method_unavailable", "network_error". */
  readonly code: string;
  readonly status: number;
  readonly field?: string;

  constructor(code: string, status: number, field?: string) {
    super(`Final Processor: ${code}${field ? ` (${field})` : ''}`);
    this.name = 'FinalProcessorError';
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

const WEBHOOK_MAX_SKEW_SECONDS = 300;

export class FinalProcessor {
  private readonly baseUrl: string;
  private readonly config: FinalProcessorConfig;

  constructor(config: FinalProcessorConfig) {
    if (!config.baseUrl || !config.siteId || !config.secret) {
      throw new Error('FinalProcessor: baseUrl, siteId and secret are required');
    }
    this.config = config;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  /** Reads FP_BASE_URL, FP_SITE_ID and FP_SECRET. */
  static fromEnv(env: Record<string, string | undefined> = process.env): FinalProcessor {
    return new FinalProcessor({
      baseUrl: env.FP_BASE_URL ?? '',
      siteId: env.FP_SITE_ID ?? '',
      secret: env.FP_SECRET ?? '',
    });
  }

  /** Registers the webhook URL and checks the keys. Call once after deploy (and whenever the URL changes). */
  connect(webhookUrl: string, platform = 'Next.js') {
    return this.request<{
      connected: true;
      site: { site_id: string; name: string };
      currencies: string[];
      methods: PaymentMethod[];
    }>('POST', '/api/v1/connect', { webhook_url: webhookUrl, platform });
  }

  async listMethods(currency?: string): Promise<PaymentMethod[]> {
    const query = currency ? `?currency=${encodeURIComponent(currency)}` : '';
    const body = await this.request<{ methods: PaymentMethod[] }>('GET', `/api/v1/methods${query}`);
    return body.methods;
  }

  createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    return this.request<CreatedPayment>('POST', '/api/v1/payments', {
      order_ref: input.orderRef,
      order_number: input.orderNumber,
      amount_minor: input.amountMinor,
      currency: input.currency,
      method: input.method,
      customer_email: input.customerEmail,
      return_url: input.returnUrl,
      cancel_url: input.cancelUrl,
      description: input.description,
    });
  }

  getPayment(paymentId: string): Promise<Payment> {
    return this.request<Payment>('GET', `/api/v1/payments/${encodeURIComponent(paymentId)}`);
  }

  /** refundRef is your idempotency key: retrying with the same ref never refunds twice. */
  refund(paymentId: string, input: { refundRef: string; amountMinor: string }): Promise<Refund> {
    return this.request<Refund>(
      'POST',
      `/api/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
      {
        refund_ref: input.refundRef,
        amount_minor: input.amountMinor,
      },
    );
  }

  /**
   * Verifies a webhook from the processor. Pass the RAW request body (await req.text()), never a
   * re-serialized object. Throws FinalProcessorError('invalid_signature') when anything is off.
   */
  verifyWebhook(
    rawBody: string,
    headers: Headers | Record<string, string | null | undefined>,
  ): WebhookEvent {
    const get = (name: string): string =>
      (headers instanceof Headers
        ? headers.get(name)
        : (headers[name] ?? headers[name.toLowerCase()])) ?? '';
    const timestamp = get('x-fp-timestamp');
    const signature = get('x-fp-signature');
    if (
      !/^\d{1,12}$/.test(timestamp) ||
      Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > WEBHOOK_MAX_SKEW_SECONDS
    ) {
      throw new FinalProcessorError('invalid_signature', 401);
    }
    const expected =
      'v1=' +
      createHmac('sha256', this.config.secret).update(`${timestamp}.${rawBody}`).digest('hex');
    if (!safeEqual(expected, signature)) {
      throw new FinalProcessorError('invalid_signature', 401);
    }
    const event = JSON.parse(rawBody) as WebhookEvent;
    if (
      !event ||
      typeof event.event_id !== 'string' ||
      typeof event.type !== 'string' ||
      typeof event.data !== 'object'
    ) {
      throw new FinalProcessorError('invalid_signature', 401);
    }
    return event;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(18).toString('base64url');
    const signature =
      'v1=' +
      createHmac('sha256', this.config.secret)
        .update(`${timestamp}\n${nonce}\n${method}\n${path}\n${raw}`)
        .digest('hex');

    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-FP-Site': this.config.siteId,
          'X-FP-Timestamp': timestamp,
          'X-FP-Nonce': nonce,
          'X-FP-Signature': signature,
        },
        body: raw === '' ? undefined : raw,
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15000),
      });
    } catch {
      throw new FinalProcessorError('network_error', 0);
    }

    const text = await response.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      throw new FinalProcessorError(
        json?.error ?? `http_${response.status}`,
        response.status,
        json?.field,
      );
    }
    return json as T;
  }
}

/** "25.5" -> "2550" for USD using string math only (no floating point). */
export function toMinor(decimal: string, currency: string): string {
  const exponent = currencyExponent(currency);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!match) throw new Error(`Invalid decimal amount: ${decimal}`);
  const fraction = (match[2] ?? '').padEnd(exponent, '0');
  if (fraction.length > exponent) throw new Error(`Too many decimals for ${currency}: ${decimal}`);
  return (match[1] + fraction).replace(/^0+(?=\d)/, '');
}

export function currencyExponent(currency: string): number {
  const zero = [
    'BIF',
    'CLP',
    'DJF',
    'GNF',
    'ISK',
    'JPY',
    'KMF',
    'KRW',
    'PYG',
    'RWF',
    'UGX',
    'VND',
    'VUV',
    'XAF',
    'XOF',
    'XPF',
  ];
  const three = ['BHD', 'JOD', 'KWD', 'OMR', 'TND'];
  const code = currency.toUpperCase();
  return zero.includes(code) ? 0 : three.includes(code) ? 3 : 2;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
