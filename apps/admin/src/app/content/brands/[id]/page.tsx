'use client';

import type { AdminBrand, AdminBrandLocale, ContentBlock } from '@da/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../../../i18n/provider';
import { api, ApiError } from '../../../../lib/api';
import { Nav } from '../../../nav';
import { BlockDocumentEditor } from '../../../products/block-editor';
import { CONTENT_ROLES, LocaleTabs, SeoFields, messageOf, useStaff } from '../../shared';

interface Draft {
  name: string;
  intro: ContentBlock[];
  seoTitle: string;
  seoDescription: string;
}

function draftOf(row: AdminBrandLocale, fallbackName: string): Draft {
  return {
    // A missing translation starts from the name the hub already shows.
    name: row.exists ? row.name : fallbackName,
    intro: row.intro,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
  };
}

/**
 * One brand hub.
 *
 * Keyed by id rather than slug, unlike pages and posts: a brand's slug is on
 * every product that carries it and is the one most likely to be corrected,
 * and an editor whose own URL moved under it on save is an editor that 404s.
 */
export default function ContentBrandEditor() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const me = useStaff();
  const t = useT('content');
  const c = useT('common');

  const [brand, setBrand] = useState<AdminBrand | null>(null);
  const [locale, setLocale] = useState<'ar' | 'en'>('ar');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [identity, setIdentity] = useState({ slug: '', website: '', isActive: true });
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const take = useCallback((loaded: AdminBrand, at: 'ar' | 'en') => {
    setBrand(loaded);
    setDraft(draftOf(loaded[at], loaded.name));
    setIdentity({ slug: loaded.slug, website: loaded.website, isActive: loaded.isActive });
  }, []);

  useEffect(() => {
    if (!me) return;
    void (async () => {
      try {
        take(await api.contentBrand(id), 'ar');
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 404) setMissing(true);
        else setError(messageOf(caught, c('actionFailed')));
      }
    })();
  }, [me, id, take, c]);

  if (!me) return <div className="admin-layout">{c('loading')}</div>;
  const canWrite = CONTENT_ROLES.includes(me.role);

  if (missing) {
    return (
      <Nav me={me} current="contentBrands">
        <Link href="/content/brands" className="back-link">
          ← {t('backToBrands')}
        </Link>
        <p className="error">{t('notFound')}</p>
      </Nav>
    );
  }

  const row = brand?.[locale];
  const original = brand && row ? draftOf(row, brand.name) : null;
  const dirty =
    original !== null &&
    draft !== null &&
    (!row?.exists ||
      draft.name !== original.name ||
      JSON.stringify(draft.intro) !== JSON.stringify(original.intro) ||
      draft.seoTitle !== original.seoTitle ||
      draft.seoDescription !== original.seoDescription);
  const identityDirty =
    brand !== null &&
    (identity.slug !== brand.slug ||
      identity.website !== brand.website ||
      identity.isActive !== brand.isActive);
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  function switchLocale(next: 'ar' | 'en'): void {
    if (!brand || next === locale) return;
    if (dirty && row?.exists && !window.confirm(t('discardConfirm'))) return;
    setLocale(next);
    setDraft(draftOf(brand[next], brand.name));
  }

  async function run(patch: Parameters<typeof api.setContentBrand>[1]): Promise<void> {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      take(await api.setContentBrand(id, patch), locale);
      setNote(t('savedNote'));
    } catch (caught) {
      setError(messageOf(caught, c('actionFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Nav me={me} current="contentBrands">
      <header className="edit-head">
        <Link href="/content/brands" className="back-link">
          ← {t('backToBrands')}
        </Link>
        <div className="edit-title">
          <h1>{brand ? brand.ar.name || brand.name : id}</h1>
          {brand ? (
            <span className="slug" dir="ltr">
              {brand.path.slice(1)}
            </span>
          ) : null}
          {brand ? (
            <span className="meta">{t('brandProducts', { count: brand.productCount })}</span>
          ) : null}
        </div>
        <div className="edit-actions">
          {brand ? (
            <LocaleTabs
              locale={locale}
              exists={{ ar: brand.ar.exists, en: brand.en.exists }}
              onChange={switchLocale}
            />
          ) : null}
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="notice">{note}</p> : null}
      {!canWrite ? <p className="notice">{t('roleDenied', { role: me.role })}</p> : null}

      {brand && row && draft ? (
        <div className="edit-sections">
          <section className="edit-section">
            <h3>{t('copyHeading')}</h3>
            {!row.exists ? <p className="notice">{t('brandLocaleMissingNote')}</p> : null}
            <div className="paste-form">
              <label className="grow">
                {t('colName')}
                <input
                  type="text"
                  dir={dir}
                  value={draft.name}
                  disabled={!canWrite}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <SeoFields
                title={draft.seoTitle}
                description={draft.seoDescription}
                dir={dir}
                disabled={!canWrite}
                onTitle={(seoTitle) => setDraft({ ...draft, seoTitle })}
                onDescription={(seoDescription) => setDraft({ ...draft, seoDescription })}
              />
            </div>
          </section>

          <section className="edit-section">
            <div className="content-form">
              <h3>{t('introHeading')}</h3>
              <p className="lede-sm">{t('introLede')}</p>
              <BlockDocumentEditor
                blocks={draft.intro}
                canWrite={canWrite}
                onChange={(intro) => setDraft({ ...draft, intro })}
              />
            </div>
          </section>

          {canWrite ? (
            <div className="terms-save">
              <button
                type="button"
                onClick={() =>
                  void run({
                    translation: {
                      locale,
                      name: draft.name.trim(),
                      intro: draft.intro,
                      seoTitle: draft.seoTitle.trim(),
                      seoDescription: draft.seoDescription.trim(),
                    },
                  })
                }
                disabled={busy || !dirty || draft.name.trim().length === 0}
              >
                {busy ? c('busy') : t('saveLocale', { locale: locale.toUpperCase() })}
              </button>
              {dirty && row.exists && original ? (
                <>
                  <button type="button" className="ghost" onClick={() => setDraft(original)}>
                    {c('cancel')}
                  </button>
                  <span className="meta-warn">{t('unsaved')}</span>
                </>
              ) : null}
            </div>
          ) : null}

          <section className="edit-section">
            <h3>{t('addressHeading')}</h3>
            <div className="terms-grid">
              <label>
                <span>{t('fieldSlug')}</span>
                <input
                  type="text"
                  dir="ltr"
                  value={identity.slug}
                  disabled={!canWrite}
                  onChange={(event) => setIdentity({ ...identity, slug: event.target.value })}
                />
                <small>{t('slugRedirectNote')}</small>
              </label>
              <label>
                <span>{t('fieldWebsite')}</span>
                <input
                  type="url"
                  dir="ltr"
                  placeholder="https://"
                  value={identity.website}
                  disabled={!canWrite}
                  onChange={(event) => setIdentity({ ...identity, website: event.target.value })}
                />
              </label>
              <label>
                <span>{t('colActive')}</span>
                <select
                  value={identity.isActive ? 'yes' : 'no'}
                  disabled={!canWrite}
                  onChange={(event) =>
                    setIdentity({ ...identity, isActive: event.target.value === 'yes' })
                  }
                >
                  <option value="yes">{t('active')}</option>
                  <option value="no">{t('inactive')}</option>
                </select>
                <small>{t('activeHint')}</small>
              </label>
            </div>
            {canWrite ? (
              <div className="terms-save">
                <button
                  type="button"
                  disabled={busy || !identityDirty || identity.slug.trim().length === 0}
                  onClick={() => {
                    const slug = identity.slug.trim();
                    if (
                      slug !== brand.slug &&
                      !window.confirm(
                        t('renameConfirm', { from: brand.path, to: `/brands/${slug}` }),
                      )
                    )
                      return;
                    void run({
                      ...(slug !== brand.slug ? { slug } : {}),
                      ...(identity.website !== brand.website
                        ? { website: identity.website.trim() }
                        : {}),
                      ...(identity.isActive !== brand.isActive
                        ? { isActive: identity.isActive }
                        : {}),
                    });
                  }}
                >
                  {busy ? c('busy') : c('save')}
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : (
        <p className="meta">{c('loading')}</p>
      )}
    </Nav>
  );
}
