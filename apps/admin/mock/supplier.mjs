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
  // The owner's case (TASK-0134): our variant is 3 years · 2 devices.
  item(
    'it_8',
    130,
    'ESET HOME Security Essential/Internet Security Key 3 Device 2 Year',
    'ESET',
    '50.00',
  ),
  item(
    'it_9',
    131,
    'ESET HOME Security Essential/Internet Security Key 3 Device 3 Year',
    'ESET',
    '70.00',
  ),
  item(
    'it_10',
    132,
    'ESET HOME Security Essential/Internet Security Key 2 Device 3 Year',
    'ESET',
    '46.00',
  ),
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

/** A line against a variant: what its name states, and whether it agrees. */
const lineTerms = (devices, period, devicesMatch, periodMatch) => ({
  devices,
  period,
  devicesMatch,
  periodMatch,
});
const year = (value) => ({ unit: 'YEAR', value });
const LIFETIME = { unit: 'LIFETIME', value: null };

const ref = (i, terms = lineTerms(null, null, 'UNKNOWN', 'UNKNOWN')) => ({
  id: i.id,
  name: i.name,
  category: i.category,
  costUsd: i.costUsd,
  outOfStock: i.outOfStock,
  missingSince: i.missingSince,
  terms,
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
    manualOutOfStock: false,
    skipped: false,
    link: {
      item: ref(items[0], lineTerms(1, null, 'MATCH', 'UNKNOWN')),
      markupPercent: null,
      followStock: true,
    },
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
    manualOutOfStock: false,
    skipped: false,
    link: {
      item: ref(items[5], lineTerms(1, year(1), 'MATCH', 'MATCH')),
      markupPercent: '40.00',
      followStock: true,
    },
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
    manualOutOfStock: false,
    skipped: false,
    link: {
      item: ref(items[3], lineTerms(5, LIFETIME, 'MATCH', 'MATCH')),
      markupPercent: null,
      followStock: true,
    },
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
    manualOutOfStock: false,
    skipped: false,
    link: null,
    suggestions: [
      { ...ref(items[1], lineTerms(5, null, 'MATCH', 'UNKNOWN')), score: 0.86 },
      { ...ref(items[0], lineTerms(1, null, 'DIFFERENT', 'UNKNOWN')), score: 0.55 },
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
    manualOutOfStock: false,
    skipped: false,
    link: {
      item: ref(items[6], lineTerms(1, year(1), 'MATCH', 'MATCH')),
      markupPercent: null,
      followStock: true,
    },
    suggestions: [{ ...ref(items[5], lineTerms(1, year(1), 'MATCH', 'MATCH')), score: 0.31 }],
  },
  {
    variantId: 'v_6',
    sku: 'ESET-INTERNET-SECURITY-NOD32-3Y-2PC',
    productSlug: 'eset-internet-security-nod32-3y-2pc',
    productName: 'أشتراك نود 32 انتي فايروس انترنت سيكورتي ESET Internet Security/NOD32',
    terms: '3 سنة · جهازان',
    priceUsd: '48.95',
    supplierOutOfStock: false,
    manualOutOfStock: false,
    skipped: false,
    link: null,
    suggestions: [
      { ...ref(items[9], lineTerms(2, year(3), 'MATCH', 'MATCH')), score: 0.58 },
      { ...ref(items[7], lineTerms(3, year(2), 'DIFFERENT', 'DIFFERENT')), score: 0.61 },
      { ...ref(items[8], lineTerms(3, year(3), 'DIFFERENT', 'MATCH')), score: 0.6 },
    ],
  },
  {
    variantId: 'v_7',
    sku: 'ESET-INTERNET-SECURITY-NOD32-3Y-2PC-2',
    productSlug: 'eset-internet-security-nod32-3y-2pc',
    productName: 'أشتراك نود 32 انتي فايروس انترنت سيكورتي ESET Internet Security/NOD32',
    terms: '3 سنة · 4 أجهزة',
    priceUsd: '47.95',
    supplierOutOfStock: true,
    manualOutOfStock: true,
    skipped: false,
    link: null,
    suggestions: [
      { ...ref(items[8], lineTerms(3, year(3), 'DIFFERENT', 'MATCH')), score: 0.6 },
      { ...ref(items[9], lineTerms(2, year(3), 'DIFFERENT', 'MATCH')), score: 0.58 },
    ],
  },
];

const mapping = {
  rows: mappingRows,
  counts: { all: 7, linked: 3, unlinked: 3, broken: 1, skipped: 0 },
};

const prices = {
  pending: 3,
  rounding: 'CENTS',
  rows: [
    // Sold under cost (TASK-0135): the filter's "below cost".
    {
      variantId: 'v_6',
      sku: 'ESET-HOME-3Y-5D',
      productSlug: 'eset-home-security',
      productName: 'إيسيت هوم سيكيورتي',
      terms: '3 سنة · 5 أجهزة',
      itemName: 'ESET HOME Security Essential Key 5 Device 3 Year',
      costUsd: '130.00',
      lastAppliedCostUsd: '110.00',
      markupPercent: '50.00',
      markupFromLink: false,
      currentPriceUsd: '119.90',
      proposedPriceUsd: '195.00',
      change: 0.6264,
      large: true,
      state: 'PENDING',
      costStanding: 'BELOW',
    },
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
      costStanding: 'ABOVE',
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
      costStanding: 'AT',
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
      costStanding: 'ABOVE',
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
      costStanding: 'ABOVE',
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

// The product editor, enough of it to render "improve with AI" (CR-0005).
const editorRow = {
  slug: 'windows-11-pro',
  nameAr: 'ويندوز 11 برو',
  nameEn: 'Windows 11 Pro',
  status: 'PUBLISHED',
  kind: 'KEY',
  brand: 'Microsoft',
  primaryCategory: 'Windows',
  variantCount: 1,
  stock: null,
  stockedVariantCount: 0,
  priceFromUsd: '2.25',
  hasGoldenWarranty: false,
  salesCount: 12,
  imageCount: 1,
  activationSteps: { ar: 2, en: 0 },
  blockers: 0,
  warnings: 1,
};
const editorReadiness = { locale: 'ar', publishable: true, checks: [] };
const editorCopy = {
  locale: 'ar',
  name: 'ويندوز 11 برو',
  shortDesc: 'مفتاح ويندوز 11 برو',
  seoTitle: 'مفتاح ويندوز 11 برو',
  seoDescription: 'اشتر مفتاح ويندوز 11 برو',
  body: '',
  bodyEditable: false,
  otherBlocks: ['answerFirst', 'faq'],
  readiness: editorReadiness,
};
const editorContent = {
  locale: 'ar',
  name: 'ويندوز 11 برو',
  blocks: [
    {
      type: 'answerFirst',
      text: 'مفتاح ويندوز 11 برو أصلي للتفعيل على جهاز واحد، يصلك على بريدك فور الدفع مع دعم كامل.',
    },
    { type: 'richText', html: '<p>نص قديم قصير يحتاج تحسيناً.</p>' },
  ],
  warnings: [],
  downloadUrl: '',
  bodyWords: 20,
  bodyMinWords: 120,
};

export const supplierRoutes = [
  ['POST /v1/admin/supplier/card/logo-color', { color: '#e8410a' }],
  ['GET /v1/admin/products/windows-11-pro', editorRow],
  ['GET /v1/admin/products/windows-11-pro/readiness', editorReadiness],
  ['GET /v1/admin/products/windows-11-pro/copy', editorCopy],
  ['GET /v1/admin/products/windows-11-pro/content', editorContent],
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
  [
    'POST /v1/admin/supplier/ai/copy',
    {
      id: 'job-1',
      status: 'RUNNING',
      productSlug: 'windows-11-pro',
      startedAt: now,
      finishedAt: null,
      result: null,
      error: null,
    },
  ],
  [
    'GET /v1/admin/supplier/ai/copy/job-1',
    {
      id: 'job-1',
      status: 'DONE',
      productSlug: 'windows-11-pro',
      startedAt: now,
      finishedAt: now,
      result: aiCopy,
      error: null,
    },
  ],
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
  [
    'POST /v1/admin/supplier/upload',
    {
      status: 'OK',
      error: null,
      rowCount: 318,
      added: 0,
      changed: 4,
      removed: 3,
      stockSwitched: 1,
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
    /^(PUT|DELETE) \/v1\/admin\/supplier\/skips\/([^/]+)$/,
    (match) => {
      const row = mappingRows.find((entry) => entry.variantId === match[2]) ?? mappingRows[0];
      row.skipped = match[1] === 'PUT';
      mapping.counts.skipped = mappingRows.filter((entry) => entry.skipped).length;
      return row;
    },
  ],
  [
    // Marked by hand (TASK-0134). The fixture server sees no body, so it toggles.
    /^PUT \/v1\/admin\/supplier\/stock\/([^/]+)$/,
    (match) => {
      const row = mappingRows.find((entry) => entry.variantId === match[1]) ?? mappingRows[0];
      row.manualOutOfStock = !row.manualOutOfStock;
      row.supplierOutOfStock = row.manualOutOfStock;
      return row;
    },
  ],
  [
    // A row's own markup (TASK-0135). No body here, so it pins 53.84% and
    // reports the proposal 199.99; the real API works it out from the request.
    /^PUT \/v1\/admin\/supplier\/prices\/([^/]+)\/markup$/,
    (match) => {
      const row = prices.rows.find((entry) => entry.variantId === match[1]) ?? prices.rows[0];
      row.markupPercent = '53.84';
      row.markupFromLink = true;
      row.proposedPriceUsd = (Number(row.costUsd) * 1.5384).toFixed(2);
      return { row, applied: null };
    },
  ],
  [
    /^(PUT|DELETE) \/v1\/admin\/supplier\/links\/([^/]+)$/,
    (match) => mappingRows.find((row) => row.variantId === match[2]) ?? mappingRows[0],
  ],
];

// One product-page section written by AI (CR-0005): the last section asked
// for is what the job returns.
let lastSection = 'faq';
const sectionResults = {
  seo: {
    section: 'seo',
    seoTitle: 'مفتاح Windows 11 Pro أصلي | تفعيل دائم وتسليم فوري',
    seoDescription:
      'اشترِ مفتاح Windows 11 Pro أصلياً لجهاز واحد بتفعيل دائم، يصلك على بريدك خلال دقائق مع دعم عبر واتساب.',
    shortDesc: 'مفتاح Windows 11 Pro أصلي لجهاز واحد، تفعيل دائم وتسليم فوري.',
    keywords: ['مفتاح ويندوز 11 برو'],
  },
  activation: {
    section: 'activation',
    steps: [
      'افتح الإعدادات ثم النظام ثم التنشيط',
      'اختر تغيير مفتاح المنتج',
      'أدخل المفتاح الذي وصلك بالبريد ثم اضغط التالي',
      'إن لم ينجح التفعيل فراسلنا على واتساب',
    ],
  },
  faq: {
    section: 'faq',
    block: {
      type: 'faq',
      title: 'أسئلة شائعة',
      items: [
        { q: 'هل المفتاح أصلي؟', a: 'نعم، مفتاح Retail أصلي.' },
        { q: 'متى يصلني المفتاح؟', a: 'خلال دقائق من الدفع على بريدك.' },
      ],
    },
  },
  steps: {
    section: 'steps',
    block: {
      type: 'steps',
      title: 'طريقة الشراء والتفعيل',
      steps: [{ text: 'أضف المنتج إلى السلة وادفع.' }, { text: 'يصلك المفتاح بالبريد.' }],
    },
  },
  specTable: {
    section: 'specTable',
    block: {
      type: 'specTable',
      title: 'المواصفات',
      rows: [
        { label: 'المدة', value: 'مدى الحياة' },
        { label: 'الأجهزة', value: 'جهاز واحد' },
      ],
    },
  },
};

export const supplierSectionRoutes = [
  ['GET /v1/admin/site', { storefrontUrl: 'https://new.digital-activation.com' }],
  [
    'GET /v1/admin/products/windows-11-pro/activation-steps',
    { steps: ['افتح الإعدادات', 'أدخل المفتاح'] },
  ],
];

const sectionJobDone = () => ({
  id: 'sec-1',
  status: 'DONE',
  section: lastSection,
  startedAt: now,
  finishedAt: now,
  result: sectionResults[lastSection],
  error: null,
});

export const supplierSectionDynamic = [
  [/^GET \/v1\/admin\/supplier\/ai\/section\/sec-1$/, sectionJobDone],
  [
    /^POST \/v1\/admin\/supplier\/ai\/section$/,
    (_match, body) => {
      lastSection = body?.section ?? 'faq';
      return {
        id: 'sec-1',
        status: 'RUNNING',
        section: lastSection,
        startedAt: now,
        finishedAt: null,
        result: null,
        error: null,
      };
    },
  ],
];
