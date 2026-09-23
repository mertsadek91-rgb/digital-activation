'use client';

import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { isArabic } from '../i18n/locale';
import type { HeroSlide } from '../lib/hero-slides';

/**
 * The featured-product slider in the hero.
 *
 * Draws what `loadHeroSlides` read from the catalog and nothing else: no
 * price, name or claim is written in this file, so the first screen of the
 * site can no longer quote a price the product page does not honour. The only
 * text here is the chrome around the data — "from", "save", the buttons —
 * and it comes from the `hero` messages like the rest of the page.
 *
 * Rotation stops while the pointer is over it, while anything inside it has
 * keyboard focus, and whenever the visitor presses pause — moving content
 * that cannot be stopped fails WCAG 2.2.2, and a slide that changes under a
 * focused link moves the link. It starts paused for anybody who has asked the
 * system for reduced motion.
 */
export function HeroSlider({ slides, locale = 'ar' }: { slides: HeroSlide[]; locale?: string }) {
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
  const count = slides.length;
  const slide = slides[current] ?? slides[0];

  const nextSlide = () => {
    setDirection(1);
    setCurrent((prev) => (prev + 1) % count);
  };

  const prevSlide = () => {
    setDirection(-1);
    setCurrent((prev) => (prev - 1 + count) % count);
  };

  // Auto-play interval. One slide has nowhere to go.
  useEffect(() => {
    if (isPaused || count < 2) return;
    const timer = setInterval(() => {
      setDirection(1);
      setCurrent((prev) => (prev + 1) % count);
    }, 5000);
    return () => clearInterval(timer);
  }, [isPaused, current, count]);

  if (!slide) return null;

  const slideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? (isAr ? -40 : 40) : isAr ? 40 : -40,
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
      x: dir > 0 ? (isAr ? 40 : -40) : isAr ? -40 : 40,
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
            key={slide.slug}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="hero-slide-content"
          >
            {/* Brand and category, both from the catalog. */}
            <div className="hero-slide-top">
              {slide.brand ? (
                <span
                  className="hero-slide-tag"
                  style={{
                    background: slide.theme.badgeBg,
                    borderColor: slide.theme.badgeBorder,
                    color: slide.theme.accent,
                  }}
                >
                  {slide.brand}
                </span>
              ) : null}
              {slide.category ? <span className="hero-slide-cat">{slide.category}</span> : null}
            </div>

            {/* h2: the page's h1 is the headline beside the slider, so a slide
                title one level below it keeps the outline unbroken. */}
            <h2 className="hero-slide-title">
              <Link href={slide.href}>{slide.name}</Link>
            </h2>
            {slide.description ? <p className="hero-slide-desc">{slide.description}</p> : null}

            <ul className="hero-slide-features">
              {slide.features.map((feature) => (
                <li key={feature}>
                  <span className="feature-bullet" style={{ color: slide.theme.accent }}>
                    ✓
                  </span>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <div className="hero-slide-footer">
              <div className="hero-slide-price-box">
                <div className="hero-slide-prices">
                  {slide.priceIsFrom ? <span className="hero-slide-from">{t('from')}</span> : null}
                  <span className="hero-slide-price">{slide.price}</span>
                  {slide.oldPrice ? (
                    <span className="hero-slide-old-price">{slide.oldPrice}</span>
                  ) : null}
                </div>
                {/* Only over a real strike-through. A saving with nothing to
                    compare against is a number invented for the badge. */}
                {slide.savePercent !== null ? (
                  <span className="hero-slide-save">
                    {t('save', { percent: String(slide.savePercent) })}
                  </span>
                ) : null}
              </div>

              <Link
                href={slide.href}
                className="hero-slide-cta"
                style={{
                  background: `linear-gradient(135deg, ${slide.theme.accent}, color-mix(in srgb, ${slide.theme.accent} 80%, black))`,
                }}
              >
                <span>{t('cta')}</span>
                <span className="cta-arrow" aria-hidden="true">
                  {isAr ? '←' : '→'}
                </span>
              </Link>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Navigation, only when there is somewhere to go. The first button is
            "previous" in both languages and the row flips with the page, so
            in Arabic it sits on the right with a right-pointing arrow. It used
            to call "next" in Arabic while announcing "previous". */}
        {count > 1 ? (
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

              <div className="hero-slider-dots">
                {slides.map((entry, idx) => (
                  <button
                    key={entry.slug}
                    type="button"
                    className={`hero-slider-dot ${idx === current ? 'is-active' : ''}`}
                    onClick={() => {
                      setDirection(idx > current ? 1 : -1);
                      setCurrent(idx);
                    }}
                    aria-label={t('goToProduct', { name: entry.name })}
                    // backgroundColor, not background: the shorthand would
                    // reset background-clip and paint the whole 24px target.
                    style={idx === current ? { backgroundColor: slide.theme.accent } : undefined}
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
        ) : null}
      </div>
    </div>
  );
}
