import crypto from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkoutStartSchema, normalizeWhatsappPhone, whatsappSettingsSchema } from '@da/contracts';
import { Prisma } from '@da/db';

import type { PrismaService } from '../prisma/prisma.service.js';

import {
  buttonSuffix,
  chooseDelivery,
  classifyMetaError,
  hasWhatsappConsent,
  isStopKeyword,
  statusPatch,
  templateParam,
  verifyMetaSignature,
} from './rules.js';
import { cartRecoveryParams, renewalParams } from './templates.js';
import { WhatsappService } from './whatsapp.service.js';

/**
 * The WhatsApp channel. Everything here fails quietly when wrong: a number
 * normalised two ways makes a STOP land on nobody, a signature check that
 * passes garbage lets anyone opt customers out, and a channel choice that
 * skips consent is a breach one message at a time.
 */

const at = (iso: string): Date => new Date(iso);

describe('phone normalisation', () => {
  it('reads local Gulf formats against the selected country', () => {
    expect(normalizeWhatsappPhone('0501234567', 'SA')).toBe('+966501234567');
    expect(normalizeWhatsappPhone('501234567', 'SA')).toBe('+966501234567');
    expect(normalizeWhatsappPhone('050 123 4567', 'AE')).toBe('+971501234567');
    expect(normalizeWhatsappPhone('9876 5432', 'KW')).toBe('+96598765432');
    expect(normalizeWhatsappPhone('3312 3456', 'QA')).toBe('+97433123456');
    expect(normalizeWhatsappPhone('966501234567', 'SA')).toBe('+966501234567');
  });

  it('accepts international forms, with or without a stray trunk zero', () => {
    expect(normalizeWhatsappPhone('+966 50 123 4567')).toBe('+966501234567');
    expect(normalizeWhatsappPhone('00966501234567')).toBe('+966501234567');
    expect(normalizeWhatsappPhone('+966 0501234567')).toBe('+966501234567');
    expect(normalizeWhatsappPhone('+971-50-123-4567', 'SA')).toBe('+971501234567');
    expect(normalizeWhatsappPhone('+44 7700 900123')).toBe('+447700900123');
  });

  it('reads Arabic-Indic digits as the digits they are', () => {
    expect(normalizeWhatsappPhone('٠٥٠١٢٣٤٥٦٧', 'SA')).toBe('+966501234567');
  });

  it('refuses garbage, landlines and guesses', () => {
    expect(normalizeWhatsappPhone('call me', 'SA')).toBeNull();
    expect(normalizeWhatsappPhone('05012', 'SA')).toBeNull();
    // A Riyadh landline: WhatsApp is a mobile service.
    expect(normalizeWhatsappPhone('0112345678', 'SA')).toBeNull();
    expect(normalizeWhatsappPhone('+96650123456789')).toBeNull();
    // A local number with no country to read it against is not guessed.
    expect(normalizeWhatsappPhone('0501234567')).toBeNull();
    expect(normalizeWhatsappPhone('0501234567', 'FR')).toBeNull();
    expect(normalizeWhatsappPhone('')).toBeNull();
  });

  it('is applied by the checkout contract, which also refuses consent without a number', () => {
    const base = { email: 'a@example.test', country: 'SA' };
    const parsed = checkoutStartSchema.parse({
      ...base,
      whatsappPhone: '0501234567',
      whatsappOptIn: true,
    });
    expect(parsed.whatsappPhone).toBe('+966501234567');
    expect(parsed.whatsappOptIn).toBe(true);

    expect(checkoutStartSchema.parse(base).whatsappOptIn).toBe(false);
    expect(checkoutStartSchema.parse({ ...base, whatsappPhone: '' }).whatsappPhone).toBeUndefined();
    expect(checkoutStartSchema.safeParse({ ...base, whatsappPhone: 'nope' }).success).toBe(false);
    expect(checkoutStartSchema.safeParse({ ...base, whatsappOptIn: true }).success).toBe(false);
  });

  it('keeps old settings rows parsing, with the channel off', () => {
    const settings = whatsappSettingsSchema.parse({});
    expect(settings.enabled).toBe(false);
    expect(settings.preferWhatsapp).toBe(false);
    expect(settings.cartRecovery).toEqual({ templateName: '', languageAr: 'ar', languageEn: 'en' });
    expect(whatsappSettingsSchema.parse({ enabled: true }).renewal.languageEn).toBe('en');
  });
});

describe('STOP keywords', () => {
  it('matches English and Arabic spellings, whatever the case or hamza', () => {
    for (const text of [
      'STOP',
      'stop',
      ' Stop. ',
      'Unsubscribe',
      'إيقاف',
      'ايقاف',
      'إلغاء',
      'الغاء',
      'إلغاء الاشتراك',
      'إِيقَاف',
      'ايـقاف',
    ]) {
      expect(isStopKeyword(text), text).toBe(true);
    }
  });

  it('does not treat a question that mentions stopping as a STOP', () => {
    for (const text of ["don't stop my licence", 'how do I stop auto-renew?', 'hello', '', null]) {
      expect(isStopKeyword(text), String(text)).toBe(false);
    }
  });
});

describe('webhook signature', () => {
  const secret = 'app-secret';
  const raw = Buffer.from('{"object":"whatsapp_business_account"}');
  const good = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

  it('accepts the HMAC of the raw bytes', () => {
    expect(verifyMetaSignature(raw, good, secret)).toBe(true);
    expect(verifyMetaSignature(raw, good.toUpperCase().replace('SHA256=', 'sha256='), secret)).toBe(
      true,
    );
  });

  it('refuses unsigned, malformed, wrong-secret and tampered requests', () => {
    expect(verifyMetaSignature(raw, undefined, secret)).toBe(false);
    expect(verifyMetaSignature(raw, 'sha256=abc', secret)).toBe(false);
    expect(verifyMetaSignature(raw, good.replace('sha256=', 'sha1='), secret)).toBe(false);
    expect(verifyMetaSignature(raw, good, 'other-secret')).toBe(false);
    expect(verifyMetaSignature(Buffer.from('{"object":"x"}'), good, secret)).toBe(false);
    expect(verifyMetaSignature(raw, good, '')).toBe(false);
  });
});

describe('channel selection', () => {
  const consented = {
    whatsappPhone: '+966501234567',
    whatsappOptInAt: at('2026-09-01T00:00:00Z'),
    whatsappOptOutAt: null,
  };
  const live = {
    whatsappEnabled: true,
    preferWhatsapp: true,
    configured: true,
    templateName: 'cart_reminder',
    customer: consented,
    emailAllowed: true,
    heldOut: false,
  };

  it('uses WhatsApp only when everything lines up', () => {
    expect(chooseDelivery(live)).toBe('whatsapp');
    expect(chooseDelivery({ ...live, preferWhatsapp: false })).toBe('email');
    expect(chooseDelivery({ ...live, whatsappEnabled: false })).toBe('email');
    expect(chooseDelivery({ ...live, configured: false })).toBe('email');
    expect(chooseDelivery({ ...live, templateName: '' })).toBe('email');
    expect(chooseDelivery({ ...live, customer: null })).toBe('email');
  });

  it('respects consent per channel, and a STOP after the opt-in', () => {
    const stopped = { ...consented, whatsappOptOutAt: at('2026-09-10T00:00:00Z') };
    expect(hasWhatsappConsent(stopped)).toBe(false);
    expect(chooseDelivery({ ...live, customer: stopped })).toBe('email');
    // Opted in again at a later checkout.
    expect(hasWhatsappConsent({ ...stopped, whatsappOptInAt: at('2026-09-20T00:00:00Z') })).toBe(
      true,
    );
    expect(hasWhatsappConsent({ ...consented, whatsappPhone: null })).toBe(false);
    // WhatsApp consent alone is enough for WhatsApp; neither channel means nothing.
    expect(chooseDelivery({ ...live, emailAllowed: false })).toBe('whatsapp');
    expect(chooseDelivery({ ...live, emailAllowed: false, customer: stopped })).toBe('none');
  });

  it('holds out whichever channel the step would have used, but not the unreachable', () => {
    expect(chooseDelivery({ ...live, heldOut: true })).toBe('held-out');
    expect(chooseDelivery({ ...live, preferWhatsapp: false, heldOut: true })).toBe('held-out');
    expect(chooseDelivery({ ...live, customer: null, emailAllowed: false, heldOut: true })).toBe(
      'none',
    );
  });
});

describe('Meta error codes', () => {
  it('names the ones that change what happens next', () => {
    expect(classifyMetaError(131050)).toBe('opted-out');
    expect(classifyMetaError(131047)).toBe('re-engagement');
    expect(classifyMetaError(131026)).toBe('undeliverable');
    expect(classifyMetaError(132001)).toBe('template-missing');
    expect(classifyMetaError(190)).toBe('auth');
    expect(classifyMetaError(130429)).toBe('rate-limited');
    expect(classifyMetaError(1)).toBe('other');
    expect(classifyMetaError(undefined)).toBe('other');
  });
});

describe('template parameters', () => {
  it('never sends an empty, multi-line or overlong parameter', () => {
    expect(templateParam('', 'there')).toBe('there');
    expect(templateParam('a\nb\t c     d', 'x')).toBe('a b c d');
    expect(templateParam('x'.repeat(300), 'x', 10)).toHaveLength(10);
  });

  it('builds the arity each approved template expects', () => {
    const cart = cartRecoveryParams({
      locale: 'en',
      firstName: null,
      productNames: ['Office 2021', 'Windows 11'],
      total: '$50.00',
      offer: { percent: 10, licenceNumber: 'L-1' },
    });
    expect(cart).toHaveLength(2);
    expect(cart[0]).toBe('there');
    expect(cart[1]).toContain('Office 2021 and 1 more ($50.00)');
    expect(cart[1]).toContain('discount licence L-1');

    const renewal = renewalParams({
      locale: 'ar',
      firstName: 'سارة',
      productName: 'Office 365',
      expiresOn: '1 أكتوبر 2026',
      offsetDays: -7,
    });
    expect(renewal).toEqual(['سارة', 'Office 365', 'انتهى في 1 أكتوبر 2026']);
  });

  it('sends only the path after the origin for a URL button', () => {
    expect(buttonSuffix(new URL('https://shop.test/en/cart?restore=abc.def'))).toBe(
      'en/cart?restore=abc.def',
    );
  });
});

// --- the service, against a fake database and a mocked Graph API ----------------

function fakePrisma() {
  const client = {
    notificationLog: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    customer: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    whatsappInbound: { create: vi.fn().mockResolvedValue({}) },
  };
  return { client, service: new WhatsappService({ client } as unknown as PrismaService) };
}

function graphReply(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('WhatsappService', () => {
  beforeEach(() => {
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'token');
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '123456');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends a template to the Graph API and logs the wamid', async () => {
    const fetchMock = graphReply(200, { messages: [{ id: 'wamid.1' }] });
    vi.stubGlobal('fetch', fetchMock);
    const { client, service } = fakePrisma();

    const result = await service.sendTemplate({
      to: '+966501234567',
      template: 'cart_reminder',
      language: 'ar',
      bodyParams: ['سارة', 'Office'],
      buttonUrlSuffix: 'cart?restore=x',
      log: { template: 'cart.recovery.1', locale: 'ar', customerId: 'c1' },
    });

    expect(result).toMatchObject({ ok: true, messageId: 'wamid.1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/123456/messages');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token');
    const sent = JSON.parse(init.body as string) as {
      to: string;
      template: { name: string; components: { type: string }[] };
    };
    expect(sent.to).toBe('966501234567');
    expect(sent.template.name).toBe('cart_reminder');
    expect(sent.template.components.map((c) => c.type)).toEqual(['body', 'button']);
    expect(client.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: 'WHATSAPP',
        providerMessageId: 'wamid.1',
        deliveryStatus: 'sent',
      }) as unknown,
    });
  });

  it('treats 131050 as a withdrawal of consent', async () => {
    vi.stubGlobal(
      'fetch',
      graphReply(400, { error: { code: 131050, message: 'User stopped marketing' } }),
    );
    const { client, service } = fakePrisma();

    const result = await service.sendTemplate({
      to: '+966501234567',
      template: 'cart_reminder',
      language: 'ar',
      bodyParams: [],
      log: { template: 'cart.recovery.1', locale: 'ar' },
    });

    expect(result).toMatchObject({ ok: false, errorCode: 131050, errorKind: 'opted-out' });
    expect(client.customer.updateMany).toHaveBeenCalledWith({
      where: { whatsappPhone: '+966501234567' },
      data: { whatsappOptInAt: null, whatsappOptOutAt: expect.any(Date) as unknown },
    });
  });

  it('reports a missing template without opting anybody out', async () => {
    vi.stubGlobal('fetch', graphReply(404, { error: { code: 132001, message: 'no template' } }));
    const { client, service } = fakePrisma();
    const result = await service.sendTemplate({
      to: '+966501234567',
      template: 'missing',
      language: 'ar',
      bodyParams: [],
      log: { template: 'renewal.reminder', locale: 'ar' },
    });
    expect(result.errorKind).toBe('template-missing');
    expect(client.customer.updateMany).not.toHaveBeenCalled();
  });

  it('does not call Meta when unconfigured', async () => {
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { service } = fakePrisma();
    expect(service.configured).toBe(false);
    const result = await service.sendText('+966501234567', 'hi', { template: 't', locale: 'ar' });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies a status callback once, however many times it arrives', async () => {
    const { client, service } = fakePrisma();
    const row = {
      id: 'log1',
      deliveryStatus: 'sent' as string | null,
      deliveredAt: null as Date | null,
      openedAt: null as Date | null,
      bouncedAt: null as Date | null,
    };
    client.notificationLog.findUnique.mockImplementation(() => Promise.resolve({ ...row }));
    client.notificationLog.update.mockImplementation(({ data }: { data: Partial<typeof row> }) => {
      Object.assign(row, data);
      return Promise.resolve({});
    });

    const delivered = { id: 'wamid.1', status: 'delivered', timestamp: '1790000000' };
    expect(await service.applyStatus(delivered)).toBe(true);
    expect(await service.applyStatus(delivered)).toBe(false);
    expect(client.notificationLog.update).toHaveBeenCalledTimes(1);
    expect(row.deliveryStatus).toBe('delivered');

    // Read, then a late "delivered": the status never moves backwards.
    expect(await service.applyStatus({ id: 'wamid.1', status: 'read' })).toBe(true);
    expect(await service.applyStatus(delivered)).toBe(false);
    expect(row.deliveryStatus).toBe('read');
    expect(row.openedAt).toBeInstanceOf(Date);
  });

  it('opts out on a failed status carrying 131050', async () => {
    const { client, service } = fakePrisma();
    client.notificationLog.findUnique.mockResolvedValue({
      id: 'log1',
      deliveryStatus: 'sent',
      deliveredAt: null,
      openedAt: null,
      bouncedAt: null,
    });
    await service.applyStatus({
      id: 'wamid.1',
      status: 'failed',
      recipient_id: '966501234567',
      errors: [{ code: 131050, title: 'stopped' }],
    });
    expect(client.customer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { whatsappPhone: '+966501234567' } }),
    );
  });

  it('handles an inbound STOP once and confirms once', async () => {
    const fetchMock = graphReply(200, { messages: [{ id: 'wamid.reply' }] });
    vi.stubGlobal('fetch', fetchMock);
    const { client, service } = fakePrisma();
    const stop = {
      id: 'wamid.in',
      from: '966501234567',
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'text',
      text: { body: 'إيقاف' },
    };

    expect(await service.handleInbound(stop)).toBe(true);
    expect(client.customer.updateMany).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const reply = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as {
      type: string;
    };
    expect(reply.type).toBe('text');

    // Meta redelivers: the id is already recorded, so nothing happens again.
    client.whatsappInbound.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    expect(await service.handleInbound(stop)).toBe(false);
    expect(client.customer.updateMany).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opts out on a quick-reply button, and ignores other messages', async () => {
    vi.stubGlobal('fetch', graphReply(200, { messages: [{ id: 'wamid.reply' }] }));
    const { client, service } = fakePrisma();
    await service.handleInbound({
      id: 'wamid.btn',
      from: '971501234567',
      type: 'button',
      button: { payload: 'STOP', text: 'Stop promotions' },
    });
    expect(client.customer.updateMany).toHaveBeenCalledTimes(1);

    await service.handleInbound({
      id: 'wamid.q',
      from: '971501234567',
      type: 'text',
      text: { body: 'Where is my key?' },
    });
    expect(client.customer.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('statusPatch', () => {
  it('marks a failure once, with its reason', () => {
    const row = { deliveryStatus: 'sent', deliveredAt: null, openedAt: null, bouncedAt: null };
    const now = at('2026-09-23T10:00:00Z');
    expect(statusPatch(row, 'failed', now, '131026: undeliverable')).toEqual({
      deliveryStatus: 'failed',
      bouncedAt: now,
      error: '131026: undeliverable',
    });
    expect(
      statusPatch({ ...row, deliveryStatus: 'failed', bouncedAt: now }, 'failed', now),
    ).toBeNull();
  });
});
