'use client';

import type {
  CredentialKind,
  OrderKeysRow,
  RevealResult,
  StaffMe,
  VaultStockRow,
} from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../../lib/api';
import { Nav } from '../nav';

/**
 * The vault.
 *
 * Two jobs, and they are different enough to be separate halves of the screen.
 *
 * Stocking: for the nine variants held in hand, paste the block a supplier
 * sent and the vault takes in what is new and reports what it refused. That
 * report matters more than the success count — a supplier resending a block is
 * routine, and a duplicate stored twice is a licence sold twice.
 *
 * Answering a complaint: a customer writes in with an order number, and the
 * person answering needs to know whether a key went out, when, and — only if
 * they must — what it says. So reading a key is deliberate: a reason is
 * required, the TOTP challenge has to be fresh, and it is shown once without
 * being kept in any state that survives leaving the page.
 */
export default function VaultPage() {
  const router = useRouter();
  const [me, setMe] = useState<StaffMe | null>(null);
  const [stock, setStock] = useState<VaultStockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStock(await api.vaultStock());
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : 'تعذّر تحميل الخزنة.');
    }
  }, [router]);

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

  if (!me) return <main className="shell">…</main>;

  const canStock = ['OWNER', 'ADMIN', 'FULFILLMENT'].includes(me.role);
  // Not FULFILLMENT: changing the shape changes how every future key for the
  // line is stored and labelled, which is a catalog decision, not a queue one.
  const canEditKind = ['OWNER', 'ADMIN', 'CATALOG'].includes(me.role);
  const canReveal = ['OWNER', 'ADMIN'].includes(me.role);
  const stocked = (stock ?? []).filter((row) => row.mode === 'FROM_STOCK');
  const others = (stock ?? []).filter((row) => row.mode !== 'FROM_STOCK');

  return (
    <main className="shell">
      <Nav me={me} current="vault" />

      <h1>الخزنة</h1>
      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}

      <section className="vault-section">
        <h2>مخزون المفاتيح</h2>
        <p className="lede-sm">
          المتغيّرات المحفوظة لديك. الباقي يُطلَب من المورّد عند الشراء ولا يحتاج مخزوناً.
        </p>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>المتغيّر</th>
                <th>يُسلَّم كـ</th>
                <th className="num">متاح</th>
                <th className="num">مخصّص</th>
                <th className="num">مُسلَّم</th>
                <th className="num">ملغى</th>
                <th className="num">منتهٍ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stocked.map((row) => (
                <StockRow
                  key={row.variantId}
                  row={row}
                  canStock={canStock}
                  canEditKind={canEditKind}
                  onKindSaved={() => void load()}
                  onNote={setNote}
                  onImported={(result) => {
                    setError(null);
                    setNote(
                      `${row.sku}: أُدخل ${String(result.imported)}، تُجوهل ${String(result.duplicatesSkipped)} مكرّراً و${String(result.invalidSkipped)} غير صالح`,
                    );
                    void load();
                  }}
                  onError={setError}
                />
              ))}
              {stocked.length === 0 && stock ? (
                <tr>
                  <td colSpan={8} className="meta">
                    لا متغيّر محفوظ. كل المنتجات حسب الطلب حالياً.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Listed, not hidden. The owner may decide to start holding stock of
            one of these, and a screen that omits them cannot be used to make
            that decision. */}
        {others.length > 0 ? (
          <details className="vault-others">
            <summary>{others.length} متغيّراً حسب الطلب — لا تحتاج مخزوناً</summary>
            <ul className="vault-other-list">
              {others.map((row) => (
                <li key={row.variantId}>
                  <span className="slug" dir="ltr">
                    {row.sku}
                  </span>
                  <span className="meta">
                    {row.mode === 'ON_DEMAND' ? 'حسب الطلب' : 'تجهيز يدوي'}
                  </span>
                  {/* Editable here too. These 92 never hold stock, but the
                      supplier still sends back either a key or an account, and
                      that is what the paste box has to ask for. */}
                  <KindPicker
                    row={row}
                    canEdit={canEditKind}
                    onSaved={() => void load()}
                    onError={setError}
                    onNote={setNote}
                  />
                  {Object.keys(row.counts).length > 0 ? (
                    <span className="meta">
                      يحتوي{' '}
                      {Object.entries(row.counts)
                        .map(([k, v]) => `${k}:${String(v)}`)
                        .join(' ')}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="vault-section">
        <h2>مفاتيح طلب</h2>
        <p className="lede-sm">
          ابدأ من رقم الطلب الذي أرسله العميل. تُعرض المعرّفات والحالات فقط — قراءة مفتاح إجراء
          منفصل يحتاج سبباً ورمز مصادقة حديثاً.
        </p>
        <OrderLookup canReveal={canReveal} onError={setError} onNote={setNote} />
      </section>
    </main>
  );
}

/**
 * The delivery-shape picker.
 *
 * Saves on change rather than behind a save button: it is one field with two
 * values, and a form around it would be three clicks for a decision that is
 * one. The server refuses the change while the vault still holds keys under
 * the other shape, and that refusal is the message shown — flipping the field
 * alone would leave stored rows describing themselves one way and the variant
 * claiming another, and the email would then label a password as a key.
 */
function KindPicker({
  row,
  canEdit,
  onSaved,
  onError,
  onNote,
}: {
  row: VaultStockRow;
  canEdit: boolean;
  onSaved: () => void;
  onError: (message: string | null) => void;
  onNote: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    return (
      <span
        className={`pill ${row.credentialKind === 'ACCOUNT_CREDENTIALS' ? 'pill-ready' : 'pill-published'}`}
      >
        {kindLabel(row.credentialKind)}
      </span>
    );
  }

  return (
    <select
      className="kind-picker"
      value={row.credentialKind}
      disabled={busy}
      aria-label={`نوع التسليم لـ ${row.sku}`}
      onChange={(event) => {
        const next = event.target.value as CredentialKind;
        if (next === row.credentialKind) return;
        setBusy(true);
        onError(null);
        void api
          .setCredentialKind(row.sku, next)
          .then(() => {
            onNote(`${row.sku}: يُسلَّم الآن كـ${kindLabel(next)}`);
            onSaved();
          })
          .catch((caught: unknown) => {
            onError(caught instanceof Error ? caught.message : 'تعذّر تغيير نوع التسليم.');
          })
          .finally(() => setBusy(false));
      }}
    >
      <option value="ACTIVATION_KEY">مفتاح تفعيل</option>
      <option value="ACCOUNT_CREDENTIALS">اسم مستخدم وكلمة مرور</option>
    </select>
  );
}

function StockRow({
  row,
  canStock,
  canEditKind,
  onImported,
  onKindSaved,
  onError,
  onNote,
}: {
  row: VaultStockRow;
  canStock: boolean;
  canEditKind: boolean;
  onImported: (result: {
    imported: number;
    duplicatesSkipped: number;
    invalidSkipped: number;
  }) => void;
  onKindSaved: () => void;
  onError: (message: string | null) => void;
  onNote: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState('');
  const [cost, setCost] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);

  const available = row.counts.AVAILABLE ?? 0;
  const isAccount = row.credentialKind === 'ACCOUNT_CREDENTIALS';
  const lines = codes.split(/\r?\n/).filter((line) => line.trim().length > 0).length;

  return (
    <>
      <tr>
        <td>
          <span className="name">{row.productName}</span>
          <span className="slug" dir="ltr">
            {row.sku}
          </span>
        </td>
        <td>
          <KindPicker
            row={row}
            canEdit={canEditKind}
            onSaved={onKindSaved}
            onError={onError}
            onNote={onNote}
          />
        </td>
        {/* Zero available on a stocked variant is a product that will sell and
            then sit in the manual queue, so it reads as a problem. */}
        <td className={`num${available === 0 ? ' is-zero' : ''}`}>{available}</td>
        <td className="num">{row.counts.ASSIGNED ?? 0}</td>
        <td className="num">{row.counts.DELIVERED ?? 0}</td>
        <td className="num">{row.counts.REVOKED ?? 0}</td>
        <td className="num">{row.counts.EXPIRED ?? 0}</td>
        <td className="actions">
          {canStock ? (
            <button type="button" className="ghost" onClick={() => setOpen(!open)}>
              {open ? 'إلغاء' : isAccount ? 'أدخل حسابات' : 'أدخل مفاتيح'}
            </button>
          ) : null}
        </td>
      </tr>

      {open ? (
        <tr className="drawer">
          <td colSpan={8}>
            <form
              className="paste-form"
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                void api
                  .importKeys(
                    row.variantId,
                    codes,
                    cost.trim() || undefined,
                    expires ? new Date(expires).toISOString() : undefined,
                  )
                  .then((result) => {
                    onImported(result);
                    setCodes('');
                    setCost('');
                    setExpires('');
                    setOpen(false);
                  })
                  .catch((caught: unknown) => {
                    onError(caught instanceof Error ? caught.message : 'تعذّر إدخال المفاتيح.');
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <label className="grow">
                {isAccount ? 'الحسابات — حساب في كل سطر' : 'المفاتيح — مفتاح في كل سطر'}
                <textarea
                  value={codes}
                  onChange={(event) => setCodes(event.target.value)}
                  rows={6}
                  dir="ltr"
                  required
                  minLength={4}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={
                    isAccount
                      ? 'user1@example.com:password\nuser2@example.com:password'
                      : 'AAAA-BBBB-CCCC-DDDD\nEEEE-FFFF-GGGG-HHHH'
                  }
                />
                <small>
                  {lines > 0 ? `${String(lines)} سطراً. ` : ''}
                  {/* The split rule, stated where it is used. A password with a
                      colon in it is normal, and "first separator wins" is the
                      only reading that survives one. */}
                  {isAccount
                    ? 'يُفصل اسم المستخدم عن كلمة المرور عند أول فاصل (: أو | أو مسافة)، وكل ما بعده كلمة المرور. السطر بلا فاصل يُحتسب غير صالح ولا يُخزَّن. '
                    : ''}
                  المكرّر يُكتشَف بالبصمة دون فكّ تشفير أي شيء، ويُتجاهل — لأن تخزين المفتاح مرّتين
                  يعني بيعه مرّتين.
                </small>
              </label>
              <label>
                التكلفة للوحدة (اختياري)
                <input
                  type="text"
                  value={cost}
                  onChange={(event) => setCost(event.target.value)}
                  placeholder="12.50"
                  dir="ltr"
                  pattern="\d+(\.\d{1,2})?"
                />
              </label>
              <label>
                ينتهي في (اختياري)
                <input
                  type="date"
                  value={expires}
                  onChange={(event) => setExpires(event.target.value)}
                  dir="ltr"
                />
                <small>للمفاتيح التي يجب تفعيلها قبل تاريخ.</small>
              </label>
              <button type="submit" disabled={busy || lines === 0}>
                {busy ? '...' : 'أدخل إلى الخزنة'}
              </button>
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * Looking up an order, and reading a key when there is no other way.
 *
 * The reveal keeps the plaintext in component state only, and clearing it is
 * one click. It is not written anywhere, and leaving the page loses it — which
 * is the right default for something that cannot be un-shown.
 */
function OrderLookup({
  canReveal,
  onError,
  onNote,
}: {
  canReveal: boolean;
  onError: (message: string | null) => void;
  onNote: (message: string) => void;
}) {
  const [number, setNumber] = useState('');
  const [lines, setLines] = useState<OrderKeysRow[] | null>(null);
  const [reason, setReason] = useState('');
  const [shown, setShown] = useState<{ id: string; secret: RevealResult } | null>(null);
  const [stepUp, setStepUp] = useState<{ keyId: string } | null>(null);
  const [totp, setTotp] = useState('');
  const [history, setHistory] = useState<{
    id: string;
    rows: { action: string; actorId: string | null; createdAt: string }[];
  } | null>(null);

  async function lookup(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    // A banner from the previous attempt outlives its subject: a refusal left
    // on screen beside a key that has just been revealed reads as a failure.
    onError(null);
    setShown(null);
    setLines(null);
    try {
      setLines(await api.orderKeys(number.trim()));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'تعذّر العثور على الطلب.');
    }
  }

  async function reveal(keyId: string): Promise<void> {
    if (reason.trim().length < 3) {
      onError('اكتب سبب القراءة أولاً — يُسجَّل مع اسمك.');
      return;
    }
    try {
      const result = await api.revealKey(keyId, reason.trim());
      onError(null);
      setShown({ id: keyId, secret: result });
      setStepUp(null);
      setTotp('');
    } catch (caught) {
      // A stale challenge is the expected refusal, not a failure: ask for a
      // code and try again rather than sending the person back to the login.
      if (caught instanceof ApiError && caught.status === 403) {
        setStepUp({ keyId });
        return;
      }
      onError(caught instanceof Error ? caught.message : 'تعذّرت قراءة المفتاح.');
    }
  }

  return (
    <>
      <form className="lookup-form" onSubmit={(event) => void lookup(event)}>
        <label>
          رقم الطلب
          <input
            type="text"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder="DA-2026-00001"
            dir="ltr"
            required
          />
        </label>
        <button type="submit">ابحث</button>
      </form>

      {lines && lines.length === 0 ? <p className="notice">لا بنود في هذا الطلب.</p> : null}

      {(lines ?? []).map((line) => (
        <div key={line.orderItemId} className="key-line">
          <p className="queue-product">{line.productName}</p>
          <p className="slug" dir="ltr">
            {line.sku} · {line.state}
            {line.deliveredAt ? ` · سُلّم ${line.deliveredAt.slice(0, 16).replace('T', ' ')}` : ''}
          </p>

          {line.keys.length === 0 ? (
            <p className="meta">لا مفتاح مرتبط بهذا البند.</p>
          ) : (
            <ul className="key-list">
              {line.keys.map((key) => (
                <li key={key.licenseKeyId}>
                  <span className="slug" dir="ltr">
                    {key.licenseKeyId}
                  </span>
                  <span className="pill pill-draft">{key.state}</span>

                  {canReveal ? (
                    <>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => void reveal(key.licenseKeyId)}
                      >
                        اقرأ المفتاح
                      </button>
                      <button
                        type="button"
                        className="linky"
                        onClick={() => {
                          void api
                            .keyHistory(key.licenseKeyId)
                            .then((rows) => setHistory({ id: key.licenseKeyId, rows }))
                            .catch(() => onError('تعذّر تحميل سجل المفتاح.'));
                        }}
                      >
                        السجل
                      </button>
                    </>
                  ) : null}

                  {shown?.id === key.licenseKeyId ? (
                    <div className="revealed">
                      {/* Labelled, not run together. Reading a password back to
                          a customer off a screen that does not say which half
                          is which is how the wrong half gets read out. */}
                      <div className="revealed-parts">
                        {shown.secret.kind === 'ACCOUNT_CREDENTIALS' ? (
                          <>
                            <p>
                              <span>اسم المستخدم</span>
                              <strong dir="ltr">{shown.secret.username}</strong>
                            </p>
                            <p>
                              <span>كلمة المرور</span>
                              <strong dir="ltr">{shown.secret.password}</strong>
                            </p>
                          </>
                        ) : (
                          <p>
                            <span>مفتاح التفعيل</span>
                            <strong dir="ltr">{shown.secret.key}</strong>
                          </p>
                        )}
                      </div>
                      <button type="button" className="linky" onClick={() => setShown(null)}>
                        أخفِ
                      </button>
                    </div>
                  ) : null}

                  {history?.id === key.licenseKeyId ? (
                    <ul className="key-history">
                      {history.rows.map((entry, index) => (
                        <li key={`${entry.createdAt}-${String(index)}`}>
                          {entry.action} · {entry.createdAt.slice(0, 16).replace('T', ' ')}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {canReveal && lines && lines.length > 0 ? (
        <label className="reason-field">
          سبب القراءة — يُسجَّل مع اسمك ووقتك
          <input
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="العميل يقول إن المفتاح لا يُفعَّل"
          />
        </label>
      ) : null}

      {stepUp ? (
        <form
          className="paste-form stepup"
          onSubmit={(event) => {
            event.preventDefault();
            void api
              .stepUp(totp)
              .then(() => reveal(stepUp.keyId))
              .catch((caught: unknown) => {
                onError(caught instanceof Error ? caught.message : 'رمز غير صحيح.');
              });
          }}
        >
          <label>
            أدخل رمز المصادقة لقراءة المفتاح
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={totp}
              onChange={(event) => setTotp(event.target.value.replace(/\D/g, ''))}
              className="code-input"
              dir="ltr"
              autoFocus
              required
            />
            <small>
              مرّ أكثر من ربع ساعة على آخر تحقّق. التسجيل يثبت من أنت؛ هذا الرمز يثبت أنك على
              المفاتيح الآن.
            </small>
          </label>
          <button type="submit" disabled={totp.length !== 6}>
            تحقّق واقرأ
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setStepUp(null);
              setTotp('');
              onNote('أُلغيت القراءة.');
            }}
          >
            إلغاء
          </button>
        </form>
      ) : null}
    </>
  );
}

/** What the customer will receive, in two words. */
function kindLabel(kind: CredentialKind): string {
  return kind === 'ACCOUNT_CREDENTIALS' ? 'مستخدم وكلمة مرور' : 'مفتاح تفعيل';
}
