/**
 * A stand-in for the API, for looking at the panel.
 *
 * The real API runs against the staging database and its crons email real
 * customers, so it is never started for a design pass (CLAUDE.md §3). This
 * answers the reads the main screens make with fixture data in the shapes
 * `@da/contracts` describes, and refuses everything else with a 404 — which
 * is also how a screen's error state gets looked at.
 *
 * Signs nobody in and holds no secret: `me` is always the same demo owner.
 *
 *   node apps/admin/mock/api.mjs            # http://localhost:4000
 *   MOCK_API_PORT=4010 node apps/admin/mock/api.mjs
 */
import { createServer } from 'node:http';

import {
  supplierDynamic,
  supplierRoutes,
  supplierSectionDynamic,
  supplierSectionRoutes,
} from './supplier.mjs';
import { studioDynamic } from './studio.mjs';

const PORT = Number(process.env.MOCK_API_PORT ?? 4000);
const ORIGIN = process.env.MOCK_API_ORIGIN ?? 'http://localhost:3001';

const now = Date.now();
const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
const day = (daysAgo) => new Date(now - daysAgo * 86_400_000).toISOString().slice(0, 10);

const me = {
  email: 'owner@example.com',
  name: 'محمد الصادق',
  role: 'OWNER',
  totpEnrolled: true,
  mustChangePassword: false,
};

const daily = Array.from({ length: 30 }, (_, i) => {
  const d = 29 - i;
  const orders = [0, 1, 2, 3, 1, 4, 2, 5, 3, 2][i % 10] + (d < 5 ? 2 : 0);
  return { date: day(d), revenueUsd: (orders * 37.5 + (i % 3) * 12).toFixed(2), orders };
});

const dashboard = {
  generatedAt: iso(0),
  timeZone: 'Asia/Riyadh',
  today: { revenueUsd: '262.50', orders: 7, previousRevenueUsd: '190.00', previousOrders: 5 },
  last7: { revenueUsd: '1480.00', orders: 41, previousRevenueUsd: '1612.00', previousOrders: 44 },
  last30: { revenueUsd: '6120.00', orders: 168, previousRevenueUsd: '0.00', previousOrders: 0 },
  averageOrderUsd: '36.43',
  refundedUsd: '74.00',
  daily,
  attention: [
    { key: 'queueOverdue', count: 2, severity: 'urgent', fix: '/queue' },
    { key: 'queueWaiting', count: 5, severity: 'due', fix: '/queue' },
    { key: 'paymentReview', count: 1, severity: 'due', fix: '/orders' },
    { key: 'messagesOverdue', count: 1, severity: 'due', fix: '/messages' },
    { key: 'messages', count: 3, severity: 'idle', fix: '/messages' },
    { key: 'reviews', count: 4, severity: 'idle', fix: '/reviews' },
  ],
  topProducts: [
    {
      sku: 'WIN11-PRO',
      slug: 'windows-11-pro',
      name: 'ويندوز 11 برو — Windows 11 Pro',
      qty: 38,
      revenueUsd: '1140.00',
    },
    {
      sku: 'OFF21-PP',
      slug: 'office-2021-pro-plus',
      name: 'أوفيس 2021 بروفيشنال بلس',
      qty: 27,
      revenueUsd: '945.00',
    },
    {
      sku: 'M365-1Y',
      slug: 'microsoft-365-family',
      name: 'مايكروسوفت 365 عائلي — سنة',
      qty: 19,
      revenueUsd: '931.00',
    },
    {
      sku: 'ADBE-CC',
      slug: 'adobe-creative-cloud',
      name: 'Adobe Creative Cloud — 12 شهراً',
      qty: 6,
      revenueUsd: '540.00',
    },
    {
      sku: 'KSP-TOT',
      slug: 'kaspersky-total',
      name: 'كاسبرسكي توتال سكيوريتي',
      qty: 11,
      revenueUsd: '330.00',
    },
  ],
  recentOrders: [
    {
      number: 'DA-2026-01187',
      status: 'PAID',
      email: 'sara.h@example.com',
      totalUsd: '30.00',
      placedAt: iso(12),
      waitingLines: 1,
    },
    {
      number: 'DA-2026-01186',
      status: 'FULFILLED',
      email: 'khaled@example.com',
      totalUsd: '49.00',
      placedAt: iso(55),
      waitingLines: 0,
    },
    {
      number: 'DA-2026-01185',
      status: 'PAYMENT_REVIEW',
      email: 'n.alotaibi@example.com',
      totalUsd: '120.00',
      placedAt: iso(140),
      waitingLines: 2,
    },
    {
      number: 'DA-2026-01184',
      status: 'PENDING_PAYMENT',
      email: 'omar.k@example.com',
      totalUsd: '35.00',
      placedAt: iso(300),
      waitingLines: 0,
    },
    {
      number: 'DA-2026-01183',
      status: 'REFUNDED',
      email: 'lina@example.com',
      totalUsd: '30.00',
      placedAt: iso(1500),
      waitingLines: 0,
    },
  ],
  lifetime: { orders: 2314, revenueUsd: '81204.00', customers: 1880 },
};

const queueRow = (n, over) => ({
  orderItemId: `oi_${n}`,
  orderNumber: `DA-2026-0118${n}`,
  placedAt: iso(over ? 900 : 40 * n),
  paidAt: iso(over ? 880 : 38 * n),
  email: [
    'sara.h@example.com',
    'khaled@example.com',
    'n.alotaibi@example.com',
    'omar.k@example.com',
    'lina@example.com',
  ][n % 5],
  activationEmail: n % 2 ? 'activate.me@example.com' : null,
  sku: ['WIN11-PRO', 'OFF21-PP', 'M365-1Y', 'ADBE-CC', 'KSP-TOT'][n % 5],
  productName: [
    'ويندوز 11 برو — Windows 11 Pro',
    'أوفيس 2021 بروفيشنال بلس',
    'مايكروسوفت 365 عائلي — سنة',
    'Adobe Creative Cloud — 12 شهراً',
    'كاسبرسكي توتال سكيوريتي',
  ][n % 5],
  qty: n % 3 === 0 ? 2 : 1,
  state: 'MANUAL_QUEUE',
  mode: 'MADE_TO_ORDER',
  credentialKind: n % 4 === 0 ? 'ACCOUNT' : 'ACTIVATION_KEY',
  deliverySlaSeconds: 4 * 3600,
  requiresActivationEmail: n % 2 === 1,
  hasKey: false,
  waitingSeconds: (over ? 880 : 38 * n) * 60,
  overdue: over,
});
const queue = {
  rows: [
    queueRow(1, true),
    queueRow(2, true),
    queueRow(3, false),
    queueRow(4, false),
    queueRow(5, false),
  ],
  waiting: 5,
  oldestPaidAt: iso(880),
};

const contact = {
  rows: [
    {
      id: 'c1',
      topic: 'ORDER',
      status: 'NEW',
      name: 'سارة حسن',
      email: 'sara.h@example.com',
      phone: '+966500000001',
      orderNumber: 'DA-2026-01187',
      message: 'لم يصلني مفتاح التفعيل بعد، هل يمكن التحقق؟',
      locale: 'ar',
      customer: { id: 'cu1', orderCount: 3, totalSpentUsd: '110.00' },
      createdAt: iso(1600),
      handledAt: null,
      handledBy: null,
      waitingSeconds: 1600 * 60,
    },
    {
      id: 'c2',
      topic: 'GENERAL',
      status: 'NEW',
      name: 'John Doe',
      email: 'john@example.com',
      phone: null,
      orderNumber: null,
      message: 'Do you sell volume licences for a small office of 12 machines?',
      locale: 'en',
      customer: null,
      createdAt: iso(200),
      handledAt: null,
      handledBy: null,
      waitingSeconds: 200 * 60,
    },
    {
      id: 'c3',
      topic: 'ORDER',
      status: 'HANDLED',
      name: 'عمر خالد',
      email: 'omar.k@example.com',
      phone: null,
      orderNumber: 'DA-2026-01180',
      message: 'أريد تغيير البريد المرتبط بالتفعيل.',
      locale: 'ar',
      customer: { id: 'cu4', orderCount: 1, totalSpentUsd: '35.00' },
      createdAt: iso(3000),
      handledAt: iso(2800),
      handledBy: 'محمد الصادق',
      waitingSeconds: 200 * 60,
    },
  ],
  waiting: 2,
  overdue: 1,
  total: 3,
};

const reviews = {
  rows: [
    {
      id: 'r1',
      status: 'PENDING',
      rating: 5,
      title: 'ممتاز',
      body: 'وصل المفتاح خلال ساعة وعمل من أول مرة.',
      locale: 'ar',
      productSlug: 'windows-11-pro',
      productName: 'ويندوز 11 برو',
      orderNumber: 'DA-2026-01170',
      deliveredAt: iso(5000),
      customerName: 'سارة حسن',
      customerEmail: 'sara.h@example.com',
      storeReply: null,
      repliedAt: null,
      createdAt: iso(400),
    },
    {
      id: 'r2',
      status: 'PENDING',
      rating: 2,
      title: null,
      body: 'Took two days to receive the account. Works fine now.',
      locale: 'en',
      productSlug: 'adobe-creative-cloud',
      productName: 'Adobe Creative Cloud',
      orderNumber: 'DA-2026-01150',
      deliveredAt: iso(9000),
      customerName: null,
      customerEmail: 'john@example.com',
      storeReply: null,
      repliedAt: null,
      createdAt: iso(2000),
    },
  ],
  counts: { pending: 4, approved: 212, rejected: 9 },
};

const orderRow = (n, status, risk, extra = {}) => ({
  number: `DA-2026-0118${n}`,
  status,
  email: [
    'sara.h@example.com',
    'khaled@example.com',
    'n.alotaibi@example.com',
    'omar.k@example.com',
    'lina@example.com',
  ][n % 5],
  customerName: ['سارة حسن', 'خالد العمري', null, 'عمر خالد', 'Lina M.'][n % 5],
  currency: n % 2 ? 'SAR' : 'USD',
  total: n % 2 ? '112.50' : '30.00',
  totalUsd: n % 2 ? '30.00' : '30.00',
  itemCount: 1 + (n % 2),
  waitingLines: status === 'PAID' ? 1 : 0,
  riskLevel: risk,
  placedAt: iso(60 * n + 10),
  paidAt: status === 'PENDING_PAYMENT' ? null : iso(60 * n),
  payments: [
    {
      provider: n % 3 === 0 ? 'BANK_TRANSFER' : 'FINAL_PROCESSOR',
      testMode: false,
      state: status === 'PENDING_PAYMENT' ? 'PENDING' : 'SUCCEEDED',
      reference: n % 3 === 0 ? null : `fp_${n}8a1`,
      amount: n % 2 ? '112.50' : '30.00',
      currency: n % 2 ? 'SAR' : 'USD',
      createdAt: iso(60 * n + 9),
    },
  ],
  ...extra,
});
const orders = {
  rows: [
    orderRow(7, 'PAID', 'LOW'),
    orderRow(6, 'FULFILLED', 'LOW'),
    orderRow(5, 'PAYMENT_REVIEW', 'HIGH'),
    orderRow(4, 'PENDING_PAYMENT', 'LOW'),
    orderRow(3, 'REFUNDED', 'MEDIUM'),
    orderRow(2, 'COMPLETED', 'LOW'),
  ],
  page: 1,
  hasMore: true,
  counts: { all: 2314, awaitingPayment: 3, paid: 2290, inReview: 1 },
};

const customers = {
  rows: [
    {
      id: 'cu1',
      email: 'sara.h@example.com',
      name: 'سارة حسن',
      paidOrders: 3,
      totalSpentUsd: '110.00',
      lastOrderAt: iso(12),
      marketingEmail: 'OPTED_IN',
      createdAt: iso(90000),
    },
    {
      id: 'cu2',
      email: 'khaled@example.com',
      name: 'خالد العمري',
      paidOrders: 3,
      totalSpentUsd: '110.00',
      lastOrderAt: iso(55),
      marketingEmail: 'OPTED_OUT',
      createdAt: iso(400),
    },
    {
      id: 'cu3',
      email: 'n.alotaibi@example.com',
      name: null,
      paidOrders: 0,
      totalSpentUsd: '0.00',
      lastOrderAt: iso(140),
      marketingEmail: 'OPTED_OUT',
      createdAt: iso(140),
    },
    {
      id: 'cu5',
      email: 'lina@example.com',
      name: 'Lina M.',
      paidOrders: 2,
      totalSpentUsd: '60.00',
      lastOrderAt: iso(1500),
      marketingEmail: 'OPTED_IN',
      createdAt: iso(50000),
    },
  ],
  page: 1,
  hasMore: false,
};

const productRow = (i) => {
  const names = [
    ['ويندوز 11 برو', 'Windows 11 Pro', 'windows-11-pro', 'PUBLISHED', 'KEY'],
    [
      'أوفيس 2021 بروفيشنال بلس',
      'Office 2021 Professional Plus',
      'office-2021-pro-plus',
      'PUBLISHED',
      'KEY',
    ],
    ['مايكروسوفت 365 عائلي', 'Microsoft 365 Family', 'microsoft-365-family', 'DRAFT', 'ACCOUNT'],
    ['Adobe Creative Cloud', null, 'adobe-creative-cloud', 'DRAFT', 'ACCOUNT'],
    ['كاسبرسكي توتال سكيوريتي', 'Kaspersky Total Security', 'kaspersky-total', 'ARCHIVED', 'KEY'],
    ['ويندوز سيرفر 2022', 'Windows Server 2022', 'windows-server-2022', 'PUBLISHED', 'KEY'],
  ][i % 6];
  return {
    slug: names[2] + (i >= 6 ? `-${i}` : ''),
    nameAr: names[0],
    nameEn: names[1],
    status: names[3],
    kind: names[4],
    brand: i % 3 === 0 ? 'Microsoft' : i % 3 === 1 ? 'Adobe' : null,
    primaryCategory: i % 2 ? 'أنظمة التشغيل' : 'برامج المكتب',
    variantCount: 1 + (i % 3),
    stock: i % 4 === 0 ? 0 : i % 4 === 1 ? 12 : null,
    stockedVariantCount: i % 4 < 2 ? 1 : 0,
    priceFromUsd: i % 5 === 0 ? null : (29 + i * 3).toFixed(2),
    hasGoldenWarranty: i % 2 === 0,
    salesCount: 120 - i * 7,
    imageCount: i % 3,
    activationSteps: { ar: i % 2 ? 4 : 0, en: i % 3 ? 3 : 0 },
    blockers: names[3] === 'DRAFT' ? (i % 2) + 1 : 0,
    warnings: i % 2,
  };
};
const products = {
  rows: Array.from({ length: 12 }, (_, i) => productRow(i)),
  total: 73,
  page: 1,
  perPage: 50,
  counts: { all: 73, draft: 41, published: 30, outOfStock: 2, blocked: 11, ready: 30 },
};

const categories = {
  rows: [
    {
      id: 'cat1',
      slug: 'operating-systems',
      parentId: null,
      position: 0,
      status: 'PUBLISHED',
      nameAr: 'أنظمة التشغيل',
      nameEn: 'Operating systems',
      headlineAr: 'ويندوز وسيرفر بترخيص أصلي',
      headlineEn: 'Windows and Server, genuine',
      productCount: 9,
    },
    {
      id: 'cat2',
      slug: 'office',
      parentId: null,
      position: 1,
      status: 'PUBLISHED',
      nameAr: 'برامج المكتب',
      nameEn: 'Office suites',
      headlineAr: 'أوفيس لكل الأجهزة',
      headlineEn: 'Office for every device',
      productCount: 7,
    },
    {
      id: 'cat3',
      slug: 'security',
      parentId: null,
      position: 2,
      status: 'DRAFT',
      nameAr: 'الحماية',
      nameEn: 'Security',
      headlineAr: '',
      headlineEn: '',
      productCount: 0,
    },
  ],
};

const launch = {
  canSell: false,
  checks: [
    {
      key: 'paymentMethod',
      severity: 'blocker',
      title: 'لا توجد طريقة دفع مفعّلة',
      detail: 'لم تُفعّل أي طريقة دفع بعد، فلا يمكن للمتجر قبض المال.',
      fix: '/payments',
    },
    {
      key: 'publishedProducts',
      severity: 'warning',
      title: 'منتجات منشورة قليلة',
      detail: '30 منتجاً منشوراً من 73.',
      fix: '/products',
    },
    {
      key: 'redirects',
      severity: 'ready',
      title: 'التوجيهات جاهزة',
      detail: '214 توجيهاً نشطاً من الموقع القديم.',
      fix: '/redirects',
    },
    {
      key: 'smtp',
      severity: 'ready',
      title: 'البريد يعمل',
      detail: 'آخر رسالة سُلّمت قبل 12 دقيقة.',
      fix: null,
    },
  ],
};

const marketing = Object.fromEntries(
  [
    'cartRecovery',
    'renewals',
    'offers',
    'trust',
    'reviewRequests',
    'socialProof',
    'seasonal',
    'business',
    'welcome',
    'referral',
    'whatsapp',
  ].map((feature, i) => [feature, { enabled: i % 2 === 0 }]),
);

// --- one order, opened --------------------------------------------------------

const orderDetail = (number) => {
  const n = Number(number.slice(-1)) || 7;
  const row = orders.rows.find((r) => r.number === number);
  if (!row) return undefined;
  const delivered = row.status === 'FULFILLED' || row.status === 'COMPLETED';
  return {
    ...row,
    customer:
      n % 5 === 2
        ? null
        : {
            id: `cu${n}`,
            name: row.customerName,
            phone: n % 2 ? '+966500000001' : null,
            whatsappPhone: n % 2 ? '+966500000001' : null,
            company: n % 3 === 0 ? 'شركة النور للتقنية' : null,
            locale: n % 4 === 0 ? 'en' : 'ar',
            riskLevel: row.riskLevel,
            paidOrders: 3,
            totalSpentUsd: '110.00',
            marketingEmail: n % 3 === 0 ? 'OPTED_OUT' : 'OPTED_IN',
            whatsappOptIn: n % 2 === 1,
            createdAt: iso(90000),
          },
    billing: {
      name: row.customerName,
      company: null,
      vat: n % 3 === 0 ? '300012345600003' : null,
      country: 'SA',
    },
    amounts: {
      subtotalUsd: '32.00',
      discountUsd: '2.00',
      taxUsd: '0.00',
      totalUsd: '30.00',
      currency: row.currency,
      fxRate: row.currency === 'SAR' ? '3.75' : '1',
      charged: row.status === 'PENDING_PAYMENT' ? null : { amount: '30.00', currency: 'USD' },
    },
    client: {
      ip: '185.12.34.56',
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    },
    history: [
      {
        id: 'h1',
        from: null,
        to: 'PENDING_PAYMENT',
        actorType: 'SYSTEM',
        actor: null,
        reason: null,
        createdAt: iso(60 * n + 10),
      },
      ...(row.status !== 'PENDING_PAYMENT'
        ? [
            {
              id: 'h2',
              from: 'PENDING_PAYMENT',
              to: row.status === 'PAYMENT_REVIEW' ? 'PAYMENT_REVIEW' : 'PAID',
              actorType: 'PROVIDER',
              actor: 'fp_78a1',
              reason: null,
              createdAt: iso(60 * n),
            },
          ]
        : []),
      ...(delivered
        ? [
            {
              id: 'h3',
              from: 'PAID',
              to: row.status,
              actorType: 'STAFF',
              actor: 'محمد الصادق',
              reason: 'سُلّم يدوياً',
              createdAt: iso(60 * n - 20),
            },
          ]
        : []),
    ],
    activationEmail: n % 2 ? 'activate.me@example.com' : null,
    couponCode: n % 3 === 0 ? 'WELCOME10' : null,
    locale: 'ar',
    lines: [
      {
        orderItemId: `oi_${n}a`,
        sku: 'WIN11-PRO',
        productName: 'ويندوز 11 برو — Windows 11 Pro',
        qty: 1,
        unitPrice: '30.00',
        lineTotal: '30.00',
        fulfillmentState: delivered
          ? 'DELIVERED'
          : row.status === 'PENDING_PAYMENT'
            ? 'PENDING'
            : 'MANUAL_QUEUE',
        deliveredAt: delivered ? iso(60 * n - 20) : null,
        credentialKind: 'ACTIVATION_KEY',
        expiresAt: null,
      },
      ...(n % 2 === 0
        ? [
            {
              orderItemId: `oi_${n}b`,
              sku: 'M365-1Y',
              productName: 'مايكروسوفت 365 عائلي — سنة',
              qty: 1,
              unitPrice: '49.00',
              lineTotal: '49.00',
              fulfillmentState: delivered
                ? 'DELIVERED'
                : row.status === 'PENDING_PAYMENT'
                  ? 'PENDING'
                  : 'AUTO_ASSIGNED',
              deliveredAt: delivered ? iso(60 * n - 20) : null,
              credentialKind: 'ACCOUNT_CREDENTIALS',
              expiresAt: delivered ? new Date(now + 300 * 86_400_000).toISOString() : null,
            },
          ]
        : []),
    ],
    notes: [
      {
        id: 'n1',
        body: 'العميل طلب التفعيل على بريد العمل بدل البريد الشخصي.',
        author: 'محمد الصادق',
        isCustomerVisible: false,
        createdAt: iso(60 * n - 5),
      },
      ...(n % 2
        ? [
            {
              id: 'n2',
              body: 'سيصلك المفتاح خلال ساعة من تأكيد الدفع.',
              author: 'سارة',
              isCustomerVisible: true,
              createdAt: iso(60 * n - 2),
            },
          ]
        : []),
    ],
    emails: [
      {
        template: 'order.received',
        to: row.email,
        sentAt: iso(60 * n + 9),
        deliveredAt: iso(60 * n + 8),
        bouncedAt: null,
        error: null,
      },
      ...(delivered
        ? [
            {
              template: 'licence.delivered',
              to: row.email,
              sentAt: iso(60 * n - 20),
              deliveredAt: iso(60 * n - 19),
              bouncedAt: null,
              error: null,
            },
          ]
        : []),
      ...(n % 4 === 0
        ? [
            {
              template: 'review.invite',
              to: row.email,
              sentAt: iso(30),
              deliveredAt: null,
              bouncedAt: iso(29),
              error: 'mailbox full',
            },
          ]
        : []),
    ],
    finalProcessor:
      row.payments[0].provider === 'FINAL_PROCESSOR' && row.status !== 'PENDING_PAYMENT'
        ? {
            paymentId: `fp_${n}8a1`,
            testMode: false,
            state: row.status === 'REFUNDED' ? 'REFUNDED' : 'SUCCEEDED',
            paidAt: iso(60 * n),
            amountUsd: '30.00',
            refundedUsd: row.status === 'REFUNDED' ? '30.00' : '0.00',
            refundableUsd: row.status === 'REFUNDED' ? '0.00' : '30.00',
            refunds:
              row.status === 'REFUNDED'
                ? [
                    {
                      id: 'rf1',
                      amountUsd: '30.00',
                      status: 'SUCCEEDED',
                      reason: 'طلب العميل',
                      refundId: 're_1',
                      refundRef: 're_1',
                      failureCode: null,
                      createdAt: iso(10),
                    },
                  ]
                : [],
          }
        : null,
  };
};

const orderKeys = (number) => {
  const n = Number(number.slice(-1)) || 7;
  const delivered = ['DA-2026-01186', 'DA-2026-01182'].includes(number);
  return [
    {
      orderItemId: `oi_${n}a`,
      sku: 'WIN11-PRO',
      productName: 'ويندوز 11 برو',
      state: delivered ? 'DELIVERED' : 'MANUAL_QUEUE',
      deliveredAt: delivered ? iso(60 * n - 20) : null,
      // DA-2026-01187: a pasted code whose email failed, written before
      // BUG-0029 was fixed: the line still says MANUAL_QUEUE, the key is bound.
      keys: delivered
        ? [{ licenseKeyId: `lk_${n}`, state: 'DELIVERED', deliveredAt: iso(60 * n - 20) }]
        : number === 'DA-2026-01187'
          ? [{ licenseKeyId: `lk_${n}`, state: 'ASSIGNED', deliveredAt: null }]
          : [],
    },
  ];
};

/** Paths with a parameter in them, matched after the exact table above. */
const dynamic = [
  ...supplierDynamic,
  ...supplierSectionDynamic,
  ...studioDynamic,
  [/^GET \/v1\/admin\/orders\/([^/]+)$/, (m) => orderDetail(decodeURIComponent(m[1]))],
  [
    /^GET \/v1\/admin\/fulfillment\/orders\/([^/]+)\/keys$/,
    (m) => orderKeys(decodeURIComponent(m[1])),
  ],
  [
    /^POST \/v1\/admin\/orders\/([^/]+)\/messages$/,
    (m, body) => {
      const kind = body?.kind ?? 'custom';
      const template =
        {
          payment_received: 'order.payment_received',
          review_request: 'review.invite',
          renewal_reminder: 'renewal.reminder',
          offer: 'admin.offer',
          custom: 'admin.message',
        }[kind] ?? 'admin.message';
      return {
        sent: true,
        to: 'sara.h@example.com',
        template,
        code: kind === 'offer' ? 'OFFER-DEMO1234' : null,
        skipped: null,
      };
    },
  ],
  [/^POST \/v1\/admin\/orders\/([^/]+)\/notes$/, () => ({ id: 'n_new' })],
  [/^POST \/v1\/admin\/orders\/([^/]+)\/confirm-payment$/, () => ({ ok: true })],
  [/^POST \/v1\/admin\/orders\/([^/]+)\/release-hold$/, () => ({ ok: true })],
  [
    /^POST \/v1\/admin\/orders\/([^/]+)\/refund$/,
    () => ({ via: 'recorded', status: 'REFUNDED', refund: null }),
  ],
  [
    /^POST \/v1\/admin\/orders\/([^/]+)\/lines\/([^/]+)\/resend$/,
    () => ({ to: 'sara.h@example.com' }),
  ],
  [
    /^POST \/v1\/admin\/fulfillment\/queue\/([^/]+)\/(fulfil|deliver)$/,
    () => ({ state: 'DELIVERED', deliveredAt: iso(0) }),
  ],
  [/^POST \/v1\/admin\/fulfillment\/queue\/([^/]+)\/fail$/, () => ({ state: 'FAILED' })],
];

const routes = new Map([
  ['GET /v1/auth/staff/me', me],
  ['POST /v1/auth/staff/refresh', { ok: true }],
  ['POST /v1/auth/staff/logout', { ok: true }],
  ['POST /v1/auth/staff/login', { outcome: 'ok', staff: me }],
  ['GET /v1/admin/dashboard', dashboard],
  ['GET /v1/admin/fulfillment/queue', queue],
  ['GET /v1/admin/contact', contact],
  ['GET /v1/admin/reviews', reviews],
  ['GET /v1/admin/orders', orders],
  ['GET /v1/admin/customers', customers],
  ['GET /v1/admin/products', products],
  ['GET /v1/admin/categories', categories],
  ['GET /v1/admin/launch', launch],
  ['GET /v1/admin/marketing/settings', marketing],
  ...supplierRoutes,
  ...supplierSectionRoutes,
]);

createServer(async (req, res) => {
  const origin = req.headers.origin ?? ORIGIN;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const parsed = (() => {
    try {
      return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    } catch {
      return null;
    }
  })();
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-allow-headers', 'content-type, accept-language');
  res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('vary', 'origin');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const key = `${req.method} ${path}`;
  let body = routes.get(key);
  if (body === undefined) {
    for (const [pattern, answer] of dynamic) {
      const match = pattern.exec(key);
      if (match) {
        body = answer(match, parsed);
        break;
      }
    }
  }
  res.setHeader('content-type', 'application/json; charset=utf-8');
  if (body === undefined) {
    res.writeHead(404);
    res.end(JSON.stringify({ message: `mock: no fixture for ${req.method} ${path}` }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify(body));
}).listen(PORT, () => {
  // The one line this server prints: where it is. Not a log, a banner.
  console.warn(`mock admin API on http://localhost:${PORT} for ${ORIGIN}`);
});
