'use client';

import { motion, useReducedMotion } from 'framer-motion';
import React from 'react';

/**
 * Impeccable & Framer Motion animation primitives.
 *
 * Designed to adhere to the Impeccable craft floor:
 * - Exponential ease-out and natural spring physics.
 * - One authored moment per section, no erratic jumpy movements.
 * - Full respect for accessibility (`prefers-reduced-motion`).
 * - Safe for Next.js App Router SSR hydration.
 */

export interface MotionWrapperProps {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  id?: string;
}

export function MotionFadeIn({ children, delay = 0, className = '', id }: MotionWrapperProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div id={id} className={className}>{children}</div>;
  }

  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-30px' }}
      transition={{
        duration: 0.45,
        delay,
        ease: [0.22, 1, 0.36, 1], // Impeccable smooth exponential ease-out
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function MotionStaggerContainer({
  children,
  staggerDelay = 0.06,
  className = '',
  id,
}: MotionWrapperProps & { staggerDelay?: number }) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div id={id} className={className}>{children}</div>;
  }

  return (
    <motion.div
      id={id}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-40px' }}
      variants={{
        hidden: { opacity: 0 },
        show: {
          opacity: 1,
          transition: {
            staggerChildren: staggerDelay,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function MotionStaggerItem({
  children,
  className = '',
  id,
}: MotionWrapperProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div id={id} className={className}>{children}</div>;
  }

  return (
    <motion.div
      id={id}
      variants={{
        hidden: { opacity: 0, y: 16 },
        show: {
          opacity: 1,
          y: 0,
          transition: {
            type: 'spring',
            damping: 24,
            stiffness: 220,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export interface MotionCardProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export function MotionCard({
  children,
  className = '',
  id,
}: MotionCardProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <article id={id} className={className}>{children}</article>;
  }

  return (
    <motion.article
      id={id}
      whileHover={{
        y: -4,
        transition: { type: 'spring', stiffness: 420, damping: 22 },
      }}
      whileTap={{ scale: 0.985 }}
      className={className}
    >
      {children}
    </motion.article>
  );
}
