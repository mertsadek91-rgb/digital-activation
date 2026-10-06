import { ARTICLE_LENGTH, ARTICLE_SUMMARY_WORDS, type ArticleIdea } from '@da/contracts';

/**
 * The article studio's prompts (CR-0006). Plain strings from plain data, so
 * what the model is told is reviewable in one place and pinned by a test.
 */

export interface InventoryProduct {
  slug: string;
  name: string;
  brand: string | null;
  categories: string[];
  path: string;
}

export interface InventoryArticle {
  slug: string;
  title: string;
  summary: string | null;
  published: boolean;
  path: string;
}

export interface Inventory {
  locale: 'ar' | 'en';
  products: InventoryProduct[];
  articles: InventoryArticle[];
}

const SITE =
  'Digital Activation (digital-activation.com) is an Arabic-first online store in the Gulf selling genuine software licence keys and accounts — Windows, Office, antivirus, design and engineering software — with instant email delivery and WhatsApp support.';

function inventoryText(inventory: Inventory): string {
  const products = inventory.products
    .map(
      (p) =>
        `- ${p.slug} | ${p.name}${p.brand ? ` | ${p.brand}` : ''}${p.categories.length ? ` | ${p.categories.join(', ')}` : ''}`,
    )
    .join('\n');
  const articles = inventory.articles
    .map((a) => `- ${a.slug} | ${a.title}${a.published ? '' : ' (draft)'}`)
    .join('\n');
  return [
    `Products in the store (slug | name | brand | categories):\n${products || '(none)'}`,
    `Articles already written (slug | title):\n${articles || '(none)'}`,
  ].join('\n\n');
}

// --- ideas ----------------------------------------------------------------------

export function ideasSystemPrompt(): string {
  return [
    `You are the content strategist and SEO lead for ${SITE}`,
    'You plan blog articles that win search traffic from people about to buy, or learning about, the software the store sells, and that lead them to the right product page.',
    'Rules for ideas:',
    '- Every idea targets one clear primary keyword real buyers type in the requested language, with a matching search intent (informational, how-to, comparison or commercial).',
    '- No idea may duplicate or closely overlap an article that already exists. Prefer gaps: products with no supporting article, comparisons between products the store sells, how-to and troubleshooting questions buyers ask before and after buying, buying guides.',
    '- relatedProductSlugs and relatedArticleSlugs may ONLY contain slugs from the lists given. Never invent a slug.',
    '- Titles are specific and benefit-led, 45–65 characters, in the requested language; keep product and brand names in Latin script.',
    '- outline lists 6–10 H2 section headings that would make a complete 1,500–2,000 word article.',
    '- You have no live search-volume data; judge demand from your knowledge of how people search, and say so briefly in reply when relevant.',
    'Answer with one JSON object and nothing else.',
  ].join('\n');
}

export function ideasUserPrompt(input: {
  inventory: Inventory;
  thread: { role: 'user' | 'assistant'; text: string }[];
  message: string;
}): string {
  const language = input.inventory.locale === 'ar' ? 'Arabic' : 'English';
  const lines = [inventoryText(input.inventory), ''];
  if (input.thread.length > 0) {
    lines.push(
      'Conversation so far with the store owner:',
      ...input.thread.slice(-10).map((m) => `${m.role === 'user' ? 'Owner' : 'You'}: ${m.text}`),
      '',
    );
  }
  lines.push(
    input.message
      ? `The owner now says: ${input.message}`
      : 'Suggest the best next articles for this store.',
    '',
    `Reply in ${language}. Give 8–12 ideas in ${language}.`,
    'Return exactly:',
    '{"reply":"a short answer to the owner (2–5 sentences)","ideas":[{"title":"...","primaryKeyword":"...","secondaryKeywords":["..."],"intent":"informational|how-to|comparison|commercial","rationale":"why this article, against what the site already has","outline":["H2 ..."],"relatedProductSlugs":["..."],"relatedArticleSlugs":["..."]}]}',
  );
  return lines.join('\n');
}

// --- one article ------------------------------------------------------------------

export function articleSystemPrompt(houseNotes: string): string {
  return [
    `You are a senior SEO content writer for ${SITE}`,
    `Write one complete blog article of ${String(ARTICLE_LENGTH.min)}–${String(ARTICLE_LENGTH.max)} words in the body (the summary not counted).`,
    'Quality bar — follow all of it:',
    `- summary: about ${String(ARTICLE_SUMMARY_WORDS)} words (45–60) that directly answer the reader's question and contain the primary keyword. It is shown first, above the article, and quoted by search and answer engines.`,
    '- Structure: an opening paragraph that sets the problem, then 6–10 H2 sections (heading level 2) with H3 sub-sections where useful, short paragraphs (2–4 sentences), bullet lists, and a closing section with a clear next step.',
    '- Include where it fits the topic: a "steps" block for any procedure, a "specTable" block for specifications or a comparison, and an "faq" block of 5–7 real questions with concise answers near the end.',
    '- SEO: primary keyword in the title, the first 100 words, at least two H2 headings and the closing section; secondary keywords used naturally; no stuffing. seoTitle 50–60 characters (never over 70) with the keyword first; seoDescription 140–160 characters (never over 180) with a reason to click.',
    '- Internal links: 4–8 links inside richText paragraphs as <a href="PATH">natural anchor text</a>, using ONLY the paths given. Link products where the reader would buy, and earlier articles where they add depth. Never invent a path; never link outside the site.',
    '- Accuracy and trust: only verifiable, general facts about the software; no invented statistics, prices, dates, version claims or quotes. Practical, specific, written for real buyers in the Gulf.',
    '- Arabic is Modern Standard Arabic that reads naturally; product and brand names stay in Latin script.',
    '- richText HTML may use only <p>, <ul>, <ol>, <li>, <strong>, <em>, <h3>, <a href>.',
    "- imagePrompt: a detailed English prompt for an image generator to make the article's 1200×630 header image in a clean, modern, professional tech style — subject, composition, colours, lighting — with no text, no logos and no trademarks in the picture. imageAlt: alt text for it in the article language.",
    houseNotes ? `House notes from the store owner:\n${houseNotes}` : '',
    'Answer with one JSON object and nothing else.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function articleUserPrompt(input: {
  inventory: Inventory;
  idea: Pick<
    ArticleIdea,
    'title' | 'primaryKeyword' | 'secondaryKeywords' | 'intent' | 'outline' | 'rationale'
  >;
  /** Paths the article may link to, with what each is. */
  links: { path: string; label: string }[];
  instructions: string;
}): string {
  const language = input.inventory.locale === 'ar' ? 'Arabic' : 'English';
  return [
    `Write the article in ${language}.`,
    `Working title: ${input.idea.title}`,
    `Primary keyword: ${input.idea.primaryKeyword}`,
    input.idea.secondaryKeywords.length
      ? `Secondary keywords: ${input.idea.secondaryKeywords.join(', ')}`
      : '',
    `Search intent: ${input.idea.intent}`,
    input.idea.rationale ? `Why this article: ${input.idea.rationale}` : '',
    input.idea.outline.length ? `Suggested outline:\n- ${input.idea.outline.join('\n- ')}` : '',
    '',
    'Paths you may link to (path — what it is):',
    ...input.links.map((link) => `${link.path} — ${link.label}`),
    '',
    input.instructions ? `The owner asks: ${input.instructions}\n` : '',
    'Block shapes (use only these):',
    '{"type":"heading","level":2,"text":"..."}  {"type":"heading","level":3,"text":"..."}',
    '{"type":"richText","html":"<p>...</p>"}',
    '{"type":"steps","title":"...","steps":[{"text":"..."}]}',
    '{"type":"specTable","title":"...","rows":[{"label":"...","value":"..."}]}',
    '{"type":"faq","title":"...","items":[{"q":"...","a":"..."}]}',
    '',
    'Return exactly:',
    '{"title":"...","slug":"latin-words-joined-by-hyphens","summary":"...","seoTitle":"...","seoDescription":"...","relatedProductSlugs":["..."],"imagePrompt":"...","imageAlt":"...","blocks":[...]}',
  ]
    .filter((line) => line !== '')
    .join('\n');
}
