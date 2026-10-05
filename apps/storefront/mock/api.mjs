/**
 * A stand-in for the API, for looking at the storefront.
 *
 * The real API runs against the staging database and its crons email real
 * customers, so it is never started for a design pass (CLAUDE.md §3). This
 * answers the reads the home page, the header and the footer make with
 * fixture data in the shapes `@da/contracts` describes, and refuses
 * everything else with a 404 — which is also how a page's empty state gets
 * looked at. Nothing is written to disk: the cart lives in memory (stage 4),
 * so the header shows a count and the cart page's own controls work, and
 * analytics are swallowed.
 *
 * Product names and prices are the UI Kit's design samples (tokens.json
 * `samplePrices`), not store offers.
 *
 *   node apps/storefront/mock/api.mjs            # http://localhost:4000
 *   MOCK_API_PORT=4010 node apps/storefront/mock/api.mjs
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_API_PORT ?? 4000);

const text = (ar, en) => ({ ar, en });

const CATEGORIES = [
  {
    slug: 'windows',
    name: text('ويندوز', 'Windows'),
    headline: text('أنظمة التشغيل', 'Operating systems'),
    productCount: 8,
  },
  {
    slug: 'office',
    name: text('أوفيس', 'Office'),
    headline: text('حزم الإنتاجية', 'Productivity suites'),
    productCount: 6,
  },
  {
    slug: 'adobe',
    name: text('أدوبي', 'Adobe'),
    headline: text('أدوات التصميم', 'Design tools'),
    productCount: 4,
  },
  {
    slug: 'autodesk',
    name: text('أوتوديسك', 'Autodesk'),
    headline: text('الهندسة والتصميم', 'Engineering & CAD'),
    productCount: 3,
  },
  {
    slug: 'antivirus',
    name: text('الحماية', 'Security'),
    headline: text('مكافحة الفيروسات', 'Antivirus'),
    productCount: 5,
  },
  {
    slug: 'subscriptions',
    name: text('الاشتراكات', 'Subscriptions'),
    headline: text('اشتراكات سنوية', 'Annual subscriptions'),
    productCount: 4,
  },
];

const PRODUCTS = [
  {
    slug: 'windows-11-pro',
    name: text('ويندوز 11 برو', 'Windows 11 Pro'),
    desc: text('ترخيص برنامج • جهاز واحد', 'Software licence • 1 device'),
    brand: 'Microsoft',
    price: '19.99',
    compareAt: null,
    sales: 38,
    warranty: true,
  },
  {
    slug: 'office-2021-professional',
    name: text('أوفيس 2021 الاحترافي', 'Office 2021 Professional'),
    desc: text('ترخيص برنامج • للاستخدام المكتبي', 'Software licence • Productivity'),
    brand: 'Microsoft',
    price: '29.99',
    compareAt: '39.99',
    sales: 27,
    warranty: true,
  },
  {
    slug: 'adobe-creative-cloud',
    name: text('أدوبي كرييتف كلاود', 'Adobe Creative Cloud'),
    desc: text('اشتراك سنوي • يتجدد دورياً', 'Annual subscription • Recurring'),
    brand: 'Adobe',
    price: '39.99',
    compareAt: null,
    sales: 12,
    warranty: false,
  },
  {
    slug: 'autocad-2025',
    name: text('أوتوكاد 2025', 'AutoCAD 2025'),
    desc: text('ترخيص برنامج • سنة واحدة', 'Software licence • 1 year'),
    brand: 'Autodesk',
    price: '24.99',
    compareAt: null,
    sales: 9,
    warranty: true,
  },
  {
    slug: 'kaspersky-total',
    name: text('كاسبرسكي توتال', 'Kaspersky Total'),
    desc: text('حماية • 3 أجهزة', 'Security • 3 devices'),
    brand: 'Kaspersky',
    price: '9.99',
    compareAt: null,
    sales: 21,
    warranty: true,
    variants: 3,
  },
  {
    slug: 'windows-server-2022',
    name: text('ويندوز سيرفر 2022', 'Windows Server 2022'),
    desc: text('ترخيص برنامج • خادم واحد', 'Software licence • 1 server'),
    brand: 'Microsoft',
    price: '29.99',
    compareAt: null,
    sales: 4,
    warranty: true,
    inStock: false,
  },
  {
    slug: 'visio-professional-2021',
    name: text('فيزيو الاحترافي 2021', 'Visio Professional 2021'),
    desc: text('ترخيص برنامج • جهاز واحد', 'Software licence • 1 device'),
    brand: 'Microsoft',
    price: '14.99',
    compareAt: '19.99',
    sales: 6,
    warranty: true,
  },
  {
    slug: 'project-professional-2021',
    name: text('بروجكت الاحترافي 2021', 'Project Professional 2021'),
    desc: text('ترخيص برنامج • جهاز واحد', 'Software licence • 1 device'),
    brand: 'Microsoft',
    price: '14.99',
    compareAt: null,
    sales: 3,
    warranty: true,
  },
];

const POSTS = [
  {
    slug: 'which-windows-edition',
    title: 'أي إصدار من ويندوز 11 يناسبك؟',
    summary: 'الفرق بين Home وPro وEnterprise، ومتى يستحق الفرق في السعر.',
    minutes: 4,
  },
  {
    slug: 'activate-office-2021',
    title: 'كيف تفعّل أوفيس 2021 خطوة بخطوة',
    summary: 'من استلام المفتاح إلى ربطه بحساب مايكروسوفت، مع حل الأخطاء الشائعة.',
    minutes: 5,
  },
  {
    slug: 'genuine-vs-grey-keys',
    title: 'ما الفرق بين المفتاح الأصلي والمفتاح الرمادي؟',
    summary: 'لماذا يتوقف بعض المفاتيح الرخيصة عن العمل بعد شهر، وكيف تتأكد قبل الشراء.',
    minutes: 3,
  },
];

function price(amount, compareAt, currency) {
  const a = Number(amount);
  const c = compareAt === null ? null : Number(compareAt);
  return {
    amount: a.toFixed(2),
    currency,
    compareAt: c === null ? null : c.toFixed(2),
    discountPercent: c === null ? null : Math.round((1 - a / c) * 100),
  };
}

function card(p, locale, currency) {
  const variants = p.variants ?? 1;
  return {
    slug: p.slug,
    name: p.name[locale],
    shortDesc: p.desc[locale],
    image: null,
    price: price(p.price, p.compareAt, currency),
    inStock: p.inStock ?? true,
    available: null,
    fulfillmentMode: 'FROM_STOCK',
    variantCount: variants,
    buyableVariantId: variants === 1 ? `var_${p.slug}` : null,
    hasGoldenWarranty: p.warranty,
    salesCount: p.sales,
    brand: p.brand,
    isDraft: false,
    sale: null,
  };
}

function link(c, locale) {
  return {
    slug: c.slug,
    name: c.name[locale],
    headline: c.headline[locale],
    href: `/collections/${c.slug}`,
    productCount: c.productCount,
  };
}

function home(locale, currency) {
  const cards = PRODUCTS.map((p) => card(p, locale, currency));
  const brands = ['Microsoft', 'Adobe', 'Autodesk', 'Kaspersky'].map((name) => ({
    slug: name.toLowerCase(),
    name,
    headline: null,
    href: `/brands/${name.toLowerCase()}`,
    productCount: PRODUCTS.filter((p) => p.brand === name).length,
  }));
  return {
    locale,
    currency,
    categories: CATEGORIES.map((c) => link(c, locale)),
    rails: [
      {
        ...link(CATEGORIES[0], locale),
        products: cards.filter((c) => c.brand === 'Microsoft').slice(0, 4),
      },
    ],
    bestSellers: [...cards].sort((a, b) => b.salesCount - a.salesCount).slice(0, 4),
    newest: cards.slice(2, 6),
    brands,
    posts:
      locale === 'ar'
        ? POSTS.map((p) => ({
            slug: p.slug,
            locale,
            title: p.title,
            summary: p.summary,
            readingMinutes: p.minutes,
            publishedAt: '2026-09-01',
          }))
        : [],
    productCount: PRODUCTS.length,
    isPreview: false,
  };
}

// --- stage 3 fixtures: listings, a product, its reviews, search ---------------

const FACETS = {
  brand: [
    { value: 'microsoft', label: 'Microsoft', count: 5 },
    { value: 'adobe', label: 'Adobe', count: 1 },
    { value: 'autodesk', label: 'Autodesk', count: 1 },
    { value: 'kaspersky', label: 'Kaspersky', count: 1 },
  ],
  platform: [
    { value: 'WINDOWS', count: 6 },
    { value: 'CROSS_PLATFORM', count: 2 },
  ],
  term: [
    { value: 'lifetime', count: 5 },
    { value: 'year', count: 3 },
  ],
  devices: [
    { value: '1', count: 6 },
    { value: '2-5', count: 2 },
  ],
  price: [
    { key: '0-25', minUsd: 0, maxUsd: 25, min: '0', max: '25', currency: 'USD', count: 5 },
    { key: '25-50', minUsd: 25, maxUsd: 50, min: '25', max: '50', currency: 'USD', count: 3 },
  ],
  inStock: 7,
  onSale: 2,
};

function listing(items, locale, currency, page, perPage) {
  const start = (page - 1) * perPage;
  return {
    products: items.slice(start, start + perPage).map((p) => card(p, locale, currency)),
    total: items.length,
    page,
    perPage,
    facets: FACETS,
  };
}

function crumbs(locale, ...rest) {
  return [{ name: locale === 'ar' ? 'الرئيسية' : 'Home', href: '/' }, ...rest];
}

const BODY = (locale) => [
  {
    type: 'richText',
    html:
      locale === 'ar'
        ? '<p>ويندوز 11 برو هو الإصدار الموجّه للمحترفين والشركات الصغيرة: يضيف إلى إصدار Home أدوات التشفير BitLocker وسطح المكتب البعيد وإدارة السياسات. المفتاح يُفعَّل على خوادم مايكروسوفت مباشرة ويبقى مرتبطاً بجهازك.</p><p>هذا نص وصفي نموذجي من الـ fixture للمعاينة فقط.</p>'
        : '<p>Windows 11 Pro is the edition for professionals and small businesses: on top of Home it adds BitLocker encryption, Remote Desktop and policy management. The key activates on Microsoft servers directly and stays bound to your device.</p><p>Sample description text from the fixture, for preview only.</p>',
  },
];

function product(locale, currency) {
  const ar = locale === 'ar';
  const base = PRODUCTS[0];
  const variants = [
    {
      id: 'var_windows-11-pro',
      sku: 'WIN11-PRO-1',
      licensePeriodValue: null,
      licensePeriodUnit: 'LIFETIME',
      deviceCount: 1,
      platform: 'WINDOWS',
      activationMethod: 'RETAIL_ONLINE',
      deliverySlaSeconds: 300,
      fulfillmentMode: 'FROM_STOCK',
      requiresActivationEmail: false,
      price: price('19.99', null, currency),
      available: 12,
      inStock: true,
      isDefault: true,
    },
    {
      id: 'var_windows-11-pro-3',
      sku: 'WIN11-PRO-3',
      licensePeriodValue: null,
      licensePeriodUnit: 'LIFETIME',
      deviceCount: 3,
      platform: 'WINDOWS',
      activationMethod: 'RETAIL_ONLINE',
      deliverySlaSeconds: 300,
      fulfillmentMode: 'FROM_STOCK',
      requiresActivationEmail: false,
      price: price('39.99', '49.99', currency),
      available: 4,
      inStock: true,
      isDefault: false,
    },
  ];
  return {
    slug: base.slug,
    kind: 'KEY',
    locale,
    name: base.name[locale],
    shortDesc: base.desc[locale],
    body: BODY(locale),
    faq: [
      {
        q: ar
          ? 'هل يعمل المفتاح على جهاز مُفعَّل مسبقاً بإصدار Home؟'
          : 'Does the key work on a machine already on Home?',
        a: ar
          ? 'نعم، المفتاح يرقّي Home إلى Pro دون إعادة تثبيت.'
          : 'Yes. The key upgrades Home to Pro without reinstalling.',
      },
      {
        q: ar ? 'كم مرة يمكن تفعيل المفتاح؟' : 'How many times can the key be activated?',
        a: ar
          ? 'مرة واحدة على جهاز واحد؛ يبقى مرتبطاً باللوحة الأم.'
          : 'Once, on one device; it stays bound to the motherboard.',
      },
    ],
    activationSteps: [
      {
        step: 1,
        text: ar ? 'افتح الإعدادات ← النظام ← التفعيل.' : 'Open Settings → System → Activation.',
      },
      {
        step: 2,
        text: ar
          ? 'اختر "تغيير مفتاح المنتج" وألصق المفتاح.'
          : 'Choose "Change product key" and paste the key.',
      },
      {
        step: 3,
        text: ar
          ? 'انتظر التأكيد؛ يظهر "تم التفعيل" خلال دقيقة.'
          : 'Wait for the confirmation; "Activated" appears within a minute.',
      },
    ],
    downloadUrl: 'https://www.microsoft.com/software-download/windows11',
    warnings: [
      {
        text: ar
          ? 'لا يعمل على Windows 10 Home دون ترقية.'
          : 'Does not work on Windows 10 Home without upgrading.',
        severity: 'note',
      },
      {
        text: ar ? 'الترخيص مقيّد بدول الخليج.' : 'The licence is region-locked to the GCC.',
        severity: 'critical',
      },
    ],
    brand: { slug: 'microsoft', name: 'Microsoft' },
    breadcrumbs: crumbs(
      locale,
      { name: CATEGORIES[0].name[locale], href: '/collections/windows' },
      { name: base.name[locale], href: '/store/' + base.slug },
    ),
    images: [],
    hasGoldenWarranty: true,
    salesCount: 38,
    rating: { value: '4.8', count: 12 },
    variants,
    selectedVariantId: variants[0].id,
    seo: { title: null, description: null },
    isDraft: false,
    sale: null,
    related: PRODUCTS.slice(1, 5).map((p) => card(p, locale, currency)),
    articles:
      locale === 'ar'
        ? [
            {
              slug: POSTS[0].slug,
              locale,
              title: POSTS[0].title,
              summary: POSTS[0].summary,
              readingMinutes: POSTS[0].minutes,
              publishedAt: '2026-09-01',
            },
          ]
        : [],
  };
}

function reviews(slug, locale) {
  const ar = locale === 'ar';
  const rows = [
    {
      id: 'rev_1',
      rating: 5,
      title: ar ? 'تفعيل خلال دقيقتين' : 'Activated in two minutes',
      body: ar
        ? 'وصل المفتاح على البريد مباشرة بعد الدفع وتم التفعيل من أول محاولة.'
        : 'The key arrived by email right after payment and activated on the first try.',
      locale,
      authorName: ar ? 'محمد' : 'Mohammed',
      createdAt: '2026-09-20T10:00:00Z',
      storeReply: null,
      repliedAt: null,
    },
    {
      id: 'rev_2',
      rating: 4,
      title: null,
      body: ar
        ? 'كل شيء واضح، كنت أتمنى شرحاً أوضح لخطوة ربط الحساب.'
        : 'Everything was clear; I wished the account-linking step were explained better.',
      locale,
      authorName: null,
      createdAt: '2026-09-12T10:00:00Z',
      storeReply: ar
        ? 'شكراً لك، أضفنا الخطوة إلى صفحة المنتج.'
        : 'Thank you; we added the step to the product page.',
      repliedAt: '2026-09-13T10:00:00Z',
    },
    {
      id: 'rev_3',
      rating: 5,
      title: ar ? 'سعر ممتاز' : 'Great price',
      body: ar
        ? 'أرخص من المتجر الرسمي بكثير والمفتاح أصلي.'
        : 'Much cheaper than the official store and the key is genuine.',
      locale,
      authorName: ar ? 'سارة' : 'Sarah',
      createdAt: '2026-08-30T10:00:00Z',
      storeReply: null,
      repliedAt: null,
    },
  ];
  return { slug, rows, page: 1, perPage: 10, total: 12, aggregate: { count: 12, average: '4.8' } };
}

const marketing = {
  trust: {
    enabled: true,
    guarantee: { ar: '', en: '' },
    instantDeliveryText: { ar: '', en: '' },
    commercialRegistration: '1010000000',
    vatNumber: '300000000000003',
    maroofUrl: '',
    showOnProduct: true,
    showOnCheckout: true,
  },
  offers: null,
  socialProof: null,
  welcome: null,
  business: null,
  referral: null,
  activeSales: [],
};

// --- stage 4 fixtures: the cart, a checkout, an order, the account ----------
//
// The cart is held in memory so the page's own controls move it: the stepper
// and the bin change the lines, "apply" takes SAVE10 and refuses anything
// else, and removing every line shows the empty state. Nothing persists past
// the process. Account reads answer as a signed-in customer regardless of
// cookies: the point is to look at the pages, not to test the session.

const DEMO_KEY = 'DEMO-XXXXX-XXXXX-XXXXX';

function cartLine(p, qty, locale, currency) {
  const unit = price(p.price, p.compareAt, currency);
  const yearly = p.slug.includes('cloud') || p.slug.includes('autocad');
  return {
    id: 'line_' + p.slug,
    variantId: 'var_' + p.slug,
    sku: p.slug.toUpperCase().slice(0, 12),
    productSlug: p.slug,
    productName: p.name[locale],
    licensePeriodValue: yearly ? 1 : null,
    licensePeriodUnit: yearly ? 'YEAR' : 'LIFETIME',
    deviceCount: 1,
    activationMethod: 'RETAIL_ONLINE',
    deliverySlaSeconds: 300,
    fulfillmentMode: 'FROM_STOCK',
    requiresActivationEmail: false,
    image: null,
    qty,
    unitPrice: unit,
    lineTotal: { ...unit, amount: (Number(unit.amount) * qty).toFixed(2) },
    priceChanged: null,
    availableToAdd: 10 - qty,
    fromCrossSell: false,
    sale: null,
    saleEnded: false,
  };
}

const cartState = {
  lines: [
    { slug: 'office-2021-professional', qty: 1 },
    { slug: 'windows-11-pro', qty: 2 },
  ],
  coupon: null,
  couponError: null,
};

function cart(locale, currency) {
  const lines = cartState.lines.map((l) =>
    cartLine(
      PRODUCTS.find((p) => p.slug === l.slug),
      l.qty,
      locale,
      currency,
    ),
  );
  const subtotal = lines.reduce((sum, l) => sum + Number(l.lineTotal.amount), 0);
  const discount = cartState.coupon ? subtotal * 0.1 : 0;
  const money = (n) => ({ amount: n.toFixed(2), currency, compareAt: null, discountPercent: null });
  return {
    token: 'mock-cart',
    locale,
    currency,
    lines,
    itemCount: lines.reduce((sum, l) => sum + l.qty, 0),
    subtotal: money(subtotal),
    discount: money(discount),
    total: money(subtotal - discount),
    coupon: cartState.coupon
      ? {
          code: 'SAVE10',
          name: locale === 'ar' ? 'خصم ترحيبي 10%' : 'Welcome 10% off',
          discount: money(discount),
        }
      : null,
    couponError: cartState.couponError,
    automaticDiscount: null,
    couponSuperseded: false,
    volume: null,
    reservationExpiresAt: null,
    adjustments: [],
  };
}

const ORDER_STEPS = (locale) =>
  locale === 'ar'
    ? [
        'افتح الإعدادات ← النظام ← التفعيل.',
        'اختر "تغيير مفتاح المنتج" وألصق المفتاح.',
        'انتظر التأكيد.',
      ]
    : [
        'Open Settings → System → Activation.',
        'Choose "Change product key" and paste the key.',
        'Wait for the confirmation.',
      ];

function order(number, locale, currency, status = 'PAID') {
  const c = cart(locale, currency);
  const base =
    c.lines.length > 0 ? c : { ...c, lines: [cartLine(PRODUCTS[1], 1, locale, currency)] };
  const lines = base.lines.map((l, i) => ({
    sku: l.sku,
    productName: l.productName,
    productSlug: l.productSlug,
    qty: l.qty,
    unitPrice: l.unitPrice,
    lineTotal: l.lineTotal,
    fulfillmentState:
      status === 'PENDING_PAYMENT' ? 'PENDING' : i === 0 ? 'DELIVERED' : 'MANUAL_QUEUE',
    credentialKind: 'ACTIVATION_KEY',
    activationSteps: ORDER_STEPS(locale),
  }));
  const subtotal = lines.reduce((sum, l) => sum + Number(l.lineTotal.amount), 0);
  const money = (n) => ({ amount: n.toFixed(2), currency, compareAt: null, discountPercent: null });
  return {
    number,
    status,
    email: 'customer@example.com',
    activationEmail: null,
    locale,
    currency,
    lines,
    subtotal: money(subtotal),
    discount: money(0),
    tax: money(0),
    total: money(subtotal),
    couponCode: null,
    placedAt: '2026-10-02T09:30:00.000Z',
    paidAt: status === 'PENDING_PAYMENT' ? null : '2026-10-02T09:31:00.000Z',
  };
}

function checkout(locale, currency) {
  const c = cart(locale, currency);
  const cross = PRODUCTS[4];
  const p = price(cross.price, cross.compareAt, currency);
  return {
    order: order('DA-2026-00042', locale, currency, 'PENDING_PAYMENT'),
    cart: c,
    crossSell: [
      {
        variantId: 'var_' + cross.slug,
        sku: 'KTS-3',
        productSlug: cross.slug,
        productName: cross.name[locale],
        image: null,
        price: p,
        bundlePrice: { ...p, amount: (Number(p.amount) * 0.8).toFixed(2) },
        savePercent: 20,
        promotionCode: 'PAIR',
      },
    ],
    activationEmailRequired: false,
    paymentMethods: ['STRIPE', 'BANK_TRANSFER'],
    finalProcessorMethods: [],
    chargedInUsd: null,
  };
}

const me = {
  email: 'customer@example.com',
  firstName: null,
  locale: 'ar',
  orderCount: 3,
  expiresAt: '2099-01-01T00:00:00.000Z',
};

function licences(locale) {
  const row = (p, n, state, i) => ({
    orderItemId: 'item_' + i,
    orderNumber: n,
    productName: p.name[locale],
    productSlug: p.slug,
    sku: p.slug.toUpperCase().slice(0, 12),
    qty: 1,
    deliveredAt: state === 'DELIVERED' ? '2026-10-02T09:35:00.000Z' : null,
    placedAt: '2026-10-02T09:30:00.000Z',
    state,
    credentialKind: 'ACTIVATION_KEY',
    activationSteps: ORDER_STEPS(locale),
    warrantyDays: 365,
    hasSecret: state === 'DELIVERED',
    expiresAt: null,
  });
  return {
    rows: [
      row(PRODUCTS[0], 'DA-2026-00041', 'DELIVERED', 1),
      row(PRODUCTS[1], 'DA-2026-00041', 'DELIVERED', 2),
      row(PRODUCTS[3], 'DA-2026-00043', 'MANUAL_QUEUE', 3),
    ],
    waiting: 1,
  };
}

function accountOrders(locale, currency) {
  const one = (number, status, paid, items) => {
    const lines = items.map(([p, qty]) => ({
      productName: p.name[locale],
      sku: p.slug.toUpperCase().slice(0, 12),
      qty,
      lineTotal: (Number(p.price) * qty).toFixed(2),
      fulfillmentState: status === 'PENDING_PAYMENT' ? 'PENDING' : 'DELIVERED',
    }));
    const subtotal = lines.reduce((sum, l) => sum + Number(l.lineTotal), 0);
    return {
      number,
      status,
      currency,
      placedAt: '2026-10-02T09:30:00.000Z',
      paidAt: paid ? '2026-10-02T09:31:00.000Z' : null,
      subtotal: subtotal.toFixed(2),
      discount: '0.00',
      tax: '0.00',
      total: subtotal.toFixed(2),
      lines,
    };
  };
  return {
    rows: [
      one('DA-2026-00043', 'PENDING_PAYMENT', false, [[PRODUCTS[3], 1]]),
      one('DA-2026-00042', 'COMPLETED', true, [
        [PRODUCTS[1], 1],
        [PRODUCTS[0], 2],
      ]),
      one('DA-2026-00041', 'COMPLETED', true, [[PRODUCTS[0], 1]]),
    ],
  };
}

function reviewable(locale) {
  const ar = locale === 'ar';
  return {
    rows: [
      {
        orderItemId: 'item_1',
        orderNumber: 'DA-2026-00041',
        productSlug: PRODUCTS[0].slug,
        productName: PRODUCTS[0].name[locale],
        deliveredAt: '2026-10-02T09:35:00.000Z',
        review: {
          id: 'own_1',
          rating: 5,
          title: ar ? 'تفعيل خلال دقيقتين' : 'Activated in two minutes',
          body: ar
            ? 'وصل المفتاح على البريد مباشرة بعد الدفع.'
            : 'The key arrived by email right after payment.',
          locale,
          status: 'PENDING',
          storeReply: null,
          createdAt: '2026-10-02T12:00:00.000Z',
          editable: true,
        },
      },
      {
        orderItemId: 'item_2',
        orderNumber: 'DA-2026-00041',
        productSlug: PRODUCTS[1].slug,
        productName: PRODUCTS[1].name[locale],
        deliveredAt: '2026-10-02T09:35:00.000Z',
        review: null,
      },
    ],
    awaiting: 1,
  };
}

function forYou(locale, currency) {
  return {
    purchases: 3,
    renewals: [
      {
        product: card(PRODUCTS[2], locale, currency),
        orderNumber: 'DA-2026-00041',
        startedAt: '2025-10-20T00:00:00.000Z',
        expiresAt: '2026-10-20T00:00:00.000Z',
        daysLeft: 17,
        termLabel: locale === 'ar' ? 'سنة' : '1 year',
      },
    ],
    suggestions: [
      { product: card(PRODUCTS[5], locale, currency), reason: 'sameBrand', becauseOf: 'Microsoft' },
      {
        product: card(PRODUCTS[4], locale, currency),
        reason: 'relatedToOwned',
        becauseOf: PRODUCTS[0].name[locale],
      },
    ],
  };
}

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

/** The stage-4 routes. Returns true when it answered. */
function stage4(req, url, body, send, locale, currency) {
  const path = url.pathname;
  const ar = locale === 'ar';
  const done = (status, payload) => {
    send(status, payload);
    return true;
  };

  if (path === '/v1/cart' && req.method === 'GET') return done(200, cart(locale, currency));
  if (path === '/v1/cart/items' && req.method === 'POST') {
    const slug = String(body.variantId ?? '').replace(/^var_/, '');
    const p = PRODUCTS.find((entry) => entry.slug === slug);
    if (!p) return done(404, { statusCode: 404, message: 'mock: unknown variant' });
    const line = cartState.lines.find((l) => l.slug === slug);
    if (line) line.qty = Math.min(10, line.qty + Number(body.qty ?? 1));
    else cartState.lines.push({ slug, qty: Number(body.qty ?? 1) });
    return done(200, cart(locale, currency));
  }
  const item = path.match(/^\/v1\/cart\/items\/var_([a-z0-9-]+)$/);
  if (item && req.method === 'PATCH') {
    const qty = Number(body.qty ?? 1);
    cartState.lines = cartState.lines
      .map((l) => (l.slug === item[1] ? { ...l, qty } : l))
      .filter((l) => l.qty > 0);
    return done(200, cart(locale, currency));
  }
  if (path === '/v1/cart/coupon' && req.method === 'POST') {
    const code = String(body.code ?? '')
      .trim()
      .toUpperCase();
    if (code === 'SAVE10') {
      cartState.coupon = 'SAVE10';
      cartState.couponError = null;
    } else {
      cartState.couponError = ar
        ? 'هذا الرمز غير صالح أو منتهٍ.'
        : 'That code is not valid or has expired.';
    }
    return done(200, cart(locale, currency));
  }
  if (path === '/v1/cart/coupon' && req.method === 'DELETE') {
    cartState.coupon = null;
    cartState.couponError = null;
    return done(200, cart(locale, currency));
  }
  if (path === '/v1/checkout' && req.method === 'POST')
    return done(200, checkout(locale, currency));

  const pay = path.match(/^\/v1\/orders\/([A-Z0-9-]+)\/pay$/);
  if (pay && req.method === 'POST') {
    const amount = order(pay[1], locale, currency).total;
    if (body.provider === 'STRIPE')
      return done(200, { provider: 'STRIPE', clientSecret: '', publishableKey: '', amount });
    if (body.provider === 'BANK_TRANSFER')
      return done(200, {
        provider: 'BANK_TRANSFER',
        amount,
        instructions: {
          headline: ar ? 'حوّل المبلغ إلى الحساب التالي:' : 'Transfer the amount to this account:',
          fields: [
            {
              label: ar ? 'اسم المستفيد' : 'Beneficiary',
              value: 'Digital Activation LLC',
              copyable: false,
            },
            { label: 'IBAN', value: 'AE07 0331 2345 6789 0123 456', copyable: true },
            { label: ar ? 'البنك' : 'Bank', value: 'Emirates NBD', copyable: false },
          ],
          afterPaying: ar
            ? 'أرسل صورة الحوالة على واتساب ليُفعَّل طلبك.'
            : 'Send the transfer receipt on WhatsApp and the order is released.',
        },
      });
    return done(503, {
      statusCode: 503,
      message: ar ? 'طريقة الدفع غير متاحة.' : 'That method is unavailable.',
      reason: 'unavailable',
    });
  }
  const ord = path.match(/^\/v1\/orders\/([A-Z0-9-]+)$/);
  if (ord && req.method === 'GET') {
    const status = ord[1].endsWith('PEND') ? 'PENDING_PAYMENT' : 'PAID';
    return done(200, order(ord[1], locale, currency, status));
  }
  const fp = path.match(/^\/v1\/checkout\/final-processor\/status\/([A-Z0-9-]+)$/);
  if (fp) {
    const n = fp[1];
    return done(200, {
      status: n.endsWith('FAIL') ? 'failed' : n.endsWith('PEND') ? 'pending' : 'paid',
    });
  }

  if (path === '/v1/account/me') return done(200, me);
  if (path === '/v1/account/link') return done(200, { sent: true });
  if (path === '/v1/account/session') return done(200, { customer: me });
  if (path === '/v1/account/sign-out') return done(204);
  if (path === '/v1/account/licences') return done(200, licences(locale));
  if (path === '/v1/account/orders') return done(200, accountOrders(locale, currency));
  if (path === '/v1/account/for-you') return done(200, forYou(locale, currency));
  if (path === '/v1/account/reviews') return done(200, reviewable(locale));
  const reveal = path.match(/^\/v1\/account\/licences\/([a-z0-9_]+)\/(reveal|resend)$/);
  if (reveal) {
    if (reveal[2] === 'resend') return done(200, { to: me.email });
    return done(200, {
      secrets: [{ kind: 'ACTIVATION_KEY', key: DEMO_KEY, username: null, password: null }],
    });
  }
  if (path === '/v1/referrals/me')
    return done(200, {
      enabled: true,
      code: 'FRIEND-7K2Q',
      friendPercent: 10,
      referrerRewardUsd: 5,
      clearAfterDays: 14,
      licenceNumber: 'DL-2026-07',
      pending: 1,
      rewarded: 2,
    });
  return false;
}

// --- stage 5 fixtures: editorial pages, the blog, the 404 guess -------------
//
// Layout samples, not store text: the policies and the warranty are the
// owner's, and these only give the pages something of each block type to
// draw (heading, rich text, answer-first, steps, FAQ, spec table, CTA).

function pageFixture(slug, locale) {
  const ar = locale === 'ar';
  const T = (a, e) => (ar ? a : e);
  const common = {
    slug,
    locale,
    seo: { title: null, description: null },
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  if (slug === 'golden-warranty') {
    return {
      ...common,
      title: T('الضمان الذهبي', 'Golden Warranty'),
      blocks: [
        {
          type: 'answerFirst',
          text: T(
            'نص نموذجي: الضمان الذهبي يغطي استبدال المفتاح إن توقف عن العمل خلال مدة الضمان، دون أسئلة معقدة.',
            'Sample text: the Golden Warranty replaces a key that stops working within the warranty period, without complicated questions.',
          ),
        },
        {
          type: 'heading',
          level: 2,
          text: T('ماذا يغطي الضمان', 'What the warranty covers'),
          id: 'covers',
        },
        {
          type: 'richText',
          html: T(
            '<p>نص نموذجي للمعاينة. يُستبدل بالسياسة التي يكتبها مالك المتجر.</p><ul><li>توقف التفعيل بعد التثبيت.</li><li>رفض المفتاح من خوادم الشركة المنتجة.</li></ul>',
            '<p>Sample text for preview, replaced by the policy the store owner writes.</p><ul><li>Activation stops after installation.</li><li>The key is refused by the vendor servers.</li></ul>',
          ),
        },
        {
          type: 'steps',
          title: T('كيف تطلب الاستبدال', 'How to claim a replacement'),
          steps: [
            { text: T('تواصل معنا برقم الطلب.', 'Contact us with your order number.') },
            { text: T('أرسل لقطة لرسالة الخطأ.', 'Send a screenshot of the error.') },
            { text: T('نرسل لك مفتاحاً بديلاً.', 'We send you a replacement key.') },
          ],
        },
        {
          type: 'faq',
          title: T('أسئلة عن الضمان', 'Warranty questions'),
          items: [
            {
              q: T('كم مدة الضمان؟', 'How long is the warranty?'),
              a: T(
                'تختلف حسب المنتج وتظهر في صفحته.',
                'It depends on the product and is shown on its page.',
              ),
            },
            {
              q: T('هل الاستبدال مجاني؟', 'Is the replacement free?'),
              a: T('نعم، ضمن شروط الضمان.', 'Yes, within the warranty terms.'),
            },
          ],
        },
      ],
    };
  }
  if (slug === 'privacy' || slug === 'terms' || slug === 'refunds' || slug === 'about') {
    const titles = {
      privacy: T('سياسة الخصوصية', 'Privacy Policy'),
      terms: T('شروط الخدمة', 'Terms of Service'),
      refunds: T('سياسة الاسترجاع', 'Refund Policy'),
      about: T('من نحن', 'About us'),
    };
    // /en/terms serves the Arabic page, so the "not translated yet" notice
    // has something to show.
    const served = slug === 'terms' ? 'ar' : locale;
    const S = (a, e) => (served === 'ar' ? a : e);
    return {
      ...common,
      locale: served,
      title: slug === 'terms' ? 'شروط الخدمة' : titles[slug],
      blocks: [
        {
          type: 'answerFirst',
          text: S(
            'هذا قالب تخطيط لصفحات السياسات، وليس نصاً قانونياً معتمداً. يُستبدل بالمحتوى الذي يوافق عليه مالك المتجر.',
            'This is a layout sample for the policy pages, not approved legal text. It is replaced by the content the store owner approves.',
          ),
        },
        {
          type: 'heading',
          level: 2,
          text: S('البيانات التي نجمعها', 'The data we collect'),
          id: 'data',
        },
        {
          type: 'richText',
          html: S(
            '<p>توضح النسخة المعتمدة بيانات الحساب والطلبات وأغراض استخدامها.</p>',
            '<p>The approved version explains the account and order data and what it is used for.</p>',
          ),
        },
        {
          type: 'heading',
          level: 2,
          text: S('كيفية استخدام البيانات', 'How the data is used'),
          id: 'use',
        },
        {
          type: 'richText',
          html: S(
            '<p>تعرض السياسة الفعلية الاستخدامات ومزودي الخدمة عند الحاجة.</p><ul><li>تنفيذ الطلب وإرسال المفتاح.</li><li>الرد على رسائل الدعم.</li></ul>',
            '<p>The actual policy lists the uses and the service providers where needed.</p><ul><li>Fulfilling the order and sending the key.</li><li>Answering support messages.</li></ul>',
          ),
        },
        {
          type: 'specTable',
          title: S('مدد الاحتفاظ', 'Retention'),
          rows: [
            {
              label: S('بيانات الطلب', 'Order data'),
              value: S('سنوات حسب القانون', 'Years, as the law requires'),
            },
            { label: S('رسائل الدعم', 'Support messages'), value: S('سنة واحدة', 'One year') },
          ],
        },
        {
          type: 'heading',
          level: 2,
          text: S('حقوق المستخدم والتواصل', 'Your rights and contact'),
          id: 'rights',
        },
        {
          type: 'richText',
          html: S(
            '<p>أدرج خطوات طلب تحديث البيانات أو حذفها وبيانات التواصل المعتمدة.</p>',
            '<p>List the steps to ask for data to be updated or deleted, and the approved contact details.</p>',
          ),
        },
        {
          type: 'cta',
          heading: S('نحن هنا لمساعدتك', 'We are here to help'),
          body: S(
            'تواصل مع فريق الدعم بشأن طلبك أو تفاصيل المنتج.',
            'Contact the support team about your order or a product.',
          ),
          buttonLabel: S('تواصل مع الدعم', 'Contact support'),
          buttonHref: (served === 'ar' ? '' : '/en') + '/contact',
          tone: 'brand',
        },
      ],
    };
  }
  return null;
}

const POST_FIXTURES = [
  {
    slug: 'windows-11-editions',
    title: 'أي إصدار من ويندوز 11 يناسبك؟',
    summary: 'الفرق بين Home وPro وEnterprise، ومتى يستحق الفرق في السعر.',
    minutes: 4,
    publishedAt: '2026-09-01T09:00:00.000Z',
  },
  {
    slug: 'activate-office-2021',
    title: 'كيف تفعّل أوفيس 2021 خطوة بخطوة',
    summary: 'من استلام المفتاح إلى ربطه بحساب مايكروسوفت، مع حل الأخطاء الشائعة.',
    minutes: 5,
    publishedAt: '2026-08-20T09:00:00.000Z',
  },
  {
    slug: 'genuine-vs-grey-keys',
    title: 'ما الفرق بين المفتاح الأصلي والمفتاح الرمادي؟',
    summary: 'لماذا يتوقف بعض المفاتيح الرخيصة عن العمل بعد شهر، وكيف تتأكد قبل الشراء.',
    minutes: 3,
    publishedAt: '2026-08-02T09:00:00.000Z',
  },
  {
    slug: 'windows-10-vs-11',
    title: 'ويندوز 10 أم ويندوز 11: أيهما تختار في 2026؟',
    summary: 'مقارنة سريعة بين الإصدارين في المتطلبات والدعم والأداء.',
    minutes: 6,
    publishedAt: '2026-07-15T09:00:00.000Z',
  },
];

function postCard(p) {
  return {
    slug: p.slug,
    locale: 'ar',
    title: p.title,
    summary: p.summary,
    readingMinutes: p.minutes,
    publishedAt: p.publishedAt,
  };
}

function postFixture(slug, locale, currency) {
  const p = POST_FIXTURES.find((entry) => entry.slug === slug);
  if (!p || locale !== 'ar') return null;
  return {
    ...postCard(p),
    blocks: [
      { type: 'heading', level: 2, text: 'الإصدارات باختصار', id: 'summary' },
      {
        type: 'richText',
        html: '<p>نص نموذجي من الـ fixture للمعاينة فقط. يعرض الفقرات والقوائم والروابط كما تظهر في المقال الحقيقي.</p><ul><li><strong>Home</strong>: للاستخدام المنزلي.</li><li><strong>Pro</strong>: يضيف BitLocker وسطح المكتب البعيد.</li></ul><blockquote>اختر Pro إن كنت تحتاج التشفير أو الدخول عن بعد.</blockquote>',
      },
      {
        type: 'comparison',
        columns: ['Home', 'Pro'],
        rows: [
          { label: 'BitLocker', cells: ['—', '✓'] },
          { label: 'سطح المكتب البعيد', cells: ['—', '✓'] },
        ],
      },
      {
        type: 'faq',
        title: 'أسئلة شائعة',
        items: [
          { q: 'هل يمكن الترقية من Home إلى Pro؟', a: 'نعم، بمفتاح Pro دون إعادة تثبيت.' },
          { q: 'هل يعمل المفتاح على أكثر من جهاز؟', a: 'لا، مفتاح واحد لجهاز واحد.' },
        ],
      },
    ],
    seo: { title: null, description: null },
    updatedAt: p.publishedAt,
    isDraft: false,
    more: POST_FIXTURES.filter((entry) => entry.slug !== slug)
      .slice(0, 3)
      .map(postCard),
    locales: ['ar'],
    products: PRODUCTS.slice(0, 2).map((product) => card(product, locale, currency)),
  };
}

/** The stage-5 routes. Returns true when it answered. */
function stage5(url, send, locale, currency) {
  const path = url.pathname;
  const page = path.match(/^\/v1\/content\/pages\/([a-z0-9-]+)$/);
  if (page) {
    const body = pageFixture(page[1], locale);
    send(body ? 200 : 404, body ?? { statusCode: 404, message: 'no such page' });
    return true;
  }
  if (path === '/v1/content/posts') {
    const posts = locale === 'ar' ? POST_FIXTURES.map(postCard) : [];
    send(200, { posts, total: posts.length });
    return true;
  }
  const post = path.match(/^\/v1\/content\/posts\/([a-z0-9-]+)$/);
  if (post) {
    const body = postFixture(post[1], locale, currency);
    send(body ? 200 : 404, body ?? { statusCode: 404, message: 'no such post' });
    return true;
  }
  if (path === '/v1/content/suggest') {
    const ar = locale === 'ar';
    send(200, {
      suggestions: [
        {
          kind: 'product',
          title: PRODUCTS[0].name[locale],
          href: (ar ? '' : '/en') + '/store/windows-11-pro',
        },
        {
          kind: 'collection',
          title: CATEGORIES[1].name[locale],
          href: (ar ? '' : '/en') + '/collections/office',
        },
        {
          kind: 'page',
          title: ar ? 'الضمان الذهبي' : 'Golden Warranty',
          href: (ar ? '' : '/en') + '/golden-warranty',
        },
      ],
    });
    return true;
  }
  if (path === '/v1/content/redirects') {
    send(404, { statusCode: 404, message: 'no redirect' });
    return true;
  }
  return false;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const locale = url.searchParams.get('locale') === 'en' ? 'en' : 'ar';
  const currency = url.searchParams.get('currency') ?? 'USD';
  const send = (status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': req.headers.origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type, accept',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') return send(204);

  const body = req.method === 'POST' || req.method === 'PATCH' ? await readJson(req) : {};
  if (stage4(req, url, body, send, locale, currency)) return;
  if (stage5(url, send, locale, currency)) return;

  const collectionMatch = url.pathname.match(/^\/v1\/catalog\/collections\/([a-z0-9-]+)$/);
  if (collectionMatch) {
    const c = CATEGORIES.find((entry) => entry.slug === collectionMatch[1]);
    if (!c) return send(404, { statusCode: 404, message: 'no such collection' });
    const items =
      c.slug === 'windows' ? PRODUCTS.filter((p) => p.brand === 'Microsoft') : PRODUCTS.slice(0, 4);
    return send(200, {
      slug: c.slug,
      locale,
      name: c.name[locale],
      headline: c.headline[locale],
      body: [],
      faq: null,
      breadcrumbs: crumbs(locale, { name: c.name[locale], href: '/collections/' + c.slug }),
      children:
        c.slug === 'windows'
          ? [
              {
                slug: 'windows-11',
                name: locale === 'ar' ? 'ويندوز 11' : 'Windows 11',
                productCount: 3,
              },
              {
                slug: 'windows-server',
                name: locale === 'ar' ? 'ويندوز سيرفر' : 'Windows Server',
                productCount: 2,
              },
            ]
          : [],
      siblings: CATEGORIES.map((entry) => ({
        slug: entry.slug,
        name: entry.name[locale],
        productCount: entry.productCount,
      })),
      seo: { title: null, description: null },
      ...listing(items, locale, currency, Number(url.searchParams.get('page') ?? 1), 24),
    });
  }
  const brandMatch = url.pathname.match(/^\/v1\/catalog\/brands\/([a-z0-9-]+)$/);
  if (brandMatch) {
    const name = brandMatch[1][0].toUpperCase() + brandMatch[1].slice(1);
    const items = PRODUCTS.filter((p) => p.brand.toLowerCase() === brandMatch[1]);
    if (items.length === 0) return send(404, { statusCode: 404, message: 'no such brand' });
    return send(200, {
      slug: brandMatch[1],
      locale,
      name,
      website: 'https://www.' + brandMatch[1] + '.com',
      logo: null,
      intro: [],
      breadcrumbs: crumbs(locale, { name, href: '/brands/' + brandMatch[1] }),
      siblings: ['microsoft', 'adobe', 'autodesk', 'kaspersky'].map((b) => ({
        slug: b,
        name: b[0].toUpperCase() + b.slice(1),
        productCount: PRODUCTS.filter((p) => p.brand.toLowerCase() === b).length,
      })),
      seo: { title: null, description: null },
      ...listing(items, locale, currency, 1, 24),
    });
  }

  switch (url.pathname) {
    case '/v1/catalog/home':
      return send(200, home(locale, currency));
    case '/v1/catalog/collections':
      return send(
        200,
        CATEGORIES.map((c) => ({
          slug: c.slug,
          name: c.name[locale],
          headline: c.headline[locale],
          productCount: c.productCount,
          children: 0,
        })),
      );
    case '/v1/catalog/store': {
      const page = Number(url.searchParams.get('page') ?? 1);
      return send(200, {
        ...listing(PRODUCTS, locale, currency, page, 24),
        collections: CATEGORIES.map((c) => ({
          slug: c.slug,
          name: c.name[locale],
          productCount: c.productCount,
        })),
      });
    }
    case '/v1/catalog/search': {
      const q = url.searchParams.get('q') ?? '';
      const hits = PRODUCTS.filter((p) =>
        (p.name.ar + p.name.en + p.brand).toLowerCase().includes(q.toLowerCase()),
      );
      const l = listing(hits, locale, currency, 1, 24);
      return send(200, { q, products: l.products, total: l.total, page: 1, perPage: 24 });
    }
    case '/v1/catalog/products/windows-11-pro':
      return send(200, product(locale, currency));
    case '/v1/reviews/products/windows-11-pro':
      return send(200, reviews('windows-11-pro', locale));
    case '/v1/marketing/public':
      return send(200, marketing);
    // What the shop can take and price in, so the footer's payment bar and the
    // currency control render: the same two the real API offers today.
    case '/v1/payment-methods':
      return send(200, { providers: ['STRIPE', 'PAYPAL'] });
    case '/v1/catalog/currencies':
      return send(200, {
        currencies: [
          { code: 'USD', symbol: '$', decimals: 2 },
          { code: 'SAR', symbol: 'SAR', decimals: 2 },
          { code: 'AED', symbol: 'AED', decimals: 2 },
        ],
      });
    case '/v1/analytics/events':
    case '/v1/content/not-found':
      return send(204);
    default:
      return send(404, { statusCode: 404, message: `mock: no fixture for ${url.pathname}` });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console -- the one line a fixture server prints
  console.log(
    `storefront mock API on http://localhost:${PORT} (home, store, collections, brands, one product with reviews, search, marketing, payment methods, currencies, cart, checkout, orders, account, pages, blog)`,
  );
});
