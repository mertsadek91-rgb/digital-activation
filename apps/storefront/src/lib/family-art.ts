/**
 * The four product-family illustrations from the owner's banner package
 * (`Source/assets/*.png`, converted to 560px WebP in `public/home/`).
 *
 * One source for the home hero and for the page band of a family's
 * collection and brand pages (TASK-0109), so a visitor who saw the art on the
 * home page gets it from the cache on the next page. The package's composed
 * `_artwork` banners are not used: each has a visible seam down the middle of
 * the canvas.
 */
export type Family = 'windows' | 'office' | 'adobe' | 'autodesk';

export interface FamilyArt {
  family: Family;
  src: string;
  width: number;
  height: number;
}

export const FAMILY_ART: readonly FamilyArt[] = [
  { family: 'windows', src: '/home/windows.webp', width: 560, height: 506 },
  { family: 'office', src: '/home/office.webp', width: 560, height: 489 },
  { family: 'adobe', src: '/home/adobe.webp', width: 560, height: 552 },
  { family: 'autodesk', src: '/home/autodesk.webp', width: 560, height: 569 },
];

/**
 * Which pages wear which drawing. Exact slugs, not prefixes: the Windows art
 * reads "Windows 11", so it belongs on Windows and Windows 11 and not on
 * Windows 10 or Windows Server, whose pages would then show the wrong product.
 */
const COLLECTIONS: Record<string, Family> = {
  windows: 'windows',
  'windows-11': 'windows',
  office: 'office',
  adobe: 'adobe',
  autodesk: 'autodesk',
};

const BRANDS: Record<string, Family> = {
  adobe: 'adobe',
  autodesk: 'autodesk',
};

function art(family: Family | undefined): FamilyArt | null {
  return family ? (FAMILY_ART.find((entry) => entry.family === family) ?? null) : null;
}

export function collectionArt(slug: string): FamilyArt | null {
  return art(COLLECTIONS[slug]);
}

export function brandArt(slug: string): FamilyArt | null {
  return art(BRANDS[slug]);
}
