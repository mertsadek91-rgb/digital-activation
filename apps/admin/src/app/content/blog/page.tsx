'use client';

import type { AdminArticleList } from '@da/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAdminLocale, useT } from '../../../i18n/provider';
import { api, ApiError } from '../../../lib/api';
import { Nav } from '../../nav';
import { CONTENT_ROLES, LocalePills, messageOf, shortDate, useStaff } from '../shared';

/**
 * المدوّنة — the blog, newest first.
 *
 * The English pill is the one to read here. Unlike a page, a post does not
 * fall back across languages: `/en/blog/<slug>` is a 404 until an English row
 * exists, so a missing pill is a missing page rather than a missing
 * translation of one.
 */
export default function ContentBlogPage() {
  const router = useRouter();
  const me = useStaff();
  const t = useT('content');
  const c = useT('common');
  const panel = useAdminLocale();
  const [data, setData] = useState<AdminArticleList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.contentArticles());
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(messageOf(caught, c('actionFailed')));
    }
  }, [router, c]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (!me) return <div className="admin-layout">{c('loading')}</div>;
  const allowed = CONTENT_ROLES.includes(me.role);

  return (
    <Nav me={me} current="contentBlog">
      <div className="queue-head">
        <h1>{t('blogTitle')}</h1>
        {allowed && !adding ? (
          <button type="button" onClick={() => setAdding(true)}>
            {t('newPost')}
          </button>
        ) : null}
      </div>
      <p className="lede-sm">{t('blogLede')}</p>

      {error ? <p className="error">{error}</p> : null}
      {!allowed ? <p className="notice">{t('roleDenied', { role: me.role })}</p> : null}

      {adding ? (
        <NewPost
          onCreated={(slug) => router.push(`/content/blog/${encodeURIComponent(slug)}`)}
          onError={setError}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {data ? (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('colTitle')}</th>
                <th>{t('colPath')}</th>
                <th>{t('colAuthor')}</th>
                <th>{t('colLocales')}</th>
                <th>{t('colPublished')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.slug}>
                  <td>
                    {(row.locales.find((entry) => entry.locale === 'ar') ?? row.locales[0])?.title}
                  </td>
                  <td>
                    <span className="slug" dir="ltr">
                      {row.path.slice(1)}
                    </span>
                  </td>
                  <td>{row.author ?? <span className="meta">{t('noAuthor')}</span>}</td>
                  <td>
                    <LocalePills locales={row.locales} />
                  </td>
                  <td>{shortDate(row.publishedAt, panel)}</td>
                  <td className="actions">
                    <Link href={`/content/blog/${encodeURIComponent(row.slug)}`}>{c('edit')}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.rows.length === 0 ? <p className="meta">{t('emptyList')}</p> : null}
        </div>
      ) : null}
    </Nav>
  );
}

function NewPost({
  onCreated,
  onError,
  onCancel,
}: {
  onCreated: (slug: string) => void;
  onError: (message: string) => void;
  onCancel: () => void;
}) {
  const t = useT('content');
  const c = useT('common');
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [locale, setLocale] = useState<'ar' | 'en'>('ar');
  const [saving, setSaving] = useState(false);

  async function create(): Promise<void> {
    setSaving(true);
    try {
      const created = await api.createContentArticle({
        slug: slug.trim(),
        title: title.trim(),
        locale,
      });
      onCreated(created.slug);
    } catch (caught) {
      onError(messageOf(caught, c('actionFailed')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="new-product">
      <h2>{t('newPostHeading')}</h2>
      <div className="terms-grid">
        <label>
          <span>{t('fieldTitle')} *</span>
          <input
            type="text"
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          <span>{t('fieldSlug')} *</span>
          <input
            type="text"
            dir="ltr"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
          />
          <small>{t('slugHint')}</small>
        </label>
        <label>
          <span>{t('localeLabel')}</span>
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value === 'en' ? 'en' : 'ar')}
          >
            <option value="ar">{t('localeArabic')}</option>
            <option value="en">{t('localeEnglish')}</option>
          </select>
        </label>
      </div>
      <p className="meta">{t('createsDraft')}</p>
      <div className="terms-save">
        <button
          type="button"
          onClick={() => void create()}
          disabled={saving || title.trim().length < 2 || slug.trim().length < 1}
        >
          {saving ? c('loading') : t('create')}
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          {c('cancel')}
        </button>
      </div>
    </section>
  );
}
