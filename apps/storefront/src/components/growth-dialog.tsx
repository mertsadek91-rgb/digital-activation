'use client';

import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** The first field, so a keyboard user starts typing rather than on the close button. */
const FIRST_FIELD = 'input:not([type="hidden"]):not([tabindex="-1"]), select, textarea';

/**
 * A modal dialog that behaves like one.
 *
 * `role="dialog"` and `aria-modal`, labelled by its heading; focus moves in on
 * open, stays in while open (Tab wraps), and goes back to whatever opened it
 * on close. Escape, the close button and a click on the backdrop all close it.
 * A marketing window that traps a keyboard user, or that a screen reader
 * cannot name, is a barrier dressed as an offer.
 */
export function GrowthDialog({
  title,
  onClose,
  children,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations('growth');
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // The latest handler, read by the one keydown listener installed on open.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = panel.current;
    const first =
      node?.querySelector<HTMLElement>(FIRST_FIELD) ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const head = items[0];
      const tail = items[items.length - 1];
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail?.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head?.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);

  return (
    <div
      className="growth-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className={`growth-dialog${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <button type="button" className="growth-close" onClick={onClose} aria-label={t('close')}>
          ×
        </button>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
