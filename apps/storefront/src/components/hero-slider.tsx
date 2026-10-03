'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';

import { ArrowIcon, ChevronRightIcon } from './icons';

/** One slide: a product family, its artwork, and where it sends the buyer. */
export interface HeroSlide {
  key: string;
  /** The family's name, as the eyebrow. */
  name: string;
  title: string;
  body: string;
  cta: string;
  href: string;
  image: { src: string; width: number; height: number };
}

/**
 * The hero as a slider, one slide per product family (owner request,
 * 2026-10-02): Windows, Office, Adobe, Autodesk — the four illustrations the
 * banner package draws.
 *
 * Server-rendered with the first slide active, so the headline is in the
 * first byte of HTML and stays the LCP element; the script only switches
 * which slide is shown. Rotation stops while the pointer is over it, while
 * anything inside it has keyboard focus, and whenever the visitor presses
 * pause — moving content that cannot be stopped fails WCAG 2.2.2 — and it
 * starts paused for anybody who has asked the system for reduced motion.
 *
 * The parts that do not change with the slide — the warranty link and the
 * three numbers — come in as children, from the page that knows them.
 */
export function HeroSlider({ slides, children }: { slides: HeroSlide[]; children?: ReactNode }) {
  const t = useTranslations('hero');
  const [current, setCurrent] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [stopped, setStopped] = useState(false);
  const count = slides.length;
  const paused = hovered || focused || stopped || count < 2;

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setStopped(true);
  }, []);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => setCurrent((index) => (index + 1) % count), 6000);
    return () => clearInterval(timer);
  }, [paused, count]);

  if (count === 0) return null;

  return (
    <section
      className="hero hero-slider"
      role="region"
      aria-roledescription="carousel"
      aria-label={t('region')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // React's focus events bubble, so these are focus-within: they fire for
      // any control inside. Leaving to another control inside is not leaving.
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      {slides.map((slide, index) => {
        const active = index === current;
        return (
          <div
            key={slide.key}
            className={`hero-slide${active ? ' is-active' : ''}`}
            role="group"
            aria-roledescription="slide"
            aria-label={`${String(index + 1)} / ${String(count)}: ${slide.name}`}
            aria-hidden={!active}
            inert={!active}
          >
            <div className="hero-content">
              <p className="eyebrow">{slide.name}</p>
              {/* The page's one h1 is the active slide's headline. */}
              {active ? <h1>{slide.title}</h1> : <p className="hero-title">{slide.title}</p>}
              <p className="hero-body">{slide.body}</p>
              <div className="hero-actions">
                <Link href={slide.href} className="btn btn-primary">
                  <ArrowIcon />
                  <span>{slide.cta}</span>
                </Link>
                {children}
              </div>
            </div>
            {/* Decorative: the headline beside it says what it is. */}
            <div className="hero-art" aria-hidden="true">
              <Image
                src={slide.image.src}
                alt=""
                width={slide.image.width}
                height={slide.image.height}
                // The candidate `next/image` serves must not exceed the drawn width, or
                // Lighthouse's responsive-images budget fails: the art box is
                // 400px wide on a desktop (every family draws at >= 384px) and
                // 260px on a phone, so the 384w and 256w candidates are asked for.
                sizes="(max-width: 767px) 256px, 384px"
                priority={index === 0}
              />
            </div>
          </div>
        );
      })}

      {count > 1 ? (
        <div className="hero-nav">
          {/* SVG chevrons, not text glyphs: a text "‹" is bidi-mirrored by the
              Arabic page and then flipped again by CSS, which pointed both
              arrows the wrong way. These point by class and direction only. */}
          <button
            type="button"
            className="hero-nav-btn hero-nav-prev"
            onClick={() => setCurrent((index) => (index - 1 + count) % count)}
            aria-label={t('previous')}
          >
            <ChevronRightIcon />
          </button>
          <div className="hero-dots" role="tablist">
            {slides.map((slide, index) => (
              <button
                key={slide.key}
                type="button"
                role="tab"
                className={`hero-dot${index === current ? ' is-active' : ''}`}
                aria-selected={index === current}
                aria-label={t('goToProduct', { name: slide.name })}
                onClick={() => setCurrent(index)}
              />
            ))}
          </div>
          <button
            type="button"
            className="hero-nav-btn hero-nav-pause"
            onClick={() => setStopped(!stopped)}
            aria-label={stopped ? t('play') : t('pause')}
            aria-pressed={stopped}
          >
            <span aria-hidden="true">{stopped ? '▶' : '❚❚'}</span>
          </button>
          <button
            type="button"
            className="hero-nav-btn hero-nav-next"
            onClick={() => setCurrent((index) => (index + 1) % count)}
            aria-label={t('next')}
          >
            <ChevronRightIcon />
          </button>
        </div>
      ) : null}
    </section>
  );
}
