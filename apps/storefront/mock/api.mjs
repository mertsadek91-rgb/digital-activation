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
    `storefront mock API on http://localhost:${PORT} (home, collections, marketing, payment methods, currencies)`,
  );
});
