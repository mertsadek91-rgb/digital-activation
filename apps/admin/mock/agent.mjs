/**
 * Product agent fixtures (CR-0007) for the admin mock API.
 *
 * One running batch caught mid-way — done, published, blocked, failed, one
 * writing now and two waiting — and one finished batch of new products, so
 * every state of the batches tab can be looked at. Starting a batch here
 * returns the running one; nothing is generated.
 */
const now = Date.now();
const ago = (minutes) => new Date(now - minutes * 60_000).toISOString();
const ahead = (seconds) => new Date(now + seconds * 1000).toISOString();

const options = {
  copy: true,
  category: true,
  newCategories: true,
  card: 'missing',
  publish: true,
  instructions: '',
};

const log = (entries) =>
  entries.map(([minutes, code, level = 'info', detail = '']) => ({
    at: ago(minutes),
    code,
    level,
    detail,
  }));

const result = (extra) => ({
  productSlug: null,
  created: false,
  category: null,
  copyLocales: [],
  card: null,
  published: null,
  blockers: [],
  ...extra,
});

const runningItems = [
  {
    id: 'ai_1',
    position: 0,
    status: 'DONE',
    label: 'ويندوز 11 برو',
    productSlug: 'windows-11-pro',
    step: null,
    attempts: 1,
    log: log([
      [14, 'started'],
      [14, 'planned', 'info', 'The product is in the right section.'],
      [14, 'categoryKept', 'info', 'أنظمة التشغيل'],
      [12, 'copyWritten', 'info', 'ar + en · claude-sonnet-5-5'],
      [12, 'cardSkipped', 'info', 'has images'],
      [12, 'published'],
    ]),
    result: result({
      productSlug: 'windows-11-pro',
      category: { action: 'kept', names: ['أنظمة التشغيل'], reason: '' },
      copyLocales: ['ar', 'en'],
      published: true,
    }),
    error: null,
    startedAt: ago(14),
    finishedAt: ago(12),
    canRevert: true,
  },
  {
    id: 'ai_2',
    position: 1,
    status: 'DONE',
    label: 'إيسيت إنترنت سكيوريتي',
    productSlug: 'eset-internet-security',
    step: null,
    attempts: 1,
    log: log([
      [11, 'started'],
      [11, 'planned', 'info', 'Antivirus products have no section yet.'],
      [11, 'categoryCreated', 'info', 'برامج الحماية / Security software'],
      [9, 'copyWritten', 'info', 'ar + en · claude-sonnet-5-5'],
      [9, 'logoWeb', 'info', 'https://www.eset.com/logo.svg · #0096a1 #1a1a1a'],
      [8, 'cardSaved', 'info', '#0096a1'],
      [8, 'published'],
    ]),
    result: result({
      productSlug: 'eset-internet-security',
      category: { action: 'created', names: ['برامج الحماية'], reason: '' },
      copyLocales: ['ar', 'en'],
      card: {
        logoSource: 'web',
        logoUrl: 'https://www.eset.com/logo.svg',
        palette: ['#0096a1', '#424d56'],
        mediaId: 'm_1',
      },
      published: true,
    }),
    error: null,
    startedAt: ago(11),
    finishedAt: ago(8),
    canRevert: true,
  },
  {
    id: 'ai_3',
    position: 2,
    status: 'DONE',
    label: 'أوتوديسك أوتوكاد 2026',
    productSlug: 'autocad-2026',
    step: null,
    attempts: 1,
    log: log([
      [7, 'started'],
      [7, 'categoryAssigned', 'info', 'برامج التصميم الهندسي'],
      [5, 'copyWritten', 'info', 'ar + en · claude-sonnet-5-5'],
      [5, 'logoNone', 'warn', 'autodesk.com'],
      [4, 'cardSaved', 'info', '#087f70'],
      [4, 'publishBlocked', 'warn', 'السعر صفر'],
    ]),
    result: result({
      productSlug: 'autocad-2026',
      category: { action: 'assigned', names: ['برامج التصميم الهندسي'], reason: '' },
      copyLocales: ['ar', 'en'],
      card: { logoSource: 'none', logoUrl: null, palette: [], mediaId: 'm_2' },
      published: false,
      blockers: ['السعر صفر: حدّد سعراً للمتغيّر الافتراضي.'],
    }),
    error: null,
    startedAt: ago(7),
    finishedAt: ago(4),
    canRevert: true,
  },
  {
    id: 'ai_4',
    position: 3,
    status: 'FAILED',
    label: 'Kaspersky Plus',
    productSlug: 'kaspersky-plus',
    step: null,
    attempts: 3,
    log: log([
      [3, 'started'],
      [3, 'rateLimited', 'warn', 'OpenCode 429 for claude-sonnet-5-5 (messages): rate limit'],
      [
        2,
        'failed',
        'error',
        "The model's answer did not fit the page shape: blocks.0.text: Too small",
      ],
    ]),
    result: result({ productSlug: 'kaspersky-plus' }),
    error: "The model's answer did not fit the page shape: blocks.0.text: Too small",
    startedAt: ago(3),
    finishedAt: ago(2),
    canRevert: false,
  },
  {
    id: 'ai_5',
    position: 4,
    status: 'RUNNING',
    label: 'مايكروسوفت أوفيس 2024 بروفيشنال بلس',
    productSlug: 'office-2024-pro-plus',
    step: 'copy',
    attempts: 1,
    log: log([
      [1, 'started'],
      [1, 'planned', 'info', 'Keeps the Office section.'],
      [1, 'categoryKept', 'info', 'برامج مايكروسوفت أوفيس'],
    ]),
    result: null,
    error: null,
    startedAt: ago(1),
    finishedAt: null,
    canRevert: false,
  },
  ...['Adobe Acrobat Pro', 'Bitdefender Total Security'].map((label, index) => ({
    id: `ai_${String(6 + index)}`,
    position: 5 + index,
    status: 'QUEUED',
    label,
    productSlug: null,
    step: null,
    attempts: 0,
    log: [],
    result: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    canRevert: false,
  })),
];

const counts = (items) => {
  const out = {
    total: items.length,
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    reverted: 0,
  };
  for (const item of items) out[item.status.toLowerCase()] += 1;
  return out;
};

const running = {
  id: 'batch_running',
  kind: 'REWRITE',
  status: 'RUNNING',
  options,
  cooldownSeconds: 90,
  nextRunAt: ahead(47),
  createdAt: ago(15),
  finishedAt: null,
  createdBy: 'محمد الصادق',
  counts: counts(runningItems),
  items: runningItems,
};

const doneItems = ['Windows 10 Pro OEM', 'Office 2021 Home & Business', 'Norton 360 Deluxe'].map(
  (label, index) => ({
    id: `ci_${String(index)}`,
    position: index,
    status: index === 2 ? 'SKIPPED' : 'DONE',
    label,
    productSlug: index === 2 ? null : label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    step: null,
    attempts: 1,
    log: log(
      index === 2
        ? [[200, 'exists', 'warn', 'A product with this name already exists (norton-360).']]
        : [
            [210, 'drafted', 'info', label],
            [210, 'created', 'info', label.toLowerCase()],
            [210, 'linked', 'info', label],
            [208, 'copyWritten', 'info', 'ar + en'],
            [207, 'published'],
          ],
    ),
    result:
      index === 2
        ? null
        : result({
            productSlug: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            created: true,
            category: { action: 'assigned', names: ['أنظمة التشغيل'], reason: '' },
            copyLocales: ['ar', 'en'],
            card: {
              logoSource: 'brand',
              logoUrl: null,
              palette: ['#0078d4'],
              mediaId: `m_c${String(index)}`,
            },
            published: true,
          }),
    error: null,
    startedAt: ago(211),
    finishedAt: ago(207),
    canRevert: index !== 2,
  }),
);

const finished = {
  id: 'batch_done',
  kind: 'CREATE',
  status: 'DONE',
  options: { ...options, card: 'always' },
  cooldownSeconds: 120,
  nextRunAt: null,
  createdAt: ago(215),
  finishedAt: ago(200),
  createdBy: 'محمد الصادق',
  counts: counts(doneItems),
  items: doneItems,
};

const summary = ({ items: _items, ...rest }) => rest;

const overview = {
  aiReady: true,
  model: 'claude-sonnet-5-5',
  workerOn: true,
  batches: [summary(running), summary(finished)],
};

const product = (id, nameAr, nameEn, status, extra = {}) => ({
  id,
  slug: nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  nameAr,
  nameEn,
  status,
  brand: null,
  categories: ['أنظمة التشغيل'],
  hasImage: true,
  words: 420,
  lastRun: null,
  ...extra,
});

const candidates = {
  products: [
    product('p1', 'ويندوز 11 برو', 'Windows 11 Pro', 'PUBLISHED', {
      brand: 'Microsoft',
      lastRun: { status: 'DONE', at: ago(12) },
    }),
    product('p2', 'ويندوز 11 هوم', 'Windows 11 Home', 'PUBLISHED', {
      brand: 'Microsoft',
      words: 96,
    }),
    product(
      'p3',
      'مايكروسوفت أوفيس 2024 بروفيشنال بلس',
      'Microsoft Office 2024 Professional Plus',
      'PUBLISHED',
      {
        brand: 'Microsoft',
        categories: ['برامج مايكروسوفت أوفيس'],
        lastRun: { status: 'RUNNING', at: ago(1) },
      },
    ),
    product('p4', 'إيسيت إنترنت سكيوريتي', 'ESET Internet Security', 'PUBLISHED', {
      brand: 'ESET',
      categories: [],
      hasImage: false,
      words: 40,
    }),
    product('p5', 'كاسبرسكي بلس', 'Kaspersky Plus', 'DRAFT', {
      categories: [],
      hasImage: false,
      words: 0,
      lastRun: { status: 'FAILED', at: ago(2) },
    }),
    product('p6', 'أوتوديسك أوتوكاد 2026', 'Autodesk AutoCAD 2026', 'DRAFT', {
      brand: 'Autodesk',
      categories: ['برامج التصميم الهندسي'],
      words: 180,
    }),
    product('p7', 'أدوبي أكروبات برو', 'Adobe Acrobat Pro', 'PUBLISHED', {
      brand: 'Adobe',
      categories: ['برامج PDF'],
      lastRun: { status: 'QUEUED', at: ago(15) },
    }),
    product('p8', 'بيتديفندر توتال سكيوريتي', 'Bitdefender Total Security', 'PUBLISHED', {
      categories: ['برامج الحماية'],
      words: 310,
    }),
  ],
  supplierLines: [
    {
      id: 's1',
      name: 'Windows Server 2025 Standard',
      category: 'Windows',
      costUsd: '24.00',
      outOfStock: false,
      wholesaleOnly: false,
      lastRun: null,
    },
    {
      id: 's2',
      name: 'Office 2024 Home & Student (Bind)',
      category: 'Office',
      costUsd: '18.50',
      outOfStock: false,
      wholesaleOnly: false,
      lastRun: null,
    },
    {
      id: 's3',
      name: 'Project Professional 2024',
      category: 'Office',
      costUsd: '12.00',
      outOfStock: true,
      wholesaleOnly: false,
      lastRun: null,
    },
    {
      id: 's4',
      name: 'Visio Professional 2021 MOQ≥50 pieces',
      category: 'Office',
      costUsd: '4.10',
      outOfStock: false,
      wholesaleOnly: true,
      lastRun: null,
    },
    {
      id: 's5',
      name: 'Norton 360 Deluxe 5 PC 1 Year',
      category: 'Antivirus',
      costUsd: null,
      outOfStock: false,
      wholesaleOnly: false,
      lastRun: { status: 'SKIPPED', at: ago(200) },
    },
    {
      id: 's6',
      name: 'SQL Server 2022 Enterprise',
      category: 'Server',
      costUsd: '160.00',
      outOfStock: false,
      wholesaleOnly: false,
      lastRun: null,
    },
  ],
};

const batches = { batch_running: running, batch_done: finished };

export const agentRoutes = [
  ['GET /v1/admin/agent', overview],
  ['GET /v1/admin/agent/candidates', candidates],
  ['POST /v1/admin/agent/batches', running],
];

export const agentDynamic = [
  [/^GET \/v1\/admin\/agent\/batches\/([^/]+)$/, (m) => batches[m[1]] ?? running],
  [/^POST \/v1\/admin\/agent\/batches\/([^/]+)\/status$/, (m) => batches[m[1]] ?? running],
  [/^POST \/v1\/admin\/agent\/items\/([^/]+)\/(retry|revert)$/, () => running],
];
