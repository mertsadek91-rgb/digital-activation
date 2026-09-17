import { Injectable, Logger } from '@nestjs/common';

import {
  type AppLocale,
  type I18nString,
  type ManualPaymentProvider,
  type ManualPaymentSetting,
  type PaymentInstructions,
  type PaymentMethodStatus,
  type PaymentProvider,
  type PaymentSettings,
  type PaymentSettingsView,
  PAYMENT_SETTINGS_KEY,
  paymentSettingsSchema,
} from '@da/contracts';

import { AuditService } from '../auth/audit.service.js';
import { say } from '../common/panel-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { StripeService } from './stripe.service.js';

/**
 * Bank transfer and crypto, as the owner maintains them.
 *
 * The store shipped with a hardcoded Arabic sentence telling the customer to
 * "transfer the amount and attach proof" and no account number under it,
 * because inventing an IBAN was not something code could do. This is the other
 * half of that decision: the details are content, they are entered once in the
 * panel, and until they exist the method is not offered. A method offered with
 * nothing to transfer to is a customer who cannot pay and does not know why.
 *
 * They live in the existing key/value `Setting` table rather than in a model of
 * their own. Two small objects read on every checkout draft do not earn a
 * table, migrations, or a second place to look for them.
 */
@Injectable()
export class PaymentSettingsService {
  private readonly logger = new Logger(PaymentSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The stored settings, or empty ones.
   *
   * A row that does not parse is treated as absent and logged, never patched
   * up. This is money-routing information: half-read details are how a transfer
   * goes to an account that was replaced two shapes ago, and an empty payment
   * step is a support email rather than a lost payment.
   */
  async read(): Promise<PaymentSettings> {
    const row = await this.prisma.client.setting.findUnique({
      where: { key: PAYMENT_SETTINGS_KEY },
    });
    if (!row) return emptySettings();

    const parsed = paymentSettingsSchema.safeParse(row.value);
    if (!parsed.success) {
      this.logger.error(
        `Setting ${PAYMENT_SETTINGS_KEY} does not match its contract; no manual method will be offered.`,
      );
      return emptySettings();
    }
    return parsed.data;
  }

  async view(): Promise<PaymentSettingsView> {
    const settings = await this.read();
    return { settings, methods: this.statuses(settings) };
  }

  /**
   * Replaces the settings wholesale, and records who did it.
   *
   * The audit row carries the before and the after. Changing where customer
   * money is sent is exactly the action that has to be attributable later, and
   * the account number is not a secret — it is printed on the checkout page —
   * so there is nothing here that the log should be redacting.
   */
  async write(
    next: PaymentSettings,
    actor: { staffId: string; ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<PaymentSettingsView> {
    const before = await this.read();
    const settings = normalise(next);

    await this.prisma.client.setting.upsert({
      where: { key: PAYMENT_SETTINGS_KEY },
      update: { value: settings },
      create: { key: PAYMENT_SETTINGS_KEY, value: settings },
    });

    await this.audit.record({
      actorId: actor.staffId,
      entity: 'Setting',
      entityId: PAYMENT_SETTINGS_KEY,
      action: 'payment.settings.update',
      before,
      after: settings,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { settings, methods: this.statuses(settings) };
  }

  /** The providers a shopper may start right now. */
  async offeredProviders(): Promise<PaymentProvider[]> {
    const settings = await this.read();
    return this.statuses(settings)
      .filter((status) => status.isOffered)
      .map((status) => status.provider);
  }

  /**
   * The instructions for one manual method, in the shopper's language.
   *
   * Null when the method is not ready, so every caller has to decide what to do
   * about that rather than rendering an empty panel by accident.
   */
  async instructionsFor(
    provider: ManualPaymentProvider,
    locale: AppLocale,
  ): Promise<PaymentInstructions | null> {
    const method = (await this.read())[provider];
    const fields = usableFields(method);
    if (!method.isEnabled || fields.length === 0) return null;

    return {
      headline: localised(method.headline, locale),
      fields: fields.map((field) => ({
        label: localised(field.label, locale),
        value: field.value.trim(),
        copyable: field.copyable,
      })),
      afterPaying: localised(method.afterPaying, locale),
    };
  }

  private statuses(settings: PaymentSettings): PaymentMethodStatus[] {
    return [
      {
        provider: 'STRIPE',
        isOffered: this.stripe.payable,
        warning: null,
        // Named separately because the two keys fail differently and the fix
        // is different: without the secret nothing can open a payment, without
        // the publishable key the browser has nothing to confirm one with.
        blocker: this.stripe.payable
          ? null
          : this.stripe.configured
            ? say(
                'STRIPE_PUBLISHABLE_KEY غير مضبوط، فلا شيء يؤكّد الدفع في المتصفّح.',
                'STRIPE_PUBLISHABLE_KEY is not set, so nothing confirms the payment in the browser.',
              )
            : say(
                'مفاتيح Stripe غير مضبوطة على الخادم.',
                'The Stripe keys are not set on the server.',
              ),
      },
      {
        provider: 'PAYPAL',
        isOffered: false,
        warning: null,
        // Stated rather than hidden: PayPal is an agreed provider that is not
        // wired, and a blank row would read as a bug in this screen.
        blocker: say('PayPal لم يُربط بعد.', 'PayPal is not wired up yet.'),
      },
      ...manualProviders.map((provider) => this.manualStatus(provider, settings[provider])),
    ];
  }

  private manualStatus(
    provider: ManualPaymentProvider,
    method: ManualPaymentSetting,
  ): PaymentMethodStatus {
    const fields = usableFields(method);

    if (fields.length === 0) {
      return {
        provider,
        isOffered: false,
        blocker:
          provider === 'BANK_TRANSFER'
            ? say(
                'لا يوجد حقل مكتمل: التحويل يحتاج اسماً ورقم حساب أو آيبان.',
                'No field is filled in: a transfer needs a name and an account number or IBAN.',
              )
            : say(
                'لا يوجد حقل مكتمل: التحويل يحتاج شبكة وعنوان محفظة.',
                'No field is filled in: a transfer needs a network and a wallet address.',
              ),
        warning: null,
      };
    }
    if (!method.isEnabled) {
      return {
        provider,
        isOffered: false,
        blocker: say(
          'البيانات مكتملة لكن الطريقة موقوفة.',
          'The details are complete but the method is switched off.',
        ),
        warning: null,
      };
    }
    return {
      provider,
      isOffered: true,
      blocker: null,
      warning: this.wordless(method) ?? this.thinness(provider, fields),
    };
  }

  /**
   * An offered method whose two prose fields say nothing.
   *
   * These are the only sentences in the instructions email. With them empty —
   * or filled with a field label, which is what happened the first time this
   * store was configured — the message that goes out is an account number, a
   * large figure and a button, and nothing else. That is the shape of a
   * payment-redirection fraud, and it was filed as spam by the first inbox it
   * reached, while a plain test message from the same mailbox, the same domain
   * and the same SPF and DKIM landed in that inbox minutes later.
   *
   * A label repeated as a headline is the specific mistake worth naming,
   * because it does not look empty in the panel: every box has something in
   * it. The check is a comparison against the labels the owner themselves
   * typed, so it needs no dictionary and no guess about wording.
   */
  private wordless(method: ManualPaymentSetting): string | null {
    const labels = new Set(
      method.fields.flatMap((field) => [field.label.ar.trim(), field.label.en.trim()]).filter(Boolean),
    );
    const isProse = (text: I18nString): boolean => {
      const value = (text.ar.trim() || text.en.trim()).trim();
      return value !== '' && !labels.has(value);
    };

    const missing: string[] = [];
    if (!isProse(method.headline)) missing.push(say('السطر التمهيدي', 'the opening line'));
    if (!isProse(method.afterPaying)) missing.push(say('ماذا بعد التحويل', 'what happens next'));
    if (missing.length === 0) return null;

    return say(
      `${missing.join(' و')} فارغ أو يكرّر تسمية حقل. الرسالة التي تصل المشتري ستكون رقم حساب ومبلغاً بلا جملة واحدة تشرحهما، وهذا يُصنَّف بريداً مزعجاً.`,
      `${missing.join(' and ')} is empty or repeats a field label. The email the buyer receives will be an account number and an amount with not one sentence explaining them, which gets filed as spam.`,
    );
  }

  /**
   * An offered method that is probably not enough to pay with.
   *
   * Counted rather than parsed. Guessing which field is the beneficiary name by
   * reading its label would mean matching Arabic and English wordings against a
   * list, and being wrong about it in either direction — refusing a correct
   * setup, or passing an incomplete one — is worse than saying plainly what a
   * transfer usually needs and letting the owner judge.
   */
  private thinness(
    provider: ManualPaymentProvider,
    fields: ManualPaymentSetting['fields'],
  ): string | null {
    if (provider === 'BANK_TRANSFER' && fields.length < 3) {
      return say(
        'التحويل معروض بحقل أو حقلين. أكثر البنوك تطلب اسم صاحب الحساب واسم البنك إلى جانب الآيبان، وترفض الحوالة إن لم يطابق الاسم.',
        'The transfer is offered with only one or two fields. Most banks want the account holder and the bank name beside the IBAN, and refuse the transfer when the name does not match.',
      );
    }
    if (provider === 'CRYPTO' && fields.length < 2) {
      return say(
        'العنوان وحده لا يكفي: أضِف الشبكة (مثل TRC-20)، فالإرسال على الشبكة الخطأ يضيّع المبلغ.',
        'The address alone is not enough: add the network (TRC-20, say), because sending on the wrong network loses the money.',
      );
    }
    return null;
  }
}

const manualProviders: ManualPaymentProvider[] = ['BANK_TRANSFER', 'CRYPTO'];

/**
 * A field counts only when it has both a value and something to call it.
 *
 * A bare number with no label is not instructions — the customer cannot tell an
 * IBAN from a swift code from an account number by looking at it, and the one
 * they pick wrong is the one that loses the money.
 */
function usableFields(method: ManualPaymentSetting): ManualPaymentSetting['fields'] {
  return method.fields.filter(
    (field) =>
      field.value.trim() !== '' && (field.label.ar.trim() !== '' || field.label.en.trim() !== ''),
  );
}

/**
 * The shopper's language, falling back to the other one.
 *
 * The same rule the order page already applies to activation steps: a store
 * that has written its bank details in Arabic only should still show them to an
 * English shopper rather than showing them nothing.
 */
function localised(text: I18nString, locale: AppLocale): string {
  const wanted = text[locale].trim();
  if (wanted !== '') return wanted;
  return (locale === 'ar' ? text.en : text.ar).trim();
}

/** Trims everything on the way in, so a trailing space cannot hide a blank. */
function normalise(settings: PaymentSettings): PaymentSettings {
  return {
    BANK_TRANSFER: normaliseMethod(settings.BANK_TRANSFER),
    CRYPTO: normaliseMethod(settings.CRYPTO),
  };
}

function normaliseMethod(method: ManualPaymentSetting): ManualPaymentSetting {
  return {
    isEnabled: method.isEnabled,
    headline: trimmed(method.headline),
    afterPaying: trimmed(method.afterPaying),
    // A row somebody added and left blank is dropped rather than stored, so the
    // panel does not accumulate empties nobody remembers the purpose of.
    fields: method.fields
      .filter(
        (field) =>
          field.value.trim() !== '' || field.label.ar.trim() !== '' || field.label.en.trim() !== '',
      )
      .map((field) => ({
        label: trimmed(field.label),
        value: field.value.trim(),
        copyable: field.copyable,
      })),
  };
}

function trimmed(text: I18nString): I18nString {
  return { ar: text.ar.trim(), en: text.en.trim() };
}

function emptyMethod(): ManualPaymentSetting {
  return {
    isEnabled: false,
    headline: { ar: '', en: '' },
    afterPaying: { ar: '', en: '' },
    fields: [],
  };
}

function emptySettings(): PaymentSettings {
  return { BANK_TRANSFER: emptyMethod(), CRYPTO: emptyMethod() };
}
