'use client';

import type { AdminProductList, AdminProductRow, Readiness, StaffMe } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../../lib/api';
import { Nav } from '../nav';

/**
 * Product list.
 *
 * A tool rather than a document, so the summary comes before the detail: the
 * count chips at the top are also the filters, because "39 blocked" is only
 * useful if one click shows which 39.
 *
 * State is encoded in shape as well as in number — a status pill, a blocker
 * count, a zero-stock cell — so what needs attention reads at a glance instead
 * of having to be counted.
 */
const FILTERS = [
  { key: 'all', label: 'الكل' },
  { key: 'draft', label: 'مسودّات' },
  { key: 'published', label: 'منشورة' },
  { key: 'out-of-stock', label: 'نافدة من المخزون' },
  { key: 'blocked', label: 'محجوبة' },
] as const;

/**
 * The API sends a stable key plus the reason, and leaves the naming to whoever
 * shows it — so the field an editor has to go and fix is named here, in the
 * language of the panel, rather than as `seoDescription`.
 */
const CHECK_LABELS: Record<string, string> = {
  seoTitle: 'عنوان SEO',
  seoDescription: 'وصف الميتا',
  body: 'وصف المنتج',
  primaryCategory: 'التصنيف الرئيسي',
  sku: 'المتغيّرات',
  price: 'السعر',
  heroImage: 'الصورة',
  englishName: 'الاسم الإنجليزي',
};

const REASONS = [
  { key: 'IMPORT', label: 'دفعة مفاتيح جديدة' },
  { key: 'MANUAL_ADJUSTMENT', label: 'تعديل يدوي' },
  { key: 'REFUND', label: 'إرجاع' },
  { key: 'REVOKED', label: 'إلغاء مفتاح' },
  { key: 'EXPIRED', label: 'انتهاء صلاحية' },
] as const;

export default function ProductsPage() {
  const router = useRouter();
  const [me, setMe] = useState<StaffMe | null>(null);
  const [data, setData] = useState<AdminProductList | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<{ slug: string; value: Readiness } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.products({ status: filter, q: query || undefined }));
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : 'تعذّر تحميل المنتجات.');
    }
  }, [filter, query, router]);

  useEffect(() => {
    void (async () => {
      try {
        const staff = await api.me();
        // Nothing else on this page would load anyway: the API refuses every
        // route while the account is on its generated password.
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

  const canWrite = me !== null && ['OWNER', 'ADMIN', 'CATALOG'].includes(me.role);

  async function publish(row: AdminProductRow) {
    setBusySlug(row.slug);
    setError(null);
    try {
      await api.setStatus(row.slug, row.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED');
      await load();
    } catch (caught) {
      if (caught instanceof ApiError) {
        // The gate refuses with a list of reasons; showing the count alone
        // would make it look arbitrary.
        setError(
          caught.blockers.length > 0
            ? `${row.slug}: ${caught.blockers.join(' · ')}`
            : caught.message,
        );
      }
    } finally {
      setBusySlug(null);
    }
  }

  async function showReadiness(slug: string) {
    if (readiness?.slug === slug) {
      setReadiness(null);
      return;
    }
    setReadiness({ slug, value: await api.readiness(slug) });
  }

  if (!me) return <main className="shell">…</main>;

  return (
    <main className="shell">
      <Nav me={me} current="products" />
      <h1>المنتجات</h1>

      <nav className="chips">
        {FILTERS.map((entry) => {
          const count = data
            ? entry.key === 'all'
              ? data.counts.all
              : entry.key === 'draft'
                ? data.counts.draft
                : entry.key === 'published'
                  ? data.counts.published
                  : entry.key === 'out-of-stock'
                    ? data.counts.outOfStock
                    : data.counts.blocked
            : null;

          return (
            <button
              key={entry.key}
              type="button"
              className={`chip${filter === entry.key ? ' is-active' : ''}`}
              onClick={() => setFilter(entry.key)}
            >
              {entry.label}
              {count === null ? null : <span className="chip-count">{count}</span>}
            </button>
          );
        })}

        <input
          type="search"
          value={query}
          placeholder="ابحث بالاسم أو الرابط أو SKU"
          onChange={(event) => setQuery(event.target.value)}
          className="search"
        />
      </nav>

      {error ? <p className="error">{error}</p> : null}

      {!canWrite ? (
        <p className="notice">
          دورك <strong>{me.role}</strong> للقراءة فقط — النشر وتعديل المخزون غير متاحين.
        </p>
      ) : null}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>المنتج</th>
              <th>الحالة</th>
              <th className="num">متغيّرات</th>
              <th className="num">المخزون</th>
              <th className="num">من</th>
              <th>الجهوزية</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((row) => (
              <ProductRow
                key={row.slug}
                row={row}
                canWrite={canWrite}
                busy={busySlug === row.slug}
                onPublish={() => void publish(row)}
                onReadiness={() => void showReadiness(row.slug)}
                readiness={readiness?.slug === row.slug ? readiness.value : null}
                onStockSaved={() => void load()}
                onError={setError}
              />
            ))}
          </tbody>
        </table>
      </div>

      {data && data.rows.length === 0 ? <p className="notice">لا نتائج.</p> : null}
      {data ? (
        <p className="foot">
          {data.rows.length} من {data.total}
        </p>
      ) : null}
    </main>
  );
}

function ProductRow({
  row,
  canWrite,
  busy,
  onPublish,
  onReadiness,
  readiness,
  onStockSaved,
  onError,
}: {
  row: AdminProductRow;
  canWrite: boolean;
  busy: boolean;
  onPublish: () => void;
  onReadiness: () => void;
  readiness: Readiness | null;
  onStockSaved: () => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [howTo, setHowTo] = useState(false);

  return (
    <>
      <tr className={row.status === 'PUBLISHED' ? 'is-live' : undefined}>
        <td>
          <span className="name">{row.nameAr}</span>
          <span className="slug" dir="ltr">
            {row.slug}
          </span>
          {row.brand ? <span className="meta">{row.brand}</span> : null}
        </td>
        <td>
          <span className={`pill pill-${row.status.toLowerCase()}`}>
            {row.status === 'PUBLISHED' ? 'منشور' : row.status === 'DRAFT' ? 'مسودّة' : row.status}
          </span>
        </td>
        <td className="num">{row.variantCount}</td>
        {/* A dash, not a zero. Most of this catalog is made to order, and a
            zero in a stock column reads as sold out. */}
        <td className={`num${row.stock === 0 ? ' is-zero' : ''}`}>
          {row.stock === null ? <span className="meta">حسب الطلب</span> : row.stock}
        </td>
        <td className="num">{row.priceFromUsd ? `$${row.priceFromUsd}` : '—'}</td>
        <td>
          <button type="button" className="linky" onClick={onReadiness}>
            {row.blockers > 0 ? (
              <span className="pill pill-blocked">{row.blockers} عائق</span>
            ) : (
              <span className="pill pill-ready">جاهز</span>
            )}
            {row.warnings > 0 ? <span className="warn">{row.warnings} تنبيه</span> : null}
          </button>
        </td>
        <td className="actions">
          {canWrite ? (
            <>
              <button type="button" onClick={onPublish} disabled={busy || row.blockers > 0}>
                {row.status === 'PUBLISHED' ? 'إلغاء النشر' : 'نشر'}
              </button>
              {/* The count, on the button. Zero steps is the state worth
                  noticing: the licence still goes out, with no instructions
                  beside it, and that is where the support ticket comes from. */}
              <button type="button" className="ghost" onClick={() => setHowTo(!howTo)}>
                شرح التفعيل
                <span className={`tab-count${row.activationSteps.ar === 0 ? ' is-late' : ''}`}>
                  {row.activationSteps.ar}
                </span>
              </button>
              {row.stockedVariantCount === 0 ? null : row.variantCount === 1 ? (
                <button type="button" className="ghost" onClick={() => setEditing(!editing)}>
                  مخزون
                </button>
              ) : (
                <span className="meta">عدّة متغيّرات</span>
              )}
            </>
          ) : null}
        </td>
      </tr>

      {editing ? (
        <tr className="drawer">
          <td colSpan={7}>
            <StockForm
              slug={row.slug}
              onDone={() => {
                setEditing(false);
                onStockSaved();
              }}
              onError={onError}
            />
          </td>
        </tr>
      ) : null}

      {howTo ? (
        <tr className="drawer">
          <td colSpan={7}>
            <HowToForm
              slug={row.slug}
              onDone={() => {
                setHowTo(false);
                onStockSaved();
              }}
              onError={onError}
            />
          </td>
        </tr>
      ) : null}

      {readiness ? (
        <tr className="drawer">
          <td colSpan={7}>
            <ul className="checks">
              {readiness.checks.map((check) => (
                <li key={check.key} className={check.passed ? 'passed' : check.severity}>
                  <span className="check-key">{CHECK_LABELS[check.key] ?? check.key}</span>
                  <span>{check.passed ? 'مستوفى' : check.detail}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * Single-variant stock entry.
 *
 * A reason is required, not optional: the counter alone cannot answer "where
 * did that key go", and that is the only question that matters when a licence
 * is missing.
 */
function StockForm({
  slug,
  onDone,
  onError,
}: {
  slug: string;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [onHand, setOnHand] = useState('0');
  const [reason, setReason] = useState<string>('IMPORT');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="stock-form"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        // A single-variant product's SKU is its slug, set by the import.
        void api
          .setInventory(slug, Number.parseInt(onHand, 10), reason, note || undefined)
          .then(onDone)
          .catch((caught: unknown) => {
            onError(caught instanceof Error ? caught.message : 'تعذّر تحديث المخزون.');
          })
          .finally(() => setBusy(false));
      }}
    >
      <label>
        المخزون
        <input
          type="number"
          min={0}
          value={onHand}
          onChange={(event) => setOnHand(event.target.value)}
          required
        />
      </label>
      <label>
        السبب
        <select value={reason} onChange={(event) => setReason(event.target.value)}>
          {REASONS.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grow">
        ملاحظة
        <input
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="اختياري — من أي مورّد، أي دفعة"
        />
      </label>
      <button type="submit" disabled={busy}>
        حفظ
      </button>
    </form>
  );
}

/**
 * The activation how-to, one step per line.
 *
 * This text is delivered twice: in the licence email, under the key, and on the
 * customer's own order page. So it is plain lines rather than a rich editor —
 * an email body cannot carry markup, and a step list that renders differently
 * in the two places is a step list nobody trusts.
 *
 * Per locale, because it is content. The Arabic list is what most customers
 * read; the English one is written separately rather than machine-translated,
 * which is the sort of thing that produces instructions nobody can follow.
 */
function HowToForm({
  slug,
  onDone,
  onError,
}: {
  slug: string;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [locale, setLocale] = useState<'ar' | 'en'>('ar');
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setText(null);
    let cancelled = false;
    void api
      .activationSteps(slug, locale)
      .then((result) => {
        if (!cancelled) setText(result.steps.join('\n'));
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        // A missing translation is a real answer, not a failure: the product
        // has no English row yet, and an empty box that cannot save is more
        // honest than a red banner.
        setText('');
        onError(caught instanceof Error ? caught.message : 'تعذّر تحميل الشرح.');
      });
    return () => {
      cancelled = true;
    };
  }, [slug, locale, onError]);

  const lines = (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <form
      className="paste-form"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void api
          .setActivationSteps(slug, locale, lines)
          .then(onDone)
          .catch((caught: unknown) => {
            onError(caught instanceof Error ? caught.message : 'تعذّر حفظ الشرح.');
          })
          .finally(() => setBusy(false));
      }}
    >
      <label>
        اللغة
        <select value={locale} onChange={(event) => setLocale(event.target.value as 'ar' | 'en')}>
          <option value="ar">العربية</option>
          <option value="en">English</option>
        </select>
      </label>
      <label className="grow">
        خطوات التفعيل — خطوة في كل سطر
        <textarea
          value={text ?? ''}
          onChange={(event) => setText(event.target.value)}
          rows={6}
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
          disabled={text === null}
          placeholder={
            'حمّل البرنامج من الموقع الرسمي\nافتح «تفعيل» وأدخل المفتاح\nأعد تشغيل البرنامج'
          }
        />
        <small>
          {lines.length > 0 ? `${String(lines.length)} خطوة. ` : ''}
          تُرسَل مع المفتاح في البريد وتظهر في صفحة طلب العميل. نصّ فقط — بلا روابط منسّقة أو تنسيق،
          لأن البريد لا يقرأه.
        </small>
      </label>
      <button type="submit" disabled={busy || text === null}>
        {busy ? '...' : 'حفظ'}
      </button>
    </form>
  );
}
