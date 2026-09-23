import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CONTACT_REPLY_HOURS, ROUTES } from '@da/contracts';
import { alternates, buildGraph, canonical, jsonld } from '@da/seo';

import { ContactForm } from '../../../components/contact-form';
import { MailIcon, TelegramIcon, WhatsAppIcon } from '../../../components/icons';
import { MotionFadeIn } from '../../../components/motion-wrapper';
import { isArabic } from '../../../i18n/locale';
import { getPage } from '../../../lib/api';
import { robotsMeta } from '../../../lib/seo';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';
const WHATSAPP_DIAL = '966534255367';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'contact' });
  const page = await getPage('contact', { locale });
  const links = alternates(SITE_URL, ROUTES.contact);

  const title = page?.seo.title ?? t('metaTitle');

  const description = page?.seo.description ?? t('metaDescription');

  return {
    title,
    description,
    robots: robotsMeta(process.env.NEXT_PUBLIC_SITE_URL),
    alternates: {
      canonical: canonical(SITE_URL, ROUTES.contact, isArabic(locale) ? 'ar' : 'en'),
      languages: Object.fromEntries(links.map((link) => [link.hrefLang, link.href])),
    },
    openGraph: {
      title,
      description,
      type: 'website',
    },
  };
}

export default async function ContactPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('contact');
  const tc = await getTranslations('common');
  const prefix = isArabic(locale) ? '' : `/${locale}`;

  const faqs = [
    {
      q: t('faq1Q'),
      a: t('faq1A'),
    },
    {
      q: t('faq2Q'),
      a: t('faq2A'),
    },
    {
      q: t('faq3Q'),
      a: t('faq3A'),
    },
    {
      /**
       * True, and checked against the stored warranty policy rather than
       * assumed: the shop does offer free remote help over AnyDesk. What it
       * does not offer is the unconditional version this page carried — "any OS
       * conflict or installation issue" — where the policy the owner wrote
       * makes it conditional on the problem preventing activation. That
       * condition is the difference between a support offer and an open-ended
       * promise of free desktop support for anything.
       */
      q: t('faq4Q'),
      a: t('faq4A'),
    },
    {
      q: t('faq5Q'),
      a: t('faq5A', { hours: String(CONTACT_REPLY_HOURS) }),
    },
  ];

  const graph = buildGraph([
    jsonld.breadcrumbs([
      { name: tc('home'), url: new URL(`${prefix}/`, SITE_URL).toString() },
      {
        name: t('breadcrumb'),
        url: new URL(`${prefix}${ROUTES.contact}`, SITE_URL).toString(),
      },
    ]),
    jsonld.faqPage(faqs),
  ]);

  return (
    <main className="shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      {/* --- Contact Hero Header --- */}
      <section className="contact-hero" aria-labelledby="contact-heading">
        <MotionFadeIn>
          <span className="contact-badge">
            <span>💬</span>
            <span>{t('badge')}</span>
          </span>

          <h1 id="contact-heading">
            {t('heading')}
          </h1>

          <p className="contact-hero-lede">
            {t('lede')}
          </p>

          <span className="contact-sla-badge">
            <span>⏱️</span>
            <span>
              {t('sla')}
            </span>
          </span>
        </MotionFadeIn>
      </section>

      {/* --- 2-Column Responsive Contact Layout --- */}
      <div className="contact-grid-layout">
        {/* Column 1: Contact Form */}
        <div className="contact-form-container">
          <MotionFadeIn>
            <ContactForm locale={locale} />
          </MotionFadeIn>
        </div>

        {/* Column 2: Direct Support Channels & Shortcuts */}
        <aside className="contact-sidebar">
          <MotionFadeIn>
            {/* Direct Channels Box */}
            <div className="contact-channels-box">
              <span className="channels-box-title">
                <span>⚡</span>
                <span>{t('channelsTitle')}</span>
              </span>

              {/* WhatsApp Card */}
              <a
                href={`https://wa.me/${WHATSAPP_DIAL}`}
                target="_blank"
                rel="noopener noreferrer"
                className="channel-card channel-whatsapp"
              >
                <div className="channel-card-left">
                  <div className="channel-icon-wrap" aria-hidden="true">
                    <WhatsAppIcon size={24} />
                  </div>
                  <div className="channel-info">
                    <strong>{t('whatsappTitle')}</strong>
                    <span dir="ltr">+966 53 425 5367</span>
                  </div>
                </div>
                <span className="channel-action-badge">{t('whatsappAction')}</span>
              </a>

              {/* Email Card */}
              <a href="mailto:help@digital-activation.com" className="channel-card channel-email">
                <div className="channel-card-left">
                  <div className="channel-icon-wrap" aria-hidden="true">
                    <MailIcon />
                  </div>
                  <div className="channel-info">
                    <strong>{t('emailTitle')}</strong>
                    <span dir="ltr">help@digital-activation.com</span>
                  </div>
                </div>
                <span className="channel-action-badge">{t('emailAction')}</span>
              </a>

              {/* Telegram Card */}
              <a
                href="https://t.me/digitalactivations"
                target="_blank"
                rel="noopener noreferrer"
                className="channel-card channel-telegram"
              >
                <div className="channel-card-left">
                  <div className="channel-icon-wrap" aria-hidden="true">
                    <TelegramIcon size={22} />
                  </div>
                  <div className="channel-info">
                    <strong>{t('telegramTitle')}</strong>
                    <span dir="ltr">@digitalactivations</span>
                  </div>
                </div>
                <span className="channel-action-badge">{t('telegramAction')}</span>
              </a>
            </div>

            {/* Self-Service Shortcuts Box */}
            <div className="self-service-box">
              <h3>{t('shortcutsTitle')}</h3>
              <ul className="self-service-list">
                <li>
                  <Link href={`${prefix}${ROUTES.licenses}`} className="self-service-link">
                    <span className="shortcut-icon" aria-hidden="true">
                      🔑
                    </span>
                    <span>
                      {t('shortcutLicences')}
                    </span>
                  </Link>
                </li>
                <li>
                  <Link href={`${prefix}${ROUTES.goldenWarranty}`} className="self-service-link">
                    <span className="shortcut-icon" aria-hidden="true">
                      🛡️
                    </span>
                    <span>
                      {t('shortcutWarranty')}
                    </span>
                  </Link>
                </li>
                <li>
                  <Link href={`${prefix}${ROUTES.accountOrders}`} className="self-service-link">
                    <span className="shortcut-icon" aria-hidden="true">
                      📦
                    </span>
                    <span>
                      {t('shortcutOrders')}
                    </span>
                  </Link>
                </li>
                <li>
                  <Link href={`${prefix}${ROUTES.store}`} className="self-service-link">
                    <span className="shortcut-icon" aria-hidden="true">
                      🛍️
                    </span>
                    <span>
                      {t('shortcutStore')}
                    </span>
                  </Link>
                </li>
              </ul>
            </div>
          </MotionFadeIn>
        </aside>
      </div>

      {/* --- Support FAQ Accordion Section --- */}
      <section className="contact-faq-section" aria-labelledby="faq-heading">
        <MotionFadeIn>
          <header className="contact-faq-head">
            <h2 id="faq-heading">
              {t('faqTitle')}
            </h2>
            <p>
              {t('faqBody')}
            </p>
          </header>

          <div className="contact-faq-list">
            {faqs.map((faq, index) => (
              <details key={index} className="contact-faq-item" open={index === 0}>
                <summary>
                  <span>{faq.q}</span>
                  <span aria-hidden="true" style={{ opacity: 0.5 }}>
                    ▾
                  </span>
                </summary>
                <div className="contact-faq-content">
                  <p style={{ margin: 0 }}>{faq.a}</p>
                </div>
              </details>
            ))}
          </div>
        </MotionFadeIn>
      </section>
    </main>
  );
}
