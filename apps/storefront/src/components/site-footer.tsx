import { ROUTES } from '@da/contracts';
import Link from 'next/link';

import { BRAND } from '@da/ui';

import { PromiseMark } from './icons';

/**
 * The footer.
 *
 * There was not one. Every page on this store ended at its last paragraph,
 * which is the single largest structural difference from the site it replaces
 * — and the footer is where a shop keeps the things a hesitant buyer looks for
 * before typing a card number: who you are, what you promise, how to reach a
 * person, and where the policies are.
 *
 * Built from live data rather than a hard-coded list. The categories are the
 * ones that actually hold published products, and the policy links are the
 * pages that are actually published: a footer full of links to drafts is worse
 * than a short footer, because every one of them is a dead end discovered at
 * the moment somebody was looking for reassurance.
 *
 * Two things the old site's footer has and this one does not, deliberately:
 *
 *   - Payment marks. The store offers no payment method yet, and a row of
 *     Visa and mada logos under a checkout that cannot take a card is a claim
 *     the shop cannot honour. They belong here the day Stripe is configured,
 *     driven by what is actually offered.
 *   - Social icons. Nobody has given me the accounts, and a linked icon that
 *     goes nowhere is worse than no icon.
 */
/**
 * The number twice: once to dial and once to read.
 *
 * `wa.me` takes digits only, and a phone number without its groups is a number
 * somebody mis-copies — this one is printed on the shop's own site in exactly
 * these groups.
 */
const WHATSAPP_DIAL = '966534255367';
const WHATSAPP_SHOWN = '+966 53 425 5367';
const SUPPORT_EMAIL = 'help@digital-activation.com';

/** What the store promises, in the four claims the old footer made. */
const PROMISES = [
  {
    kind: 'warranty' as const,
    ar: 'ضمان ذهبي',
    en: 'Golden warranty',
    subAr: 'أكواد تفعيل أصلية ١٠٠٪ ومكفولة',
    subEn: 'Genuine keys, covered for the licence term',
  },
  {
    kind: 'delivery' as const,
    ar: 'تسليم سريع',
    en: 'Fast delivery',
    subAr: 'تسليم فوري لأكواد التفعيل عبر البريد',
    subEn: 'Activation keys by email',
  },
  {
    kind: 'price' as const,
    ar: 'أسعار منافسة',
    en: 'Fair prices',
    subAr: 'تلبّي ميزانيتك مع خصومات دائمة',
    subEn: 'Priced to sit inside a budget',
  },
  {
    kind: 'support' as const,
    ar: 'دعم فني',
    en: 'Real support',
    subAr: 'فريق تقني محترف متواجد لمساعدتك',
    subEn: 'A person who answers, in Arabic',
  },
];

/** Only the pages that exist and are published. Slugs, not guesses. */
const POLICY_PAGES = [
  { slug: 'terms', ar: 'سياسة الاستخدام', en: 'Terms of use' },
  { slug: 'privacy', ar: 'سياسة الخصوصية', en: 'Privacy policy' },
  { slug: 'golden-warranty', ar: 'الضمان الذهبي', en: 'Golden warranty' },
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

  return (
    <footer className="site-footer">
      <div className="footer-promises">
        {PROMISES.map((promise) => (
          <div key={promise.ar} className="promise">
            <span className="promise-mark" aria-hidden="true">
              <PromiseMark kind={promise.kind} />
            </span>
            <span>
              <strong>{ar ? promise.ar : promise.en}</strong>
              <span className="promise-sub">{ar ? promise.subAr : promise.subEn}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="footer-columns">
        <div className="footer-brand">
          <p className="footer-logo">{ar ? BRAND.nameAr : BRAND.nameEn}</p>
          <p className="footer-about">{ar ? BRAND.taglineAr : BRAND.taglineEn}</p>
        </div>

        {collections.length > 0 ? (
          <nav className="footer-col" aria-label={ar ? 'التصنيفات' : 'Categories'}>
            <h2>{ar ? 'التصنيفات' : 'Categories'}</h2>
            <ul>
              {collections.slice(0, 6).map((collection) => (
                <li key={collection.slug}>
                  <Link href={`${prefix}${ROUTES.collection(collection.slug)}`}>
                    {collection.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <nav className="footer-col" aria-label={ar ? 'خريطة الموقع' : 'Site map'}>
          <h2>{ar ? 'خريطة الموقع' : 'Site map'}</h2>
          <ul>
            <li>
              <Link href={`${prefix}${ROUTES.store}`}>{ar ? 'المتجر' : 'Store'}</Link>
            </li>
            <li>
              <Link href={`${prefix}${ROUTES.blog}`}>{ar ? 'المدونة' : 'Blog'}</Link>
            </li>
            <li>
              <Link href={`${prefix}${ROUTES.search}`}>{ar ? 'ابحث' : 'Search'}</Link>
            </li>
            <li>
              <Link href={`${prefix}${ROUTES.licenses}`}>{ar ? 'تراخيصي' : 'My licences'}</Link>
            </li>
            <li>
              <Link href={`${prefix}${ROUTES.accountOrders}`}>{ar ? 'طلباتي' : 'My orders'}</Link>
            </li>
          </ul>
        </nav>

        <nav className="footer-col" aria-label={ar ? 'روابط مهمة' : 'Policies'}>
          <h2>{ar ? 'روابط مهمة' : 'Policies'}</h2>
          <ul>
            {POLICY_PAGES.map((page) => (
              <li key={page.slug}>
                <Link href={`${prefix}/${page.slug}`}>{ar ? page.ar : page.en}</Link>
              </li>
            ))}
            <li>
              <Link href={`${prefix}${ROUTES.contact}`}>{ar ? 'الدعم الفني' : 'Support'}</Link>
            </li>
          </ul>
        </nav>

        <div className="footer-col footer-contact">
          <h2>{ar ? 'خدمة العملاء' : 'Customer service'}</h2>
          <ul>
            <li>
              <a href={`https://wa.me/${WHATSAPP_DIAL}`} rel="noopener noreferrer">
                <span className="contact-kind">{ar ? 'واتساب' : 'WhatsApp'}</span>
                <span className="contact-value" dir="ltr">
                  {WHATSAPP_SHOWN}
                </span>
              </a>
            </li>
            <li>
              <a href={`mailto:${SUPPORT_EMAIL}`}>
                <span className="contact-kind">{ar ? 'البريد الإلكتروني' : 'Email'}</span>
                <span className="contact-value" dir="ltr">
                  {SUPPORT_EMAIL}
                </span>
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="footer-base">
        <p>
          {ar
            ? `جميع الحقوق محفوظة © ${String(new Date().getFullYear())} لصالح ${BRAND.nameAr}`
            : `© ${String(new Date().getFullYear())} ${BRAND.nameEn}. All rights reserved.`}
        </p>
        {/* The language switch lives in the header too, but somebody who has
            read to the bottom in the wrong language should not have to go back
            up to change it. */}
        <Link href={ar ? '/en' : '/'} hrefLang={ar ? 'en' : 'ar'}>
          {ar ? 'English' : 'العربية'}
        </Link>
      </div>
    </footer>
  );
}
