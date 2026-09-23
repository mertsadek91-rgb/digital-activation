'use client';

import type { PaymentDetail, PaymentInstructions } from '@da/contracts';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/**
 * Where to send the money, for bank transfer and crypto.
 *
 * Every value the shopper has to reproduce is forced `dir="ltr"` and set in the
 * monospace face. An IBAN or a wallet address is a Latin-and-digits string
 * inside an Arabic, right-to-left paragraph, and the bidirectional algorithm
 * will happily render "AE07 0331 2345 6789 0123 456" with its groups in the
 * wrong visual order — the reader copies what they see, transposes a group, and
 * the transfer lands nowhere. Money sent to a wrong account is not refundable
 * by us, so the copy button is the point rather than a convenience.
 */
export function PaymentInstructionsPanel({ instructions }: { instructions: PaymentInstructions }) {
  return (
    <div className="pay-instructions">
      {instructions.headline ? <p className="lede">{instructions.headline}</p> : null}

      <dl className="pay-details">
        {instructions.fields.map((field) => (
          <DetailRow key={`${field.label}:${field.value}`} field={field} />
        ))}
      </dl>

      {instructions.afterPaying ? <p className="notice">{instructions.afterPaying}</p> : null}
    </div>
  );
}

function DetailRow({ field }: { field: PaymentDetail }) {
  const t = useTranslations('paymentInstructions');
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(field.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // An insecure origin or a browser that refuses the permission. The value
      // is on the screen and selectable either way, so this stays silent rather
      // than raising an error about a button that was only ever a shortcut.
      setCopied(false);
    }
  }

  return (
    <div className={field.copyable ? 'pay-detail is-exact' : 'pay-detail'}>
      <dt>{field.label}</dt>
      <dd>
        <span className="pay-value" dir={field.copyable ? 'ltr' : undefined}>
          {field.value}
        </span>
        {field.copyable ? (
          <button type="button" className="btn btn-ghost btn-copy" onClick={() => void copy()}>
            {copied ? t('copied') : t('copy')}
          </button>
        ) : null}
      </dd>
    </div>
  );
}
