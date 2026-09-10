import type { CatalogVariant, DisplayPrice } from '@da/contracts';

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

export function formatLicensePeriod(variant: CatalogVariant, locale: string): string {
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

/** The delivery promise, stated in the units a buyer thinks in. */
export function formatDelivery(seconds: number, locale: string): string {
  const ar = locale === 'ar';
  if (seconds <= 120) return ar ? 'تسليم فوري' : 'Instant delivery';
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return ar ? `خلال ${String(minutes)} دقيقة` : `Within ${String(minutes)} minutes`;
  }
  const hours = Math.round(seconds / 3600);
  if (ar) return hours === 1 ? 'خلال ساعة' : `خلال ${String(hours)} ساعات`;
  return hours === 1 ? 'Within an hour' : `Within ${String(hours)} hours`;
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

/** Short label for a variant picker button. */
export function variantLabel(variant: CatalogVariant, locale: string): string {
  return `${formatLicensePeriod(variant, locale)} · ${formatDevices(variant.deviceCount, locale)}`;
}
