'use client';

import { type PublicMarketing, type SocialProof, socialProofSchema } from '@da/contracts';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';

import { isArabic } from '../i18n/locale';

import { CloseIcon } from './icons';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** How long one notice stays up, not counting time spent paused. */
const VISIBLE_MS = 6_000;

/** Dismissing once stops notices for the rest of the visit, not just this page. */
const DISMISS_KEY = 'da.socialProof.dismissed';

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * "Bought 7 times in the last 3 days", and now and then a small notice.
 *
 * Everything shown comes from the API's answer, which is built from paid
 * orders and carries no name, email, city or order number — only a count, a
 * coarse age and sometimes a country. Below the store's minimum the answer is
 * empty and this renders nothing: no "be the first", no invented visitors.
 *
 * The notices are the part most easily made annoying, so they are held to a
 * budget: one every `intervalSeconds`, at most `maxPerPage`, each up for a few
 * seconds; paused while hovered, focused or the tab is hidden; gone for the
 * visit once dismissed. Announced politely to screen readers. On a phone they
 * sit in the page below the buy box rather than floating, so they can never
 * cover the button (see `social-proof.css`). Only the product page mounts this
 * — never the cart or the checkout.
 */
export function SocialProofNotices({
  slug,
  locale,
  settings,
}: {
  slug: string;
  locale: string;
  settings: NonNullable<PublicMarketing['socialProof']>;
}) {
  const t = useTranslations('socialProof');
  const [data, setData] = useState<SocialProof | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const url = new URL('/v1/marketing/social-proof', API);
        url.searchParams.set('productSlug', slug);
        const response = await fetch(url);
        if (!response.ok) return;
        const parsed = socialProofSchema.safeParse(await response.json());
        if (!cancelled && parsed.success) setData(parsed.data);
      } catch {
        // Decoration, not content: a page without its notices is still a page.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const countries = useMemo(() => {
    try {
      return new Intl.DisplayNames([isArabic(locale) ? 'ar' : 'en'], { type: 'region' });
    } catch {
      return null;
    }
  }, [locale]);

  if (!data || data.count === 0) return null;

  const hours = data.windowHours;
  const window =
    hours >= 48 && hours % 24 === 0
      ? t('windowDays', { count: hours / 24 })
      : t('windowHours', { count: hours });

  const queue =
    settings.intervalSeconds > 0 ? data.recent.slice(0, Math.max(0, settings.maxPerPage)) : [];

  const lines = queue.map((notice) => {
    const ago =
      notice.ago === 'hours' ? t('agoHours') : notice.ago === 'day' ? t('agoDay') : t('agoDays');
    const country = notice.country ? (countries?.of(notice.country) ?? null) : null;
    return country ? t('noticeCountry', { country, ago }) : t('notice', { ago });
  });

  return (
    <div className="social-proof">
      <p className="proof social-proof-summary">{t('summary', { count: data.count, window })}</p>
      {lines.length > 0 ? (
        <NoticeTicker
          lines={lines}
          intervalMs={settings.intervalSeconds * 1000}
          regionLabel={t('region')}
          dismissLabel={t('dismiss')}
        />
      ) : null}
    </div>
  );
}

function NoticeTicker({
  lines,
  intervalMs,
  regionLabel,
  dismissLabel,
}: {
  lines: string[];
  intervalMs: number;
  regionLabel: string;
  dismissLabel: string;
}) {
  const [step, setStep] = useState({ index: 0, visible: false });
  const [dismissed, setDismissed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  // Time left on whichever wait is current, carried across pauses so hovering
  // stretches a notice instead of restarting the whole cycle.
  const remaining = useRef(intervalMs);

  useEffect(() => {
    setDismissed(readDismissed());
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const paused = hovered || focused || hidden;
  const finished = step.index >= lines.length;

  useEffect(() => {
    if (dismissed || paused || finished) return;
    const started = Date.now();
    let fired = false;
    const timer = window.setTimeout(() => {
      fired = true;
      if (step.visible) {
        remaining.current = intervalMs;
        setStep({ index: step.index + 1, visible: false });
      } else {
        remaining.current = VISIBLE_MS;
        setStep({ index: step.index, visible: true });
      }
    }, remaining.current);
    return () => {
      window.clearTimeout(timer);
      if (!fired) remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [dismissed, paused, finished, step, intervalMs]);

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Private mode: dismissed for this page only, which is still dismissed.
    }
  };

  const line = step.visible && !finished ? lines[step.index] : null;

  return (
    // The live region is always mounted and only its contents change, which is
    // what makes a screen reader announce the change rather than miss it.
    <div
      className="social-proof-live"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={regionLabel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      {line ? (
        <div className="social-proof-notice">
          <span>{line}</span>
          <button
            type="button"
            className="social-proof-dismiss"
            aria-label={dismissLabel}
            title={dismissLabel}
            onClick={dismiss}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
