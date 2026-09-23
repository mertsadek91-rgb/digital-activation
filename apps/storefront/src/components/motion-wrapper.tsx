import type { ReactNode } from 'react';

/**
 * A section that eases in as it scrolls into view — in CSS, not in script.
 *
 * It was a framer-motion component with `initial={{ opacity: 0 }}`, which the
 * server rendered as `style="opacity:0"`. Everything inside it — the product
 * grid on /store, most of the home page — arrived invisible and stayed that
 * way until the JavaScript loaded, hydrated and ran; on a slow phone that is
 * seconds of blank page, and with scripts blocked it was never shown at all.
 * Crawlers that do not run scripts saw the same.
 *
 * `.reveal` in globals.css is a scroll-driven animation: it only applies in
 * browsers that support `animation-timeline: view()`, only when reduced motion
 * has not been asked for, and it is driven by scroll position rather than by
 * script — so content is visible in the HTML as delivered, everywhere.
 */
export function MotionFadeIn({
  children,
  className = '',
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div id={id} className={className ? `reveal ${className}` : 'reveal'}>
      {children}
    </div>
  );
}
