'use client';

import type { AdminCategory, AdminCategoryList, StaffMe } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api, ApiError } from '../../lib/api';
import { Nav } from '../nav';

/**
 * الأقسام — the sections a shopper browses by.
 *
 * Sixteen of them came from the WordPress import and there has never been a
 * screen: they could not be renamed, reordered, nested or added to, while a
 * rail linking to all sixteen sits on every catalog page and 103 legacy URLs
 * redirect into them.
 *
 * The count of published products is the column that matters. A section with
 * none is a page in the navigation with nothing on it, and this catalog has
 * one — which was invisible until there was a list to see it in.
 */
export default function CategoriesPage() {
  const router = useRouter();
  const t = useT('categories');
  const c = useT('common');
  const [me, setMe] = useState<StaffMe | null>(null);
  const [data, setData] = useState<AdminCategoryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.categories());
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : c('actionFailed'));
    }
  }, [router, c]);

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
    if (me) void load();
  }, [me, load]);

  if (!me) return <div className="admin-layout">{c('loading')}</div>;

  const canWrite = ['OWNER', 'ADMIN', 'CATALOG'].includes(me.role);
  const canCreate = ['OWNER', 'ADMIN'].includes(me.role);
  const byId = new Map((data?.rows ?? []).map((row) => [row.id, row]));

  return (
    <Nav me={me} current="categories">
      <div className="queue-head">
        <h1>{t('title')}</h1>
        {canCreate && !adding ? (
          <button type="button" onClick={() => setAdding(true)}>
            {t('newCategory')}
          </button>
        ) : null}
      </div>
      <p className="lede-sm">{t('lede')}</p>

      {error ? <p className="error">{error}</p> : null}
      {!canWrite ? <p className="notice">{t('roleReadonly', { role: me.role })}</p> : null}

      {adding ? (
        <NewCategory
          parents={data?.rows ?? []}
          onCreated={(next) => {
            setData(next);
            setAdding(false);
          }}
          onError={setError}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {data ? (
        <div className="table-scroll">
          <table className="admin-table categories-table">
            <thead>
              <tr>
                <th>{t('colName')}</th>
                <th>{t('colSlug')}</th>
                <th>{t('colParent')}</th>
                <th className="num">{t('colProducts')}</th>
                <th className="num">{t('colPosition')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <CategoryRow
                  key={row.id}
                  row={row}
                  parents={data.rows}
                  parentName={row.parentId ? (byId.get(row.parentId)?.nameAr ?? '—') : null}
                  canWrite={canWrite}
                  onSaved={setData}
                  onError={setError}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Nav>
  );
}

function CategoryRow({
  row,
  parents,
  parentName,
  canWrite,
  onSaved,
  onError,
}: {
  row: AdminCategory;
  parents: AdminCategory[];
  parentName: string | null;
  canWrite: boolean;
  onSaved: (next: AdminCategoryList) => void;
  onError: (message: string) => void;
}) {
  const t = useT('categories');
  const c = useT('common');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(row);

  useEffect(() => {
    setDraft(row);
  }, [row]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(row);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      onSaved(
        await api.setCategory(row.id, {
          ...(draft.slug !== row.slug ? { slug: draft.slug } : {}),
          ...(draft.nameAr !== row.nameAr ? { nameAr: draft.nameAr } : {}),
          ...(draft.nameEn !== row.nameEn ? { nameEn: draft.nameEn } : {}),
          ...(draft.headlineAr !== row.headlineAr ? { headlineAr: draft.headlineAr } : {}),
          ...(draft.headlineEn !== row.headlineEn ? { headlineEn: draft.headlineEn } : {}),
          ...(draft.parentId !== row.parentId ? { parentId: draft.parentId } : {}),
          ...(draft.position !== row.position ? { position: draft.position } : {}),
        }),
      );
      setOpen(false);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : c('actionFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <tr className="category-row">
        <td>
          <strong>{row.nameAr || row.slug}</strong>
          {row.nameEn ? <span className="meta">{row.nameEn}</span> : null}
        </td>
        <td>
          <span className="slug" dir="ltr">
            {row.slug}
          </span>
        </td>
        <td>{parentName ?? <span className="meta">{t('topLevel')}</span>}</td>
        {/* An empty section is a page in the navigation with nothing on it. */}
        <td className={`num${row.productCount === 0 ? ' is-empty-section' : ''}`}>
          {row.productCount}
        </td>
        <td className="num">{row.position}</td>
        <td className="actions">
          {canWrite ? (
            <button type="button" className="ghost" onClick={() => setOpen(!open)}>
              {open ? c('hide') : c('edit')}
            </button>
          ) : null}
        </td>
      </tr>

      {open ? (
        <tr className="category-drawer">
          <td colSpan={6}>
            <div className="terms-grid">
              <label>
                <span>{t('nameAr')}</span>
                <input
                  id={`cat-ar-${row.id}`}
                  type="text"
                  dir="rtl"
                  value={draft.nameAr}
                  onChange={(event) => setDraft({ ...draft, nameAr: event.target.value })}
                />
              </label>
              <label>
                <span>{t('nameEn')}</span>
                <input
                  id={`cat-en-${row.id}`}
                  type="text"
                  dir="ltr"
                  value={draft.nameEn}
                  onChange={(event) => setDraft({ ...draft, nameEn: event.target.value })}
                />
              </label>
              <label>
                <span>{t('headlineAr')}</span>
                <input
                  id={`cat-head-ar-${row.id}`}
                  type="text"
                  dir="rtl"
                  value={draft.headlineAr}
                  onChange={(event) => setDraft({ ...draft, headlineAr: event.target.value })}
                />
              </label>
              <label>
                <span>{t('headlineEn')}</span>
                <input
                  id={`cat-head-en-${row.id}`}
                  type="text"
                  dir="ltr"
                  value={draft.headlineEn}
                  onChange={(event) => setDraft({ ...draft, headlineEn: event.target.value })}
                />
              </label>
              <label>
                <span>{t('colParent')}</span>
                <select
                  id={`cat-parent-${row.id}`}
                  value={draft.parentId ?? ''}
                  onChange={(event) =>
                    setDraft({ ...draft, parentId: event.target.value || null })
                  }
                >
                  <option value="">{t('topLevel')}</option>
                  {parents
                    .filter((entry) => entry.id !== row.id)
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.nameAr || entry.slug}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>{t('colPosition')}</span>
                <input
                  id={`cat-pos-${row.id}`}
                  type="number"
                  min={0}
                  dir="ltr"
                  value={draft.position}
                  onChange={(event) =>
                    setDraft({ ...draft, position: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                <span>{t('colSlug')}</span>
                <input
                  id={`cat-slug-${row.id}`}
                  type="text"
                  dir="ltr"
                  value={draft.slug}
                  onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
                />
                <small>{t('slugRedirectNote')}</small>
              </label>
            </div>

            <div className="terms-save">
              <button type="button" onClick={() => void save()} disabled={!dirty || saving}>
                {saving ? c('loading') : c('save')}
              </button>
              {dirty ? (
                <button type="button" className="ghost" onClick={() => setDraft(row)}>
                  {c('cancel')}
                </button>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function NewCategory({
  parents,
  onCreated,
  onError,
  onCancel,
}: {
  parents: AdminCategory[];
  onCreated: (next: AdminCategoryList) => void;
  onError: (message: string) => void;
  onCancel: () => void;
}) {
  const t = useT('categories');
  const c = useT('common');
  const [slug, setSlug] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [parentId, setParentId] = useState('');
  const [saving, setSaving] = useState(false);

  async function create(): Promise<void> {
    setSaving(true);
    try {
      onCreated(
        await api.createCategory({
          slug: slug.trim(),
          nameAr: nameAr.trim(),
          ...(nameEn.trim() ? { nameEn: nameEn.trim() } : {}),
          parentId: parentId || null,
        }),
      );
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : c('actionFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="new-product">
      <h2>{t('newCategoryHeading')}</h2>
      <div className="terms-grid">
        <label>
          <span>{t('nameAr')} *</span>
          <input
            id="new-cat-ar"
            type="text"
            dir="rtl"
            value={nameAr}
            onChange={(event) => setNameAr(event.target.value)}
          />
        </label>
        <label>
          <span>{t('nameEn')}</span>
          <input
            id="new-cat-en"
            type="text"
            dir="ltr"
            value={nameEn}
            onChange={(event) => setNameEn(event.target.value)}
          />
        </label>
        <label>
          <span>{t('colSlug')} *</span>
          <input
            id="new-cat-slug"
            type="text"
            dir="ltr"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
          />
        </label>
        <label>
          <span>{t('colParent')}</span>
          <select
            id="new-cat-parent"
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
          >
            <option value="">{t('topLevel')}</option>
            {parents.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.nameAr || entry.slug}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="terms-save">
        <button
          type="button"
          onClick={() => void create()}
          disabled={saving || nameAr.trim().length < 2 || slug.trim().length < 2}
        >
          {saving ? c('loading') : t('createCategory')}
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          {c('cancel')}
        </button>
      </div>
    </section>
  );
}
