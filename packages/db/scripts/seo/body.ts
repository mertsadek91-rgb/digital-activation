/**
 * A product description assembled from catalog facts.
 *
 * The publish gate wants 120 words of body before a product may go on sale, and
 * it is the only thing standing between this catalog and its English store:
 * measured against the gate, 73 of 73 English translations fail on `body` and
 * nothing else. Four Arabic ones fail the same way.
 *
 * Every sentence here comes from a column — the licence term, the device count,
 * the platform, the activation method, what the customer actually receives, the
 * delivery window, the Golden Warranty flag. Nothing is invented and nothing is
 * praised: no "الأفضل", no "أرخص سعر", none of what the legacy store set inside
 * a PNG where no crawler could read it and no buyer could check it.
 *
 * It is written as blocks rather than a slab of HTML because that is what the
 * schema is for. A `specTable` is quoted by answer engines and an image of a
 * table is not, and the legacy store put the entire pitch for its best-selling
 * bundle inside a picture.
 *
 * This is a floor, not a ceiling. A product somebody has written real copy for
 * keeps it — the caller never overwrites a body that already clears the gate.
 */
import type { Lang, ProductFacts, VariantFacts } from './copy.js';

export interface Block {
  type: string;
  [key: string]: unknown;
}

const AR_PLATFORMS: Record<VariantFacts['platform'], string> = {
  WINDOWS: 'ويندوز',
  MAC: 'ماك',
  LINUX: 'لينكس',
  CROSS_PLATFORM: 'ويندوز وماك',
};
const EN_PLATFORMS: Record<VariantFacts['platform'], string> = {
  WINDOWS: 'Windows',
  MAC: 'Mac',
  LINUX: 'Linux',
  CROSS_PLATFORM: 'Windows and Mac',
};

/**
 * How the licence is turned on, in the shop's own words.
 *
 * Kept separate from the phrasing used in the meta description on purpose: this
 * one has room to say what the buyer has to *do*, which is what a description
 * is for and what a 160-character summary has no space for.
 */
const ACTIVATION: Record<string, { ar: string; en: string }> = {
  RETAIL_ONLINE: {
    ar: 'التفعيل أونلاين: تُدخل المفتاح في إعدادات المنتج ويُفعَّل مباشرة عبر خوادم الشركة المنتجة.',
    en: 'Activated online: you enter the key in the product’s settings and it is verified with the publisher directly.',
  },
  RETAIL_PHONE: {
    ar: 'التفعيل عبر الهاتف: إن رفض التفعيل الأونلاين، يوجّهك النظام إلى تفعيل هاتفي يستغرق دقائق، وفريقنا يرافقك فيه.',
    en: 'Activated by phone: if online activation is declined, the product walks you through a phone activation that takes minutes, and our team stays with you through it.',
  },
  VOLUME_MAK: {
    ar: 'مفتاح MAK للتفعيل الجماعي: يُستخدم على العدد المذكور من الأجهزة، ويُفعَّل أونلاين أو عبر الهاتف.',
    en: 'A MAK volume key: it activates the stated number of devices, online or by phone.',
  },
  KMS: {
    ar: 'التفعيل عبر خادم KMS داخل الشبكة، ويُجدَّد تلقائياً ما دام الجهاز يصل إلى الخادم.',
    en: 'Activated against a KMS server on the network, renewing itself while the machine can reach it.',
  },
  BIND_MICROSOFT_ACCOUNT: {
    ar: 'يُربط الترخيص بحساب مايكروسوفت الذي تحدّده عند الشراء، ويبقى مرتبطاً به على أي جهاز تسجّل الدخول منه.',
    en: 'The licence binds to the Microsoft account you name at checkout and travels with it to any machine you sign in on.',
  },
  REDEEM_CODE: {
    ar: 'كود استرداد: تُدخله في صفحة الاسترداد الرسمية فيُضاف الاشتراك إلى حسابك.',
    en: 'A redeem code: you enter it on the publisher’s redemption page and the subscription lands in your account.',
  },
  ACCOUNT_CREDENTIALS: {
    ar: 'يصلك حساب جاهز باسم مستخدم وكلمة مرور، تسجّل الدخول به مباشرة.',
    en: 'You receive a ready account — a username and a password — and sign in with it directly.',
  },
  PANEL_INVITE: {
    ar: 'دعوة على لوحة التحكم: نرسل الدعوة إلى بريدك، وتقبلها لينضمّ حسابك إلى الاشتراك.',
    en: 'A panel invitation: it arrives at your email, and accepting it joins your account to the subscription.',
  },
  CAL_KEY: {
    ar: 'مفاتيح CAL لتراخيص الوصول: تُدخل في أداة ترخيص الخادم فتُضاف إلى عدد التراخيص المتاحة.',
    en: 'CAL access licence keys: entered in the server’s licensing tool, where they add to the seats available.',
  },
};

function term(variant: VariantFacts, lang: Lang): string {
  if (variant.licensePeriodUnit === 'LIFETIME') return lang === 'ar' ? 'مدى الحياة' : 'Lifetime';
  const n = variant.licensePeriodValue ?? 0;
  if (lang === 'en') {
    const unit = variant.licensePeriodUnit.toLowerCase();
    return `${String(n)} ${unit}${n === 1 ? '' : 's'}`;
  }

  const forms: Record<string, [string, string, string]> = {
    DAY: ['يوم واحد', 'يومان', 'أيام'],
    MONTH: ['شهر واحد', 'شهران', 'أشهر'],
    YEAR: ['سنة واحدة', 'سنتان', 'سنوات'],
  };
  const shape = forms[variant.licensePeriodUnit];
  if (!shape) return String(n);
  if (n === 1) return shape[0];
  if (n === 2) return shape[1];
  return `${String(n)} ${shape[2]}`;
}

function devices(count: number, lang: Lang): string {
  if (count === 0) return lang === 'ar' ? 'غير مرتبط بجهاز' : 'Not tied to a device';
  if (lang === 'en') return count === 1 ? 'One device' : `${String(count)} devices`;
  if (count === 1) return 'جهاز واحد';
  if (count === 2) return 'جهازان';
  if (count <= 10) return `${String(count)} أجهزة`;
  return `${String(count)} جهازاً`;
}

function delivery(seconds: number, lang: Lang): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes <= 1) return lang === 'ar' ? 'خلال دقيقة' : 'Within a minute';
  if (minutes < 60) {
    return lang === 'ar' ? `خلال ${String(minutes)} دقيقة` : `Within ${String(minutes)} minutes`;
  }
  const hours = Math.round(minutes / 60);
  if (lang === 'ar') return hours === 1 ? 'خلال ساعة' : `خلال ${String(hours)} ساعات`;
  return hours === 1 ? 'Within an hour' : `Within ${String(hours)} hours`;
}

/**
 * The term as an English adjective — "1-year", "lifetime".
 *
 * Hyphenated, because "a 1 year licence" is not how the phrase is written and
 * this is the opening sentence of the page.
 */
function adjective(variant: VariantFacts): string {
  if (variant.licensePeriodUnit === 'LIFETIME') return 'lifetime';
  const n = variant.licensePeriodValue ?? 0;
  return `${String(n)}-${variant.licensePeriodUnit.toLowerCase()}`;
}

/** The variant a description speaks for: the one the product page opens on. */
function primary(product: ProductFacts): VariantFacts | null {
  return product.variants[0] ?? null;
}

export function buildBody(product: ProductFacts, lang: Lang): Block[] | null {
  const variant = primary(product);
  if (!variant) return null;

  const ar = lang === 'ar';
  const platform = ar ? AR_PLATFORMS[variant.platform] : EN_PLATFORMS[variant.platform];
  const activation = ACTIVATION[variant.activationMethod];
  const account = variant.credentialKind === 'ACCOUNT_CREDENTIALS';

  const blocks: Block[] = [];

  /**
   * A service is not a licence, and the generic copy calls everything one.
   *
   * There is one service in this catalog — SEO content writing — and the
   * standard opening would have told a buyer it was "a genuine lifetime licence
   * for Windows whose key reaches your email". Its device count is 1 and its
   * platform is WINDOWS because those are the column defaults, not because
   * anybody decided them, so the specification the rest of this file leans on
   * describes a product that does not exist.
   */
  if (product.kind === 'SERVICE') {
    blocks.push({
      type: 'answerFirst',
      text: ar
        ? `${product.name} خدمة يؤدّيها فريقنا، لا ترخيصاً يُفعَّل. تطلبها من المتجر، ونتواصل معك على بريدك لنتّفق على التفاصيل قبل أن نبدأ، ثم نسلّم العمل على البريد نفسه.`
        : `${product.name} is a service our team performs, not a licence to activate. You order it here, we reach you at your email to agree the detail before starting, and the work is delivered to the same address.`,
    });
    blocks.push({
      type: 'heading',
      level: 2,
      text: ar ? 'كيف تسير' : 'How it works',
      id: 'how-it-works',
    });
    blocks.push({
      type: 'richText',
      html: ar
        ? `<p>بعد تأكيد الطلب نراسلك ${delivery(variant.deliverySlaSeconds, 'ar')} لنسأل عمّا تحتاجه بالضبط: الموضوع، الجمهور، اللغة، وأي مرجع لديك. لا نبدأ قبل أن نتّفق، حتى لا تدفع مقابل عمل لا يناسبك. ثم نسلّم العمل على بريدك، ونراجعه معك إن احتاج تعديلاً.</p>`
        : `<p>Once the order is confirmed we write to you ${delivery(variant.deliverySlaSeconds, 'en').toLowerCase()} to ask what exactly you need: the subject, the audience, the language, and any reference you have. Nothing starts before that is agreed, so you are not paying for work that does not fit. The finished work comes back to your email, and we revise it with you if it needs it.</p>`,
    });
    blocks.push({
      type: 'faq',
      items: [
        {
          q: ar ? 'هل هذه خدمة أم ترخيص؟' : 'Is this a service or a licence?',
          a: ar
            ? 'خدمة. لا يصلك مفتاح تفعيل، بل عمل يؤدّيه فريقنا ويُسلَّم على بريدك.'
            : 'A service. No activation key arrives; our team does the work and delivers it to your email.',
        },
        {
          q: ar ? 'متى تبدأون؟' : 'When do you start?',
          a: ar
            ? `نراسلك ${delivery(variant.deliverySlaSeconds, 'ar')} من تأكيد الطلب، ونبدأ بعد أن نتّفق على التفاصيل معك.`
            : `We write to you ${delivery(variant.deliverySlaSeconds, 'en').toLowerCase()} of the order being confirmed, and start once the detail is agreed with you.`,
        },
      ],
    });
    return blocks;
  }

  // The paragraph an answer engine lifts. It has to stand alone.
  blocks.push({
    type: 'answerFirst',
    text: ar
      ? `${product.name} ترخيص أصلي ${term(variant, 'ar') === 'مدى الحياة' ? 'مدى الحياة' : `لمدة ${term(variant, 'ar')}`} يعمل على ${platform}. يصلك ${account ? 'الحساب' : 'المفتاح'} على بريدك الإلكتروني ${delivery(variant.deliverySlaSeconds, 'ar').replace('خلال', 'خلال')} من تأكيد الدفع، ومعه خطوات التفعيل. لا أقراص ولا شحن: المنتج رقمي بالكامل.`
      : `${product.name} is a genuine ${adjective(variant)} licence for ${platform}. The ${account ? 'account' : 'key'} reaches your email ${delivery(variant.deliverySlaSeconds, 'en').toLowerCase()} of payment being confirmed, with the activation steps beside it. No disc and no shipping: the product is entirely digital.`,
  });

  blocks.push({
    type: 'heading',
    level: 2,
    text: ar ? 'ما الذي تحصل عليه' : 'What you get',
    id: 'what-you-get',
  });

  blocks.push({
    type: 'richText',
    html: ar
      ? `<p>${
          account
            ? 'يصلك حساب جاهز باسم مستخدم وكلمة مرور'
            : 'يصلك مفتاح تفعيل أصلي كسلسلة نصية تُدخلها في المنتج'
        }${account ? '' : '، مع رابط التحميل الرسمي'}، وخطوات التفعيل مكتوبة بالعربية. ${
          // The term and the device count in prose as well as in the table.
          // The gate reads neither a table nor a step, so a body that states
          // its two most-asked facts only there states them where the one
          // check that decides publication cannot see them — and, more to the
          // point, where a reader skimming the paragraph does not either.
          variant.deviceCount > 0
            ? `الترخيص يغطّي ${devices(variant.deviceCount, 'ar')} ${term(variant, 'ar') === 'مدى الحياة' ? 'بلا تاريخ انتهاء' : `لمدة ${term(variant, 'ar')}`}.`
            : `الترخيص ${term(variant, 'ar') === 'مدى الحياة' ? 'بلا تاريخ انتهاء' : `لمدة ${term(variant, 'ar')}`} وغير مرتبط بجهاز بعينه.`
        } ${
          product.hasGoldenWarranty
            ? 'ويشمل الطلب الضمان الذهبي: إن لم يعمل المفتاح استبدلناه دون تكلفة.'
            : ''
        }</p>`
      : `<p>${
          account
            ? 'You receive a ready account with a username and a password'
            : 'You receive a genuine activation key as a string you enter in the product'
        }${
          // No download link for an account: the products delivered that way are
          // web services, and there is nothing to download.
          account ? '' : ', together with the official download link'
        }, and written activation steps. ${
          variant.deviceCount > 0
            ? `The licence covers ${devices(variant.deviceCount, 'en').toLowerCase()}${variant.licensePeriodUnit === 'LIFETIME' ? ' with no expiry date' : ` for ${term(variant, 'en').toLowerCase()}`}.`
            : `The licence runs ${variant.licensePeriodUnit === 'LIFETIME' ? 'with no expiry date' : `for ${term(variant, 'en').toLowerCase()}`} and is not tied to a particular machine.`
        } ${
          product.hasGoldenWarranty
            ? 'The order carries the Golden Warranty: if the key does not work, it is replaced at no charge.'
            : ''
        }</p>`,
  });

  blocks.push({
    type: 'heading',
    level: 2,
    text: ar ? 'المواصفات' : 'Specification',
    id: 'specification',
  });

  const rows: { label: string; value: string }[] = [
    { label: ar ? 'مدّة الترخيص' : 'Licence term', value: term(variant, lang) },
    { label: ar ? 'عدد الأجهزة' : 'Devices', value: devices(variant.deviceCount, lang) },
    { label: ar ? 'المنصّة' : 'Platform', value: platform },
    {
      label: ar ? 'ما يصلك' : 'What arrives',
      value: account
        ? ar
          ? 'اسم مستخدم وكلمة مرور'
          : 'A username and a password'
        : ar
          ? 'مفتاح تفعيل'
          : 'An activation key',
    },
    {
      label: ar ? 'التسليم' : 'Delivery',
      value: `${delivery(variant.deliverySlaSeconds, lang)}${ar ? ' على بريدك' : ' by email'}`,
    },
  ];
  if (product.brand) rows.push({ label: ar ? 'الناشر' : 'Publisher', value: product.brand });
  if (product.hasGoldenWarranty) {
    rows.push({
      label: ar ? 'الضمان' : 'Warranty',
      value: ar ? 'الضمان الذهبي' : 'Golden Warranty',
    });
  }
  blocks.push({ type: 'specTable', rows });

  if (activation) {
    blocks.push({
      type: 'heading',
      level: 2,
      text: ar ? 'كيف يُفعَّل' : 'How it activates',
      id: 'activation',
    });
    /**
     * The explanation as prose, and the steps beneath it.
     *
     * It was only in the steps at first, and the gate does not count a step:
     * it reads `html`, `text` and a FAQ's pairs, and nothing else. So the
     * English bodies came out at 99 to 115 words against a floor of 120 and
     * were refused — the sentence a buyer most needs was invisible to the one
     * check that decides whether they ever see the page. It belongs in prose
     * regardless; the steps are what you do, this is what is happening.
     */
    blocks.push({
      type: 'richText',
      html: ar
        ? `<p>${activation.ar} ${
            product.hasGoldenWarranty
              ? 'وإن لم يعمل المفتاح، الضمان الذهبي يغطّي استبداله دون تكلفة.'
              : 'وإن واجهتك مشكلة، فريق الدعم يتابعها معك حتى يكتمل التفعيل.'
          }</p>`
        : `<p>${activation.en} ${
            product.hasGoldenWarranty
              ? 'If the key does not work, the Golden Warranty covers replacing it at no charge.'
              : 'If anything refuses, our support team follows it through with you until activation completes.'
          }</p>`,
    });
    blocks.push({
      type: 'steps',
      steps: [
        {
          text: ar
            ? 'أكمل الطلب، ويصلك البريد الذي يحمل بيانات التفعيل.'
            : 'Complete the order; the email carrying the activation details arrives.',
        },
        {
          text: ar
            ? `${account ? 'سجّل الدخول بالحساب الذي وصلك.' : 'أدخل المفتاح كما هو، دون مسافات زائدة.'}`
            : `${account ? 'Sign in with the account that arrived.' : 'Enter the key exactly as it arrived, with no stray spaces.'}`,
        },
        {
          text: ar
            ? 'إن واجهتك مشكلة، راسل الدعم برقم طلبك قبل أن تعيد المحاولة مراراً.'
            : 'If anything refuses, message support with your order number before retrying repeatedly.',
        },
      ],
    });
  }

  blocks.push({
    type: 'faq',
    items: [
      {
        q: ar ? 'هل الترخيص أصلي؟' : 'Is the licence genuine?',
        a: ar
          ? `نعم. ${account ? 'الحساب' : 'المفتاح'} أصلي ويُفعَّل على خوادم ${product.brand ?? 'الشركة المنتجة'} مباشرة.`
          : `Yes. The ${account ? 'account' : 'key'} is genuine and activates against ${product.brand ?? 'the publisher'}’s own servers.`,
      },
      {
        q: ar ? 'متى يصلني الطلب؟' : 'When does it arrive?',
        a: ar
          ? `${delivery(variant.deliverySlaSeconds, 'ar')} من تأكيد الدفع، على البريد الإلكتروني الذي تكتبه عند الشراء.`
          : `${delivery(variant.deliverySlaSeconds, 'en')} of payment being confirmed, to the email address you give at checkout.`,
      },
      {
        q: ar ? 'على كم جهاز يعمل؟' : 'How many devices does it cover?',
        a: ar
          ? `${devices(variant.deviceCount, 'ar')}${variant.deviceCount > 0 ? '، كما هو مذكور في المواصفات أعلاه.' : '.'}`
          : `${devices(variant.deviceCount, 'en')}${variant.deviceCount > 0 ? ', as stated in the specification above.' : '.'}`,
      },
    ],
  });

  return blocks;
}
