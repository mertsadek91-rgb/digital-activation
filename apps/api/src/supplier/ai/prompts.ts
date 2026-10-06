import { READINESS_RULES, SEO_LENGTH_GUIDE } from '@da/contracts';

/**
 * The prompts. Pure strings from plain facts, so what the model is told is
 * reviewable in one place and pinned by a test.
 *
 * Two rules matter more than style:
 *  - Only facts we hand over. A licence copy that invents "lifetime updates"
 *    or "official Microsoft partner" is a refund and a complaint; the model
 *    is told the terms and told not to add any.
 *  - Our shapes, not the model's. The answer is JSON in exactly the block
 *    types the content editor saves; anything else is dropped on the way in.
 */

export interface ProductFacts {
  nameAr: string | null;
  nameEn: string | null;
  brand: string | null;
  categories: string[];
  kind: string;
  variants: {
    terms: string;
    platform: string;
    activationMethod: string;
    deliveryMinutes: number;
    warrantyDays: number | null;
  }[];
  supplierLines: { name: string; warranty: string | null }[];
}

export interface StyleSample {
  seoTitle: string;
  seoDescription: string;
  shortDesc: string;
  excerpt: string;
}

const SITE = `You write product pages for Digital Activation (digital-activation.com), an Arabic-first online store in the Gulf that sells genuine software licence keys and accounts (Windows, Office, antivirus, design and engineering software) with instant digital delivery by email, local support on WhatsApp, and secure payment.`;

const BLOCK_RULES = `Body blocks — use only these JSON shapes:
- {"type":"answerFirst","text":"..."}  one plain-text paragraph of 40–600 characters that answers "what is this and why buy it here" in the first sentence. Always the first block.
- {"type":"heading","level":2,"text":"..."} or level 3.
- {"type":"richText","html":"..."}  HTML using only <p>, <ul>, <ol>, <li>, <strong>, <em>, <h3>. No inline styles, no links, no images, no tables.
- {"type":"steps","title":"...","steps":[{"text":"..."}]}  1–12 activation or delivery steps.
- {"type":"specTable","title":"...","rows":[{"label":"...","value":"..."}]}  facts only.
- {"type":"faq","title":"...","items":[{"q":"...","a":"..."}]}  4–6 real buyer questions.
Order: answerFirst, then heading + richText sections (what you get, key features, who it is for, system requirements if known), specTable, steps, faq.`;

export function copySystemPrompt(instructions: string): string {
  return [
    SITE,
    'Write like a senior e-commerce copywriter and SEO specialist: clear, confident, specific, no hype words, no emojis, no exclamation marks.',
    'Arabic copy is Modern Standard Arabic that reads naturally to Gulf shoppers; keep product and brand names in Latin script (e.g. Windows 11 Pro). English copy is plain international English.',
    'Use ONLY the facts provided. Never invent features, version numbers, update promises, partnerships, "official reseller" claims, discounts or prices. If a fact is unknown, leave it out.',
    'Do not mention the supplier or wholesale prices.',
    `SEO: seoTitle ${String(READINESS_RULES.seoTitleMinLength)}–${String(SEO_LENGTH_GUIDE.seoTitleMax)} characters with the main keyword first; seoDescription ${String(READINESS_RULES.seoDescriptionMinLength)}–${String(SEO_LENGTH_GUIDE.seoDescriptionMax)} characters with a reason to click; shortDesc under 200 characters. Body at least ${String(READINESS_RULES.bodyMinWords + 60)} words across all blocks. Keywords: 5–10 phrases real buyers search for in that language (product + licence/key/activation/price/buy intents), used naturally in headings and body, never stuffed.`,
    BLOCK_RULES,
    instructions ? `House notes from the store owner:\n${instructions}` : '',
    'Answer with one JSON object and nothing else.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function copyUserPrompt(input: {
  locale: 'ar' | 'en';
  facts: ProductFacts;
  focusKeywords: string;
  sample: StyleSample | null;
}): string {
  const { facts } = input;
  const language = input.locale === 'ar' ? 'Arabic' : 'English';
  const lines = [
    `Write the ${language} product page copy.`,
    '',
    'Product facts:',
    `- Name (Arabic): ${facts.nameAr ?? 'not set'}`,
    `- Name (English): ${facts.nameEn ?? 'not set'}`,
    `- Brand: ${facts.brand ?? 'unknown'}`,
    `- Categories: ${facts.categories.join(', ') || 'none'}`,
    `- Product type: ${facts.kind}`,
    ...facts.variants.map(
      (variant, index) =>
        `- Option ${String(index + 1)}: ${variant.terms}; platform ${variant.platform}; activation ${variant.activationMethod}; delivered in about ${String(variant.deliveryMinutes)} minutes${variant.warrantyDays ? `; replacement warranty ${String(variant.warrantyDays)} days` : ''}`,
    ),
    ...facts.supplierLines.map(
      (line) =>
        `- Supplier line name (for facts only, do not quote): ${line.name}${line.warranty ? `; warranty ${line.warranty}` : ''}`,
    ),
  ];
  if (input.focusKeywords)
    lines.push('', `Build the copy around these keywords: ${input.focusKeywords}`);
  if (input.sample) {
    lines.push(
      '',
      'Match the tone and structure of this existing page from the same store (do not copy its facts):',
      `seoTitle: ${input.sample.seoTitle}`,
      `seoDescription: ${input.sample.seoDescription}`,
      `shortDesc: ${input.sample.shortDesc}`,
      `body excerpt: ${input.sample.excerpt}`,
    );
  }
  lines.push(
    '',
    'Return exactly:',
    '{"shortDesc":"...","seoTitle":"...","seoDescription":"...","keywords":["..."],"blocks":[...]}',
  );
  return lines.join('\n');
}

export function draftSystemPrompt(): string {
  return [
    SITE,
    'You turn a supplier price-list line into the identity of a new store product. Use only what the line says.',
    'Answer with one JSON object and nothing else.',
  ].join('\n\n');
}

export function draftUserPrompt(line: {
  name: string;
  category: string | null;
  warranty: string | null;
}): string {
  return [
    `Supplier line: ${line.name}`,
    `Supplier category: ${line.category ?? 'unknown'}`,
    `Supplier warranty: ${line.warranty ?? 'unknown'}`,
    '',
    'Return exactly this JSON:',
    '{"nameEn":"clean English product name, no supplier wording such as MOQ, Free Delivery, Customize Name",',
    ' "nameAr":"Arabic product name for Gulf shoppers, brand and product names kept in Latin script",',
    ' "slug":"lowercase-latin-words-joined-by-hyphens, under 60 chars",',
    ' "kind":"KEY | ACCOUNT | PANEL | BUNDLE | SERVICE",',
    ' "licensePeriodUnit":"DAY | MONTH | YEAR | LIFETIME",',
    ' "licensePeriodValue": number or null for LIFETIME,',
    ' "deviceCount": number of PCs/devices/users (1 if not stated),',
    ' "platform":"WINDOWS | MAC | LINUX | CROSS_PLATFORM",',
    ' "activationMethod":"RETAIL_ONLINE | RETAIL_PHONE | VOLUME_MAK | KMS | BIND_MICROSOFT_ACCOUNT | REDEEM_CODE | ACCOUNT_CREDENTIALS | PANEL_INVITE | CAL_KEY | NOT_APPLICABLE",',
    ' "brand":"brand name as one word or two, e.g. Microsoft, Adobe, ESET"}',
    '',
    'Rules: "Account+Password" lines are kind ACCOUNT with activationMethod ACCOUNT_CREDENTIALS. "Bind Key" lines bind to a Microsoft account (BIND_MICROSOFT_ACCOUNT). "MAK" is VOLUME_MAK. "Redeem Code" is REDEEM_CODE. "Lifetime" or no period on a perpetual licence (Windows, Office 2016–2024) is LIFETIME.',
  ].join('\n');
}
