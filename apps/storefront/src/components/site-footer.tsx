import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ROUTES } from '@da/contracts';
import { BRAND } from '@da/ui';

import { isArabic } from '../i18n/locale';
import { SUPPORT_EMAIL, WHATSAPP_DIAL, WHATSAPP_SHOWN } from '../lib/contact';

import {
  BoltIcon,
  GlobeIcon,
  HeadsetIcon,
  InstagramIcon,
  MailIcon,
  ShieldCheckIcon,
  TelegramIcon,
  WhatsAppIcon,
  XIcon,
} from './icons';
import { PaymentsBar } from './product-trust';
import { BrandLogo } from './brand-logo';
import { FooterNewsletter } from './footer-newsletter';

/**
 * Site footer: the five-column layout the shop had before the kit, drawn in
 * the kit's language (owner request, 2026-10-03, after the simplified kit
 * footer went to staging).
 *
 * The brand column carries the real logo, the one-line promise, the two
 * trust pills and the official channels. Then the shelves, the site map, the
 * warranty and policies, and a support column that gives a buyer two ways to
 * reach a person — WhatsApp and email, as cards — with the remote-help note
 * under them. The newsletter card follows, then the payment bar, then the
 * bottom row with the copyright and the language switch. No registration or
 * VAT numbers: the owner removed them from the storefront the same day.
 */

/** Core legal and trust policy pages, labelled by `footer.policy.<key>`. */
const POLICY_PAGES = [
  { slug: 'golden-warranty', key: 'goldenWarranty', isSpecial: true },
  { slug: 'terms', key: 'terms', isSpecial: false },
  /*
   * The refund policy: the page a buyer looks for before typing a card number
   * and the page a payment provider asks for by URL during onboarding.
   */
  { slug: 'refunds', key: 'refunds', isSpecial: false },
  { slug: 'privacy', key: 'privacy', isSpecial: false },
  { slug: 'contact', key: 'contact', isSpecial: false },
] as const;

export function SiteFooter({
  locale,
  collections = [],
}: {
  locale: string;
  collections?: { slug: string; name: string }[];
}) {
  const t = useTranslations('footer');
  const th = useTranslations('header');
  const ar = isArabic(locale);
  const prefix = ar ? '' : `/${locale}`;
  const currentYear = new Date().getFullYear();
  const brandName = ar ? BRAND.nameAr : BRAND.nameEn;

  const categories =
    collections.length > 0
      ? collections.slice(0, 6).map((col) => ({
          href: `${prefix}${ROUTES.collection(col.slug)}`,
          label: col.name,
        }))
      : [
          { href: `${prefix}/collections/windows`, label: t('fallbackWindows') },
          { href: `${prefix}/collections/office`, label: t('fallbackOffice') },
          { href: `${prefix}/collections/antivirus`, label: t('fallbackAntivirus') },
          { href: `${prefix}/collections/server`, label: t('fallbackServer') },
          { href: `${prefix}/collections/subscriptions`, label: t('fallbackDesign') },
        ];

  const siteMap = [
    { href: `${prefix}${ROUTES.store}`, label: t('softwareStore') },
    { href: `${prefix}${ROUTES.blog}`, label: t('guides') },
    { href: `${prefix}${ROUTES.search}`, label: t('searchKeys') },
    { href: `${prefix}${ROUTES.licenses}`, label: t('myLicences') },
    { href: `${prefix}${ROUTES.accountOrders}`, label: t('orderHistory') },
  ];

  return (
    <footer className="site-footer" role="contentinfo">
      <div className="footer-main">
        <div className="footer-main-container">
          {/* 1. The brand: the real logo (which already contains the name),
              the promise, the two pills, the channels. */}
          <div className="footer-brand-column">
            <Link
              href={`${prefix}${ROUTES.home}`}
              className="footer-brand-header"
              aria-label={brandName}
            >
              <BrandLogo locale={locale} width={150} />
            </Link>
            <p className="footer-brand-sub">{t('brandSub')}</p>
            <p className="footer-brand-bio">{t('brandBio')}</p>

            <div className="footer-trust-badges">
              <span className="trust-pill">
                <ShieldCheckIcon size={14} />
                <span>{t('verifiedStore')}</span>
              </span>
              <span className="trust-pill">
                <BoltIcon size={14} />
                <span>{t('instantDelivery')}</span>
              </span>
            </div>

            <div className="footer-social-wrap">
              <span className="social-label">{t('channels')}</span>
              <div className="footer-social-links">
                <a
                  href={`https://wa.me/${WHATSAPP_DIAL}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('whatsappSupport')}
                  className="icon-button social-btn"
                  title="WhatsApp"
                >
                  <WhatsAppIcon size={20} />
                </a>
                <a
                  href="https://t.me/digitalactivation"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('telegram')}
                  className="icon-button social-btn"
                  title="Telegram"
                >
                  <TelegramIcon size={20} />
                </a>
                <a
                  href="https://x.com/digital_activ"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('x')}
                  className="icon-button social-btn"
                  title="X (Twitter)"
                >
                  <XIcon size={16} />
                </a>
                <a
                  href="https://instagram.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('instagram')}
                  className="icon-button social-btn"
                  title="Instagram"
                >
                  <InstagramIcon size={18} />
                </a>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  aria-label={t('sendEmail')}
                  className="icon-button social-btn"
                  title="Email"
                >
                  <MailIcon />
                </a>
              </div>
            </div>
          </div>

          {/* 2. The shelves the catalog actually has. */}
          <nav className="footer-nav-column" aria-label={t('categories')}>
            <h2 className="footer-col-title">{t('categories')}</h2>
            <ul className="footer-nav-list">
              {categories.map((entry) => (
                <li key={entry.href}>
                  <Link href={entry.href}>{entry.label}</Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* 3. The site map. */}
          <nav className="footer-nav-column" aria-label={t('siteMap')}>
            <h2 className="footer-col-title">{t('siteMap')}</h2>
            <ul className="footer-nav-list">
              {siteMap.map((entry) => (
                <li key={entry.href}>
                  <Link href={entry.href}>{entry.label}</Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* 4. The warranty first, then the policies. */}
          <nav className="footer-nav-column" aria-label={t('policies')}>
            <h2 className="footer-col-title">{t('policies')}</h2>
            <ul className="footer-nav-list">
              {POLICY_PAGES.map((page) => (
                <li key={page.slug}>
                  <Link
                    href={`${prefix}/${page.slug}`}
                    className={page.isSpecial ? 'special-policy-link' : undefined}
                  >
                    {page.isSpecial ? <ShieldCheckIcon size={14} /> : null}
                    <span>{t(`policy.${page.key}`)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* 5. A person to reach: two cards and the remote-help note. */}
          <div className="footer-support-column">
            <div className="support-col-header">
              <h2 className="footer-col-title">{t('support')}</h2>
              <span className="support-status-chip">
                <span className="status-ping" aria-hidden="true" />
                {t('online')}
              </span>
            </div>

            <div className="footer-contact-cards">
              <a
                href={`https://wa.me/${WHATSAPP_DIAL}`}
                target="_blank"
                rel="noopener noreferrer"
                className="footer-contact-card"
              >
                <span className="iconbox footer-contact-card-icon is-whatsapp" aria-hidden="true">
                  <WhatsAppIcon size={20} />
                </span>
                <span className="footer-contact-card-body">
                  <span className="footer-contact-card-label">{t('directWhatsapp')}</span>
                  <span className="footer-contact-card-val" dir="ltr">
                    {WHATSAPP_SHOWN}
                  </span>
                </span>
              </a>

              <a href={`mailto:${SUPPORT_EMAIL}`} className="footer-contact-card">
                <span className="iconbox footer-contact-card-icon" aria-hidden="true">
                  <MailIcon />
                </span>
                <span className="footer-contact-card-body">
                  <span className="footer-contact-card-label">{t('supportEmail')}</span>
                  <span className="footer-contact-card-val" dir="ltr">
                    {SUPPORT_EMAIL}
                  </span>
                </span>
              </a>

              {/* The shop's own offer, in the shop's own terms: conditional on a
                  problem that is preventing activation, as the warranty policy
                  the owner wrote makes it. */}
              <div className="remote-support-badge">
                <span className="iconbox footer-contact-card-icon" aria-hidden="true">
                  <HeadsetIcon size={20} />
                </span>
                <span className="remote-text">
                  <strong>{t('remoteTitle')}</strong>
                  <span>{t('remoteBody')}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* The newsletter, double opt-in: the form sends a confirmation email
          and says so. */}
      <div className="footer-newsletter-section">
        <div className="footer-newsletter-container">
          <FooterNewsletter locale={locale} />
        </div>
      </div>

      {/* The payment bar: `PaymentMarks` draws only what is configured and
          renders nothing when nothing is, which is why the whole bar hangs
          off it. */}
      <PaymentsBar />

      <div className="footer-bottom-bar">
        <div className="footer-bottom-container">
          <p className="copyright-notice">
            {t('copyright', {
              year: String(currentYear),
              brand: brandName,
            })}
          </p>

          <p className="footer-made-note">{t('madeNote')}</p>

          <div className="footer-lang-switcher">
            <Link
              href={ar ? '/en' : '/'}
              hrefLang={ar ? 'en' : 'ar'}
              className="footer-lang-btn"
              title={t('switchLanguageTitle')}
            >
              <GlobeIcon size={16} />
              <span>{th('otherLanguage')}</span>
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
