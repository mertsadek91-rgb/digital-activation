/**
 * Turning catalog facts into an SEO title and a meta description.
 *
 * Every word this file produces comes from a column: the product's name, its
 * brand, the licence term, the device count, the platform, the activation
 * method, the delivery window and the Golden Warranty flag. Nothing else is
 * available to it, and that is the point — the legacy store's product copy ran
 * to "الأفضل" and "أرخص سعر" set inside a PNG, which is both unverifiable and
 * invisible to a crawler. No price appears here either: prices move and meta
 * descriptions do not, and a description quoting a stale one has to be
 * rewritten every time a supplier changes.
 *
 * The Latin product name carries the title rather than the Arabic one. The
 * Arabic names came out of WooCommerce with the variant baked into them ("لمدة
 * سنة") and a scatter of typos ("أشتراك"), and a generator that repeats a typo
 * forty times has made the problem worse rather than better. The Latin name is
 * what the store itself writes as the product's name, and the Arabic search
 * results this catalog competes in are already full of Latin product names.
 */

export type Lang = 'ar' | 'en';

export interface VariantFacts {
  licensePeriodValue: number | null;
  licensePeriodUnit: 'DAY' | 'MONTH' | 'YEAR' | 'LIFETIME';
  deviceCount: number;
  platform: 'WINDOWS' | 'MAC' | 'LINUX' | 'CROSS_PLATFORM';
  activationMethod: string;
  credentialKind: 'ACTIVATION_KEY' | 'ACCOUNT_CREDENTIALS';
  deliverySlaSeconds: number;
  warrantyDays: number | null;
}

export interface ProductFacts {
  slug: string;
  kind: 'KEY' | 'ACCOUNT' | 'PANEL' | 'BUNDLE' | 'SERVICE';
  /** The Latin product name, from the English translation. */
  name: string;
  brand: string | null;
  hasGoldenWarranty: boolean;
  variants: VariantFacts[];
}

// --- licence term -----------------------------------------------------------

/** Days, used only to sort terms against each other. */
function termDays(variant: VariantFacts): number {
  const value = variant.licensePeriodValue ?? 0;
  switch (variant.licensePeriodUnit) {
    case 'DAY':
      return value;
    case 'MONTH':
      return value * 30;
    case 'YEAR':
      return value * 365;
    case 'LIFETIME':
      return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * `one` carries its own "واحد/واحدة" because the agreement is grammatical
 * gender, not a suffix that can be appended: سنة is feminine and شهر is not,
 * so "شهر واحدة" is simply wrong and a single template cannot produce both.
 */
const AR_UNITS: Record<
  'DAY' | 'MONTH' | 'YEAR',
  { one: string; two: string; few: string; many: string }
> = {
  DAY: { one: 'يوم واحد', two: 'يومين', few: 'أيام', many: 'يوماً' },
  MONTH: { one: 'شهر واحد', two: 'شهرين', few: 'أشهر', many: 'شهراً' },
  YEAR: { one: 'سنة واحدة', two: 'سنتين', few: 'سنوات', many: 'سنة' },
};

/**
 * The term as a noun phrase.
 *
 * Arabic counts in three shapes — one, two, and three-to-ten — and above ten
 * it returns to the singular. A format string with `${n} سنوات` in it writes
 * "1 سنوات" and "12 سنوات", so this is a function rather than a template.
 */
function termNoun(variant: VariantFacts, lang: Lang): string {
  const n = variant.licensePeriodValue ?? 0;
  if (variant.licensePeriodUnit === 'LIFETIME') return lang === 'ar' ? 'مدى الحياة' : 'lifetime';

  if (lang === 'en') {
    const unit = variant.licensePeriodUnit.toLowerCase();
    return `${String(n)} ${unit}${n === 1 ? '' : 's'}`;
  }

  const forms = AR_UNITS[variant.licensePeriodUnit];
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (n <= 10) return `${String(n)} ${forms.few}`;
  // Eleven and above take the singular in the accusative: "15 يوماً", never
  // "15 أيام" and never the bare "15 يوم".
  return `${String(n)} ${forms.many}`;
}

/** "لمدة سنة واحدة" / "مدى الحياة" / "بمدد من شهر واحد إلى سنة واحدة". */
function termPhrase(variants: VariantFacts[], lang: Lang): string | null {
  const sorted = [...variants].sort((a, b) => termDays(a) - termDays(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return null;

  const nouns = [...new Set(sorted.map((variant) => termNoun(variant, lang)))];
  if (nouns.length === 1) {
    const noun = nouns[0]!;
    if (lang === 'en') return noun;
    return noun === 'مدى الحياة' ? 'مدى الحياة' : `لمدة ${noun}`;
  }

  const low = termNoun(first, lang);
  const high = termNoun(last, lang);
  return lang === 'ar' ? `بمدد من ${low} إلى ${high}` : `from ${low} to ${high}`;
}

/**
 * The term as an English adjective — "1-Year", "lifetime".
 *
 * Hyphenated, because "a 1 year licence" is not how the phrase is written and
 * a meta description is a sentence somebody reads before deciding to click.
 * Null when the variants disagree: "1-Year to Lifetime Licence Key" is not a
 * title, and the span belongs in the description where there is room for it.
 */
function termAdjective(variants: VariantFacts[], titleCase: boolean): string | null {
  const shapes = [
    ...new Set(
      variants.map((variant) => {
        if (variant.licensePeriodUnit === 'LIFETIME') return titleCase ? 'Lifetime' : 'lifetime';
        const unit = variant.licensePeriodUnit.toLowerCase();
        const word = titleCase ? `${unit.charAt(0).toUpperCase()}${unit.slice(1)}` : unit;
        return `${String(variant.licensePeriodValue ?? 0)}-${word}`;
      }),
    ),
  ];
  return shapes.length === 1 ? shapes[0]! : null;
}

// --- devices ----------------------------------------------------------------

/**
 * Null when the catalog says nothing useful.
 *
 * A device count of zero is not "no devices"; it is how this catalog records a
 * licence that binds to no machine at all — the Canva and Office account
 * lines. "for 0 devices" would be a claim the product page does not make.
 */
function devicePhrase(variants: VariantFacts[], lang: Lang): string | null {
  const counts = [...new Set(variants.map((variant) => variant.deviceCount))]
    .filter((count) => count > 0)
    .sort((a, b) => a - b);
  if (counts.length === 0) return null;

  const low = counts[0]!;
  const high = counts[counts.length - 1]!;

  if (lang === 'en') {
    if (low !== high) return `for ${String(low)}–${String(high)} devices`;
    return low === 1 ? 'for one device' : `for ${String(low)} devices`;
  }

  if (low !== high) return `لـ${String(low)}–${String(high)} أجهزة`;
  if (low === 1) return 'لجهاز واحد';
  if (low === 2) return 'لجهازين';
  if (low <= 10) return `لـ${String(low)} أجهزة`;
  return `لـ${String(low)} جهازاً`;
}

// --- platform ---------------------------------------------------------------

const PLATFORMS: Record<VariantFacts['platform'], Record<Lang, string>> = {
  WINDOWS: { ar: 'ويندوز', en: 'Windows' },
  MAC: { ar: 'ماك', en: 'Mac' },
  LINUX: { ar: 'لينكس', en: 'Linux' },
  CROSS_PLATFORM: { ar: 'ويندوز وماك', en: 'Windows and Mac' },
};

function platformPhrase(variants: VariantFacts[], lang: Lang): string | null {
  const names = [...new Set(variants.map((variant) => PLATFORMS[variant.platform][lang]))];
  if (names.length === 0) return null;
  return names.join(lang === 'ar' ? ' و' : ' and ');
}

// --- activation -------------------------------------------------------------

/**
 * How the licence is used, in the store's own vocabulary.
 *
 * The distinction is commercial rather than cosmetic: phone activation
 * generates support tickets and online activation does not, and a customer who
 * discovers which one they bought after paying is a refund. NOT_APPLICABLE
 * says nothing, because there is nothing to activate — that value exists for
 * the SEO writing service, which is human-delivered work.
 */
const ACTIVATION: Record<string, Record<Lang, string> | null> = {
  RETAIL_ONLINE: { ar: 'التفعيل أونلاين', en: 'Activated online' },
  RETAIL_PHONE: { ar: 'التفعيل عبر الهاتف', en: 'Activated by phone' },
  VOLUME_MAK: { ar: 'التفعيل بمفتاح MAK', en: 'Activated with a MAK volume key' },
  KMS: { ar: 'التفعيل عبر KMS', en: 'Activated through KMS' },
  BIND_MICROSOFT_ACCOUNT: {
    ar: 'يرتبط الترخيص بحساب مايكروسوفت الخاص بك',
    en: 'The licence binds to your own Microsoft account',
  },
  REDEEM_CODE: { ar: 'التفعيل بكود استرداد', en: 'Activated with a redeem code' },
  ACCOUNT_CREDENTIALS: {
    ar: 'يصلك حساب جاهز باسم مستخدم وكلمة مرور',
    en: 'Arrives as account credentials, a username and a password',
  },
  PANEL_INVITE: {
    ar: 'التفعيل عبر دعوة على لوحة التحكم',
    en: 'Activated through a panel invitation',
  },
  CAL_KEY: { ar: 'التفعيل بمفتاح CAL', en: 'Activated with a CAL key' },
  NOT_APPLICABLE: null,
};

/** Only when every variant agrees. A split product says nothing rather than half a truth. */
function activationPhrase(variants: VariantFacts[], lang: Lang): string | null {
  const methods = [...new Set(variants.map((variant) => variant.activationMethod))];
  if (methods.length !== 1) return null;
  return ACTIVATION[methods[0]!]?.[lang] ?? null;
}

// --- delivery ---------------------------------------------------------------

/**
 * The slowest window across the variants, not the fastest.
 *
 * "⚡ يصلك في ثواني" over a line that is ordered from a supplier after the
 * customer pays is exactly the promise that produces the support ticket. If
 * one variant takes six hours, six hours is what the description says.
 */
function deliveryPhrase(variants: VariantFacts[], lang: Lang): string {
  const seconds = Math.max(...variants.map((variant) => variant.deliverySlaSeconds));

  if (seconds <= 60) return lang === 'ar' ? 'خلال دقيقة' : 'within a minute';

  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return lang === 'ar' ? `خلال ${String(minutes)} دقيقة` : `within ${String(minutes)} minutes`;
  }

  const hours = Math.round(seconds / 3600);
  if (lang === 'en') return `within ${String(hours)} hour${hours === 1 ? '' : 's'}`;
  if (hours === 1) return 'خلال ساعة';
  if (hours === 2) return 'خلال ساعتين';
  return hours <= 10 ? `خلال ${String(hours)} ساعات` : `خلال ${String(hours)} ساعة`;
}

// --- warranty ---------------------------------------------------------------

/**
 * The Golden Warranty, carried by 45 of the 101 legacy products and one of the
 * very few pages on that store to earn organic impressions on its own name.
 * A null `warrantyDays` means the licence term itself, which is what the
 * promise covers; a number means a supplier gave less than that.
 */
function warrantyPhrase(product: ProductFacts, lang: Lang): string | null {
  if (!product.hasGoldenWarranty) return null;

  const days = [...new Set(product.variants.map((variant) => variant.warrantyDays))];
  const only = days.length === 1 ? days[0] : undefined;
  if (typeof only === 'number') {
    return lang === 'ar'
      ? `يشمله الضمان الذهبي ${String(only)} يوماً`
      : `Covered by the Golden Warranty for ${String(only)} days`;
  }

  return lang === 'ar'
    ? 'يشمله الضمان الذهبي طوال مدة الترخيص'
    : 'Covered by the Golden Warranty for the licence term';
}

// --- what the thing is ------------------------------------------------------

/**
 * The noun the title leads with.
 *
 * Read off the delivery shape rather than off ProductKind, because the
 * delivery shape is what a buyer searches for: somebody typing "حساب Canva
 * Pro" does not want a licence key, and in this catalog those are two
 * different products.
 */
function kindNoun(product: ProductFacts, lang: Lang): string {
  if (product.kind === 'SERVICE') return lang === 'ar' ? 'خدمة' : 'Service';
  if (product.kind === 'BUNDLE') return lang === 'ar' ? 'حزمة' : 'Bundle';

  const methods = [...new Set(product.variants.map((variant) => variant.activationMethod))];
  const kinds = [...new Set(product.variants.map((variant) => variant.credentialKind))];

  if (kinds.length === 1 && kinds[0] === 'ACCOUNT_CREDENTIALS') {
    return lang === 'ar' ? 'حساب' : 'Account';
  }
  if (methods.length === 1 && methods[0] === 'PANEL_INVITE') {
    return lang === 'ar' ? 'اشتراك' : 'Subscription';
  }
  if (methods.length === 1 && methods[0] === 'REDEEM_CODE') {
    return lang === 'ar' ? 'كود تفعيل' : 'Redeem Code';
  }
  return lang === 'ar' ? 'مفتاح تفعيل' : 'Licence Key';
}

// --- the two fields ---------------------------------------------------------

export interface Proposal {
  seoTitle: string;
  seoDescription: string;
}

/**
 * Builds the title by adding qualifiers while they still fit.
 *
 * The name and the noun are not negotiable; the term, the device count and the
 * platform are added in that order and dropped the moment one would push the
 * title past where a search result is cut. A title that reads whole when
 * truncated beats one carrying a fact nobody ever sees.
 */
function buildTitle(product: ProductFacts, lang: Lang, max: number, min: number): string {
  const noun = kindNoun(product, lang);
  const adjective = termAdjective(product.variants, true);
  const platform = platformPhrase(product.variants, lang);

  /**
   * The head of the title, shortened if the product's own name has spent the
   * budget already.
   *
   * `CorelDRAW Technical Suite 2024 for Windows` is 42 characters before this
   * file adds a word to it, and four titles came out between 63 and 72 — over
   * the 60 where Google cuts, with nothing in the script noticing. The optional
   * parts below are only ever *added* when they fit, so nothing was ever
   * shortening the base.
   *
   * What goes is the least load-bearing word first: the term adjective, which
   * the description states in full anyway, then the kind noun. The name itself
   * is never cut — a title ending mid-word is worse than a title that is only
   * the product's name.
   */
  const heads =
    lang === 'ar'
      ? [`${noun} ${product.name}`, product.name]
      : [
          `${product.name}${adjective === null ? '' : ` ${adjective}`} ${noun}`,
          `${product.name} ${noun}`,
          product.name,
        ];

  let title = heads[0] ?? product.name;
  for (const head of heads) {
    if (title.length <= max) break;
    // Never below the gate's own floor: a title the gate would refuse is a
    // second problem rather than a fix, and the top-up loop further down can
    // only add to a title, not rescue one that has been cut too far.
    if (head.length >= min) title = head;
  }

  // Two things about the list below. The platform carries its preposition,
  // because "…Lifetime Licence Key Mac" is not English and "…مدى الحياة ماك"
  // is not Arabic — both are two nouns shoved together. And a service gets
  // neither the device count nor the platform, for the reason `opening` gives:
  // on a service row those are column defaults rather than decisions.
  const optional =
    product.kind === 'SERVICE'
      ? [lang === 'ar' ? termPhrase(product.variants, 'ar') : null]
      : lang === 'ar'
        ? [
            termPhrase(product.variants, 'ar'),
            devicePhrase(product.variants, 'ar'),
            platform === null ? null : `على ${platform}`,
          ]
        : [devicePhrase(product.variants, 'en'), platform === null ? null : `on ${platform}`];

  for (const part of optional) {
    if (part === null) continue;
    const next = `${title} ${part}`;
    if (next.length <= max) title = next;
  }

  // A short Latin name ("n8n") can leave the title under the gate's own floor,
  // and a proposal the gate refuses is a second problem rather than a fix. The
  // brand and the platform are the facts left to spend on it.
  const spare = product.kind === 'SERVICE' ? [product.brand] : [product.brand, platform];
  for (const part of spare) {
    if (title.length >= min || part === null || title.includes(part)) continue;
    title = lang === 'ar' ? `${title} — ${part}` : `${title} — ${part}`;
  }

  return title;
}

/** Joins fragments with a space, dropping the ones the catalog could not supply. */
function join(parts: (string | null)[]): string {
  return parts.filter((part): part is string => part !== null && part.length > 0).join(' ');
}

/**
 * What the product is, as one sentence.
 *
 * Arabic strings its qualifiers together without punctuation — "مفتاح تفعيل X
 * مدى الحياة لجهاز واحد على ماك" is one phrase, and commas between each pair
 * turn it into a list of fragments. English wants the comma before the device
 * count and not before the platform.
 */
function opening(
  product: ProductFacts,
  lang: Lang,
  parts: { devices: boolean; platform: boolean },
): string {
  const term = termPhrase(product.variants, lang);
  const adjective = termAdjective(product.variants, false);

  // A service has a device count of 1 and a platform of WINDOWS because those
  // are the column defaults, not because anybody decided them: the one service
  // in this catalog is SEO copywriting, and "a licence for one device on
  // Windows" would be the script inventing a product that does not exist.
  if (product.kind === 'SERVICE') {
    if (lang === 'ar') return `خدمة ${product.name}${term === null ? '' : ` ${term}`}.`;
    return `${product.name}, a${adjective === null ? '' : ` ${adjective}`} service.`;
  }

  const devices = parts.devices ? devicePhrase(product.variants, lang) : null;
  const platform = parts.platform ? platformPhrase(product.variants, lang) : null;

  if (lang === 'ar') {
    return `${join([`${kindNoun(product, 'ar')} ${product.name}`, term, devices, platform === null ? null : `على ${platform}`])}.`;
  }

  // A span reads as "Licences for X, from 1 month to 1 year"; a single term
  // reads as "A 1-year licence for X".
  const head =
    adjective !== null
      ? `A ${adjective} licence for ${product.name}`
      : term === null
        ? `A licence for ${product.name}`
        : `Licences for ${product.name}, ${term}`;

  return `${head}${devices === null ? '' : `, ${devices}`}${platform === null ? '' : ` on ${platform}`}.`;
}

export function propose(
  product: ProductFacts,
  lang: Lang,
  rules: { seoTitleMinLength: number; seoDescriptionMinLength: number },
  guide: { seoTitleMax: number; seoDescriptionMax: number },
): Proposal {
  const activation = activationPhrase(product.variants, lang);
  const delivery = deliveryPhrase(product.variants, lang);
  const warranty = warrantyPhrase(product, lang);

  // Two sentences, then the warranty as a third. It was a comma clause until
  // the dry run read it back as "delivered by email within 6 hours, Covered by
  // the Golden Warranty" — a promise the store actually keeps deserves its own
  // sentence rather than a subordinate clause with a capital letter in it.
  // The delivery clause has to stand alone when the activation method does not.
  // Products whose variants activate differently get no activation phrase, and
  // the first draft of this left them with a sentence beginning "delivered by
  // email" — lowercase, and in Arabic still carrying the و that joins it to a
  // clause that is no longer there.
  const delivered =
    lang === 'ar' ? `التسليم بالبريد الإلكتروني ${delivery}` : `delivered by email ${delivery}`;
  const arrival =
    activation === null
      ? lang === 'ar'
        ? delivered
        : `Delivered by email ${delivery}`
      : lang === 'ar'
        ? `${activation}، و${delivered}`
        : `${activation}, ${delivered}`;

  /**
   * The closing sentences, with either fact optionally left out.
   *
   * Dropping the activation method falls back to exactly what a product with no
   * single activation method already gets — the delivery clause standing on its
   * own, capitalised in English and without the و that would join it to a
   * clause that is no longer there.
   */
  const close = (withActivation: boolean, withWarranty: boolean): string => {
    const head =
      withActivation && activation !== null
        ? arrival
        : lang === 'ar'
          ? delivered
          : `Delivered by email ${delivery}`;
    return `${head}.${withWarranty && warranty !== null ? ` ${warranty}.` : ''}`;
  };

  /**
   * Trim to where the SERP cuts, by dropping facts rather than by cutting a
   * sentence in half. Everything dropped here is still on the product page; a
   * description truncated mid-word is not.
   *
   * The order is what the store can most afford to lose. The platform goes
   * first — a buyer looking at a Windows Server licence knows it is for
   * Windows. Then the device count. Then the activation method, which is the
   * most technical fact here and the one fewest people search on. The Golden
   * Warranty goes last of all, because it is the only sentence in the
   * description that is a promise rather than a specification.
   *
   * The ladder used to stop after the device count, and for ten products the
   * remaining sentence was still over the limit — the script warned that Google
   * would cut them and then proposed them anyway, which is a warning standing
   * in for a fix.
   */
  const rungs: { devices: boolean; platform: boolean; activation: boolean; warranty: boolean }[] = [
    { devices: true, platform: true, activation: true, warranty: true },
    { devices: true, platform: false, activation: true, warranty: true },
    { devices: false, platform: false, activation: true, warranty: true },
    { devices: false, platform: false, activation: false, warranty: true },
    { devices: false, platform: false, activation: false, warranty: false },
  ];

  let description = '';
  for (const rung of rungs) {
    const candidate = `${opening(product, lang, rung)} ${close(rung.activation, rung.warranty)}`;
    // The first rung is taken unconditionally so there is always a proposal;
    // after that a shorter one is only an improvement while it still clears the
    // gate's own floor.
    if (description === '') {
      description = candidate;
    } else if (candidate.length >= rules.seoDescriptionMinLength) {
      description = candidate;
    }
    if (description.length <= guide.seoDescriptionMax) break;
  }

  // Every template above clears the 70-character floor comfortably, but a
  // one-variant product with a three-letter name and no activation method
  // could still fall short, and a proposal the gate refuses is not a proposal.
  // The brand is the one fact not already in the sentence.
  if (description.length < rules.seoDescriptionMinLength && product.brand !== null) {
    description += lang === 'ar' ? ` من ${product.brand}.` : ` Published by ${product.brand}.`;
  }

  return {
    seoTitle: buildTitle(product, lang, guide.seoTitleMax, rules.seoTitleMinLength),
    seoDescription: description,
  };
}
