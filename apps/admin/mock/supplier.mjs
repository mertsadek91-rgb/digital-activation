/**
 * Supplier price sheet fixtures (CR-0004) for the admin mock API.
 *
 * Invented lines in the shape the supplier's sheet produces: a struck
 * (out-of-stock) line, a line without a price, a wholesale-only line, one gone
 * from the sheet, and a few linked to our variants with price proposals,
 * including a large change.
 */
const now = new Date('2026-10-05T12:00:00Z').toISOString();
const days = (n) => new Date(Date.parse(now) - n * 86_400_000).toISOString();

const source = {
  id: 'src_1',
  name: 'Tikeys',
  spreadsheetId: '1eHCuShPggYvdy_dWbJwmljxWEoNv-65f_MCFSLK4-I0',
  sheetGid: 0,
  url: 'https://docs.google.com/spreadsheets/d/1eHCuShPggYvdy_dWbJwmljxWEoNv-65f_MCFSLK4-I0/edit#gid=0',
  markupPercent: '50.00',
  rounding: 'CENTS',
  autoSync: true,
  lastSyncAt: days(0.02),
  lastSyncStatus: 'OK',
  lastSyncError: null,
  sheetUpdatedLabel: '2026-09-30',
  readerConfigured: true,
};

const item = (id, row, name, category, cost, extra = {}) => ({
  id,
  name,
  category,
  costUsd: cost,
  priceText: cost ? `$${cost}` : null,
  warranty: '7 days',
  remarks: null,
  outOfStock: false,
  partialStrike: false,
  wholesaleOnly: false,
  rowNumber: row,
  firstSeenAt: days(5),
  lastSeenAt: days(0.02),
  missingSince: null,
  changedAt: null,
  links: [],
  ...extra,
});

const items = [
  item('it_1', 5, 'Windows 11/10 Pro Retail Key 1 PC', 'Windows Key', '1.50', {
    remarks: 'Hot Sale',
    links: [{ variantId: 'v_1', sku: 'WIN11-PRO-1PC', productSlug: 'windows-11-pro' }],
  }),
  item('it_2', 8, 'Windows 11/10 Pro Retail Key 5 PC', 'Windows Key', '35.00'),
  item('it_3', 31, 'Office 2021 Professional Plus Retail Bind Key 1 PC', 'Office 2021', null, {
    remarks: 'Price fluctuation',
  }),
  item('it_4', 52, 'Office 365 E3 5 Device 1TB Lifetime Account+Password', 'Office 365', '3.00', {
    outOfStock: true,
    warranty: '1 Year',
    remarks: 'New',
    changedAt: days(1),
    links: [{ variantId: 'v_3', sku: 'O365-E3-5D', productSlug: 'office-365-e3' }],
  }),
  item(
    'it_5',
    44,
    'Windows USB Box Full Package With OEM Key MOQ≥30 pieces, Free Delivery',
    'Windows COA/DVD/USB Box',
    '18.00',
    {
      wholesaleOnly: true,
      warranty: '1 Year',
    },
  ),
  item('it_6', 120, 'ESET NOD32 Antivirus 1 Device 1 Year', 'ESET', '4.20', {
    changedAt: days(2),
    warranty: 'Subscription period',
    links: [{ variantId: 'v_2', sku: 'ESET-NOD32-1D1Y', productSlug: 'eset-nod32' }],
  }),
  item('it_7', null, 'Kaspersky Standard 1 Device 1 Year', 'Kaspersky', '6.00', {
    missingSince: days(3),
  }),
];

const counts = {
  all: items.length,
  linked: items.filter((i) => i.links.length).length,
  unlinked: items.filter((i) => !i.links.length && !i.missingSince).length,
  out: items.filter((i) => i.outOfStock).length,
  missing: items.filter((i) => i.missingSince).length,
  nocost: items.filter((i) => !i.costUsd).length,
  changed: items.filter((i) => i.changedAt).length,
};

const ref = (i) => ({
  id: i.id,
  name: i.name,
  category: i.category,
  costUsd: i.costUsd,
  outOfStock: i.outOfStock,
  missingSince: i.missingSince,
});

const mappingRows = [
  {
    variantId: 'v_1',
    sku: 'WIN11-PRO-1PC',
    productSlug: 'windows-11-pro',
    productName: 'ويندوز 11 برو',
    terms: 'مدى الحياة · 1 جهاز',
    priceUsd: '2.00',
    supplierOutOfStock: false,
    link: { item: ref(items[0]), markupPercent: null, followStock: true },
    suggestions: [],
  },
  {
    variantId: 'v_2',
    sku: 'ESET-NOD32-1D1Y',
    productSlug: 'eset-nod32',
    productName: 'إيسيت نود 32',
    terms: '1 سنة · 1 جهاز',
    priceUsd: '5.99',
    supplierOutOfStock: false,
    link: { item: ref(items[5]), markupPercent: '40.00', followStock: true },
    suggestions: [],
  },
  {
    variantId: 'v_3',
    sku: 'O365-E3-5D',
    productSlug: 'office-365-e3',
    productName: 'أوفيس 365 E3',
    terms: 'مدى الحياة · 5 جهاز',
    priceUsd: '9.00',
    supplierOutOfStock: true,
    link: { item: ref(items[3]), markupPercent: null, followStock: true },
    suggestions: [],
  },
  {
    variantId: 'v_4',
    sku: 'WIN11-PRO-5PC',
    productSlug: 'windows-11-pro',
    productName: 'ويندوز 11 برو',
    terms: 'مدى الحياة · 5 جهاز',
    priceUsd: '49.00',
    supplierOutOfStock: false,
    link: null,
    suggestions: [
      { ...ref(items[1]), score: 0.86 },
      { ...ref(items[0]), score: 0.55 },
    ],
  },
  {
    variantId: 'v_5',
    sku: 'KAS-STD-1D1Y',
    productSlug: 'kaspersky-standard',
    productName: 'كاسبرسكي ستاندرد',
    terms: '1 سنة · 1 جهاز',
    priceUsd: '9.00',
    supplierOutOfStock: true,
    link: { item: ref(items[6]), markupPercent: null, followStock: true },
    suggestions: [{ ...ref(items[5]), score: 0.31 }],
  },
];

const mapping = {
  rows: mappingRows,
  counts: { all: 5, linked: 3, unlinked: 1, broken: 1 },
};

const prices = {
  pending: 2,
  rows: [
    {
      variantId: 'v_1',
      sku: 'WIN11-PRO-1PC',
      productSlug: 'windows-11-pro',
      productName: 'ويندوز 11 برو',
      terms: 'مدى الحياة · 1 جهاز',
      itemName: items[0].name,
      costUsd: '1.50',
      lastAppliedCostUsd: '1.30',
      markupPercent: '50.00',
      markupFromLink: false,
      currentPriceUsd: '2.00',
      proposedPriceUsd: '2.25',
      change: 0.125,
      large: false,
      state: 'PENDING',
    },
    {
      variantId: 'v_2',
      sku: 'ESET-NOD32-1D1Y',
      productSlug: 'eset-nod32',
      productName: 'إيسيت نود 32',
      terms: '1 سنة · 1 جهاز',
      itemName: items[5].name,
      costUsd: '4.20',
      lastAppliedCostUsd: '3.00',
      markupPercent: '40.00',
      markupFromLink: true,
      currentPriceUsd: '4.20',
      proposedPriceUsd: '5.88',
      change: 0.4,
      large: true,
      state: 'PENDING',
    },
    {
      variantId: 'v_3',
      sku: 'O365-E3-5D',
      productSlug: 'office-365-e3',
      productName: 'أوفيس 365 E3',
      terms: 'مدى الحياة · 5 جهاز',
      itemName: items[3].name,
      costUsd: '3.00',
      lastAppliedCostUsd: '3.00',
      markupPercent: '50.00',
      markupFromLink: false,
      currentPriceUsd: '4.50',
      proposedPriceUsd: '4.50',
      change: 0,
      large: false,
      state: 'CURRENT',
    },
    {
      variantId: 'v_5',
      sku: 'KAS-STD-1D1Y',
      productSlug: 'kaspersky-standard',
      productName: 'كاسبرسكي ستاندرد',
      terms: '1 سنة · 1 جهاز',
      itemName: items[6].name,
      costUsd: '6.00',
      lastAppliedCostUsd: '6.00',
      markupPercent: '50.00',
      markupFromLink: false,
      currentPriceUsd: '9.00',
      proposedPriceUsd: '9.00',
      change: 0,
      large: false,
      state: 'MISSING',
    },
  ],
};

const log = {
  snapshots: [
    {
      id: 's3',
      fetchedAt: days(0.02),
      status: 'OK',
      error: null,
      sheetUpdatedLabel: '2026-09-30',
      rowCount: 321,
      added: 2,
      changed: 3,
      removed: 1,
      stockSwitched: 2,
      manual: true,
    },
    {
      id: 's2',
      fetchedAt: days(0.06),
      status: 'UNCHANGED',
      error: null,
      sheetUpdatedLabel: '2026-09-30',
      rowCount: 320,
      added: 0,
      changed: 0,
      removed: 0,
      stockSwitched: 0,
      manual: false,
    },
    {
      id: 's1',
      fetchedAt: days(1),
      status: 'REFUSED',
      error:
        'The sheet now has 12 rows, down from 320. That looks like a broken read, so nothing was changed.',
      sheetUpdatedLabel: null,
      rowCount: 12,
      added: 0,
      changed: 0,
      removed: 0,
      stockSwitched: 0,
      manual: false,
    },
  ],
  changes: [
    {
      id: 'c1',
      createdAt: days(0.02),
      itemId: 'it_6',
      itemName: items[5].name,
      kind: 'COST',
      before: '3.00',
      after: '4.20',
    },
    {
      id: 'c2',
      createdAt: days(0.02),
      itemId: 'it_4',
      itemName: items[3].name,
      kind: 'STOCK',
      before: false,
      after: true,
    },
    {
      id: 'c3',
      createdAt: days(0.02),
      itemId: 'it_7',
      itemName: items[6].name,
      kind: 'REMOVED',
      before: null,
      after: null,
    },
  ],
  actions: [
    {
      id: 'a1',
      createdAt: days(0.02),
      action: 'variant.supplier_stock',
      actor: null,
      entityId: 'v_3',
      before: { sku: 'O365-E3-5D', supplierOutOfStock: false },
      after: { sku: 'O365-E3-5D', supplierOutOfStock: true },
    },
    {
      id: 'a2',
      createdAt: days(0.5),
      action: 'variant.supplier_price_applied',
      actor: 'Demo Owner',
      entityId: 'v_3',
      before: { sku: 'O365-E3-5D', priceUsd: '4.00' },
      after: { sku: 'O365-E3-5D', priceUsd: '4.50' },
    },
    {
      id: 'a3',
      createdAt: days(1),
      action: 'supplier.link_set',
      actor: 'Demo Owner',
      entityId: 'v_2',
      before: null,
      after: { sku: 'ESET-NOD32-1D1Y', itemName: items[5].name },
    },
  ],
};

const aiStatus = {
  model: 'claude-sonnet-5-5',
  protocol: 'auto',
  temperature: 0.5,
  instructions: '',
  configured: true,
  resolvedProtocol: 'messages',
};

const aiModels = {
  models: [
    { id: 'claude-haiku-4-5', protocol: 'messages', family: 'claude' },
    { id: 'claude-sonnet-5-5', protocol: 'messages', family: 'claude' },
    { id: 'gemini-3.8-flash', protocol: 'gemini', family: 'gemini' },
    { id: 'gpt-6-sol', protocol: 'responses', family: 'gpt' },
    { id: 'kimi-k3', protocol: 'chat', family: 'kimi' },
  ],
};

const aiCopy = {
  model: 'claude-sonnet-5-5',
  notes: [],
  ar: {
    shortDesc: 'مفتاح Windows 11 Pro أصلي للتفعيل الدائم على جهاز واحد، يصلك على بريدك خلال دقائق.',
    seoTitle: 'مفتاح Windows 11 Pro أصلي | تفعيل دائم وتسليم فوري',
    seoDescription:
      'اشترِ مفتاح Windows 11 Pro أصلي لجهاز واحد بتفعيل دائم. يصلك المفتاح على بريدك خلال دقائق مع دعم عبر واتساب ودفع آمن.',
    keywords: [
      'مفتاح ويندوز 11 برو',
      'تفعيل Windows 11 Pro',
      'شراء ويندوز 11 برو',
      'سعر مفتاح ويندوز 11',
    ],
    blocks: [
      {
        type: 'answerFirst',
        text: 'مفتاح Windows 11 Pro أصلي يفعّل نسختك على جهاز واحد تفعيلاً دائماً، ويصلك على بريدك الإلكتروني خلال دقائق من الدفع.',
      },
      { type: 'heading', level: 2, text: 'ماذا تحصل عليه' },
      {
        type: 'richText',
        html: '<ul><li>مفتاح تفعيل Retail لجهاز واحد</li><li>تسليم فوري على البريد</li><li>دعم عبر واتساب</li></ul>',
      },
      {
        type: 'steps',
        title: 'طريقة التفعيل',
        steps: [
          { text: 'افتح الإعدادات ثم التنشيط.' },
          { text: 'اختر تغيير مفتاح المنتج وأدخل المفتاح.' },
        ],
      },
      {
        type: 'faq',
        title: 'أسئلة شائعة',
        items: [{ q: 'هل التفعيل دائم؟', a: 'نعم، المفتاح لترخيص دائم لجهاز واحد.' }],
      },
    ],
  },
  en: {
    shortDesc:
      'A genuine Windows 11 Pro key for permanent activation on one PC, delivered to your inbox in minutes.',
    seoTitle: 'Windows 11 Pro Key | Genuine, Instant Delivery',
    seoDescription:
      'Buy a genuine Windows 11 Pro retail key for one PC with permanent activation. Delivered by email within minutes, with WhatsApp support.',
    keywords: ['windows 11 pro key', 'buy windows 11 pro', 'windows 11 pro activation'],
    blocks: [
      {
        type: 'answerFirst',
        text: 'A genuine Windows 11 Pro retail key that activates one PC permanently, delivered by email within minutes of payment.',
      },
      { type: 'heading', level: 2, text: 'What you get' },
      {
        type: 'richText',
        html: '<p>One retail activation key, instant email delivery and WhatsApp support.</p>',
      },
    ],
  },
};

const cardSpec = {
  title: 'Windows 11 Pro',
  ribbon: ['مدى', 'الحياة'],
  chips: [
    { label: 'تسليم فوري', icon: 'clock' },
    { label: 'مفتاح أصلي', icon: 'shield' },
  ],
  color: '#0078d4',
  useLogo: true,
};

export const supplierRoutes = [
  [
    'GET /v1/admin/supplier/card/windows-11-pro',
    {
      spec: cardSpec,
      brandName: 'Microsoft',
      hasLogo: true,
      fontsAvailable: false,
      hasImages: true,
    },
  ],
  [
    'POST /v1/admin/supplier/card/windows-11-pro/preview',
    {
      dataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      notes: [
        'Tajawal font files are not in apps/api/assets/fonts; the card used the server default font.',
      ],
    },
  ],
  [
    'POST /v1/admin/supplier/card/windows-11-pro/suggest',
    { ...cardSpec, title: 'Windows 11 Pro', ribbon: ['ترخيص', 'دائم'] },
  ],
  ['POST /v1/admin/supplier/card/windows-11-pro', { images: [], uploadBlocked: null }],
  ['GET /v1/admin/supplier/ai', aiStatus],
  ['PUT /v1/admin/supplier/ai', aiStatus],
  ['GET /v1/admin/supplier/ai/models', aiModels],
  [
    'POST /v1/admin/supplier/ai/test',
    {
      ok: true,
      model: 'claude-sonnet-5-5',
      protocol: 'messages',
      reply: 'مرحباً — Hello',
      ms: 840,
    },
  ],
  ['POST /v1/admin/supplier/ai/copy', { id: 'job-1', status: 'RUNNING', productSlug: 'windows-11-pro', startedAt: now, finishedAt: null, result: null, error: null }],
  ['GET /v1/admin/supplier/ai/copy/job-1', { id: 'job-1', status: 'DONE', productSlug: 'windows-11-pro', startedAt: now, finishedAt: now, result: aiCopy, error: null }],
  [
    'POST /v1/admin/supplier/ai/draft/it_2',
    {
      model: 'claude-sonnet-5-5',
      slug: 'windows-11-pro-retail-key-5-pc',
      nameAr: 'مفتاح Windows 11 Pro لخمسة أجهزة',
      nameEn: 'Windows 11 Pro Retail Key 5 PC',
      kind: 'KEY',
      sku: 'WINDOWS-11-PRO-RETAIL-KEY-5-PC',
      licensePeriodUnit: 'LIFETIME',
      licensePeriodValue: null,
      deviceCount: 5,
      platform: 'WINDOWS',
      activationMethod: 'RETAIL_ONLINE',
      priceUsd: '52.50',
      brandId: null,
      categoryIds: [],
      notes: ['brand "Microsoft" is not in the catalogue yet'],
    },
  ],
  ['GET /v1/admin/supplier/source', source],
  ['PUT /v1/admin/supplier/source', source],
  [
    'POST /v1/admin/supplier/sync',
    {
      status: 'OK',
      error: null,
      rowCount: 321,
      added: 2,
      changed: 3,
      removed: 1,
      stockSwitched: 2,
      warnings: [],
    },
  ],
  ['GET /v1/admin/supplier/items', { items, counts }],
  ['GET /v1/admin/supplier/mapping', mapping],
  ['GET /v1/admin/supplier/prices', prices],
  [
    'POST /v1/admin/supplier/prices/apply',
    {
      applied: [{ variantId: 'v_1', sku: 'WIN11-PRO-1PC', from: '2.00', to: '2.25' }],
      skipped: [{ variantId: 'v_2', sku: 'ESET-NOD32-1D1Y', reason: 'LARGE' }],
    },
  ],
  ['GET /v1/admin/supplier/log', log],
];

export const supplierDynamic = [
  [
    /^(PUT|DELETE) \/v1\/admin\/supplier\/links\/([^/]+)$/,
    (match) => mappingRows.find((row) => row.variantId === match[2]) ?? mappingRows[0],
  ],
];
