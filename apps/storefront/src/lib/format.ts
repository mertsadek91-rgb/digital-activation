import type { CatalogVariant, DisplayPrice, FulfillmentMode, Order } from '@da/contracts';

/** The part of a variant that describes its term. A cart line carries it too. */
type LicenceTerm = Pick<CatalogVariant, 'licensePeriodValue' | 'licensePeriodUnit'>;

/**
 * Presentation helpers.
 *
 * Prices render with Latin digits in both locales — that is how Gulf commerce
 * writes them, and mixing digit systems in one page reads as a rendering fault
 * rather than a localisation.
 */
export function formatPrice(price: Pick<DisplayPrice, 'amount' | 'currency'>): string {
  const amount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: price.currency,
    currencyDisplay: 'narrowSymbol',
    numberingSystem: 'latn',
  }).format(Number(price.amount));
  return amount;
}

const PERIOD_AR: Record<string, [string, string, string]> = {
  // [singular, dual, plural] — Arabic needs all three, and getting this wrong
  // is immediately visible: "3 سنة" instead of "3 سنوات".
  DAY: ['يوم', 'يومان', 'أيام'],
  MONTH: ['شهر', 'شهران', 'أشهر'],
  YEAR: ['سنة', 'سنتان', 'سنوات'],
};

const PERIOD_EN: Record<string, [string, string]> = {
  DAY: ['day', 'days'],
  MONTH: ['month', 'months'],
  YEAR: ['year', 'years'],
};

/**
 * The licence term in words.
 *
 * Takes only the two fields it reads, not a whole variant. A cart line carries
 * the same two and nothing else, and there is no reason for the cart to be
 * unable to describe its own contents.
 */
export function formatLicensePeriod(variant: LicenceTerm, locale: string): string {
  if (variant.licensePeriodUnit === 'LIFETIME') {
    return locale === 'ar' ? 'مدى الحياة' : 'Lifetime';
  }

  const value = variant.licensePeriodValue ?? 1;

  if (locale === 'ar') {
    const forms = PERIOD_AR[variant.licensePeriodUnit];
    if (!forms) return String(value);
    if (value === 1) return forms[0];
    if (value === 2) return forms[1];
    return `${String(value)} ${forms[2]}`;
  }

  const forms = PERIOD_EN[variant.licensePeriodUnit];
  if (!forms) return String(value);
  return `${String(value)} ${value === 1 ? forms[0] : forms[1]}`;
}

export function formatDevices(count: number, locale: string): string {
  if (count === 0) return locale === 'ar' ? 'غير محدود' : 'Unlimited';
  if (locale === 'ar') {
    if (count === 1) return 'جهاز واحد';
    if (count === 2) return 'جهازان';
    return `${String(count)} أجهزة`;
  }
  return count === 1 ? '1 device' : `${String(count)} devices`;
}

/**
 * The delivery promise, stated in the units a buyer thinks in.
 *
 * "Instant" is reserved for a key that is already held. Most of this catalog
 * is bought from a supplier after the order arrives, and calling that instant
 * would be a promise the store cannot keep — so a made-to-order line states
 * the window and says it starts from the moment of purchase, which is the
 * thing the buyer actually wants to know.
 */
export function formatDelivery(
  seconds: number,
  locale: string,
  mode: FulfillmentMode = 'FROM_STOCK',
): string {
  const ar = locale === 'ar';
  const fromStock = mode === 'FROM_STOCK';

  if (seconds <= 120) {
    if (fromStock) return ar ? 'تسليم فوري' : 'Instant delivery';
    // The supplier is fast, but a person still places the order.
    return ar ? 'تسليم سريع بعد الشراء' : 'Fast delivery after purchase';
  }

  const window =
    seconds < 3600
      ? ar
        ? `${String(Math.round(seconds / 60))} دقيقة`
        : `${String(Math.round(seconds / 60))} minutes`
      : (() => {
          const hours = Math.round(seconds / 3600);
          if (ar) return hours === 1 ? 'ساعة' : `${String(hours)} ساعات`;
          return hours === 1 ? 'an hour' : `${String(hours)} hours`;
        })();

  if (fromStock) return ar ? `خلال ${window}` : `Within ${window}`;
  return ar ? `خلال ${window} من إتمام الشراء` : `Within ${window} of purchase`;
}

/**
 * How the store describes the way a line is supplied.
 *
 * `inStock` is not decoration. The three variants this shop sells most —
 * Windows 11 Pro, Windows 10 Pro, Office 2021 — are the ones kept in stock,
 * and when the shelf is empty the page said "متوفّر لدينا — يُسلَّم فوراً"
 * two lines above a buy box saying "غير متوفر حالياً". A specification table
 * that contradicts the button beside it is worse than a missing row: the
 * shopper has to decide which half of the page to believe.
 *
 * It is optional because the cart calls this about a line already held, where
 * availability is settled and the mode is all there is to say.
 *
 * None of these strings says "supplier". Where the shop buys from is the
 * shop's business, and a buyer told their key is "being ordered from the
 * supplier" learns two things they did not ask about — that the shop does not
 * hold it, and that somebody else does — in place of the one thing they want,
 * which is when it arrives. The waiting state is "قيد التجهيز", being
 * prepared. The comments in this file still say supplier, because why a line
 * is bought after the sale rather than before it is something the next person
 * editing this code has to understand; the rule is about the strings.
 */
export function formatFulfillment(
  mode: FulfillmentMode,
  locale: string,
  inStock?: boolean,
): string {
  const ar = locale === 'ar';
  switch (mode) {
    case 'FROM_STOCK':
      if (inStock === false) {
        return ar
          ? 'من مخزوننا — نفد حالياً، ويعود قريباً'
          : 'From our own stock — none left right now';
      }
      return ar ? 'متوفّر لدينا — يُسلَّم فوراً' : 'Held in stock — delivered immediately';
    case 'ON_DEMAND':
      return ar
        ? 'يُجهَّز بعد الشراء، حتى لا تبدأ مدّة الترخيص قبل أن تستخدمه'
        : 'Prepared after purchase, so the licence term does not start before you use it';
    case 'MANUAL_SETUP':
      return ar
        ? 'يُجهَّز يدوياً على بياناتك بعد الشراء'
        : 'Prepared by hand against your own details after purchase';
  }
}

const ACTIVATION_AR: Record<string, string> = {
  RETAIL_ONLINE: 'تفعيل أونلاين',
  RETAIL_PHONE: 'تفعيل عبر الهاتف',
  VOLUME_MAK: 'مفتاح MAK — تفعيل عبر الهاتف',
  KMS: 'تفعيل KMS',
  BIND_MICROSOFT_ACCOUNT: 'مرتبط بحساب مايكروسوفت',
  REDEEM_CODE: 'كود استبدال',
  ACCOUNT_CREDENTIALS: 'حساب جاهز',
  PANEL_INVITE: 'دعوة عبر بانل',
  CAL_KEY: 'مفتاح CAL',
  NOT_APPLICABLE: 'خدمة — لا يحتاج تفعيلاً',
};

const ACTIVATION_EN: Record<string, string> = {
  RETAIL_ONLINE: 'Online activation',
  RETAIL_PHONE: 'Phone activation',
  VOLUME_MAK: 'MAK key — phone activation',
  KMS: 'KMS activation',
  BIND_MICROSOFT_ACCOUNT: 'Bound to a Microsoft account',
  REDEEM_CODE: 'Redeem code',
  ACCOUNT_CREDENTIALS: 'Ready-made account',
  PANEL_INVITE: 'Panel invitation',
  CAL_KEY: 'CAL key',
  NOT_APPLICABLE: 'Service — nothing to activate',
};

export function formatActivation(method: string, locale: string): string {
  const table = locale === 'ar' ? ACTIVATION_AR : ACTIVATION_EN;
  return table[method] ?? method;
}

/*
 * Order wording.
 *
 * Moved here from the order confirmation page when the account area grew an
 * order list, because the two pages show the same order and a customer who
 * reads "قيد التجهيز" on one and something else on the other reads it
 * as two different things happening.
 */
const STATUS_AR: Record<string, string> = {
  PENDING_PAYMENT: 'في انتظار الدفع',
  PAYMENT_REVIEW: 'قيد المراجعة',
  PAID: 'مدفوع',
  FULFILLING: 'قيد التجهيز',
  FULFILLED: 'تم التجهيز',
  COMPLETED: 'مكتمل',
  CANCELLED: 'ملغى',
  REFUNDED: 'مُسترَد',
  PARTIALLY_REFUNDED: 'مُسترَد جزئياً',
  FAILED: 'فشل',
};

const STATE_AR: Record<string, string> = {
  PENDING: 'في الانتظار',
  AUTO_ASSIGNED: 'تم تخصيص المفتاح',
  MANUAL_QUEUE: 'قيد التجهيز',
  DELIVERED: 'تم التسليم',
  FAILED: 'تعذّر — فريقنا يتابعه',
};

const STATE_EN: Record<string, string> = {
  PENDING: 'Pending',
  AUTO_ASSIGNED: 'Key assigned',
  MANUAL_QUEUE: 'Being prepared',
  DELIVERED: 'Delivered',
  FAILED: 'Failed — our team is on it',
};

/**
 * The same statuses in English.
 *
 * Both pages printed the enum with its underscores removed, so an English
 * customer was told their order was `PENDING PAYMENT` — the database's word
 * for it, in capitals, which reads as a fault rather than as "we are waiting
 * for your transfer". These are the Arabic meanings, not new promises: each
 * one says the same thing its Arabic counterpart above says.
 */
const STATUS_EN: Record<string, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  PAYMENT_REVIEW: 'Payment under review',
  PAID: 'Paid',
  FULFILLING: 'Being prepared',
  FULFILLED: 'Prepared',
  COMPLETED: 'Complete',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially refunded',
  FAILED: 'Failed',
};

export function formatOrderStatus(status: Order['status'], locale: string): string {
  if (locale === 'ar') return STATUS_AR[status] ?? status;
  // Falls back to the enum without its underscores for a status nobody has
  // translated yet: a word in capitals is poor, and a blank is worse.
  return STATUS_EN[status] ?? status.replace(/_/g, ' ');
}

/** Where one line of an order has got to. */
export function formatLineState(
  state: Order['lines'][number]['fulfillmentState'],
  locale: string,
): string {
  const table = locale === 'ar' ? STATE_AR : STATE_EN;
  return table[state] ?? state;
}

/** Short label for a variant picker button, or for a cart line. */
export function variantLabel(
  variant: LicenceTerm & { deviceCount: number },
  locale: string,
): string {
  return `${formatLicensePeriod(variant, locale)} · ${formatDevices(variant.deviceCount, locale)}`;
}

/**
 * A publication date, in the reader's own calendar convention.
 *
 * Gregorian in both languages with Latin digits, which is what the store this
 * replaces prints and what a reader comparing two posts needs: `ar-SA` would
 * give Hijri dates that do not line up with the Gregorian ones in the article
 * bodies, and Eastern Arabic numerals that no other number on this site uses.
 */
export function formatArticleDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ar', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    calendar: 'gregory',
    numberingSystem: 'latn',
  }).format(date);
}

/** "٥ دقائق قراءة" — the plural rules Arabic needs, not a bare number. */
export function readingLabel(minutes: number, locale: string): string {
  if (locale === 'en') return `${String(minutes)} min read`;
  if (minutes === 1) return 'دقيقة قراءة';
  if (minutes === 2) return 'دقيقتا قراءة';
  if (minutes <= 10) return `${String(minutes)} دقائق قراءة`;
  return `${String(minutes)} دقيقة قراءة`;
}
