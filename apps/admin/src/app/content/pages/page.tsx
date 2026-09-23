'use client';

import type { AdminPageList, PageTemplateValue } from '@da/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAdminLocale, useT } from '../../../i18n/provider';
import { api, ApiError } from '../../../lib/api';
import { Nav } from '../../nav';
import { CONTENT_ROLES, LocalePills, messageOf, shortDate, useStaff } from '../shared';

const TEMPLATES: PageTemplateValue[] = ['GENERIC', 'LEGAL', 'LANDING', 'TOOL'];

/**
 * الصفحات — the editorial pages: the policies, the warranty, the contact page.
 *
 * One row per URL rather than per database row, with a pill for each
 * language. The pill that matters is the missing one: `/en/privacy` answers
 * with the Arabic text until an English row exists, and this list is where
 * that gap is visible without opening every page.
 */
export default function ContentPagesPage() {
  const router = useRouter();
  const me = useStaff();
  const t = useT('content');
  const c = useT('common');
  const panel = useAdminLocale();
  const [data, setData] = useState<AdminPageList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.contentPages());
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
    <Nav me={me} current="contentPages">
      <div className="queue-head">
        <h1>{t('pagesTitle')}</h1>
        {allowed && !adding ? (
          <button type="button" onClick={() => setAdding(true)}>
            {t('newPage')}
          </button>
        ) : null}
      </div>
      <p className="lede-sm">{t('pagesLede')}</p>

      {error ? <p className="error">{error}</p> : null}
      {!allowed ? <p className="notice">{t('roleDenied', { role: me.role })}</p> : null}

      {adding ? (
        <NewPage
          onCreated={(slug) => router.push(`/content/pages/${encodeURIComponent(slug)}`)}
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
                <th>{t('colTemplate')}</th>
                <th>{t('colLocales')}</th>
                <th>{t('colUpdated')}</th>
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
                      {row.slug}
                    </span>
                  </td>
                  <td>{t(`template_${row.template}`)}</td>
                  <td>
                    <LocalePills locales={row.locales} />
                  </td>
                  <td>{shortDate(row.updatedAt, panel)}</td>
                  <td className="actions">
                    <Link href={`/content/pages/${encodeURIComponent(row.slug)}`}>{c('edit')}</Link>
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

function NewPage({
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
  const [template, setTemplate] = useState<PageTemplateValue>('GENERIC');
  const [saving, setSaving] = useState(false);

  async function create(): Promise<void> {
    setSaving(true);
    try {
      const created = await api.createContentPage({
        slug: slug.trim(),
        title: title.trim(),
        locale,
        template,
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
      <h2>{t('newPageHeading')}</h2>
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
        <label>
          <span>{t('colTemplate')}</span>
          <select
            value={template}
            onChange={(event) =>
              setTemplate(TEMPLATES.find((entry) => entry === event.target.value) ?? 'GENERIC')
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
