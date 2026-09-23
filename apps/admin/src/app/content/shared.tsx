'use client';

import type { ContentLocaleSummary, EditableStatus, StaffMe } from '@da/contracts';
import { READINESS_RULES, SEO_LENGTH_GUIDE } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api } from '../../lib/api';
import { Gauge } from '../products/copy-form';

/**
 * The pieces the page, blog and brand screens share.
 *
 * Three editors over three tables that are, to the person using them, one
 * job: the words on a public page and what a search result says about it. So
 * they share one language switch, one pair of SEO counters and one status
 * control — three near-copies of each is where a fix lands in two of them.
 */

/** Who may read and write here. OWNER is on the list because the guard passes it anyway. */
export const CONTENT_ROLES = ['OWNER', 'ADMIN', 'CATALOG', 'MARKETING'];

/** The signed-in staff member, or null while loading; sends everyone else away. */
export function useStaff(): StaffMe | null {
  const router = useRouter();
  const [me, setMe] = useState<StaffMe | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const staff = await api.me();
        if (staff.mustChangePassword) {
          router.push('/password');
          return;
        }
        setMe(staff);
      } catch {
        router.push('/login');
      }
    })();
  }, [router]);

  return me;
}

export function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

/**
 * Which language is being edited.
 *
 * Marks a locale with no row yet, because that is the most useful thing to
 * know before switching to it: the English half of a post is either there or
 * it is a translation somebody still has to write.
 */
export function LocaleTabs({
  locale,
  exists,
  onChange,
}: {
  locale: 'ar' | 'en';
  exists: { ar: boolean; en: boolean };
  onChange: (next: 'ar' | 'en') => void;
}) {
  const t = useT('content');
  return (
    <div className="locale-switch" role="group" aria-label={t('localeLabel')}>
      <span className="meta">{t('localeLabel')}</span>
      {(['ar', 'en'] as const).map((code) => (
        <button
          key={code}
          type="button"
          className={`chip${locale === code ? ' is-active' : ''}`}
          aria-pressed={locale === code}
          onClick={() => onChange(code)}
        >
          {code === 'ar' ? t('localeArabic') : t('localeEnglish')}
          {exists[code] ? '' : ` · ${t('localeMissing')}`}
        </button>
      ))}
    </div>
  );
}

/** One pill per locale on a list row: its status, or that it is missing. */
export function LocalePills({ locales }: { locales: ContentLocaleSummary[] }) {
  const t = useT('content');
  return (
    <span className="edit-pills">
      {(['ar', 'en'] as const).map((code) => {
        const row = locales.find((entry) => entry.locale === code);
        const label = code.toUpperCase();
        if (!row) {
          return (
            <span key={code} className="pill pill-blocked" title={t('localeMissing')}>
              {label} · {t('localeMissing')}
            </span>
          );
        }
        return (
          <span
            key={code}
            className={`pill ${row.status === 'PUBLISHED' ? 'pill-published' : 'pill-draft'}`}
          >
            {label} ·{' '}
            {row.status === 'PUBLISHED'
              ? t('statusPublished')
              : row.status === 'DRAFT'
                ? t('statusDraft')
                : row.status}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Draft or published.
 *
 * A row can hold any of the five stored states, and the storefront serves one
 * of them. A state the panel cannot set — IN_REVIEW from some earlier tool —
 * is shown as it is and offered the two that mean something, rather than being
 * silently coerced on the next save.
 */
export function StatusField({
  stored,
  value,
  disabled,
  onChange,
}: {
  stored: string;
  value: EditableStatus | null;
  disabled: boolean;
  onChange: (next: EditableStatus) => void;
}) {
  const t = useT('content');
  const current = value ?? (stored === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT');
  return (
    <label>
      <span>{t('status')}</span>
      <select
        value={current}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT')}
      >
        <option value="DRAFT">{t('statusDraft')}</option>
        <option value="PUBLISHED">{t('statusPublished')}</option>
      </select>
      {stored !== 'PUBLISHED' && stored !== 'DRAFT' ? (
        <small>{t('statusOther', { status: stored })}</small>
      ) : (
        <small>{current === 'PUBLISHED' ? t('statusPublishedHint') : t('statusDraftHint')}</small>
      )}
    </label>
  );
}

/**
 * The SEO title and description, with the same counters as the product screen.
 *
 * Floors from READINESS_RULES, ceilings from SEO_LENGTH_GUIDE: nothing here
 * refuses a save over either — a page is not gated the way a product is — but
 * the numbers are the ones the product editors already read, so a page and a
 * product are judged by one rule.
 */
export function SeoFields({
  title,
  description,
  dir,
  disabled,
  onTitle,
  onDescription,
}: {
  title: string;
  description: string;
  dir: 'rtl' | 'ltr';
  disabled: boolean;
  onTitle: (next: string) => void;
  onDescription: (next: string) => void;
}) {
  const t = useT('content');
  const p = useT('products');
  return (
    <>
      <label className="grow">
        {t('seoTitle')}
        <input
          type="text"
          value={title}
          dir={dir}
          maxLength={70}
          disabled={disabled}
          onChange={(event) => onTitle(event.target.value)}
        />
        <Gauge
          value={title.trim().length}
          min={READINESS_RULES.seoTitleMinLength}
          max={SEO_LENGTH_GUIDE.seoTitleMax}
          unit={p('unitCharacters')}
        />
      </label>
      <label className="grow">
        {t('seoDescription')}
        <textarea
          value={description}
          rows={3}
          dir={dir}
          maxLength={180}
          disabled={disabled}
          onChange={(event) => onDescription(event.target.value)}
        />
        <Gauge
          value={description.trim().length}
          min={READINESS_RULES.seoDescriptionMinLength}
          max={SEO_LENGTH_GUIDE.seoDescriptionMax}
          unit={p('unitCharacters')}
        />
      </label>
    </>
  );
}

/** "3 Sept 2026", in the panel's language. */
export function shortDate(iso: string | null, locale: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ar-EG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
