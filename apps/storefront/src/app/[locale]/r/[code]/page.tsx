import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ReferralLanding } from '../../../../components/referral-landing';

/**
 * Where a shared referral link lands. Never indexed: every code is a copy of
 * the same page, and a crawler following one would record a visit.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'referral' });
  return { title: t('landingTitle'), robots: { index: false, follow: false } };
}

export default async function ReferralPage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  return <ReferralLanding code={code} locale={locale} />;
}
