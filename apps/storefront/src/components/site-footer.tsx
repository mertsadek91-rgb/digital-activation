import Link from 'next/link';
import { CONTACT_REPLY_HOURS, ROUTES } from '@da/contracts';
import { BRAND } from '@da/ui';

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

/** The 4 Core Guarantees with styled themed color badges */
const PROMISES = [
  {
    kind: 'warranty',
    badgeTheme: 'gold',
    ar: 'ضمان ذهبي معتمد',
    en: 'Certified Golden Warranty',
    subAr: 'تراخيص أصلية ١٠٠٪ ومكفولة طوال مدة اشتراكك',
    subEn: '100% genuine keys, guaranteed for the full licence duration',
    icon: ShieldCheckIcon,
  },
  {
    kind: 'delivery',
    badgeTheme: 'sky',
    ar: 'تسليم رقمي فوري',
    en: 'Instant Digital Delivery',
    subAr: 'استلام فوري للمفتاح وروابط التحميل على بريدك وواتساب',
    subEn: 'Instant receipt of product key & official setup guides',
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
    ar: 'دفع آمن',
    en: 'Secure payment',
    subAr: 'الدفع عبر اتصال مشفّر، ولا نحتفظ ببيانات الدفع عندنا',
    subEn: 'Paid over an encrypted connection; we keep no payment details',
    icon: CreditCardIcon,
  },
  {
    kind: 'support',
    badgeTheme: 'purple',
    // "24/7" is a staffing claim, and the shop has never made one. What it does
    // commit to is a reply inside CONTACT_REPLY_HOURS, which is what the contact
    // form and its acknowledgement email both say.
    ar: 'دعم فني متخصص',
    en: 'Dedicated technical support',
    subAr: `فريق تقني يردّ خلال ${String(CONTACT_REPLY_HOURS)} ساعة كحدّ أقصى`,
    subEn: `A technical team that answers within ${String(CONTACT_REPLY_HOURS)} hours`,
    icon: SupportIcon,
  },
];

/** Core legal and trust policy pages */
const POLICY_PAGES = [
  {
    slug: 'golden-warranty',
    ar: '🛡️ الضمان الذهبي المعتمد',
    en: '🛡️ Golden Warranty',
    isSpecial: true,
  },
  { slug: 'terms', ar: 'سياسة الاستخدام والخدمة', en: 'Terms of Service', isSpecial: false },
  /*
   * The refund policy, which was published and linked from nowhere.
   *
   * It is the page a buyer looks for before typing a card number and the page
   * a payment provider asks for by URL during onboarding — and on a store
   * selling a product that cannot be posted back, it is the one policy that
   * answers the question everybody actually has.
   */
  { slug: 'refunds', ar: 'سياسة الاسترجاع', en: 'Refund Policy', isSpecial: false },
  { slug: 'privacy', ar: 'سياسة الخصوصية وأمان البيانات', en: 'Privacy Policy', isSpecial: false },
  { slug: 'contact', ar: 'مركز الدعم والتذاكر', en: 'Support Center', isSpecial: false },
];

export function SiteFooter({
  locale,
  collections = [],
}: {
  locale: string;
  collections?: { slug: string; name: string }[];
}) {
  const ar = locale !== 'en';
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
              <div key={promise.ar} className={`footer-promise-card is-${promise.badgeTheme}`}>
                <div className="promise-icon-bubble" aria-hidden="true">
                  <Icon size={22} />
                </div>
                <div className="promise-text-block">
                  <strong className="promise-title">{ar ? promise.ar : promise.en}</strong>
                  <span className="promise-desc">{ar ? promise.subAr : promise.subEn}</span>
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
              {ar ? 'المنصة الرسمية للتراخيص الرقمية' : 'Official Software Activation Hub'}
            </p>

            <p className="footer-brand-bio">
              {ar
                ? 'الوجهة الموثوقة الأولى في السعودية والخليج لتوفير مفاتيح تفعيل أنظمة التشغيل وحزم الأوفيس وبرامج الحماية الأصلية بأفضل الأسعار مع تسليم فوري وضمان شامل.'
                : 'Your trusted premier destination in Saudi Arabia & GCC for genuine Windows, Office, and Antivirus activation licenses with instant delivery and full warranty.'}
            </p>

            <div className="footer-trust-badges">
              <span className="trust-pill">🇸🇦 {ar ? 'متجر موثق رسمياً' : 'Verified Store'}</span>
              <span className="trust-pill">⚡ {ar ? 'تسليم فوري ومباشر' : 'Instant Delivery'}</span>
            </div>

            {/* Social channels */}
            <div className="footer-social-wrap">
              <span className="social-label">{ar ? 'قنواتنا الرسمية:' : 'Official channels:'}</span>
              <div className="footer-social-links">
                <a
                  href={`https://wa.me/${WHATSAPP_DIAL}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={ar ? 'واتساب الدعم' : 'WhatsApp Support'}
                  className="social-btn is-whatsapp"
                  title="WhatsApp"
                >
                  <WhatsAppIcon size={18} />
                </a>
                <a
                  href="https://t.me/digitalactivation"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={ar ? 'قناة تيليجرام' : 'Telegram Channel'}
                  className="social-btn is-telegram"
                  title="Telegram"
                >
                  <TelegramIcon size={18} />
                </a>
                <a
                  href="https://x.com/digital_activ"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={ar ? 'حسابنا على X' : 'X Profile'}
                  className="social-btn is-x"
                  title="X (Twitter)"
                >
                  <XIcon size={16} />
                </a>
                <a
                  href="https://instagram.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={ar ? 'حساب انستغرام' : 'Instagram Profile'}
                  className="social-btn is-instagram"
                  title="Instagram"
                >
                  <InstagramIcon size={17} />
                </a>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  aria-label={ar ? 'مراسلة البريد الإلكتروني' : 'Send Email'}
                  className="social-btn is-mail"
                  title="Email"
                >
                  <MailIcon />
                </a>
              </div>
            </div>
          </div>

          {/* Col 2: Categories */}
          <nav className="footer-nav-column" aria-label={ar ? 'أقسام المتجر' : 'Categories'}>
            <h2 className="footer-col-title">{ar ? 'أقسام المتجر' : 'Categories'}</h2>
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
                      <span>{ar ? 'ويندوز 11 و 10' : 'Windows 11 & 10'}</span>
                    </Link>
                  </li>
                  <li>
                    <Link href={`${prefix}/collections/office`}>
                      <span className="bullet-dot" aria-hidden="true">
                        ›
                      </span>
                      <span>{ar ? 'مايكروسوفت أوفيس' : 'Microsoft Office'}</span>
                    </Link>
                  </li>
                  <li>
                    <Link href={`${prefix}/collections/antivirus`}>
                      <span className="bullet-dot" aria-hidden="true">
                        ›
                      </span>
                      <span>{ar ? 'برامج مكافحة الفيروسات' : 'Antivirus & Security'}</span>
                    </Link>
                  </li>
                  <li>
                    <Link href={`${prefix}/collections/server`}>
                      <span className="bullet-dot" aria-hidden="true">
                        ›
                      </span>
                      <span>{ar ? 'ويندوز سيرفر و CAL' : 'Windows Server & CAL'}</span>
                    </Link>
                  </li>
                  <li>
                    <Link href={`${prefix}/collections/subscriptions`}>
                      <span className="bullet-dot" aria-hidden="true">
                        ›
                      </span>
                      <span>{ar ? 'اشتراكات برامج التصميم' : 'Design & Creative Tools'}</span>
                    </Link>
                  </li>
                </>
              )}
            </ul>
          </nav>

          {/* Col 3: Sitemap */}
          <nav className="footer-nav-column" aria-label={ar ? 'خريطة الموقع' : 'Site map'}>
            <h2 className="footer-col-title">{ar ? 'خريطة الموقع' : 'Site Map'}</h2>
            <ul className="footer-nav-list">
              <li>
                <Link href={`${prefix}${ROUTES.store}`}>
                  <span className="bullet-dot" aria-hidden="true">
                    ›
                  </span>
                  <span>{ar ? 'المتجر الرقمي' : 'Software Store'}</span>
                </Link>
              </li>
              <li>
                <Link href={`${prefix}${ROUTES.blog}`}>
                  <span className="bullet-dot" aria-hidden="true">
                    ›
                  </span>
                  <span>{ar ? 'المدونة وشروحات التفعيل' : 'Guides & Blog'}</span>
                </Link>
              </li>
              <li>
                <Link href={`${prefix}${ROUTES.search}`}>
                  <span className="bullet-dot" aria-hidden="true">
                    ›
                  </span>
                  <span>{ar ? 'البحث عن مفتاح تفعيل' : 'Search Keys'}</span>
                </Link>
              </li>
              <li>
                <Link href={`${prefix}${ROUTES.licenses}`}>
                  <span className="bullet-dot" aria-hidden="true">
                    ›
                  </span>
                  <span>{ar ? 'بوابة تراخيصي' : 'My Licenses'}</span>
                </Link>
              </li>
              <li>
                <Link href={`${prefix}${ROUTES.accountOrders}`}>
                  <span className="bullet-dot" aria-hidden="true">
                    ›
                  </span>
                  <span>{ar ? 'سجل طلباتي السابقة' : 'Order History'}</span>
                </Link>
              </li>
            </ul>
          </nav>

          {/* Col 4: Guarantees & Policies */}
          <nav
            className="footer-nav-column"
            aria-label={ar ? 'الضمان والسياسات' : 'Trust & Policies'}
          >
            <h2 className="footer-col-title">{ar ? 'الضمان والسياسات' : 'Trust & Policies'}</h2>
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
                    <span>{ar ? page.ar : page.en}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Col 5: Customer Service Hub */}
          <div className="footer-support-column">
            <div className="support-col-header">
              <h2 className="footer-col-title">
                {ar ? 'خدمة العملاء والدعم' : 'Customer Support'}
              </h2>
              <span className="support-status-chip">
                <span className="status-ping" aria-hidden="true" />
                {ar ? 'متاح الآن للرد الفوري' : 'Online & Ready'}
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
                    {ar ? 'واتساب المباشر' : 'Direct WhatsApp'}
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
                    {ar ? 'البريد الرسمي للدعم' : 'Official Support Email'}
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
                  <strong>{ar ? 'دعم فني عن بُعد' : 'Remote setup help'}</strong>
                  <span>
                    {ar
                      ? 'إن منعت مشكلة في جهازك التفعيل، نساعدك عن بُعد دون رسوم'
                      : 'If a problem on your machine blocks activation, we help remotely at no charge'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. VIP Newsletter Strip */}
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
      <PaymentsBar locale={locale} />

      {/* 5. Bottom Copyright & Locale Switcher Bar */}
      <div className="footer-bottom-bar">
        <div className="footer-bottom-container">
          <p className="copyright-notice">
            {ar
              ? `جميع الحقوق محفوظة © ${String(currentYear)} لصالح ${BRAND.nameAr} — مؤسسة رقمية سعودية موثقة.`
              : `© ${String(currentYear)} ${BRAND.nameEn}. All rights reserved.`}
          </p>

          <p className="footer-made-note">
            {ar
              ? 'الوجهة الأولى لتراخيص البرامج المعتمدة في المملكة والخليج العربي 🇸🇦'
              : 'The leading destination for genuine digital licenses in Saudi Arabia & GCC.'}
          </p>

          <div className="footer-lang-switcher">
            <Link
              href={ar ? '/en' : '/'}
              hrefLang={ar ? 'en' : 'ar'}
              className="footer-lang-btn"
              title={ar ? 'تبديل اللغة إلى الإنجليزية' : 'Switch language to Arabic'}
            >
              <GlobeIcon size={16} />
              <span>{ar ? 'English' : 'العربية'}</span>
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
