import { getTranslations, setRequestLocale } from 'next-intl/server';

import { buildGraph, jsonld } from '@da/seo';
import { BRAND } from '@da/ui';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');

  // One graph, one script tag. Assembled through buildGraph so a second
  // Product/ItemList/Article entity on the same page throws in development —
  // the legacy store shipped two conflicting Product blocks per page and
  // therefore got no rich results at all.
  const graph = buildGraph([
    jsonld.organization({
      name: locale === 'ar' ? BRAND.nameAr : BRAND.nameEn,
      url: SITE_URL,
      logoUrl: `${SITE_URL}/logo.svg`,
      sameAs: [],
    }),
    jsonld.website({
      url: SITE_URL,
      name: locale === 'ar' ? BRAND.nameAr : BRAND.nameEn,
      locale,
    }),
  ]);

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />
      <h1>{t('title')}</h1>
      <p>{t('tagline')}</p>
    </main>
  );
}
