import type { AiSection } from '@da/contracts';
import { SEO_LENGTH_GUIDE, READINESS_RULES } from '@da/contracts';

import type { ProductFacts } from './prompts.js';

/**
 * Prompts for one section of a product page (CR-0005).
 *
 * Each section has its own job, its own rules and its own exact JSON shape,
 * so the answer drops straight into the form that edits it. The model sees
 * the product's facts and the rest of the page for context, and the
 * section's current content when it is improving rather than writing.
 */

const SITE =
  'You write for Digital Activation (digital-activation.com), an Arabic-first store in the Gulf selling genuine software licence keys and accounts with instant email delivery and WhatsApp support.';

const COMMON = [
  'Use ONLY the facts provided, plus standard, publicly documented procedures for this kind of product. Never invent features, version numbers, prices, discounts, partnerships or guarantees. If something is unknown, leave it out.',
  'Arabic is Modern Standard Arabic that reads naturally to Gulf shoppers, with product and brand names kept in Latin script. English is plain international English.',
  'No emojis, no exclamation marks, no hype words.',
  'Answer with one JSON object and nothing else.',
].join('\n');

const RULES: Record<AiSection, { task: string; shape: string }> = {
  seo: {
    task: `Write the search snippet: seoTitle ${String(READINESS_RULES.seoTitleMinLength)}–${String(SEO_LENGTH_GUIDE.seoTitleMax)} characters with the main keyword first and the store's value (genuine, instant delivery); seoDescription ${String(READINESS_RULES.seoDescriptionMinLength)}–${String(SEO_LENGTH_GUIDE.seoDescriptionMax)} characters that states what the buyer gets and gives a reason to click; shortDesc under 200 characters for the product card; 5–10 keywords real buyers search for in that language.`,
    shape: '{"seoTitle":"...","seoDescription":"...","shortDesc":"...","keywords":["..."]}',
  },
  activation: {
    task: "Write the activation how-to that is emailed with the licence and shown on the order page: 3–8 short imperative steps, one action each, plain text with no markup or numbering, in the order a customer follows them, matching the product's activation method and platform (for a retail key: open Settings → Activation and enter the key; for account credentials: sign in with the details sent; for a redeem code: redeem it on the vendor's official page). End with what to do if activation fails: contact support on WhatsApp.",
    shape: '{"steps":["...","..."]}',
  },
  faq: {
    task: "Write 4–6 questions buyers really ask before paying for this product, each answered in 1–3 clear sentences: genuineness, delivery time, activation, devices and duration, compatibility, what happens if the key fails. Questions in the buyer's own words.",
    shape: '{"title":"...","items":[{"q":"...","a":"..."}]}',
  },
  steps: {
    task: 'Write the "how to buy and activate" steps shown in the page body: 3–8 steps from placing the order to a working product, one sentence each.',
    shape: '{"title":"...","steps":[{"text":"..."}]}',
  },
  specTable: {
    task: 'Write the specification table: 4–10 rows of label and value taken only from the facts (product type, licence duration, number of devices, platform, activation method, delivery, warranty when known, language when known). No marketing in it.',
    shape: '{"title":"...","rows":[{"label":"...","value":"..."}]}',
  },
};

export function sectionSystemPrompt(section: AiSection, houseNotes: string): string {
  return [
    SITE,
    `Your task: ${RULES[section].task}`,
    COMMON,
    houseNotes ? `House notes from the store owner:\n${houseNotes}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function sectionUserPrompt(input: {
  section: AiSection;
  locale: 'ar' | 'en';
  facts: ProductFacts;
  /** The rest of the page as text, for context and consistency. */
  pageText: string;
  /** The section's current content as JSON, when improving. */
  current: string | null;
  instructions: string;
  focusKeywords: string;
}): string {
  const { facts } = input;
  const language = input.locale === 'ar' ? 'Arabic' : 'English';
  const lines = [
    input.current
      ? `Improve this section of the ${language} product page. Keep what is true and specific, fix what is weak, unclear or wrong, and complete what is missing.`
      : `Write this section of the ${language} product page.`,
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
  ];
  if (input.pageText) {
    lines.push(
      '',
      'The rest of the page, for context (do not repeat it verbatim):',
      input.pageText.slice(0, 6000),
    );
  }
  if (input.current) {
    lines.push('', 'The section as it is now:', input.current.slice(0, 6000));
  }
  if (input.focusKeywords) lines.push('', `Keywords to use naturally: ${input.focusKeywords}`);
  if (input.instructions)
    lines.push('', `The store owner asks for this run: ${input.instructions}`);
  lines.push('', 'Return exactly:', RULES[input.section].shape);
  return lines.join('\n');
}
