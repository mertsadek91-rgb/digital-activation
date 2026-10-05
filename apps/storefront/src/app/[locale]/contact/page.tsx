import type { Metadata } from 'next';
import { Link } from '../../../components/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CONTACT_REPLY_HOURS, ROUTES } from '@da/contracts';
import { alternates, buildGraph, canonical, jsonld } from '@da/seo';

import { Breadcrumbs } from '../../../components/breadcrumbs';
import { ContactForm } from '../../../components/contact-form';
import {
  BoltIcon,
  CartIcon,
  EnvelopeIcon,
  GridIcon,
  KeyIcon,
  PlusIcon,
  ShieldCheckIcon,
  TelegramIcon,
  WhatsAppIcon,
} from '../../../components/icons';
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

  // The kit's `support` page (TASK-0108): the band, then two columns — how
  // to reach a person and the common questions on the start side, the form
  // as a card on the end side — and the kit's mint support banner under them.
  // The emoji glyphs are gone: every channel and shortcut has a drawn icon.
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      <div className="page-band">
        <div className="shell">
          <Breadcrumbs
            items={[
              { name: tc('home'), href: `${prefix}/` },
              { name: t('breadcrumb'), href: `${prefix}${ROUTES.contact}` },
            ]}
          />
          <header className="page-head">
            <h1>{t('heading')}</h1>
            <p className="lede">{t('lede')}</p>
          </header>
          <span className="content-label">
            <BoltIcon size={14} />
            {t('sla')}
          </span>
        </div>
      </div>

      <main className="shell contact-page">
        <div className="contact-layout">
          <div className="contact-info">
            <section aria-labelledby="contact-channels">
              <h2 id="contact-channels">{t('channelsTitle')}</h2>
              <ul className="channel-list">
                <li>
                  <a
                    href={`https://wa.me/${WHATSAPP_DIAL}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="channel-card"
                  >
                    <span className="iconbox is-whatsapp" aria-hidden="true">
                      <WhatsAppIcon size={22} />
                    </span>
                    <span className="channel-text">
                      <strong>{t('whatsappTitle')}</strong>
                      <span dir="ltr">+966 53 425 5367</span>
                    </span>
                    <span className="channel-action">{t('whatsappAction')}</span>
                  </a>
                </li>
                <li>
                  <a href="mailto:help@digital-activation.com" className="channel-card">
                    <span className="iconbox" aria-hidden="true">
                      <EnvelopeIcon size={22} />
                    </span>
                    <span className="channel-text">
                      <strong>{t('emailTitle')}</strong>
                      <span dir="ltr">help@digital-activation.com</span>
                    </span>
                    <span className="channel-action">{t('emailAction')}</span>
                  </a>
                </li>
                <li>
                  <a
                    href="https://t.me/digitalactivations"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="channel-card"
                  >
                    <span className="iconbox" aria-hidden="true">
                      <TelegramIcon size={22} />
                    </span>
                    <span className="channel-text">
                      <strong>{t('telegramTitle')}</strong>
                      <span dir="ltr">@digitalactivations</span>
                    </span>
                    <span className="channel-action">{t('telegramAction')}</span>
                  </a>
                </li>
              </ul>
            </section>

            <section aria-labelledby="contact-shortcuts">
              <h2 id="contact-shortcuts">{t('shortcutsTitle')}</h2>
              <ul className="shortcut-list">
                <li>
                  <Link href={`${prefix}${ROUTES.licenses}`} className="menuitem">
                    <KeyIcon size={20} />
                    <span>{t('shortcutLicences')}</span>
                  </Link>
                </li>
                <li>
                  <Link href={`${prefix}${ROUTES.goldenWarranty}`} className="menuitem">
                    <ShieldCheckIcon size={20} />
                    <span>{t('shortcutWarranty')}</span>
                  </Link>
                </li>
                <li>
                  <Link href={`${prefix}${ROUTES.accountOrders}`} className="menuitem">
                    <CartIcon />
                    <span>{t('shortcutOrders')}</span>
                  </Link>
                </li>
                <li>
                  <Link href={`${prefix}${ROUTES.store}`} className="menuitem">
                    <GridIcon size={20} />
                    <span>{t('shortcutStore')}</span>
                  </Link>
                </li>
              </ul>
            </section>

            <section aria-labelledby="faq-heading">
              <h2 id="faq-heading">{t('faqTitle')}</h2>
              <p className="contact-faq-lede">{t('faqBody')}</p>
              <div className="faq-list">
                {faqs.map((faq, index) => (
                  <details key={index} className="faqrow" open={index === 0}>
                    <summary>
                      <span>{faq.q}</span>
                      <span className="faq-toggle" aria-hidden="true">
                        <PlusIcon />
                      </span>
                    </summary>
                    <p>{faq.a}</p>
                  </details>
                ))}
              </div>
            </section>
          </div>

          <div className="contact-form-col">
            <ContactForm locale={locale} />
          </div>
        </div>

        <section className="help-banner" aria-labelledby="contact-help">
          <div>
            <span className="eyebrow">{t('badge')}</span>
            <h2 id="contact-help">{t('helpTitle')}</h2>
            <p>{t('helpBody')}</p>
          </div>
          <div className="help-banner-actions">
            <a
              className="btn btn-primary"
              href={`https://wa.me/${WHATSAPP_DIAL}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <WhatsAppIcon size={18} />
              {t('whatsappAction')}
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
