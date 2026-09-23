'use client';

import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import React, { useEffect, useState } from 'react';

import { isArabic } from '../i18n/locale';

export interface SlideItem {
  id: string;
  tagAr: string;
  tagEn: string;
  catAr: string;
  catEn: string;
  titleAr: string;
  titleEn: string;
  descAr: string;
  descEn: string;
  href: string;
  featuresAr: string[];
  featuresEn: string[];
  theme: {
    accent: string;
    bgGlow: string;
    badgeBg: string;
    badgeBorder: string;
  };
}

const SLIDES: SlideItem[] = [
  {
    id: 'office-2024',
    tagAr: 'الأكثر طلباً 🔥',
    tagEn: 'Best Seller 🔥',
    catAr: 'تطبيقات الأعمال والمكتب',
    catEn: 'Office & Productivity',
    titleAr: 'مايكروسوفت أوفيس 2024 برو بلس',
    titleEn: 'Microsoft Office 2024 Pro Plus',
    descAr: 'ترخيص أصلي مدى الحياة لجهاز واحد، يضم Word, Excel, PowerPoint والتطبيقات الاحترافية بالكامل.',
    descEn: 'Genuine lifetime license for 1 PC. Includes Word, Excel, PowerPoint and full desktop suite.',
    href: '/store',
    featuresAr: ['تفعيل رسمي عبر موقع مايكروسوفت', 'ترخيص أصلي دائم مدى الحياة', 'تسليم فوري بعد الدفع مباشرة'],
    featuresEn: ['Official setup via Microsoft', 'Permanent lifetime license', 'Instant delivery after payment'],
    theme: {
      accent: '#EA580C',
      bgGlow: 'radial-gradient(circle at 80% 20%, rgba(234, 88, 12, 0.16) 0%, transparent 60%)',
      badgeBg: 'rgba(234, 88, 12, 0.12)',
      badgeBorder: 'rgba(234, 88, 12, 0.3)',
    },
  },
  {
    id: 'windows-11-pro',
    tagAr: 'ترقية فورية ⚡',
    tagEn: 'Instant Upgrade ⚡',
    catAr: 'أنظمة التشغيل الأصلية',
    catEn: 'Operating Systems',
    titleAr: 'ويندوز 11 بروفيشنال (Windows 11 Pro)',
    titleEn: 'Windows 11 Professional',
    descAr: 'مفتاح رقمي أصلي لتنشيط نظام ويندوز 11 برو مع دعم كامل لمزايا التشفير والأمان المتقدمة.',
    descEn: 'Original digital key for Windows 11 Pro with BitLocker, Hyper-V and remote desktop security.',
    href: '/store',
    featuresAr: ['يدعم الترقية من هوم إلى برو', 'تشفير كامل للقرص مع BitLocker', 'مربوط بلوحة الأم مدى الحياة'],
    featuresEn: ['Upgrade from Home to Pro directly', 'Full disk encryption with BitLocker', 'Binds to motherboard for lifetime'],
    theme: {
      accent: '#0284C7',
      bgGlow: 'radial-gradient(circle at 80% 20%, rgba(2, 132, 199, 0.16) 0%, transparent 60%)',
      badgeBg: 'rgba(2, 132, 199, 0.12)',
      badgeBorder: 'rgba(2, 132, 199, 0.3)',
    },
  },
  {
    id: 'adobe-all-apps',
    tagAr: 'للمصممين والمحترفين 🎨',
    tagEn: 'For Creators & Pros 🎨',
    catAr: 'التصميم والإبداع',
    catEn: 'Creative Cloud',
    titleAr: 'باقة أدوبي كرييتف كلاود الشاملة',
    titleEn: 'Adobe Creative Cloud All Apps',
    descAr: 'اشتراك سنوي كامل يتيح لك استخدام فوتوشوب، إليستريتور، بريمير، و20+ برنامج تصميم باشتراك رسمي.',
    descEn: '1-Year subscription giving access to Photoshop, Illustrator, Premiere Pro and 20+ apps.',
    href: '/store',
    featuresAr: ['تفعيل على حسابك الشخصي في أدوبي', 'سعة تخزين سحابية 100 جيجابايت', 'يدعم الذكاء الاصطناعي Generative Fill'],
    featuresEn: ['Activates on your personal Adobe ID', '100GB Cloud Storage included', 'Includes Firefly Generative AI'],
    theme: {
      accent: '#E11D48',
      bgGlow: 'radial-gradient(circle at 80% 20%, rgba(225, 29, 72, 0.16) 0%, transparent 60%)',
      badgeBg: 'rgba(225, 29, 72, 0.12)',
      badgeBorder: 'rgba(225, 29, 72, 0.3)',
    },
  },
  {
    id: 'kaspersky-security',
    tagAr: 'حماية متكاملة 🛡️',
    tagEn: 'Ultimate Security 🛡️',
    catAr: 'برامج الحماية والأمن',
    catEn: 'Antivirus & Cybersecurity',
    titleAr: 'كاسبرسكي توتال سيكيورتي (Kaspersky)',
    titleEn: 'Kaspersky Total Security',
    descAr: 'حماية فائقة وشاملة ضد الفيروسات، برامج الفدية، والتصيد المصرفي لراحة بال كاملة.',
    descEn: 'Maximum multi-device defense against viruses, ransomware, phishing, and financial fraud.',
    href: '/store',
    featuresAr: ['حماية متقدمة للدفع والمعاملات البنكية', 'جدار حماية ذكي ضد برامج التجسس', 'ضمان ذهبي لاستبدال المفتاح'],
    featuresEn: ['Safe Money banking protection', 'Smart firewall & ransomware shield', 'Golden warranty replacement'],
    theme: {
      accent: '#059669',
      bgGlow: 'radial-gradient(circle at 80% 20%, rgba(5, 150, 105, 0.16) 0%, transparent 60%)',
      badgeBg: 'rgba(5, 150, 105, 0.12)',
      badgeBorder: 'rgba(5, 150, 105, 0.3)',
    },
  },
];

/**
 * The featured-product rotator.
 *
 * It carried a price, a struck-through "was" price and a "save 60%" badge on
 * every slide, typed into this file — figures no catalog row stood behind and
 * which the product page they linked to did not show. The headlines and the
 * links stay; the numbers are the product pages' to state.
 *
 * Rotation stops while the pointer is over it, while anything inside it has
 * keyboard focus, and whenever the visitor presses pause — moving content
 * that cannot be stopped fails WCAG 2.2.2, and a slide that changes under a
 * focused link moves the link. It starts paused for anybody who has asked the
 * system for reduced motion.
 */
export function HeroSlider({ locale = 'ar' }: { locale?: string }) {
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(1);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [stopped, setStopped] = useState(false);
  const isPaused = hovered || focused || stopped;

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setStopped(true);
  }, []);

  const t = useTranslations('hero');
  const isAr = isArabic(locale);
  const slide = SLIDES[current] ?? SLIDES[0]!;

  const nextSlide = () => {
    setDirection(1);
    setCurrent((prev) => (prev + 1) % SLIDES.length);
  };

  const prevSlide = () => {
    setDirection(-1);
    setCurrent((prev) => (prev - 1 + SLIDES.length) % SLIDES.length);
  };

  // Auto-play interval
  useEffect(() => {
    if (isPaused) return;
    const timer = setInterval(() => {
      setDirection(1);
      setCurrent((prev) => (prev + 1) % SLIDES.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [isPaused, current]);

  const slideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? (isAr ? -40 : 40) : (isAr ? 40 : -40),
      opacity: 0,
      scale: 0.98,
    }),
    center: {
      x: 0,
      opacity: 1,
      scale: 1,
      transition: {
        x: { type: 'spring' as const, stiffness: 300, damping: 30 },
        opacity: { duration: 0.3 },
      },
    },
    exit: (dir: number) => ({
      x: dir > 0 ? (isAr ? 40 : -40) : (isAr ? -40 : 40),
      opacity: 0,
      scale: 0.98,
      transition: { duration: 0.2 },
    }),
  };

  return (
    <div
      className="hero-slider-wrap"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // React's focus events bubble, so these are focus-within: they fire for
      // any control inside. Leaving to another control inside is not leaving.
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      aria-label={t('region')}
      role="region"
    >
      <div className="hero-slider-card" style={{ background: slide.theme.bgGlow }}>
        <AnimatePresence custom={direction} mode="wait">
          <motion.div
            key={slide.id}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="hero-slide-content"
          >
            {/* Top Badges */}
            <div className="hero-slide-top">
              <span
                className="hero-slide-tag"
                style={{
                  background: slide.theme.badgeBg,
                  borderColor: slide.theme.badgeBorder,
                  color: slide.theme.accent,
                }}
              >
                {isAr ? slide.tagAr : slide.tagEn}
              </span>
              <span className="hero-slide-cat">
                {isAr ? slide.catAr : slide.catEn}
              </span>
            </div>

            {/* Title & Description */}
            <h3 className="hero-slide-title">
              {isAr ? slide.titleAr : slide.titleEn}
            </h3>
            <p className="hero-slide-desc">
              {isAr ? slide.descAr : slide.descEn}
            </p>

            {/* Checklist Features */}
            <ul className="hero-slide-features">
              {(isAr ? slide.featuresAr : slide.featuresEn).map((feature, idx) => (
                <li key={idx}>
                  <span className="feature-bullet" style={{ color: slide.theme.accent }}>✓</span>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            {/* Price & Action Row */}
            <div className="hero-slide-footer">
              <Link
                href={isAr ? slide.href : `/${locale}${slide.href}`}
                className="hero-slide-cta"
                style={{
                  background: `linear-gradient(135deg, ${slide.theme.accent}, color-mix(in srgb, ${slide.theme.accent} 80%, black))`,
                }}
              >
                <span>{t('cta')}</span>
                <span className="cta-arrow" aria-hidden="true">{isAr ? '←' : '→'}</span>
              </Link>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Navigation. The first button is "previous" in both languages and
            the row flips with the page, so in Arabic it sits on the right with
            a right-pointing arrow — backwards, in a right-to-left reading. It
            used to call "next" in Arabic while announcing "previous". */}
        <div className="hero-slider-nav">
          <button
            type="button"
            className="hero-slider-arrow"
            onClick={prevSlide}
            aria-label={t('previous')}
          >
            {isAr ? '→' : '←'}
          </button>

          <div className="hero-slider-center">
            <button
              type="button"
              className="hero-slider-arrow hero-slider-pause"
              onClick={() => setStopped(!stopped)}
              aria-label={stopped ? t('play') : t('pause')}
            >
              <span aria-hidden="true">{stopped ? '▶' : '❚❚'}</span>
            </button>

            {/* Pagination Indicators */}
            <div className="hero-slider-dots">
              {SLIDES.map((s, idx) => (
                <button
                  key={s.id}
                  type="button"
                  className={`hero-slider-dot ${idx === current ? 'is-active' : ''}`}
                  onClick={() => {
                    setDirection(idx > current ? 1 : -1);
                    setCurrent(idx);
                  }}
                  aria-label={t('goTo', { n: String(idx + 1) })}
                  style={idx === current ? { background: slide.theme.accent } : undefined}
                />
              ))}
            </div>
          </div>

          <button
            type="button"
            className="hero-slider-arrow"
            onClick={nextSlide}
            aria-label={t('next')}
          >
            {isAr ? '←' : '→'}
          </button>
        </div>
      </div>
    </div>
  );
}
