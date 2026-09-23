import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CONTACT_REPLY_HOURS, ROUTES } from '@da/contracts';
import { BRAND } from '@da/ui';

import { isArabic } from '../i18n/locale';

import {
  BoltIcon,
  CreditCardIcon,
  GlobeIcon,
  InstagramIcon,
  MailIcon,
  ShieldCheckIcon,
  SupportIcon,
  TelegramIcon,
  WhatsAppIcon,
  XIcon,
} from './icons';
import { PaymentsBar } from './product-trust';
import { BrandLogo } from './brand-logo';
import { FooterNewsletter } from './footer-newsletter';

const WHATSAPP_DIAL = '966534255367';
const WHATSAPP_SHOWN = '+966 53 425 5367';
const SUPPORT_EMAIL = 'help@digital-activation.com';

/**
 * The 4 Core Guarantees with styled themed color badges. The wording is
 * `footer.promise.<kind>` in the message files.
 */
const PROMISES = [
  {
    kind: 'warranty',
    badgeTheme: 'gold',
    icon: ShieldCheckIcon,
  },
  {
    kind: 'delivery',
    badgeTheme: 'sky',
    icon: BoltIcon,
  },
  {
    kind: 'payments',
    badgeTheme: 'teal',
    /*
     * "ومتعدد" — and several — has gone, because there is one.
     *
     * This strip once named five card networks the shop cannot take. Those
     * were removed and the count survived, which is the same claim with the
     * evidence taken out. One method is configured today, and a promise of
     * several on every page of the site is a promise the checkout then breaks.
     *
     * The card line went with it for the same reason: "we store no card
     * details" is perfectly true and tells a reader that cards are taken. The
     * payment bar lower down is driven by what is actually configured; this
     * strip now says only what stays true however that bar turns out.
     */
    icon: CreditCardIcon,
  },
  {
    kind: 'support',
    badgeTheme: 'purple',
    // "24/7" is a staffing claim, and the shop has never made one. What it does
    // commit to is a reply inside CONTACT_REPLY_HOURS, which is what the contact
    // form and its acknowledgement email both say.
    icon: SupportIcon,
  },
] as const;

/** Core legal and trust policy pages, labelled by `footer.policy.<key>`. */
const POLICY_PAGES = [
  { slug: 'golden-warranty', key: 'goldenWarranty', isSpecial: true },
  { slug: 'terms', key: 'terms', isSpecial: false },
  /*
   * The refund policy, which was published and linked from nowhere.
   *
   * It is the page a buyer looks for before typing a card number and the page
   * a payment provider asks for by URL during onboarding — and on a store
   * selling a product that cannot be posted back, it is the one policy that
   * answers the question everybody actually has.
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

  return (
    <footer className="site-footer" role="contentinfo">
      {/* 1. Value & Guarantees Band */}
      <div className="footer-promises-band">
        <div className="footer-promises-inner">
          {PROMISES.map((promise) => {
            const Icon = promise.icon;
            return (
              <div key={promise.kind} className={`footer-promise-card is-${promise.badgeTheme}`}>
                <div className="promise-icon-bubble" aria-hidden="true">
                  <Icon size={22} />
                </div>
                <div className="promise-text-block">
                  <strong className="promise-title">{t(`promise.${promise.kind}.title`)}</strong>
                  <span className="promise-desc">
                    {t(`promise.${promise.kind}.body`, { hours: String(CONTACT_REPLY_HOURS) })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Main Columns Grid */}
      <div className="footer-main">
        <div className="footer-main-container">
          {/* Col 1: Brand, Trust & Social */}
          <div className="footer-brand-column">
            {/* The real logo, which already contains the name — so the name is
                not set beside it a second time. What stays is the line that
                says what the shop is, which the mark does not. */}
            <Link
              href={`${prefix}${ROUTES.home}`}
              className="footer-brand-header"
              aria-label={ar ? BRAND.nameAr : BRAND.nameEn}
            >
              <BrandLogo locale={locale} width={148} />
            </Link>
            <p className="footer-brand-sub">
              {t('brandSub')}
            </p>

            <p className="footer-brand-bio">
              {t('brandBio')}
            </p>

            <div className="footer-trust-badges">
              <span className="trust-pill">🇸🇦 {t('verifiedStore')}</span>
              <span className="trust-pill">⚡ {t('instantDelivery')}</span>
            </div>

            {/* Social channels */}
            <div className="footer-social-wrap">
              <span className="social-label">{t('channels')}</span>
              <div className="footer-social-links">
                <a
                  href={`https://wa.me/${WHATSAPP_DIAL}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('whatsappSupport')}
                  className="social-btn is-whatsapp"
                  title="WhatsApp"
                >
                  <WhatsAppIcon size={18} />
                </a>
                <a
                  href="https://t.me/digitalactivation"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('telegram')}
                  className="social-btn is-telegram"
                  title="Telegram"
                >
                  <TelegramIcon size={18} />
                </a>
                <a
                  href="https://x.com/digital_activ"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('x')}
                  className="social-btn is-x"
                  title="X (Twitter)"
                >
                  <XIcon size={16} />
                </a>
                <a
                  href="https://instagram.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('instagram')}
                  className="social-btn is-instagram"
                  title="Instagram"
                >
                  <InstagramIcon size={17} />
                </a>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  aria-label={t('sendEmail')}
                  className="social-btn is-mail"
                  title="Email"
                >
                  <MailIcon />
                </a>
              </div>
            </div>
          </div>

          {/* Col 2: Categories */}
          <nav className="footer-nav-column" aria-label={t('categories')}>
            <h2 className="footer-col-title">{t('categories')}</h2>
            <ul className="footer-nav-list">
              {collections.length > 0 ? (
                collections.slice(0, 6).map((col) => (
                  <li key={col.slug}>
                    <Link href={`${prefix}${ROUTES.collection(col.slug)}`}>
                      <span className="bullet-dot" aria-hidden="true">
                        ›
                      </span>
                      <span>{col.name}</span>
                    </Link>
                  </li>
                ))
              ) : (
                <>
                  <li>
                    <Link href={`${prefix}/collections/windows`}>
                      <span className="bullet-dot" aria-hidden="true">
                        ›
                      </span>
                      <span>{t('fallbackWindows')}</span>
                    </Link>
                  </li>
                  <li>
                    <Link href={`${prefix}/collections/office`}>
                      <span className="bullet-dot" aria-hidden="true">
                        ›
                      </span>
                      <span>{t('fallbackOffice')}</span>
                    </Link>
                  </li>
                  <li>
                    <Link href={`${prefix}/collections/antivirus`}>
                      <span className="bullet-dot" aria-hidden="true">
                        ›
                      </span>
                      <span>{t('fallbackAntivirus')}</span>
                    </Link>
                  </li>
                  <li>
                    <Link href={`${prefix}/collections/server`}>
                      <span className="bullet-dot" aria-hidden="true">
                        ›
                      </span>
                      <span>{t('fallbackServer')}</span>
                    </Link>
                  </li>
                  <li>
                    <Link href={`${prefix}/collections/subscriptions`}>
                      <span className="bullet-dot" aria-hidden="true">
                        ›
                      </span>
                      <span>{t('fallbackDesign')}</span>
                    </Link>
                  </li>
                </>
              )}
            </ul>
          </nav>

          {/* Col 3: Sitemap */}
          <nav className="footer-nav-column" aria-label={t('siteMapLabel')}>
            <h2 className="footer-col-title">{t('siteMap')}</h2>
            <ul className="footer-nav-list">
              <li>
                <Link href={`${prefix}${ROUTES.store}`}>
                  <span className="bullet-dot" aria-hidden="true">
                    ›
                  </span>
                  <span>{t('softwareStore')}</span>
                </Link>
              </li>
              <li>
                <Link href={`${prefix}${ROUTES.blog}`}>
                  <span className="bullet-dot" aria-hidden="true">
                    ›
                  </span>
                  <span>{t('guides')}</span>
                </Link>
              </li>
              <li>
                <Link href={`${prefix}${ROUTES.search}`}>
                  <span className="bullet-dot" aria-hidden="true">
                    ›
                  </span>
                  <span>{t('searchKeys')}</span>
                </Link>
              </li>
              <li>
                <Link href={`${prefix}${ROUTES.licenses}`}>
                  <span className="bullet-dot" aria-hidden="true">
                    ›
                  </span>
                  <span>{t('myLicences')}</span>
                </Link>
              </li>
              <li>
                <Link href={`${prefix}${ROUTES.accountOrders}`}>
                  <span className="bullet-dot" aria-hidden="true">
                    ›
                  </span>
                  <span>{t('orderHistory')}</span>
                </Link>
              </li>
            </ul>
          </nav>

          {/* Col 4: Guarantees & Policies */}
          <nav
            className="footer-nav-column"
            aria-label={t('policies')}
          >
            <h2 className="footer-col-title">{t('policies')}</h2>
            <ul className="footer-nav-list">
              {POLICY_PAGES.map((page) => (
                <li key={page.slug}>
                  <Link
                    href={`${prefix}/${page.slug}`}
                    className={page.isSpecial ? 'special-policy-link' : undefined}
                  >
                    <span className="bullet-dot" aria-hidden="true">
                      ›
                    </span>
                    <span>{t(`policy.${page.key}`)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Col 5: Customer Service Hub */}
          <div className="footer-support-column">
            <div className="support-col-header">
              <h2 className="footer-col-title">
                {t('support')}
              </h2>
              <span className="support-status-chip">
                <span className="status-ping" aria-hidden="true" />
                {t('online')}
              </span>
            </div>

            <div className="footer-contact-cards">
              {/* WhatsApp Action */}
              <a
                href={`https://wa.me/${WHATSAPP_DIAL}`}
                target="_blank"
                rel="noopener noreferrer"
                className="footer-contact-card is-whatsapp"
              >
                <div className="footer-contact-card-icon">
                  <WhatsAppIcon size={20} />
                </div>
                <div className="footer-contact-card-body">
                  <span className="footer-contact-card-label">
                    {t('directWhatsapp')}
                  </span>
                  <span className="footer-contact-card-val" dir="ltr">
                    {WHATSAPP_SHOWN}
                  </span>
                </div>
              </a>

              {/* Email Action */}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="footer-contact-card is-email">
                <div className="footer-contact-card-icon">
                  <MailIcon />
                </div>
                <div className="footer-contact-card-body">
                  <span className="footer-contact-card-label">
                    {t('supportEmail')}
                  </span>
                  <span className="footer-contact-card-val" dir="ltr">
                    {SUPPORT_EMAIL}
                  </span>
                </div>
              </a>

              {/* The shop's own offer, in the shop's own terms.
                  It read "مساعدة مجانية عبر AnyDesk لتفعيل مفتاحك خطوة بخطوة" —
                  unconditional, on every page. The warranty policy the owner
                  wrote makes it conditional on a problem that is preventing
                  activation, and that condition is the whole difference between
                  a support offer and free desktop support for anything. */}
              <div className="remote-support-badge">
                <span className="remote-icon" aria-hidden="true">
                  💻
                </span>
                <div className="remote-text">
                  <strong>{t('remoteTitle')}</strong>
                  <span>
                    {t('remoteBody')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* The newsletter, double opt-in: the form sends a confirmation email
          and says so. The strip that stood here before announced a coupon
          and stored nothing. */}
      <div className="footer-newsletter-section">
        <div className="footer-newsletter-container">
          <FooterNewsletter locale={locale} />
        </div>
      </div>

      {/* The payment bar, on every page of the site.
          It listed mada, Apple Pay, Visa, Mastercard, stc pay and bank transfer
          under the heading "طرق الدفع الآمنة والمعتمدة" while the shop had no
          payment method configured at all — six marks, none of which it could
          take. `PaymentMarks` draws only what is configured and renders nothing
          when nothing is, which is why the whole bar hangs off it. */}
      <PaymentsBar />

      {/* 5. Bottom Copyright & Locale Switcher Bar */}
      <div className="footer-bottom-bar">
        <div className="footer-bottom-container">
          <p className="copyright-notice">
            {t('copyright', {
              year: String(currentYear),
              brand: ar ? BRAND.nameAr : BRAND.nameEn,
            })}
          </p>

          <p className="footer-made-note">
            {t('madeNote')}
          </p>

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
