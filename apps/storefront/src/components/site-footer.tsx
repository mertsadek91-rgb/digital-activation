import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type PublicMarketing, ROUTES } from '@da/contracts';
import { BRAND } from '@da/ui';

import { isArabic } from '../i18n/locale';
import { SUPPORT_EMAIL, WHATSAPP_DIAL, WHATSAPP_SHOWN } from '../lib/contact';

import { GlobeIcon, InstagramIcon, MailIcon, TelegramIcon, WhatsAppIcon, XIcon } from './icons';
import { PaymentsBar } from './product-trust';
import { RegistrationDetails, hasRegistration } from './trust-block';
import { BrandLogo } from './brand-logo';
import { FooterNewsletter } from './footer-newsletter';

/**
 * Site footer, after the UI Kit (`03_Homepage_Sections/<lang>/.../home_footer`, TASK-0102).
 *
 * The kit's footer is four columns on the page ground — the brand and a line
 * about the shop, the products, customer service, useful links — and a
 * bottom row with the copyright and the payment marks. That is what this is,
 * with the shop's own facts in it: the categories the catalog actually has,
 * the ways to reach a person (WhatsApp, email), the policies a buyer looks
 * for before typing a card number, and the registration numbers the store
 * entered. The newsletter card sits above the columns, as the kit's last home
 * section does, on every page.
 *
 * The five-colour promise band and the contact "cards" that stood here are
 * gone: the benefits are on the home page in the kit's own strip, and a
 * footer that repeats the home page on every page is a footer nobody reads.
 */

/** Core legal and trust policy pages, labelled by `footer.policy.<key>`. */
const POLICY_PAGES = [
  { slug: 'golden-warranty', key: 'goldenWarranty', isSpecial: true },
  { slug: 'terms', key: 'terms', isSpecial: false },
  /*
   * The refund policy: the page a buyer looks for before typing a card number
   * and the page a payment provider asks for by URL during onboarding — and on
   * a store selling a product that cannot be posted back, it is the one policy
   * that answers the question everybody actually has.
   */
  { slug: 'refunds', key: 'refunds', isSpecial: false },
  { slug: 'privacy', key: 'privacy', isSpecial: false },
] as const;

export function SiteFooter({
  locale,
  collections = [],
  trust = null,
}: {
  locale: string;
  collections?: { slug: string; name: string }[];
  /** The marketing panel's trust settings; null while that feature is off. */
  trust?: PublicMarketing['trust'];
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

  return (
    <footer className="site-footer" role="contentinfo">
      {/* The newsletter, double opt-in: the form sends a confirmation email
          and says so. */}
      <div className="footer-newsletter-section">
        <div className="footer-newsletter-container">
          <FooterNewsletter locale={locale} />
        </div>
      </div>

      <div className="footer-main">
        <div className="footer-main-container">
          {/* The brand: the real logo, which already contains the name, and
              the one line that says what the shop is, which the mark does not. */}
          <div className="footer-brand-column">
            <Link
              href={`${prefix}${ROUTES.home}`}
              className="footer-brand-header"
              aria-label={brandName}
            >
              <BrandLogo locale={locale} width={140} />
            </Link>
            <p className="footer-brand-bio">{t('brandBio')}</p>

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
            </div>
          </div>

          {/* Products: the categories the catalog actually has. */}
          <nav className="footer-nav-column" aria-label={t('products')}>
            <h2 className="footer-col-title">{t('products')}</h2>
            <ul className="footer-nav-list">
              {categories.map((entry) => (
                <li key={entry.href}>
                  <Link href={entry.href}>{entry.label}</Link>
                </li>
              ))}
              <li>
                <Link href={`${prefix}${ROUTES.store}`}>{t('softwareStore')}</Link>
              </li>
            </ul>
          </nav>

          {/* Customer service: a person to reach, and the pages about an order. */}
          <nav className="footer-nav-column" aria-label={t('customerService')}>
            <h2 className="footer-col-title">{t('customerService')}</h2>
            <ul className="footer-nav-list">
              <li>
                <a
                  href={`https://wa.me/${WHATSAPP_DIAL}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="footer-contact-link"
                >
                  <WhatsAppIcon size={16} />
                  <span>{t('whatsapp')}</span>
                  <span className="footer-contact-value" dir="ltr">
                    {WHATSAPP_SHOWN}
                  </span>
                </a>
              </li>
              <li>
                <a href={`mailto:${SUPPORT_EMAIL}`} className="footer-contact-link">
                  <MailIcon />
                  <span className="footer-contact-value" dir="ltr">
                    {SUPPORT_EMAIL}
                  </span>
                </a>
              </li>
              <li>
                <Link href={`${prefix}${ROUTES.contact}`}>{t('policy.contact')}</Link>
              </li>
              <li>
                <Link href={`${prefix}${ROUTES.licenses}`}>{t('myLicences')}</Link>
              </li>
              <li>
                <Link href={`${prefix}${ROUTES.accountOrders}`}>{t('orderHistory')}</Link>
              </li>
              <li>
                <Link href={`${prefix}${ROUTES.blog}`}>{t('guides')}</Link>
              </li>
            </ul>
          </nav>

          {/* Useful links: the policies, the warranty first. */}
          <nav className="footer-nav-column" aria-label={t('usefulLinks')}>
            <h2 className="footer-col-title">{t('usefulLinks')}</h2>
            <ul className="footer-nav-list">
              {POLICY_PAGES.map((page) => (
                <li key={page.slug}>
                  <Link
                    href={`${prefix}/${page.slug}`}
                    className={page.isSpecial ? 'special-policy-link' : undefined}
                  >
                    {t(`policy.${page.key}`)}
                  </Link>
                </li>
              ))}
              <li>
                <Link href={`${prefix}${ROUTES.search}`}>{t('searchKeys')}</Link>
              </li>
            </ul>
          </nav>
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

          {/* Registration and VAT numbers, as the store entered them. A number
              a buyer can look up is worth more than any badge. */}
          {trust && hasRegistration(trust) ? (
            <RegistrationDetails trust={trust} className="footer-registration" />
          ) : null}

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
