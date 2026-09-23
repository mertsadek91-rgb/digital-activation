'use client';

import type { AdminArticle, AdminArticleLocale, ContentBlock, EditableStatus } from '@da/contracts';
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

interface Draft {
  title: string;
  summary: string;
  blocks: ContentBlock[];
  seoTitle: string;
  seoDescription: string;
  status: EditableStatus | null;
  authorId: string;
  /** `datetime-local` text, in the editor's own timezone. */
  publishedAt: string;
}

/** An ISO instant as `YYYY-MM-DDTHH:mm` local time, which is what the input wants. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function draftOf(row: AdminArticleLocale): Draft {
  return {
    title: row.title,
    summary: row.summary,
    blocks: row.blocks,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    status: null,
    authorId: row.authorId ?? '',
    publishedAt: toLocalInput(row.publishedAt),
  };
}

/**
 * One blog post, both languages.
 *
 * The same arrangement as a page — the address on its own, everything else
 * per language — plus the three fields a post has and a page does not: the
 * excerpt, the by-line and the date. The date is editable because the
 * imported posts carry the dates the old blog published them on, and a first
 * publish from here stamps today only when nothing is set.
 */
export default function ContentPostEditor() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params.slug);
  const router = useRouter();
  const me = useStaff();
  const t = useT('content');
  const c = useT('common');

  const [post, setPost] = useState<AdminArticle | null>(null);
  const [locale, setLocale] = useState<'ar' | 'en'>('ar');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [nextSlug, setNextSlug] = useState(slug);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const take = useCallback((loaded: AdminArticle, at: 'ar' | 'en') => {
    setPost(loaded);
    setDraft(draftOf(loaded[at]));
    setNextSlug(loaded.slug);
  }, []);

  useEffect(() => {
    if (!me) return;
    void (async () => {
      try {
        take(await api.contentArticle(slug), 'ar');
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
      <Nav me={me} current="contentBlog">
        <Link href="/content/blog" className="back-link">
          ← {t('backToBlog')}
        </Link>
        <p className="error">{t('notFound')}</p>
      </Nav>
    );
  }

  const row = post?.[locale];
  const original = row ? draftOf(row) : null;
  const dirty =
    original !== null &&
    draft !== null &&
    (draft.title !== original.title ||
      draft.summary !== original.summary ||
      JSON.stringify(draft.blocks) !== JSON.stringify(original.blocks) ||
      draft.seoTitle !== original.seoTitle ||
      draft.seoDescription !== original.seoDescription ||
      draft.authorId !== original.authorId ||
      draft.publishedAt !== original.publishedAt ||
      (draft.status !== null && draft.status !== row?.status));
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  function switchLocale(next: 'ar' | 'en'): void {
    if (!post || next === locale) return;
    if (dirty && !window.confirm(t('discardConfirm'))) return;
    setLocale(next);
    setDraft(draftOf(post[next]));
  }

  async function saveCopy(): Promise<void> {
    if (!draft || !original) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const saved = await api.setContentArticle(slug, {
        translation: {
          locale,
          title: draft.title.trim(),
          summary: draft.summary.trim(),
          blocks: draft.blocks,
          seoTitle: draft.seoTitle.trim(),
          seoDescription: draft.seoDescription.trim(),
          authorId: draft.authorId === '' ? null : draft.authorId,
          ...(draft.status === null ? {} : { status: draft.status }),
          // Sent only when changed: an untouched date must stay the server's
          // to decide, or the first publish could never stamp one.
          ...(draft.publishedAt === original.publishedAt
            ? {}
            : {
                publishedAt:
                  draft.publishedAt === '' ? null : new Date(draft.publishedAt).toISOString(),
              }),
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
    if (!post) return;
    const to = nextSlug.trim();
    if (!window.confirm(t('renameConfirm', { from: post.path, to: `/blog/${to}` }))) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const saved = await api.setContentArticle(post.slug, { slug: to });
      router.replace(`/content/blog/${encodeURIComponent(saved.slug)}`);
    } catch (caught) {
      setError(messageOf(caught, c('actionFailed')));
      setBusy(false);
    }
  }

  return (
    <Nav me={me} current="contentBlog">
      <header className="edit-head">
        <Link href="/content/blog" className="back-link">
          ← {t('backToBlog')}
        </Link>
        <div className="edit-title">
          <h1>{post ? post.ar.title || post.en.title : slug}</h1>
          <span className="slug" dir="ltr">
            {post ? post.path.slice(1) : slug}
          </span>
        </div>
        <div className="edit-actions">
          {post ? (
            <LocaleTabs
              locale={locale}
              exists={{ ar: post.ar.exists, en: post.en.exists }}
              onChange={switchLocale}
            />
          ) : null}
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="notice">{note}</p> : null}
      {!canWrite ? <p className="notice">{t('roleDenied', { role: me.role })}</p> : null}

      {post && row && draft ? (
        <div className="edit-sections">
          <section className="edit-section">
            <h3>{t('copyHeading')}</h3>
            {!row.exists ? <p className="notice">{t('postLocaleMissingNote')}</p> : null}
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
              <label className="grow">
                {t('fieldSummary')}
                <textarea
                  rows={3}
                  dir={dir}
                  maxLength={400}
                  value={draft.summary}
                  disabled={!canWrite}
                  onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                />
                <small>{t('summaryHint')}</small>
              </label>
              <SeoFields
                title={draft.seoTitle}
                description={draft.seoDescription}
                dir={dir}
                disabled={!canWrite}
                onTitle={(seoTitle) => setDraft({ ...draft, seoTitle })}
                onDescription={(seoDescription) => setDraft({ ...draft, seoDescription })}
              />
              <label>
                <span>{t('fieldAuthor')}</span>
                <select
                  value={draft.authorId}
                  disabled={!canWrite}
                  onChange={(event) => setDraft({ ...draft, authorId: event.target.value })}
                >
                  <option value="">{t('noAuthor')}</option>
                  {post.authors.map((author) => (
                    <option key={author.id} value={author.id}>
                      {author.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t('fieldPublishedAt')}</span>
                <input
                  type="datetime-local"
                  dir="ltr"
                  value={draft.publishedAt}
                  disabled={!canWrite}
                  onChange={(event) => setDraft({ ...draft, publishedAt: event.target.value })}
                />
                <small>{t('publishedAtHint')}</small>
              </label>
              <StatusField
                stored={row.status}
                value={draft.status}
                disabled={!canWrite}
                onChange={(status) => setDraft({ ...draft, status })}
              />
            </div>
            {row.exists ? (
              <p className="meta">{t('readingMinutes', { minutes: row.readingMinutes })}</p>
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
              {dirty && row ? (
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
                  disabled={!canWrite}
                  onChange={(event) => setNextSlug(event.target.value)}
                />
                <small>{t('slugRedirectNote')}</small>
              </label>
            </div>
            {canWrite ? (
              <div className="terms-save">
                <button
                  type="button"
                  onClick={() => void saveAddress()}
                  disabled={busy || nextSlug.trim() === post.slug || nextSlug.trim().length === 0}
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
