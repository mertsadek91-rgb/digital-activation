import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';

import { CONTACT_REPLY_HOURS, ROUTES } from '@da/contracts';
import { alternates, buildGraph, canonical, jsonld } from '@da/seo';

import { ContactForm } from '../../../components/contact-form';
import { MailIcon, TelegramIcon, WhatsAppIcon } from '../../../components/icons';
import { MotionFadeIn } from '../../../components/motion-wrapper';
import { getPage } from '../../../lib/api';
import { robotsMeta } from '../../../lib/seo';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';
const WHATSAPP_DIAL = '966534255367';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const ar = locale === 'ar';
  const page = await getPage('contact', { locale });
  const links = alternates(SITE_URL, ROUTES.contact);

  const title =
    page?.seo.title ??
    (ar
      ? 'تواصل معنا — الدعم الفني وخدمة العملاء | متجر التفعيل الرقمي'
      : 'Contact Us — Technical Support & Customer Service | Digital Activation');

  const description =
    page?.seo.description ??
    (ar
      ? 'راسلنا عبر النموذج أو تواصل مباشرة عبر واتساب أو تيليجرام أو البريد الإلكتروني. نردّ خلال ساعتين بحد أقصى 24 ساعة.'
      : 'Reach us through the form, or message directly on WhatsApp, Telegram or email. We reply within 2 hours, 24 hours at the latest.');

  return {
    title,
    description,
    robots: robotsMeta(process.env.NEXT_PUBLIC_SITE_URL),
    alternates: {
      canonical: canonical(SITE_URL, ROUTES.contact, ar ? 'ar' : 'en'),
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

  const ar = locale === 'ar';
  const prefix = ar ? '' : `/${locale}`;

  const faqs = [
    {
      q: ar
        ? 'المفتاح لا يعمل أو يظهر خطأ — ما هو أسرع إجراء؟'
        : 'My key is not working or shows an error — what is the fastest step?',
      a: ar
        ? 'اختر «مشكلة تفعيل» في النموذج أعلاه أو راسلنا مباشرة عبر واتساب مع ذكر رقم طلبك. وننصح بعدم تكرار محاولة إدخال المفتاح مرات عديدة حتى يتم فحصه وتزويدك بالحل المناسب أو استبداله فوراً.'
        : 'Select "Activation problem" in the form above or message us directly on WhatsApp with your order number. We advise not repeating incorrect attempts repeatedly until our team verifies it and gives you the exact fix or immediate replacement.',
    },
    {
      q: ar
        ? 'أين أجد مفتاح الترخيص بعد الشراء؟'
        : 'Where do I find my licence key after purchasing?',
      a: ar
        ? 'يصلك المفتاح والتعليمات مباشرة على بريدك الإلكتروني فور إتمام الطلب، كما يمكنك في أي وقت الاطلاع عليه في صفحة «تراخيصي» داخل حسابك عبر تسجيل الدخول برابط البريد.'
        : 'Your key and instructions arrive immediately in your email upon order completion. You can also view it anytime on your "My licences" page by logging in with a magic link.',
    },
    {
      q: ar
        ? 'هل تبيعون للشركات والمؤسسات مع فواتير معتمدة؟'
        : 'Do you sell to businesses with certified tax invoices?',
      a: ar
        ? 'نعم بكل تأكيد. اختر «مبيعات الشركات» في النموذج مع تحديد المنتج والكمية المطلوبة، وسيقوم فريق مبيعات الأعمال بالرد عليك بعرض سعر مخصص وفاتورة رسمية.'
        : 'Yes, absolutely. Choose "Business sales" in the form specifying the product and quantities needed, and our B2B team will reply with a tailored quotation and official invoice.',
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
      q: ar
        ? 'هل يمكن لفريق الدعم مساعدتي عن بُعد بالتحكم بجهازي؟'
        : 'Can your support team help me remotely on my PC?',
      a: ar
        ? 'إن كانت المشكلة تقنية في جهازك وتمنع التفعيل، يمكن لفريق الدعم مساعدتك عبر التحكّم عن بُعد ببرنامج مثل AnyDesk، دون رسوم.'
        : 'If a technical problem on your own machine is preventing activation, our team can help you over a remote session using a tool such as AnyDesk, at no charge.',
    },
    {
      q: ar
        ? 'كم يستغرق الرد على الرسائل والاستفسارات؟'
        : 'How long does customer support take to reply?',
      a: ar
        ? `نردّ على رسائل النموذج والبريد خلال ${String(CONTACT_REPLY_HOURS)} ساعة كحدّ أقصى، وعادةً أسرع من ذلك. واتساب أسرع قناة للوصول إلينا.`
        : `We reply to form and email messages within ${String(CONTACT_REPLY_HOURS)} hours at the latest, usually sooner. WhatsApp is the fastest way to reach us.`,
    },
  ];

  const graph = buildGraph([
    jsonld.breadcrumbs([
      { name: ar ? 'الرئيسية' : 'Home', url: new URL(`${prefix}/`, SITE_URL).toString() },
      {
        name: ar ? 'تواصل معنا' : 'Contact us',
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
            <span>{ar ? 'خدمة العملاء والدعم الفني المباشر' : 'Customer Support & Live Help'}</span>
          </span>

          <h1 id="contact-heading">
            {ar ? 'تواصل معنا — نحن هنا لمساعدتك' : 'Contact Us — We Are Here to Help'}
          </h1>

          <p className="contact-hero-lede">
            {ar
              ? 'لديك استفسار قبل الشراء، أو تحتاج مساعدة في تفعيل ترخيصك، أو ترغب في عروض خاصة للشركات؟ تواصل معنا وسنكون سعداء بخدمتك.'
              : 'Have a pre-purchase question, need help activating your licence, or looking for business quotes? Message us and we will be delighted to assist you.'}
          </p>

          <span className="contact-sla-badge">
            <span>⏱️</span>
            <span>
              {ar
                ? 'متوسط سرعة الرد: أقل من ساعتين (حد أقصى 24 ساعة)'
                : 'Average reply time: Under 2 hours (24h max)'}
            </span>
          </span>
        </MotionFadeIn>
      </section>

      {/* --- 2-Column Responsive Contact Layout --- */}
      <div className="contact-grid-layout">
        {/* Column 1: Contact Form */}
        <div className="contact-form-container">
          <MotionFadeIn delay={0.05}>
            <ContactForm locale={locale} />
          </MotionFadeIn>
        </div>

        {/* Column 2: Direct Support Channels & Shortcuts */}
        <aside className="contact-sidebar">
          <MotionFadeIn delay={0.1}>
            {/* Direct Channels Box */}
            <div className="contact-channels-box">
              <span className="channels-box-title">
                <span>⚡</span>
                <span>{ar ? 'قنوات التواصل المباشرة' : 'Direct Contact Channels'}</span>
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
                    <strong>{ar ? 'واتساب الدعم الفني' : 'WhatsApp Support'}</strong>
                    <span dir="ltr">+966 53 425 5367</span>
                  </div>
                </div>
                <span className="channel-action-badge">{ar ? 'محادثة فورية' : 'Chat Now'}</span>
              </a>

              {/* Email Card */}
              <a href="mailto:help@digital-activation.com" className="channel-card channel-email">
                <div className="channel-card-left">
                  <div className="channel-icon-wrap" aria-hidden="true">
                    <MailIcon />
                  </div>
                  <div className="channel-info">
                    <strong>{ar ? 'البريد الإلكتروني' : 'Email Address'}</strong>
                    <span dir="ltr">help@digital-activation.com</span>
                  </div>
                </div>
                <span className="channel-action-badge">{ar ? 'إرسال بريد' : 'Send Email'}</span>
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
                    <strong>{ar ? 'تيليجرام' : 'Telegram Channel'}</strong>
                    <span dir="ltr">@digitalactivations</span>
                  </div>
                </div>
                <span className="channel-action-badge">{ar ? 'مراسلة' : 'Message'}</span>
              </a>
            </div>

            {/* Self-Service Shortcuts Box */}
            <div className="self-service-box">
              <h3>{ar ? 'روابط سريعة تفيدك قبل المراسلة' : 'Quick Self-Service Shortcuts'}</h3>
              <ul className="self-service-list">
                <li>
                  <Link href={`${prefix}${ROUTES.licenses}`} className="self-service-link">
                    <span className="shortcut-icon" aria-hidden="true">
                      🔑
                    </span>
                    <span>
                      {ar ? 'أين أجد مفتاحي؟ (صفحة تراخيصي)' : 'Where is my key? (My licences)'}
                    </span>
                  </Link>
                </li>
                <li>
                  <Link href={`${prefix}${ROUTES.goldenWarranty}`} className="self-service-link">
                    <span className="shortcut-icon" aria-hidden="true">
                      🛡️
                    </span>
                    <span>
                      {ar ? 'شروط واستبدال الضمان الذهبي' : 'Golden Warranty & Replacement Terms'}
                    </span>
                  </Link>
                </li>
                <li>
                  <Link href={`${prefix}${ROUTES.accountOrders}`} className="self-service-link">
                    <span className="shortcut-icon" aria-hidden="true">
                      📦
                    </span>
                    <span>
                      {ar ? 'متابعة سجل طلباتك وفواتيرك' : 'Track your orders & invoices'}
                    </span>
                  </Link>
                </li>
                <li>
                  <Link href={`${prefix}${ROUTES.store}`} className="self-service-link">
                    <span className="shortcut-icon" aria-hidden="true">
                      🛍️
                    </span>
                    <span>
                      {ar ? 'تصفح جميع برامج وتراخيص المتجر' : 'Browse all store software & keys'}
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
              {ar ? 'أسئلة شائعة حول الدعم والتواصل' : 'Frequently Asked Questions'}
            </h2>
            <p>
              {ar
                ? 'إليك إجابات سريعة على الاستفسارات الأكثر شيوعاً التي تردنا من عملائنا.'
                : 'Quick answers to the most common questions our customers ask.'}
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
