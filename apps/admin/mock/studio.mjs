/**
 * Article studio fixtures (CR-0006) for the admin mock API.
 *
 * Invented ideas in each state, a short thread, and jobs that finish at once:
 * a chat reply and a drafted article with its image prompt.
 */
const now = new Date('2026-10-06T09:00:00Z').toISOString();

const idea = (id, title, keyword, intent, extra = {}) => ({
  id,
  title,
  primaryKeyword: keyword,
  secondaryKeywords: [],
  intent,
  rationale: '',
  outline: [],
  relatedProductSlugs: [],
  relatedArticleSlugs: [],
  locale: 'ar',
  status: 'NEW',
  articleSlug: null,
  imagePrompt: null,
  createdAt: now,
  ...extra,
});

const state = {
  ideas: [
    idea('i1', 'كيف تفعّل ويندوز 11 برو بمفتاح أصلي خطوة بخطوة', 'تفعيل ويندوز 11 برو', 'how-to', {
      secondaryKeywords: ['مفتاح ويندوز 11', 'ترخيص ويندوز أصلي'],
      rationale: 'لا يوجد مقال يشرح التفعيل رغم أن ويندوز 11 برو من أكثر المنتجات مبيعاً.',
      outline: [
        'ما الذي تحتاجه قبل البدء',
        'إدخال المفتاح من الإعدادات',
        'حل أخطاء التفعيل الشائعة',
      ],
      relatedProductSlugs: ['windows-11-pro'],
      relatedArticleSlugs: ['windows-versions'],
    }),
    idea('i2', 'أوفيس 2021 أم مايكروسوفت 365: أيهما يناسبك؟', 'أوفيس 2021 أو 365', 'comparison', {
      rationale: 'سؤال متكرر عند الشراء، والمتجر يبيع الاثنين.',
      relatedProductSlugs: ['office-2021-pro-plus', 'microsoft-365-family'],
    }),
    idea('i3', 'دليل شراء برامج مكافحة الفيروسات للمنزل', 'أفضل برنامج حماية', 'commercial', {
      status: 'DRAFTED',
      articleSlug: 'antivirus-buying-guide',
      imagePrompt:
        'A clean flat illustration of a shield over a laptop and a phone, teal and mint palette, no text, 16:9',
    }),
    idea('i4', 'ما هو مفتاح OEM؟', 'مفتاح OEM', 'informational', { status: 'DISMISSED' }),
  ],
  thread: [
    { role: 'user', text: 'أريد أفكاراً عن ويندوز وأوفيس', at: now },
    {
      role: 'assistant',
      text: 'اقترحت ثلاث أفكار: شرح تفعيل ويندوز 11 برو، مقارنة أوفيس 2021 مع 365، ودليل شراء برامج الحماية.',
      at: now,
    },
  ],
};

const view = () => ({
  ...state,
  inventory: { products: 64, articles: 18, publishedArticles: 15 },
  aiReady: true,
});

const article = {
  slug: 'activate-windows-11-pro',
  title: 'كيف تفعّل ويندوز 11 برو بمفتاح أصلي خطوة بخطوة',
  locale: 'ar',
  wordCount: 1720,
  summaryWords: 48,
  internalLinks: ['/store/windows-11-pro', '/blog/windows-versions', '/store/office-2021-pro-plus'],
  relatedProducts: ['windows-11-pro'],
  imagePrompt:
    'A modern laptop on a tidy desk showing the Windows 11 activation screen with a green check mark, soft daylight, teal and mint accents, photorealistic, no text, 16:9',
  imageAlt: 'شاشة تفعيل ويندوز 11 برو على حاسوب محمول',
  notes: ['تمت إزالة رابط واحد لصفحة غير موجودة.'],
};

const jobs = new Map();
let counter = 0;
const startJob = (kind, result) => {
  counter += 1;
  const job = {
    id: `job_${counter}`,
    kind,
    status: 'DONE',
    startedAt: now,
    finishedAt: now,
    result,
    error: null,
  };
  jobs.set(job.id, job);
  return job;
};

export const studioDynamic = [
  [/^GET \/v1\/admin\/studio$/, () => view()],
  [
    /^POST \/v1\/admin\/studio\/chat$/,
    (_match, body) => {
      if (body?.message) state.thread.push({ role: 'user', text: body.message, at: now });
      state.thread.push({ role: 'assistant', text: 'أضفت فكرتين جديدتين في الأسفل.', at: now });
      return startJob('chat', { reply: 'أضفت فكرتين جديدتين.', ideas: 2 });
    },
  ],
  [
    /^DELETE \/v1\/admin\/studio\/chat$/,
    () => {
      state.thread = [];
      return view();
    },
  ],
  [
    /^PATCH \/v1\/admin\/studio\/ideas\/([^/]+)$/,
    (match, body) => {
      const found = state.ideas.find((entry) => entry.id === decodeURIComponent(match[1]));
      if (found && body?.status) found.status = body.status;
      return view();
    },
  ],
  [
    /^POST \/v1\/admin\/studio\/articles$/,
    (_match, body) => {
      const found = state.ideas.find((entry) => entry.id === body?.ideaId);
      if (found) {
        found.status = 'DRAFTED';
        found.articleSlug = article.slug;
        found.imagePrompt = article.imagePrompt;
      }
      return startJob('article', article);
    },
  ],
  [/^GET \/v1\/admin\/studio\/jobs\/([^/]+)$/, (match) => jobs.get(match[1])],
];
