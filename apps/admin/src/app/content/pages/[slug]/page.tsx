'use client';

import type {
  AdminPage,
  AdminPageLocale,
  ContentBlock,
  EditableStatus,
  PageTemplateValue,
} from '@da/contracts';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../../../i18n/provider';
import { api, ApiError } from '../../../../lib/api';
import { Nav } from '../../../nav';
import { BlockDocumentEditor } from '../../../products/block-editor';
import {
  CONTENT_ROLES,
  LocaleTabs,
  SeoFields,
  StatusField,
  messageOf,
  useStaff,
} from '../../shared';

const TEMPLATES: PageTemplateValue[] = ['GENERIC', 'LEGAL', 'LANDING', 'TOOL'];

interface Draft {
  title: string;
  blocks: ContentBlock[];
  seoTitle: string;
  seoDescription: string;
  status: EditableStatus | null;
}

function draftOf(row: AdminPageLocale): Draft {
  return {
    title: row.title,
    blocks: row.blocks,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    status: null,
  };
}

/**
 * One page, both languages.
 *
 * Two saves, on purpose. The address belongs to the page and moves both
 * languages at once — it writes a 301 and cannot be undone by a second click
 * without writing another — so it sits apart with its own button. Everything
 * else belongs to one language and saves with that language's form; switching
 * language with unsaved changes asks first, because the other form is a
 * different row and the edits would otherwise simply vanish.
 */
export default function ContentPageEditor() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params.slug);
  const router = useRouter();
  const me = useStaff();
  const t = useT('content');
  const c = useT('common');

  const [page, setPage] = useState<AdminPage | null>(null);
  const [locale, setLocale] = useState<'ar' | 'en'>('ar');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [nextSlug, setNextSlug] = useState(slug);
  const [template, setTemplate] = useState<PageTemplateValue>('GENERIC');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const take = useCallback((loaded: AdminPage, at: 'ar' | 'en') => {
    setPage(loaded);
    setDraft(draftOf(loaded[at]));
    setNextSlug(loaded.slug);
    setTemplate(loaded.template);
  }, []);

  useEffect(() => {
    if (!me) return;
    void (async () => {
      try {
        take(await api.contentPage(slug), 'ar');
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 404) setMissing(true);
        else setError(messageOf(caught, c('actionFailed')));
      }
    })();
  }, [me, slug, take, c]);

  if (!me) return <div className="admin-layout">{c('loading')}</div>;
  const canWrite = CONTENT_ROLES.includes(me.role);

  if (missing) {
    return (
      <Nav me={me} current="contentPages">
        <Link href="/content/pages" className="back-link">
          ← {t('backToPages')}
        </Link>
        <p className="error">{t('notFound')}</p>
      </Nav>
    );
  }

  const row = page?.[locale];
  const dirty =
    row !== undefined &&
    draft !== null &&
    (draft.title !== row.title ||
      JSON.stringify(draft.blocks) !== JSON.stringify(row.blocks) ||
      draft.seoTitle !== row.seoTitle ||
      draft.seoDescription !== row.seoDescription ||
      (draft.status !== null && draft.status !== row.status));
  const addressDirty = page !== null && (nextSlug !== page.slug || template !== page.template);
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  function switchLocale(next: 'ar' | 'en'): void {
    if (!page || next === locale) return;
    if (dirty && !window.confirm(t('discardConfirm'))) return;
    setLocale(next);
    setDraft(draftOf(page[next]));
  }

  async function saveCopy(): Promise<void> {
    if (!draft || !row) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const saved = await api.setContentPage(slug, {
        translation: {
          locale,
          title: draft.title.trim(),
          blocks: draft.blocks,
          seoTitle: draft.seoTitle.trim(),
          seoDescription: draft.seoDescription.trim(),
          ...(draft.status === null ? {} : { status: draft.status }),
        },
      });
      take(saved, locale);
      setNote(t('savedNote'));
    } catch (caught) {
      setError(messageOf(caught, c('actionFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function saveAddress(): Promise<void> {
    if (!page) return;
    const renaming = nextSlug.trim() !== page.slug;
    if (
      renaming &&
      !window.confirm(t('renameConfirm', { from: page.path, to: `/${nextSlug.trim()}` }))
    )
      return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const saved = await api.setContentPage(page.slug, {
        ...(renaming ? { slug: nextSlug.trim() } : {}),
        ...(template !== page.template ? { template } : {}),
      });
      if (saved.slug !== slug) {
        // The server has written the redirect; follow the page to its new URL.
        router.replace(`/content/pages/${encodeURIComponent(saved.slug)}`);
        return;
      }
      take(saved, locale);
      setNote(t('savedNote'));
    } catch (caught) {
      setError(messageOf(caught, c('actionFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Nav me={me} current="contentPages">
      <header className="edit-head">
        <Link href="/content/pages" className="back-link">
          ← {t('backToPages')}
        </Link>
        <div className="edit-title">
          <h1>{page ? page.ar.title || page.en.title : slug}</h1>
          <span className="slug" dir="ltr">
            {slug}
          </span>
        </div>
        <div className="edit-actions">
          {page ? (
            <LocaleTabs
              locale={locale}
              exists={{ ar: page.ar.exists, en: page.en.exists }}
              onChange={switchLocale}
            />
          ) : null}
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="notice">{note}</p> : null}
      {!canWrite ? <p className="notice">{t('roleDenied', { role: me.role })}</p> : null}

      {page && row && draft ? (
        <div className="edit-sections">
          <section className="edit-section">
            <h3>{t('copyHeading')}</h3>
            {!row.exists ? <p className="notice">{t('localeMissingNote')}</p> : null}
            <div className="paste-form">
              <label className="grow">
                {t('fieldTitle')}
                <input
                  type="text"
                  dir={dir}
                  value={draft.title}
                  disabled={!canWrite}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
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
              <StatusField
                stored={row.status}
                value={draft.status}
                disabled={!canWrite}
                onChange={(status) => setDraft({ ...draft, status })}
              />
            </div>
            {row.exists ? (
              <p className="meta">{t('versionNote', { version: row.version })}</p>
            ) : null}
          </section>

          <section className="edit-section">
            <div className="content-form">
              <h3>{t('bodyHeading')}</h3>
              <p className="lede-sm">{t('bodyLede')}</p>
              <BlockDocumentEditor
                blocks={draft.blocks}
                canWrite={canWrite}
                onChange={(blocks) => setDraft({ ...draft, blocks })}
              />
            </div>
          </section>

          {canWrite ? (
            <div className="terms-save">
              <button
                type="button"
                onClick={() => void saveCopy()}
                disabled={busy || !dirty || draft.title.trim().length < 2}
              >
                {busy ? c('busy') : t('saveLocale', { locale: locale.toUpperCase() })}
              </button>
              {dirty ? (
                <>
                  <button type="button" className="ghost" onClick={() => setDraft(draftOf(row))}>
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
                  value={nextSlug}
                  disabled={!canWrite || page.slugLocked}
                  onChange={(event) => setNextSlug(event.target.value)}
                />
                <small>{page.slugLocked ? t('slugLocked') : t('slugRedirectNote')}</small>
              </label>
              <label>
                <span>{t('colTemplate')}</span>
                <select
                  value={template}
                  disabled={!canWrite}
                  onChange={(event) =>
                    setTemplate(
                      TEMPLATES.find((entry) => entry === event.target.value) ?? 'GENERIC',
                    )
                  }
                >
                  {TEMPLATES.map((entry) => (
                    <option key={entry} value={entry}>
                      {t(`template_${entry}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {canWrite ? (
              <div className="terms-save">
                <button
                  type="button"
                  onClick={() => void saveAddress()}
                  disabled={busy || !addressDirty || nextSlug.trim().length === 0}
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
