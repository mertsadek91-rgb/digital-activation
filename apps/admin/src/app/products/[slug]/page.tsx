'use client';

import type { AdminProductRow, Readiness, StaffMe } from '@da/contracts';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../../i18n/provider';
import { api, ApiError } from '../../../lib/api';
import { Nav } from '../../nav';
import { ContentForm } from '../content-form';
import { CopyForm } from '../copy-form';
import { HowToForm } from '../how-to-form';
import { IdentityForm } from '../identity-form';
import { ImagesForm } from '../images-form';
import { LinksForm } from '../links-form';
import { ReadinessChecks } from '../readiness-checks';
import { StockForm } from '../stock-form';
import { TermsForm } from '../terms-form';

/**
 * One product, everything about it, on one page.
 *
 * The list used to open eight different drawers under a row — one button
 * each, one at a time, each with its own language menu — and editing a product
 * properly meant opening them in turn and scrolling a table that was seventy
 * rows tall around them. This page is the other arrangement: every section is
 * open, stacked in the order a product is built, with a side rail to jump
 * between them and one language switch that moves the SEO copy, the
 * description, the activation steps and the publish checks together.
 *
 * Each section still saves on its own. A single save button over nine forms
 * would turn one typo into a nine-section mistake, and every form here already
 * knows what it changed.
 */

const SECTIONS = [
  { id: 'readiness', label: 'readinessHeading' },
  { id: 'identity', label: 'identity' },
  { id: 'terms', label: 'termsHeading' },
  { id: 'stock', label: 'stockHeading' },
  { id: 'images', label: 'images' },
  { id: 'seo', label: 'seoCopy' },
  { id: 'content', label: 'content' },
  { id: 'howto', label: 'activationHowTo' },
  { id: 'links', label: 'links' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export default function ProductEditPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params.slug);
  const router = useRouter();
  const t = useT('products');
  const c = useT('common');

  const [me, setMe] = useState<StaffMe | null>(null);
  const [row, setRow] = useState<AdminProductRow | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [locale, setLocale] = useState<'ar' | 'en'>('ar');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<SectionId>('readiness');

  /**
   * The header and the gate, together.
   *
   * Both are re-read after every save: a saved meta description clears a
   * blocker, and the pill at the top has to say so without a reload.
   */
  const refresh = useCallback(async () => {
    try {
      const [nextRow, nextReadiness] = await Promise.all([
        api.product(slug, locale),
        api.readiness(slug, locale),
      ]);
      setRow(nextRow);
      setReadiness(nextReadiness);
      setMissing(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      if (caught instanceof ApiError && caught.status === 404) {
        setMissing(true);
        return;
      }
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [slug, locale, router, t]);

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

  useEffect(() => {
    if (me) void refresh();
  }, [me, refresh]);

  /**
   * Which section is on screen, for the rail.
   *
   * Observed rather than computed from scroll position: nine sections of
   * very different heights, and the one whose top is nearest the header is
   * the one being read.
   */
  useEffect(() => {
    if (!me) return;
    // Every section currently inside the band, not only the ones whose state
    // changed in this callback: a callback fires per transition, so the one
    // that reports "images left" carries no entry for the section that had
    // already entered under it, and the rail would go on pointing at images.
    const inside = new Set<SectionId>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace('section-', '') as SectionId;
          if (entry.isIntersecting) inside.add(id);
          else inside.delete(id);
        }
        const first = SECTIONS.find((section) => inside.has(section.id));
        if (first) setActive(first.id);
      },
      { rootMargin: '-96px 0px -60% 0px', threshold: 0 },
    );
    for (const section of SECTIONS) {
      const element = document.getElementById(`section-${section.id}`);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [me, row === null]);

  // Stable across renders: every form lists it in an effect's dependencies,
  // and a new function each render would refetch every section on every
  // keystroke.
  const onError = useCallback((message: string) => {
    setNote(null);
    setError(message);
  }, []);

  const onSaved = useCallback(() => {
    setError(null);
    setNote(t('savedNote'));
    void refresh();
  }, [refresh, t]);

  if (!me) return <div className="admin-layout">{c('loading')}</div>;

  const canWrite = ['OWNER', 'ADMIN', 'CATALOG'].includes(me.role);
  const published = row?.status === 'PUBLISHED';

  async function togglePublish(): Promise<void> {
    if (!row) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api.setStatus(slug, published ? 'DRAFT' : 'PUBLISHED', locale);
      setNote(published ? t('unpublishedNote') : t('publishedNote'));
      await refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        // The gate refuses with a list of reasons; showing the count alone
        // would make it look arbitrary.
        setError(caught.blockers.length > 0 ? caught.blockers.join(' · ') : caught.message);
      } else {
        setError(caught instanceof Error ? caught.message : c('actionFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (missing) {
    return (
      <Nav me={me} current="products">
        <Link href="/products" className="back-link">
          ← {t('backToList')}
        </Link>
        <p className="error">{t('notFound')}</p>
      </Nav>
    );
  }

  return (
    <Nav me={me} current="products">
      <header className="edit-head">
        <Link href="/products" className="back-link">
          ← {t('backToList')}
        </Link>

        <div className="edit-title">
          <h1>{row ? row.nameAr : slug}</h1>
          {/* `.slug` draws its own leading slash, so the text is the slug alone —
              the full public address is in the identity section below. */}
          <span className="slug" dir="ltr">
            {slug}
          </span>
          {row ? (
            <div className="edit-pills">
              <span className={`pill pill-${row.status.toLowerCase()}`}>
                {row.status === 'PUBLISHED'
                  ? t('statusPublished')
                  : row.status === 'DRAFT'
                    ? t('statusDraft')
                    : row.status}
              </span>
              {row.blockers > 0 ? (
                <a href="#section-readiness" className="pill pill-blocked">
                  {t('blockerPill', { count: row.blockers })}
                </a>
              ) : (
                <span className="pill pill-ready">{t('readyPill')}</span>
              )}
              {row.warnings > 0 ? (
                <span className="warn">{t('warningCount', { count: row.warnings })}</span>
              ) : null}
              {row.brand ? <span className="meta">{row.brand}</span> : null}
              {row.nameEn ? (
                <span className="meta" dir="ltr">
                  {row.nameEn}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="meta">{c('loading')}</span>
          )}
        </div>

        <div className="edit-actions">
          {/* One switch for every per-language section and for the gate,
              because they are read together. */}
          <div className="locale-switch" role="group" aria-label={t('contentLocaleLabel')}>
            <span className="meta">{t('contentLocaleLabel')}</span>
            {(['ar', 'en'] as const).map((code) => (
              <button
                key={code}
                type="button"
                className={`chip${locale === code ? ' is-active' : ''}`}
                aria-pressed={locale === code}
                onClick={() => setLocale(code)}
              >
                {code === 'ar' ? t('localeArabic') : t('localeEnglish')}
              </button>
            ))}
          </div>
          {canWrite && row ? (
            <button
              type="button"
              className={published ? 'ghost' : undefined}
              disabled={busy || (!published && row.blockers > 0)}
              title={!published && row.blockers > 0 ? t('publishBlockedHint') : undefined}
              onClick={() => void togglePublish()}
            >
              {busy ? c('busy') : published ? t('unpublish') : t('publish')}
            </button>
          ) : null}
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="notice">{note}</p> : null}
      {!canWrite ? <p className="notice">{t('roleReadonly', { role: me.role })}</p> : null}

      <div className="edit-layout">
        <nav className="edit-nav" aria-label={t('sectionsLabel')}>
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#section-${section.id}`}
              className={active === section.id ? 'is-active' : undefined}
              onClick={() => setActive(section.id)}
            >
              <span>{t(section.label)}</span>
              {section.id === 'readiness' && row && row.blockers > 0 ? (
                <span className="tab-count is-late">{row.blockers}</span>
              ) : null}
              {section.id === 'images' && row && row.imageCount === 0 ? (
                <span className="tab-count is-late">0</span>
              ) : null}
              {section.id === 'howto' && row && row.activationSteps[locale] === 0 ? (
                <span className="tab-count is-late">0</span>
              ) : null}
            </a>
          ))}
        </nav>

        <div className="edit-sections">
          <section id="section-readiness" className="edit-section">
            <h3>{t('readinessHeading')}</h3>
            <p className="lede-sm">{t('readinessLede')}</p>
            {readiness ? (
              <ReadinessChecks readiness={readiness} linkToSections />
            ) : (
              <p className="meta">{c('loading')}</p>
            )}
          </section>

          <section id="section-identity" className="edit-section">
            <IdentityForm
              slug={slug}
              canWrite={canWrite}
              onSaved={(nextSlug) => {
                // A slug change moves the product; this page follows it to
                // its new address rather than editing one that no longer
                // exists. The server has already written the redirect.
                if (nextSlug !== slug) {
                  router.replace(`/products/${encodeURIComponent(nextSlug)}`);
                  return;
                }
                onSaved();
              }}
              onError={onError}
            />
          </section>

          <section id="section-terms" className="edit-section">
            <TermsForm slug={slug} canWrite={canWrite} onSaved={onSaved} onError={onError} />
          </section>

          <section id="section-stock" className="edit-section">
            <h3>{t('stockHeading')}</h3>
            <p className="lede-sm">{t('stockLede')}</p>
            <StockForm slug={slug} canWrite={canWrite} onSaved={onSaved} onError={onError} />
          </section>

          <section id="section-images" className="edit-section">
            <ImagesForm slug={slug} canWrite={canWrite} onChanged={onSaved} onError={onError} />
          </section>

          <section id="section-seo" className="edit-section">
            <h3>{t('seoCopy')}</h3>
            <p className="lede-sm">{t('seoLede')}</p>
            <CopyForm
              slug={slug}
              locale={locale}
              canWrite={canWrite}
              onSaved={onSaved}
              onError={onError}
            />
          </section>

          <section id="section-content" className="edit-section">
            <ContentForm
              slug={slug}
              locale={locale}
              canWrite={canWrite}
              onSaved={onSaved}
              onError={onError}
            />
          </section>

          <section id="section-howto" className="edit-section">
            <h3>{t('activationHowTo')}</h3>
            <p className="lede-sm">{t('howToLede')}</p>
            <HowToForm
              slug={slug}
              locale={locale}
              canWrite={canWrite}
              onSaved={onSaved}
              onError={onError}
            />
          </section>

          <section id="section-links" className="edit-section">
            <LinksForm slug={slug} canWrite={canWrite} onError={onError} />
          </section>
        </div>
      </div>
    </Nav>
  );
}
