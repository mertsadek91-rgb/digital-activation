import type { ProductFacts } from '../supplier/ai/prompts.js';

/**
 * The product agent's planning prompt (CR-0007). One call per product decides
 * three small things together — the section, the brand's website and the
 * card's words — so the only other model calls are the two long page copies.
 * Pure strings, pinned by a test.
 */

export interface PlanCategory {
  id: string;
  nameAr: string;
  nameEn: string | null;
  parentId: string | null;
  products: number;
}

export interface PlanInput {
  facts: ProductFacts;
  /** The product's sections now, by id. Empty for a new product. */
  currentCategoryIds: string[];
  categories: PlanCategory[];
  /** May the plan create a section that does not exist. */
  allowCreate: boolean;
  /** The supplier's own section name for the line, when it is a new product. */
  supplierCategory: string | null;
}

export function planSystemPrompt(instructions: string): string {
  return [
    'You are the catalogue planner for Digital Activation (digital-activation.com), an Arabic-first store in the Gulf selling genuine software licence keys and accounts with instant delivery.',
    'For one product you decide: which store section(s) it belongs in, the brand and its official website, and the few words printed on its product card image.',
    'Sections: prefer the existing ones. Keep the current sections when they are right. Assign existing section ids when the current ones are wrong or missing. Create a new section only when no existing section fits a shopper looking for this product, and name it the way the existing ones are named (a product family or software type, never one product, never a brand alone unless the store already sections by brand).',
    "Brand website: the vendor's official site as a bare host name (microsoft.com, eset.com, autodesk.com). Null if you are not sure.",
    'Use only facts provided; never invent features, partnerships or prices.',
    instructions ? `House notes from the store owner:\n${instructions}` : '',
    'Answer with one JSON object and nothing else.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function planUserPrompt(input: PlanInput): string {
  const { facts } = input;
  const sections = input.categories
    .map(
      (category) =>
        `- ${category.id} | ${category.nameAr} | ${category.nameEn ?? '-'} | parent: ${category.parentId ?? '-'} | products: ${String(category.products)}`,
    )
    .join('\n');
  return [
    'Product facts:',
    `- Arabic name: ${facts.nameAr ?? 'unknown'}`,
    `- English name: ${facts.nameEn ?? 'unknown'}`,
    `- Brand in our catalogue: ${facts.brand ?? 'none'}`,
    `- Kind: ${facts.kind}`,
    ...facts.variants.map(
      (variant) => `- Variant: ${variant.terms}; ${variant.platform}; ${variant.activationMethod}`,
    ),
    ...facts.supplierLines.map((line) => `- Supplier line: ${line.name}`),
    input.supplierCategory ? `- Supplier's section for the line: ${input.supplierCategory}` : null,
    '',
    `Current section ids: ${input.currentCategoryIds.length > 0 ? input.currentCategoryIds.join(', ') : 'none'}`,
    '',
    'Existing sections (id | Arabic | English | parent | products):',
    sections || '(none yet)',
    '',
    'Return exactly:',
    '{"category": {"action": "keep" | "assign" | "create",',
    '   "categoryIds": [existing section ids, most specific first, at most 3; for "keep" the current ones],',
    input.allowCreate
      ? '   "create": null, or for "create" {"nameAr": "...", "nameEn": "...", "slug": "lowercase-latin-words", "parentId": existing id or null},'
      : '   "create": null  (creating sections is switched off: choose "keep" or "assign"),',
    '   "reason": "one short sentence"},',
    ' "names": {"ar": "the product name in Arabic as the store writes it, Latin product names kept in Latin", "en": "the English name"},',
    ' "brand": {"name": "vendor name or null", "domain": "official host name or null"},',
    ' "card": {"title": "product name for the card, at most 28 characters, Latin script as printed on the box",',
    '   "ribbon": 1 to 3 very short Arabic lines for the corner ribbon, such as ["مدى","الحياة"] or ["5","أجهزة"],',
    '   "chips": [{"label": two Arabic words, "icon": one of clock, bolt, key, shield, user}, {"label": ..., "icon": ...}]}}',
    'The chips name two true benefits, such as instant delivery (تسليم فوري) and a genuine key (مفتاح أصلي) or account (حساب أصلي).',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
