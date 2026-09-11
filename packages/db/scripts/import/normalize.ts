/**
 * Normalisation tables for the WordPress import.
 *
 * The legacy catalog stored licence terms as free text in ACF fields, and after
 * two years of editing by hand the same fact is written many ways:
 *
 *   license_period   "سنة كاملة" · "سنة واحدة" · "سنة واحد" · "12 شهر"
 *                    · "سنة كاملة (12 شهر)"   — five spellings of one year
 *   no_of_devices    "جهاز واحد" · "جهاز واحد PC" · "جهاز واحدجهاز واحد"
 *                    · "جهازين" vs "2 أجهزة"  — and one duplicated string
 *   languages        eleven spellings of three concepts, two misspelled
 *
 * Nothing can be filtered, compared or grouped on values like that, which is
 * why the new schema uses enums and integers. These tables are where the
 * translation happens.
 *
 * The rule throughout: an unrecognised value is REPORTED, never defaulted.
 * A silent default here would bake a wrong licence term into a product page,
 * and the customer would find out after paying.
 */
import {
  ActivationMethod,
  type FulfillmentMode,
  LicensePeriodUnit,
  Platform,
  ProductKind,
} from '../../src/index.js';

export interface LicensePeriod {
  value: number | null;
  unit: LicensePeriodUnit;
}

/** Exact-match table. Keys are the legacy strings, trimmed. */
export const LICENSE_PERIOD: Record<string, LicensePeriod> = {
  'مدى الحياة': { value: null, unit: LicensePeriodUnit.LIFETIME },
  'ترخيص مدى الحياة — بدون رسوم تجديد': { value: null, unit: LicensePeriodUnit.LIFETIME },
  'سنة كاملة': { value: 1, unit: LicensePeriodUnit.YEAR },
  'سنة واحدة': { value: 1, unit: LicensePeriodUnit.YEAR },
  'سنة واحد': { value: 1, unit: LicensePeriodUnit.YEAR },
  'سنة كاملة (12 شهر)': { value: 1, unit: LicensePeriodUnit.YEAR },
  '12 شهر': { value: 1, unit: LicensePeriodUnit.YEAR },
  'سنتان (24 شهر)': { value: 2, unit: LicensePeriodUnit.YEAR },
  '3 سنوات': { value: 3, unit: LicensePeriodUnit.YEAR },
  '3 سنوات (36 شهر)': { value: 3, unit: LicensePeriodUnit.YEAR },
  '5 سنوات': { value: 5, unit: LicensePeriodUnit.YEAR },
  '1 شهر': { value: 1, unit: LicensePeriodUnit.MONTH },
  '3 أشهر': { value: 3, unit: LicensePeriodUnit.MONTH },
  '6 أشهر': { value: 6, unit: LicensePeriodUnit.MONTH },
  '15 يوم': { value: 15, unit: LicensePeriodUnit.DAY },
};

export interface DeviceSpec {
  /** 0 means unlimited. */
  count: number;
  platform?: Platform;
}

export const DEVICE_COUNT: Record<string, DeviceSpec> = {
  'جهاز واحد': { count: 1 },
  'جهاز واحد PC': { count: 1 },
  'جهاز Windows واحد': { count: 1 },
  // A real duplicated-text value in the legacy data.
  'جهاز واحدجهاز واحد': { count: 1 },
  'جهاز واحد (PC أو Mac)': { count: 1, platform: Platform.CROSS_PLATFORM },
  'جهاز واحد (Windows/Linux)': { count: 1, platform: Platform.CROSS_PLATFORM },
  'جهاز Mac واحد': { count: 1, platform: Platform.MAC },
  'موقع انترنت واحد': { count: 1 },
  جهازين: { count: 2 },
  '2 أجهزة': { count: 2 },
  '3 أجهزة': { count: 3 },
  '5 أجهزة': { count: 5 },
  '10 أجهزة': { count: 10 },
  '10': { count: 10 },
  '25 جهاز': { count: 25 },
  '50 جهاز/مستخدم (CAL)': { count: 50 },
  'غير محدود': { count: 0 },
  'غير محدود (حساب برو)': { count: 0 },
  'غير محدود (حساب Edu)': { count: 0 },
  'جهازان PC': { count: 2 },
  '1': { count: 1 },
  '50 Device CAL': { count: 50 },
  '50 User CAL': { count: 50 },
  'جهاز واحد يعمل على اجهزة الماك': { count: 1, platform: Platform.MAC },
};

export const ACTIVATION_METHOD: Record<string, ActivationMethod> = {
  'كود تفعيل سيريال': ActivationMethod.RETAIL_ONLINE,
  'كود تفعيل أصلي': ActivationMethod.RETAIL_ONLINE,
  'كود تفعيل': ActivationMethod.RETAIL_ONLINE,
  'كود تفعيل أونلاين': ActivationMethod.RETAIL_ONLINE,
  'مفتاح تفعيل': ActivationMethod.RETAIL_ONLINE,
  'تفعيل أونلاين تلقائي': ActivationMethod.RETAIL_ONLINE,
  'مفتاح تفعيل مباشر من البرنامج': ActivationMethod.RETAIL_ONLINE,
  'كود تفعيل للأعمال': ActivationMethod.RETAIL_ONLINE,
  'كود تفعيل CAL أصلي': ActivationMethod.CAL_KEY,
  'Bind Key - مرتبط بحساب مايكروسوفت': ActivationMethod.BIND_MICROSOFT_ACCOUNT,
  'بانل تفعيل احترافي (Bind Key Panel)': ActivationMethod.PANEL_INVITE,
  // Phone activation is called out separately because it generates support
  // tickets that online activation does not — a real operational difference.
  'MAK Key - تفعيل عبر الهاتف (Phone Activation)': ActivationMethod.VOLUME_MAK,
  'كود تفعيل عبر الهاتف': ActivationMethod.RETAIL_PHONE,
  'تفعيل يدوي (Manual Activation)': ActivationMethod.RETAIL_PHONE,
  'يتم التفعيل على الايميل الخاص بكم': ActivationMethod.REDEEM_CODE,
  'يتم التفعيل على الايميل الذي تم تزويدنا به': ActivationMethod.REDEEM_CODE,
  'اشتراك على أصلي من شركة أدوبي': ActivationMethod.REDEEM_CODE,
  'حساب جاهز (Email+Password) + Key + بانل': ActivationMethod.ACCOUNT_CREDENTIALS,
  'أشتراك جاهز للأستخدام عن طريق اسم مستخدم وكلمة مرور': ActivationMethod.ACCOUNT_CREDENTIALS,
  'ملفات json يمكن تشغيلها بشكل مباشر على جهازك': ActivationMethod.REDEEM_CODE,
  'عن طريق مفتاح تفعيل': ActivationMethod.RETAIL_ONLINE,
  'كود تفعيل مرتبط بحساب مايكروسوفت': ActivationMethod.BIND_MICROSOFT_ACCOUNT,
  'يتم تفعيل الاضافة على الموقع مباشرة': ActivationMethod.PANEL_INVITE,
  'دعوة لحساب Canva Pro': ActivationMethod.PANEL_INVITE,
  'حساب Canva Edu جاهز': ActivationMethod.ACCOUNT_CREDENTIALS,
  'كود تفعيل أصلي 100%': ActivationMethod.RETAIL_ONLINE,
  'اشتراك بالخدمة': ActivationMethod.NOT_APPLICABLE,
};

/**
 * The title is more precise than the field.
 *
 * Two Office 2016 rows carry the same `activation_method` — "كود تفعيل سيريال"
 * — while their titles say Phone Activation and Online Activation, and they are
 * priced $9.95 and $44.45 apart. The field was filled in by habit; the title is
 * what the customer reads and what actually distinguishes the products. So the
 * title wins where it is explicit.
 */
const TITLE_ACTIVATION: [RegExp, ActivationMethod][] = [
  [/redeem\s*code/i, ActivationMethod.REDEEM_CODE],
  [/phone\s*activation|تفعيل بالهاتف|عبر الهاتف/i, ActivationMethod.RETAIL_PHONE],
  [/manual\s*(activation)?|يدوي/i, ActivationMethod.RETAIL_PHONE],
  [/online\s*activation/i, ActivationMethod.RETAIL_ONLINE],
];

export function refineActivationFromTitle(
  title: string,
  fromField: ActivationMethod,
): ActivationMethod {
  for (const [pattern, method] of TITLE_ACTIVATION) {
    if (pattern.test(title)) return method;
  }
  return fromField;
}

/**
 * Delivery promise, in seconds. "تسليم فوري" is taken at its word only where
 * the product can actually be auto-fulfilled from the vault; the six-hour and
 * three-hour values are the store's own honest windows and are kept as such.
 */
export const DELIVERY_SLA_SECONDS: Record<string, number> = {
  'تسليم فوري عبر البريد الإلكتروني': 60,
  'تسليم فوري كود تفعيل عن طريق الإيميل': 60,
  'تسليم فوري لبيانات البانل عبر البريد الإلكتروني': 60,
  'يتم التسليم بشكل فوري عن طريق الايميل': 60,
  'عن طريق الايميل': 60,
  'يتم التسليم خلال 15 دقيقة': 900,
  'تم التسليم خلال 15 دقيقة': 900,
  'يتم التسليم بعد 3 ساعات': 3 * 3600,
  'خلال 6 ساعات': 6 * 3600,
  'يتم التسليم على الايميل الذي يتم تزويدنا به': 6 * 3600,
  'تنصيب وتفعيل الإضافة على موقعك': 24 * 3600,
};

/**
 * How each legacy row is fulfilled, read from WooCommerce rather than guessed.
 *
 * `_manage_stock` is the honest signal: the owner switched inventory tracking
 * on for exactly the nine lines held in hand and left it off for the other 91,
 * which are bought from a supplier once the customer has paid. That is not a
 * gap in the old data — it is the old data recording the real business, and
 * treating every row as stock-backed is what made 67 products read "out of
 * stock" when they were never out of stock.
 */
export function classifyFulfillment(meta: Record<string, string>): FulfillmentMode {
  // Stock in hand wins, and the order of these two checks is the whole point.
  // Doing it the other way round classified the Office 365 accounts as manual
  // setup because their activation is "a ready subscription" — and dropped the
  // fifteen of them the owner actually holds. How a licence is used describes
  // it; having fifteen on the shelf is a fact about it.
  if ((meta._manage_stock ?? 'no') === 'yes') return 'FROM_STOCK';

  const activation = (meta.activation_method ?? '').trim();
  const delivery = (meta.delivery ?? '').trim();

  // A person has to prepare these: an account made with the customer's own
  // address, a panel invitation, an installation on their site. No amount of
  // stock would make them instant.
  if (MANUAL_SETUP_MARKERS.some((marker) => activation.includes(marker))) {
    return 'MANUAL_SETUP';
  }
  if (delivery.includes('تنصيب')) return 'MANUAL_SETUP';

  return 'ON_DEMAND';
}

const MANUAL_SETUP_MARKERS = [
  'حساب جاهز',
  'أشتراك جاهز',
  'حساب Canva Edu',
  'دعوة لحساب',
  'بانل تفعيل',
  'تفعيل يدوي',
  'يتم تفعيل الاضافة',
];

/**
 * Activations that bind to an address the customer supplies.
 *
 * Seventeen legacy rows say so in their own words — "on your own email", "on
 * the email you provide us", or a Microsoft/Canva account binding. Ordering one
 * of these without asking for that address produces a key nobody can use, so
 * checkout has to collect it.
 */
export function requiresActivationEmail(meta: Record<string, string>): boolean {
  const haystack = `${meta.activation_method ?? ''} ${meta.delivery ?? ''}`;
  // Only the bindings that genuinely need an address from the customer. A
  // "ready account" is credentials the seller creates and hands over, so it
  // needs nothing — and asking for an activation email there would add a field
  // to checkout that has no purpose, on fourteen products.
  return [
    'الايميل الخاص بكم',
    'الايميل الذي تم تزويدنا به',
    'الايميل الذي يتم تزويدنا به',
    'مرتبط بحساب مايكروسوفت',
    'Bind Key',
    'دعوة لحساب',
  ].some((marker) => haystack.includes(marker));
}

/** Legacy product_cat name -> new Latin category slug. */
export const CATEGORY_SLUG: Record<string, string> = {
  'ويندوز Windows': 'windows',
  'Windows 10 ويندوز': 'windows-10',
  'Windows 11 ويندوز': 'windows-11',
  'Windows Server ويندوز سيرفر': 'windows-server',
  'Windows Server CAL': 'windows-server-cal',
  'Windows Server RDS CAL': 'windows-server-rds-cal',
  'Microsoft SQL Server': 'windows-server',
  'أوفيس Office': 'office',
  'الحماية AntiVirus': 'antivirus',
  'أدوبي Adobe': 'adobe',
  'أوتوديسك Autodesk': 'autodesk',
  CorelDRAW: 'coreldraw',
  'Visual Studio': 'visual-studio',
  اشتراكات: 'subscriptions',
  'سوق ووردبريس': 'wordpress',
  'أدوات سيو': 'seo-tools',
};

/** Legacy pa_brand term name -> seeded brand slug. */
export const BRAND_SLUG: Record<string, string> = {
  'مايكروسوفت Microsoft': 'microsoft',
  Microsoft: 'microsoft',
  'ويندوز Windows': 'windows',
  Windows: 'windows',
  'أوفيس Office': 'microsoft-office',
  'مايكروسوفت أوفيس': 'microsoft-office',
  'أدوبي Adobe': 'adobe',
  Adobe: 'adobe',
  'أوتوديسك Autodesk': 'autodesk',
  Autodesk: 'autodesk',
  ESET: 'eset',
  'نود 32 ESET': 'eset',
  Norton: 'norton',
  نورتن: 'norton',
  McAfee: 'mcafee',
  مكافي: 'mcafee',
  CorelDRAW: 'coreldraw',
  Corel: 'coreldraw',
  CCleaner: 'ccleaner',
  Elementor: 'elementor',
  'ايست ESET': 'eset',
  'Mcafee - مكافي': 'mcafee',
  'Norton نورتن': 'norton',
};

/**
 * Product kind, by keyword in the Arabic or Latin title. Order matters: the
 * first match wins, so the more specific patterns come first.
 */
const KIND_PATTERNS: [RegExp, ProductKind][] = [
  [/\bpanel\b|بانل/i, ProductKind.PANEL],
  [/حساب|account/i, ProductKind.ACCOUNT],
  [/الباقة|باقة|حزمة|bundle/i, ProductKind.BUNDLE],
  [/كتابة|seo content|إنشاء المحتوى/i, ProductKind.SERVICE],
];

export function classifyKind(title: string): ProductKind {
  for (const [pattern, kind] of KIND_PATTERNS) {
    if (pattern.test(title)) return kind;
  }
  return ProductKind.KEY;
}

/**
 * Platform from the title, when the device field does not say. Windows is the
 * default only because 90% of this catalog is Windows software — not because
 * it is a safe guess in general, so a Mac or cross-platform hint always wins.
 */
export function classifyPlatform(title: string): Platform {
  if (/\bmac\b|macos|للماك/i.test(title)) return Platform.MAC;
  if (/\blinux\b/i.test(title)) return Platform.CROSS_PLATFORM;
  if (/canva|adobe|claude|n8n|elementor/i.test(title)) return Platform.CROSS_PLATFORM;
  return Platform.WINDOWS;
}
