/**
 * Product names as identity.
 *
 * The supplier's rows move, so a line is known by its name. Two spellings of
 * the same name — a doubled space, a line break inside the cell, a full-width
 * character — must land on the same key; two different products must not.
 * So the key only folds what cannot carry meaning: Unicode compatibility
 * forms, case and whitespace.
 */
export function nameKey(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The numbers in a name: "Windows 11 Pro 5 PC" → ["11", "5"]. */
function numbers(key: string): string[] {
  return key.match(/\d+(?:\.\d+)?/g) ?? [];
}

function trigrams(key: string): Map<string, number> {
  const padded = `  ${key.replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  const grams = new Map<string, number>();
  for (let i = 0; i < padded.length - 2; i += 1) {
    const gram = padded.slice(i, i + 3);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/**
 * How alike two names are, 0..1: trigram Dice similarity, discounted when the
 * numbers differ. "… Key 1 PC" and "… Key 5 PC" share almost every trigram and
 * are different products at different prices, so a mismatched number costs
 * more than a mismatched word.
 *
 * Used only to *suggest* a line to a person. Nothing links on a score.
 */
export function nameSimilarity(a: string, b: string): number {
  const ka = nameKey(a);
  const kb = nameKey(b);
  if (ka === kb) return 1;
  const ga = trigrams(ka);
  const gb = trigrams(kb);
  let shared = 0;
  let total = 0;
  for (const [gram, count] of ga) {
    shared += Math.min(count, gb.get(gram) ?? 0);
    total += count;
  }
  for (const count of gb.values()) total += count;
  const dice = total === 0 ? 0 : (2 * shared) / total;

  const na = numbers(ka);
  const nb = numbers(kb);
  const missing =
    na.filter((n) => !nb.includes(n)).length + nb.filter((n) => !na.includes(n)).length;
  return dice * Math.pow(0.8, missing);
}
