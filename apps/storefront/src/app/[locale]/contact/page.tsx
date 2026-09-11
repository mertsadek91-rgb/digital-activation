import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';

import { ROUTES } from '@da/contracts';
import { alternates, buildGraph, canonical, jsonld } from '@da/seo';

import { Blocks } from '../../../components/blocks';
import { ContactForm } from '../../../components/contact-form';
import { getPage } from '../../../lib/api';
import { robotsMeta } from '../../../lib/seo';

/**
 * /contact — the channels, and a form that actually goes somewhere.
 *
 * Its own route rather than the editorial catch-all, because the page is half
 * content and half form. The text and the channels are a Page row, so the
 * WhatsApp number is something the owner edits rather than something a deploy
 * changes; the form is code, because it posts to an endpoint that stores the
 * message before it emails anybody.
 *
 * The page renders with or without the row. Content that has not been written
 * must not take the form down with it — this is the page somebody reaches when
 * something has already gone wrong.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const ar = locale === 'ar';
  const page = await getPage('contact', { locale });
  const links = alternates(SITE_URL, ROUTES.contact);

  return {
    title: page?.seo.title ?? (ar ? 'تواصل معنا' : 'Contact us'),
    description:
      page?.seo.description ??
      (ar
        ? 'راسلنا عبر النموذج أو واتساب أو تيليجرام. نردّ خلال 24 ساعة كحدّ أقصى.'
        : 'Reach us through the form, on WhatsApp or on Telegram. We reply within 24 hours at the latest.'),
    robots: robotsMeta(process.env.NEXT_PUBLIC_SITE_URL),
    alternates: {
      canonical: canonical(SITE_URL, ROUTES.contact, ar ? 'ar' : 'en'),
      languages: Object.fromEntries(links.map((link) => [link.hrefLang, link.href])),
    },
  };
}

export default async function ContactPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ar = locale === 'ar';
  const prefix = ar ? '' : `/${locale}`;
  const page = await getPage('contact', { locale });

  const questions = (page?.blocks ?? []).flatMap((block) =>
    block.type === 'faq' ? block.items : [],
  );

  const graph = buildGraph([
    jsonld.breadcrumbs([
      { name: ar ? 'الرئيسية' : 'Home', url: new URL(`${prefix}/`, SITE_URL).toString() },
      {
        name: page?.title ?? (ar ? 'تواصل معنا' : 'Contact us'),
        url: new URL(`${prefix}${ROUTES.contact}`, SITE_URL).toString(),
      },
    ]),
    questions.length > 0 ? jsonld.faqPage(questions) : null,
  ]);

  return (
    <main className="shell account-shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      <header className="page-head">
        <h1>{page?.title ?? (ar ? 'تواصل معنا' : 'Contact us')}</h1>
      </header>

      {page ? (
        <div className="prose">
          <Blocks blocks={page.blocks} />
        </div>
      ) : null}

      <ContactForm locale={locale} />
    </main>
  );
}
