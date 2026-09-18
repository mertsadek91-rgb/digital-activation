'use client';

import type { Readiness } from '@da/contracts';

import { useT } from '../../i18n/provider';

/**
 * The publish gate's verdict, as a list a person can act on.
 *
 * The API sends a stable key plus the reason, and leaves the naming to whoever
 * shows it — so the field an editor has to go and fix is named here, in the
 * language of the panel, rather than as `seoDescription`.
 */
type ProductsMessageKey = Parameters<ReturnType<typeof useT<'products'>>>[0];

const CHECK_KEYS: Record<string, ProductsMessageKey> = {
  seoTitle: 'checkSeoTitle',
  seoDescription: 'checkSeoDescription',
  body: 'checkBody',
  primaryCategory: 'checkPrimaryCategory',
  sku: 'checkSku',
  price: 'checkPrice',
  heroImage: 'checkHeroImage',
  englishName: 'checkEnglishName',
};

/**
 * Where on the editor page each check is answered.
 *
 * A blocker that names its field is a fact; a blocker that jumps to the box
 * where the field is typed is an instruction. Anything not listed here has
 * no section of its own and is shown without a link.
 */
const CHECK_SECTIONS: Record<string, string> = {
  seoTitle: 'seo',
  seoDescription: 'seo',
  body: 'content',
  primaryCategory: 'identity',
  englishName: 'identity',
  sku: 'terms',
  price: 'terms',
  heroImage: 'images',
};

/**
 * The gate's field names, in the panel's language.
 *
 * `check.key` is a stable identifier from the API and the fallback is the key
 * itself, so a check this panel has not been taught to name still renders as
 * something rather than as a blank cell.
 */
export function checkLabel(key: string, t: ReturnType<typeof useT<'products'>>): string {
  const name = CHECK_KEYS[key];
  return name === undefined ? key : t(name);
}

export function ReadinessChecks({
  readiness,
  /** When given, an unmet check links to the section that fixes it. */
  linkToSections = false,
}: {
  readiness: Readiness;
  linkToSections?: boolean;
}) {
  const t = useT('products');

  return (
    <ul className="checks">
      {readiness.checks.map((check) => {
        const section = CHECK_SECTIONS[check.key];
        const label = checkLabel(check.key, t);
        return (
          <li key={check.key} className={check.passed ? 'passed' : check.severity}>
            {linkToSections && !check.passed && section ? (
              <a className="check-key" href={`#section-${section}`}>
                {label}
              </a>
            ) : (
              <span className="check-key">{label}</span>
            )}
            <span>{check.passed ? t('checkPassed') : check.detail}</span>
          </li>
        );
      })}
    </ul>
  );
}
