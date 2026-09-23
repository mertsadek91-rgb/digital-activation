'use client';

import type { AdminBrandList } from '@da/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../../i18n/provider';
import { api, ApiError } from '../../../lib/api';
import { Nav } from '../../nav';
import { CONTENT_ROLES, messageOf, useStaff } from '../shared';

/**
 * العلامات — the brand hubs at /brands/<slug>.
 *
 * The SEO column is the reason this list exists. Every hub was written by the
 * fallback — the brand's name as its title and no description — so a pill per
 * language says which hubs have been given copy of their own and which are
 * still reading the default.
 */
export default function ContentBrandsPage() {
  const router = useRouter();
  const me = useStaff();
  const t = useT('content');
  const c = useT('common');
  const [data, setData] = useState<AdminBrandList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.contentBrands());
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
    <Nav me={me} current="contentBrands">
      <div className="queue-head">
        <h1>{t('brandsTitle')}</h1>
      </div>
      <p className="lede-sm">{t('brandsLede')}</p>

      {error ? <p className="error">{error}</p> : null}
      {!allowed ? <p className="notice">{t('roleDenied', { role: me.role })}</p> : null}

      {data ? (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('colName')}</th>
                <th>{t('colPath')}</th>
                <th className="num">{t('colProducts')}</th>
                <th>{t('colSeo')}</th>
                <th>{t('colActive')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.nameAr || row.nameEn || row.slug}
                    {row.nameEn && row.nameAr ? (
                      <span className="meta" dir="ltr">
                        {' '}
                        {row.nameEn}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className="slug" dir="ltr">
                      {row.path.slice(1)}
                    </span>
                  </td>
                  <td className="num">{row.productCount}</td>
                  <td>
                    <span className="edit-pills">
                      {(['ar', 'en'] as const).map((code) => (
                        <span
                          key={code}
                          className={`pill ${row.seoComplete.includes(code) ? 'pill-ready' : 'pill-blocked'}`}
                        >
                          {code.toUpperCase()} ·{' '}
                          {row.seoComplete.includes(code) ? t('seoWritten') : t('seoMissing')}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td>
                    {row.isActive ? t('active') : <span className="meta">{t('inactive')}</span>}
                  </td>
                  <td className="actions">
                    <Link href={`/content/brands/${encodeURIComponent(row.id)}`}>{c('edit')}</Link>
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
