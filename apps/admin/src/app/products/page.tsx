'use client';

import type {
  AdminProductList,
  AdminProductRow,
  ProductCopy,
  Readiness,
  StaffMe,
} from '@da/contracts';
import { countBodyWords, READINESS_RULES, SEO_LENGTH_GUIDE } from '@da/contracts';
import { RichTextEditor } from './rich-text-editor';
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
  /**
   * The chip this screen was missing.
   *
   * "محجوبة" answers what needs work. Nothing answered what needs a decision —
   * and the catalog was sitting on 30 drafts that were priced, described,
   * categorised and imaged, with the publish gate ready to accept every one of
   * them. Two products were live out of 73. That is not a content problem and
   * the panel was not saying it was anything at all.
   */
  { key: 'ready', label: 'جاهزة للنشر' },
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
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [readiness, setReadiness] = useState<{ slug: string; value: Readiness } | null>(null);
  /**
   * Which language the gate is being read in.
   *
   * Not cosmetic. The gate is assessed per locale and this screen sent `ar` and
   * only `ar`, so the one thing it could never tell you is the thing that is
   * actually true of this catalog: all 73 English translations are missing both
   * SEO fields. Switching here changes the blocker counts, the drawer and what
   * publishing is refused for, together — a gate that disagreed with the screen
   * it is drawn on would be worse than no gate.
   */
  const [locale, setLocale] = useState<'ar' | 'en'>('ar');

  const load = useCallback(async () => {
    try {
      setData(await api.products({ status: filter, q: query || undefined, locale }));
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : 'تعذّر تحميل المنتجات.');
    }
  }, [filter, query, locale, router]);

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
      await api.setStatus(row.slug, row.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED', locale);
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

  /**
   * Publish every draft the gate would accept, one call at a time.
   *
   * Sequential rather than batched, and through the same endpoint the single
   * button uses, so each product passes the gate on its own and each one writes
   * its own audit row. A bulk endpoint would be faster and would also be a
   * second publish path that could disagree with the first about what "ready"
   * means — which is the class of bug that puts a product with no price on a
   * live shop.
   *
   * Confirmed by name and number first. This is the one control on the panel
   * that changes what the shop sells, for many products at once, and it is not
   * something to discover by clicking.
   */
  async function publishReady() {
    const rows = (data?.rows ?? []).filter((row) => row.status === 'DRAFT' && row.blockers === 0);
    if (rows.length === 0) return;
    if (
      !window.confirm(
        [
          `سيُنشر ${String(rows.length)} منتجاً ويصبح معروضاً للبيع فوراً على المتجر.`,
          '',
          ...rows.slice(0, 8).map((row) => `· ${row.nameAr}`),
          ...(rows.length > 8 ? [`… و${String(rows.length - 8)} غيرها`] : []),
          '',
          'هل تريد المتابعة؟',
        ].join('\n'),
      )
    ) {
      return;
    }

    setBulk({ done: 0, total: rows.length });
    setError(null);
    const failed: string[] = [];
    for (const [index, row] of rows.entries()) {
      try {
        await api.setStatus(row.slug, 'PUBLISHED', locale);
      } catch (caught) {
        // One refusal does not stop the rest: the gate is per product, and
        // stopping would leave the run half done with no record of where.
        failed.push(
          caught instanceof ApiError && caught.blockers.length > 0
            ? `${row.slug} (${caught.blockers.join('، ')})`
            : row.slug,
        );
      }
      setBulk({ done: index + 1, total: rows.length });
    }
    setBulk(null);
    if (failed.length > 0) {
      setError(`تعذّر نشر ${String(failed.length)}: ${failed.slice(0, 5).join(' · ')}`);
    }
    await load();
  }

  async function showReadiness(slug: string) {
    if (readiness?.slug === slug) {
      setReadiness(null);
      return;
    }
    setReadiness({ slug, value: await api.readiness(slug, locale) });
  }

  if (!me) return <div className="admin-layout">…</div>;

  return (
    <Nav me={me} current="products" >
      <h1>المنتجات</h1>

      <nav className="chips">
        {FILTERS.map((entry) => {
          const count = data
            ? entry.key === 'all'
              ? data.counts.all
              : entry.key === 'draft'
                ? data.counts.draft
                : entry.key === 'ready'
                  ? data.counts.ready
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

        {/* Switching language closes any open drawer: the checks in it were
            read for the other one, and a stale list of blockers is worse than
            no list. */}
        <div className="locale-switch" role="group" aria-label="لغة الجهوزية">
          {(['ar', 'en'] as const).map((code) => (
            <button
              key={code}
              type="button"
              className={`chip${locale === code ? ' is-active' : ''}`}
              aria-pressed={locale === code}
              onClick={() => {
                setLocale(code);
                setReadiness(null);
              }}
            >
              {code === 'ar' ? 'عربي' : 'English'}
            </button>
          ))}
        </div>
      </nav>

      {error ? <p className="error">{error}</p> : null}

      {!canWrite ? (
        <p className="notice">
          دورك <strong>{me.role}</strong> للقراءة فقط — النشر وتعديل المخزون غير متاحين.
        </p>
      ) : null}

      {/* Offered only on the list it acts on, so what it will publish is what
          is on screen. */}
      {canWrite && filter === 'ready' && (data?.counts.ready ?? 0) > 0 ? (
        <div className="bulk-bar">
          <p>
            <strong>{data?.counts.ready}</strong> منتجاً مكتملاً ينتظر قراراً — مسعّرة وموصوفة
            ومصنّفة، والمتجر لا يعرضها.
          </p>
          <button type="button" disabled={bulk !== null} onClick={() => void publishReady()}>
            {bulk === null
              ? 'انشر الجاهزة كلها'
              : `جارٍ النشر ${String(bulk.done)}/${String(bulk.total)}…`}
          </button>
        </div>
      ) : null}

      <div className="table-scroll">
        <table className="admin-table products-table">
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
    </Nav>
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
  const [copy, setCopy] = useState(false);

  return (
    <>
      <tr className={row.status === 'PUBLISHED' ? 'is-live' : undefined}>
        <td>
          <span className="name" title={row.nameAr}>
            {row.nameAr}
          </span>
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
              {/* The blocker count sits on this button because this is where
                  the blockers are fixed: 35 of the 73 products are held back
                  by nothing but an SEO title and a meta description, and the
                  panel had nowhere to type either of them until now. */}
              <button type="button" className="ghost" onClick={() => setCopy(!copy)}>
                نصوص SEO
                {row.blockers > 0 ? (
                  <span className="tab-count is-late">{row.blockers}</span>
                ) : null}
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

      {copy ? (
        <tr className="drawer">
          <td colSpan={7}>
            <CopyForm slug={row.slug} onSaved={onStockSaved} onError={onError} />
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
 * The gate's own flattening, repeated for the live counter.
 *
 * `readiness.ts` strips the tags out of a richText block and counts what is
 * left; the editor is holding that same HTML in a textarea, so it strips the
 * same way and counts with the same shared function. Any other arithmetic and
 * the number beside the box disagrees with the number that decides the
 * publish, which is worse than showing no number at all.
 */
function bodyWords(html: string): number {
  return countBodyWords(html.replace(/<[^>]+>/g, ' '));
}

/**
 * A length against the rule it has to clear.
 *
 * The shortfall is the number, not the length: "37 more characters" is an
 * instruction, "83 characters" is a fact somebody then has to do arithmetic
 * on. The ceiling is mentioned only once it is passed, and as advice — the
 * gate has no maximum, the SERP does.
 */
function Gauge({
  value,
  min,
  max,
  unit,
}: {
  value: number;
  min: number;
  /** Null where there is no ceiling worth mentioning — a long body still ranks. */
  max: number | null;
  unit: string;
}) {
  const short = min - value;

  return (
    <small>
      <span className={`pill ${short <= 0 ? 'pill-ready' : 'pill-blocked'}`}>
        {short <= 0 ? 'مستوفى' : `ينقص ${short} ${unit}`}
      </span>{' '}
      {value} {unit} — الحد الأدنى {min}.
      {max !== null && value > max
        ? ` أطول من ${max} ${unit}، وما بعدها يُقتطع في نتيجة البحث.`
        : ''}
    </small>
  );
}

/**
 * The SEO title, the meta description and the body — per locale.
 *
 * This drawer is the reason the publish gate is usable at all. 43 of the 101
 * legacy products shipped with no title and no description, the gate refuses
 * exactly that, and the panel had no box to type either one into: a refusal
 * nobody can act on is a refusal that gets switched off.
 *
 * The readiness for the chosen locale sits above the fields rather than in its
 * own drawer, and the counters recompute as the text is typed, so a blocker
 * clears on screen while somebody is fixing it. The locale switch is a real
 * one: the gate is assessed per locale, and every English translation in this
 * catalog is missing both fields and its whole body.
 */
function CopyForm({
  slug,
  onSaved,
  onError,
}: {
  slug: string;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [locale, setLocale] = useState<'ar' | 'en'>('ar');
  const [loaded, setLoaded] = useState<ProductCopy | null>(null);
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [shortDesc, setShortDesc] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const take = useCallback((copy: ProductCopy) => {
    setLoaded(copy);
    setSeoTitle(copy.seoTitle);
    setSeoDescription(copy.seoDescription);
    setShortDesc(copy.shortDesc);
    setBody(copy.body);
  }, []);

  useEffect(() => {
    setLoaded(null);
    let cancelled = false;
    void api
      .productCopy(slug, locale)
      .then((copy) => {
        if (!cancelled) take(copy);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        onError(caught instanceof Error ? caught.message : 'تعذّر تحميل النصوص.');
      });
    return () => {
      cancelled = true;
    };
  }, [slug, locale, onError, take]);

  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <>
      {/* The refusal, beside the fields that answer it. The three content
          checks carry live counters below; the rest are here because they are
          the reason a product stays blocked after the copy is written. */}
      {loaded ? (
        <ul className="checks">
          {loaded.readiness.checks.map((check) => (
            <li key={check.key} className={check.passed ? 'passed' : check.severity}>
              <span className="check-key">{CHECK_LABELS[check.key] ?? check.key}</span>
              <span>{check.passed ? 'مستوفى' : check.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="paste-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!loaded) return;
          setBusy(true);
          void api
            .setProductCopy(slug, {
              locale,
              seoTitle,
              seoDescription,
              shortDesc,
              // Omitted when the body holds blocks this box cannot put back;
              // the API refuses a body in that case rather than flattening it.
              ...(loaded.bodyEditable ? { body } : {}),
            })
            .then((copy) => {
              take(copy);
              onSaved();
            })
            .catch((caught: unknown) => {
              onError(caught instanceof Error ? caught.message : 'تعذّر حفظ النصوص.');
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
          عنوان SEO
          <input
            type="text"
            value={seoTitle}
            dir={dir}
            disabled={loaded === null}
            onChange={(event) => setSeoTitle(event.target.value)}
            placeholder="العنوان الذي يظهر في نتيجة البحث"
          />
          <Gauge
            value={seoTitle.trim().length}
            min={READINESS_RULES.seoTitleMinLength}
            max={SEO_LENGTH_GUIDE.seoTitleMax}
            unit="حرفاً"
          />
        </label>

        <label className="grow">
          وصف الميتا
          <textarea
            value={seoDescription}
            rows={3}
            dir={dir}
            disabled={loaded === null}
            onChange={(event) => setSeoDescription(event.target.value)}
            placeholder="جملة أو جملتان تصفان المنتج لمن يقرأ نتيجة البحث"
          />
          <Gauge
            value={seoDescription.trim().length}
            min={READINESS_RULES.seoDescriptionMinLength}
            max={SEO_LENGTH_GUIDE.seoDescriptionMax}
            unit="حرفاً"
          />
        </label>

        <label className="grow">
          السطر القصير
          <input
            type="text"
            value={shortDesc}
            dir={dir}
            disabled={loaded === null}
            onChange={(event) => setShortDesc(event.target.value)}
            placeholder="السطر فوق السعر في صفحة المنتج"
          />
          <small>لا يمنع النشر، لكنه أول ما يقرأه الزائر فوق السعر.</small>
        </label>

        <label className="grow">
          وصف المنتج
          <RichTextEditor
            value={body}
            dir={dir}
            disabled={loaded === null || !loaded.bodyEditable}
            onChange={setBody}
          />
          {loaded && !loaded.bodyEditable ? (
            <small>
              هذا الوصف يحتوي على كتل لا يحرّرها هذا الصندوق ({loaded.otherBlocks.join('، ')}) — وهي
              الكتل التي تقتبسها محرّكات البحث. بقية الحقول قابلة للحفظ.
            </small>
          ) : (
            <>
              <Gauge
                value={bodyWords(body)}
                min={READINESS_RULES.bodyMinWords}
                max={null}
                unit="كلمة"
              />
              {/* HTML rather than a rich editor, because HTML is what is
                  stored: every Arabic body in this catalog is one richText
                  block of WooCommerce markup, and a plain-text box would have
                  wiped its headings and lists on the first save. */}
              <small>
                نصّ HTML بسيط — عناوين h2/h3، فقرات p، قوائم ul/ol. ما عدا ذلك يُزال عند الحفظ.
              </small>
            </>
          )}
        </label>

        <button type="submit" disabled={busy || loaded === null}>
          {busy ? '...' : 'حفظ'}
        </button>
      </form>
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
