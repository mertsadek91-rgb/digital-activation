'use client';

import type { PaymentProvider } from '@da/contracts';
import { offeredPaymentSchema } from '@da/contracts';
import { useEffect, useState } from 'react';

/**
 * Payment marks and the shop's own promises, under the product gallery.
 *
 * Two blocks, and they are sourced differently on purpose. The payment marks
 * are drawn from what the shop can actually take money with, asked of the API
 * at render time. The promises are drawn from the product in front of the
 * reader — the warranty one appears only for a product that carries it.
 *
 * Neither used to be true. The marks were a hard-coded row of mada, Apple Pay,
 * Visa, Mastercard and bank transfer on a shop with no payment method
 * configured at all; the promises claimed instant delivery on a catalog whose
 * delivery runs to six hours, and a warranty on products that do not have one.
 * A badge is a promise, and this component sits at the moment somebody decides
 * to trust the shop with a card number.
 *
 * Inline SVG so the marks cost no request and stay crisp at any density.
 */
export function VisaIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 58 32"
      className={className}
      width="42"
      height="16"
      aria-label="Visa"
      role="img"
    >
      <title>Visa</title>
      <path
        d="M21.2 8.4l-3.9 14.8h-4.2L10.7 11c-.3-1-.6-1.4-1.5-1.8-.9-.5-2.4-.9-3.7-1.2l.1-.6h6.8c.9 0 1.6.6 1.8 1.6l1.7 8.8 4.2-10.4h4.1zm12.3 10c0-3.8-5.3-4-5.3-5.7 0-.5.5-1 1.6-1.2.5-.1 2-.2 3.8.7l.7-3.1c-.9-.4-2.2-.7-3.8-.7-4 0-6.9 2.1-6.9 5.2 0 2.3 2 3.5 3.6 4.3 1.6.8 2.2 1.3 2.2 2 0 1.1-1.3 1.6-2.5 1.6-1.7 0-2.6-.2-4-.9l-.7 3.3c.9.4 2.6.8 4.3.8 4.5 0 7-2.2 7-5.4zm10.7 4.8h3.7l-3.3-14.8h-3.4c-.8 0-1.4.5-1.7 1.1l-6 13.7h4.3l.9-2.3h5.2l.3 2.3zm-4.5-5.3l2.2-5.9 1.2 5.9h-3.4zm-14.1-9.5l-3.3 14.8h-4l3.3-14.8h4z"
        fill="#1a1f71"
      />
    </svg>
  );
}

export function MastercardIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 32"
      className={className}
      width="36"
      height="22"
      aria-label="Mastercard"
      role="img"
    >
      <title>Mastercard</title>
      <circle cx="17" cy="16" r="12" fill="#eb001b" />
      <circle cx="31" cy="16" r="12" fill="#f79e1b" fillOpacity="0.88" />
    </svg>
  );
}

export function BankTransferIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 21h18M3 10h18M5 10v11M9 10v11M15 10v11M19 10v11M12 3l9 5H3l9-5z" />
    </svg>
  );
}

export function LockShieldIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <circle cx="12" cy="11" r="1.5" fill="currentColor" stroke="none" />
      <path d="M12 12.5v3" />
    </svg>
  );
}

export interface ProductTrustProps {
  locale: string;
  showPerks?: boolean;
  /** The product's own warranty flag, when this is drawn on a product page. */
  hasGoldenWarranty?: boolean;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Which marks a configured provider entitles the shop to draw.
 *
 * Deliberately conservative. Stripe processes Visa and Mastercard on every
 * account, so those two are safe to draw the moment Stripe is connected. mada
 * and Apple Pay are not: both are per-account opt-ins — mada needs a Saudi
 * entity with it enabled, Apple Pay needs a verified domain — and nothing in
 * this codebase can see whether either is switched on. A mark this file cannot
 * verify is a mark it does not draw.
 */
const MARKS: Record<PaymentProvider, ('visa' | 'mastercard' | 'bank' | 'crypto')[]> = {
  STRIPE: ['visa', 'mastercard'],
  PAYPAL: ['visa', 'mastercard'],
  BANK_TRANSFER: ['bank'],
  CRYPTO: ['crypto'],
};

/**
 * The marks the shop is entitled to draw, or null while it does not yet know.
 *
 * Shared by the product page, the cart, the checkout and the footer, so there
 * is one answer to "what can this shop take" and one place it comes from.
 */
export function usePaymentMarks(): string[] | null {
  const [providers, setProviders] = useState<PaymentProvider[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(new URL('/v1/payment-methods', API));
        if (!response.ok) return;
        const parsed = offeredPaymentSchema.safeParse(await response.json());
        if (!cancelled && parsed.success) setProviders(parsed.data.providers);
      } catch {
        // A mark that cannot be drawn truthfully is not drawn. Silence here is
        // the correct failure: the page loses a decoration, not a fact.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (providers === null) return null;
  return [...new Set(providers.flatMap((provider) => MARKS[provider]))];
}

/** The row itself. Renders nothing at all when the shop can take nothing. */
export function PaymentMarks({ locale }: { locale: string }) {
  const ar = locale !== 'en';
  const marks = usePaymentMarks();
  if (marks === null || marks.length === 0) return null;

  return (
    <div
      className="payment-badges-row"
      aria-label={ar ? 'طرق الدفع المدعومة' : 'Accepted payment methods'}
    >
      {marks.includes('visa') ? (
        <div className="pay-badge pay-visa" title="Visa">
          <VisaIcon />
        </div>
      ) : null}
      {marks.includes('mastercard') ? (
        <div className="pay-badge pay-mc" title="Mastercard">
          <MastercardIcon />
        </div>
      ) : null}
      {marks.includes('bank') ? (
        <div className="pay-badge pay-bank" title={ar ? 'تحويل بنكي' : 'Direct bank transfer'}>
          <BankTransferIcon />
          <span className="pay-label">{ar ? 'تحويل بنكي' : 'Bank'}</span>
        </div>
      ) : null}
    </div>
  );
}

export function ProductTrust({ locale, showPerks = true, hasGoldenWarranty }: ProductTrustProps) {
  const ar = locale === 'ar';
  const marks = usePaymentMarks();

  return (
    <div className="product-trust-wrapper">
      {/* Only when there is something true to say. */}
      {marks !== null && marks.length > 0 ? (
        <div className="product-payments-card">
          <div className="payments-header">
            <span className="payments-title">
              <LockShieldIcon size={14} />
              <strong>{ar ? 'طرق الدفع المتاحة' : 'Secure payment methods'}</strong>
            </span>
            <span className="payments-ssl-badge">
              {ar ? 'اتصال مشفّر' : 'Encrypted connection'}
            </span>
          </div>
          <PaymentMarks locale={locale} />
        </div>
      ) : null}

      {/* --- Guarantee & Service Perks Box --- */}
      {showPerks ? (
        <div className="product-perks-box">
          {/* "Instant" is not this catalog's promise. Delivery runs from about a
              minute to six hours depending on the variant, and the spec grid a
              few centimetres up the page states the real figure for the one
              selected — so this said "فوري" directly above a row reading "خلال
              6 ساعات". It says how the licence arrives; the grid says when. */}
          <div className="perk-item">
            <span className="perk-icon perk-bolt" aria-hidden="true">
              ⚡
            </span>
            <div className="perk-text">
              <strong>{ar ? 'تسليم رقمي بالبريد' : 'Delivered by email'}</strong>
              <p>
                {ar
                  ? 'يصلك المفتاح والتعليمات على بريدك — المدّة مذكورة في جدول المواصفات'
                  : 'Your key and instructions by email — the timing is in the spec table'}
              </p>
            </div>
          </div>

          {/* Only for a product that actually carries it. The flag is on the
              product and half this catalog does not have it, so a fixed badge
              here promises a warranty the order confirmation would not. */}
          {hasGoldenWarranty ? (
            <div className="perk-item">
              <span className="perk-icon perk-shield" aria-hidden="true">
                🛡️
              </span>
              <div className="perk-text">
                <strong>{ar ? 'الضمان الذهبي' : 'Golden Warranty'}</strong>
                <p>
                  {ar
                    ? 'مفاتيح أصلية مع ضمان استبدال طوال مدّة الترخيص'
                    : 'Genuine keys, with replacement cover for the licence term'}
                </p>
              </div>
            </div>
          ) : null}

          <div className="perk-item">
            <span className="perk-icon perk-support" aria-hidden="true">
              💬
            </span>
            <div className="perk-text">
              <strong>{ar ? 'دعم فني مباشر عبر واتساب' : 'Direct WhatsApp Support'}</strong>
              <p>
                {ar
                  ? 'فريقنا معك خطوة بخطوة حتى التفعيل الكامل'
                  : 'Our team guides you step-by-step through activation'}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The footer's payment strip, which exists only when there is something to put
 * in it.
 *
 * It lives here rather than in `site-footer.tsx` because it calls a hook and
 * that file is a server component — the footer renders on every page and has no
 * other reason to reach the browser. This is the only part of it that does.
 */
export function PaymentsBar({ locale }: { locale: string }) {
  const ar = locale !== 'en';
  const marks = usePaymentMarks();
  if (marks === null || marks.length === 0) return null;

  return (
    <div className="footer-payments-bar">
      <div className="footer-payments-container">
        <div className="payments-label-group">
          <span className="payments-heading">{ar ? 'طرق الدفع' : 'Payment methods'}</span>
          <span className="payments-divider" aria-hidden="true">
            •
          </span>
          <span className="payments-security-note">
            <LockShieldIcon size={14} />
            {/* What is true of any HTTPS page, stated plainly. "256-bit SSL"
                and "bank-level" are marketing for the same fact. */}
            <span>{ar ? 'اتصال مشفّر' : 'Encrypted connection'}</span>
          </span>
        </div>
        <PaymentMarks locale={locale} />
      </div>
    </div>
  );
}
