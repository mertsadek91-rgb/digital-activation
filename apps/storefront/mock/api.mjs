/**
 * A stand-in for the API, for looking at the storefront.
 *
 * The real API runs against the staging database and its crons email real
 * customers, so it is never started for a design pass (CLAUDE.md §3). This
 * answers the reads the home page, the header and the footer make with
 * fixture data in the shapes `@da/contracts` describes, and refuses
 * everything else with a 404 — which is also how a page's empty state gets
 * looked at. Nothing is written anywhere: the cart answers 404, so the header
 * shows no count, and analytics are swallowed.
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

/** One line of the one product, at its price: what `MOCK_CART=1` answers. */
function cart(locale, currency) {
  const base = PRODUCTS[0];
  const unit = price('19.99', null, currency);
  return {
    token: 'mock-cart',
    locale,
    currency,
    lines: [
      {
        id: 'line_1',
        variantId: 'var_windows-11-pro',
        sku: 'WIN11-PRO-1',
        productSlug: base.slug,
        productName: base.name[locale],
        licensePeriodValue: null,
        licensePeriodUnit: 'LIFETIME',
        deviceCount: 1,
        activationMethod: 'RETAIL_ONLINE',
        deliverySlaSeconds: 300,
        fulfillmentMode: 'FROM_STOCK',
        requiresActivationEmail: false,
        image: null,
        qty: 1,
        unitPrice: unit,
        lineTotal: unit,
        priceChanged: null,
        availableToAdd: 9,
        fromCrossSell: false,
        sale: null,
        saleEnded: false,
      },
    ],
    itemCount: 1,
    subtotal: unit,
    discount: price('0', null, currency),
    total: unit,
    coupon: null,
    couponError: null,
    automaticDiscount: null,
    couponSuperseded: false,
    volume: null,
    reservationExpiresAt: null,
    adjustments: [],
  };
}

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

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const locale = url.searchParams.get('locale') === 'en' ? 'en' : 'ar';
  const currency = url.searchParams.get('currency') ?? 'USD';
  const send = (status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': req.headers.origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type, accept',
    });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') return send(204);

  // A one-line cart, only when asked for (`MOCK_CART=1`): the Lighthouse run
  // measures `/cart?add=<variant>` with a line in it, as CI does. Without the
  // flag the cart keeps answering 404, which is the empty state a design pass
  // wants to look at.
  if (process.env.MOCK_CART === '1' && url.pathname.startsWith('/v1/cart')) {
    if (url.pathname === '/v1/cart' || url.pathname === '/v1/cart/items') {
      return send(200, cart(locale, currency));
    }
    return send(404, { statusCode: 404, message: `mock: no cart fixture for ${url.pathname}` });
  }
  if (process.env.MOCK_CART === '1' && url.pathname === '/v1/offers/suggestions') {
    return send(200, { items: [], licenceNumber: 'DL-0000' });
  }

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
    `storefront mock API on http://localhost:${PORT} (home, store, collections, brands, one product with reviews, search, marketing, payment methods, currencies)`,
  );
});
