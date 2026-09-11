'use client';

import type { Queue, QueueRow, SecretInput, StaffMe } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../../lib/api';
import { Nav } from '../nav';

/**
 * The supplier queue.
 *
 * This is the screen the business actually runs on. Most of the catalog is made
 * to order, so every sale arrives here as a line somebody has to buy from a
 * supplier and hand back — and until this page existed that work lived in a
 * state nothing ever left.
 *
 * Designed around the one minute it takes to work a row: read what was bought,
 * copy the activation email if there is one, place the supplier order in
 * another tab, paste the code back. So the activation email is on the row with
 * a copy button rather than a click away, and the paste box opens in place.
 *
 * Lateness is measured against the window the product page promised, not a
 * fixed number, and an overdue row is loud. A queue where everything looks the
 * same is a queue where the customer who waited longest keeps waiting.
 */
const FAIL_REASONS = [
  'المورّد لا يملك المخزون',
  'سعر المورّد تغيّر',
  'بيانات التفعيل من العميل غير صحيحة',
  'المنتج أُوقف من الشركة المنتجة',
] as const;

export default function QueuePage() {
  const router = useRouter();
  const [me, setMe] = useState<StaffMe | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [includeDone, setIncludeDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setQueue(await api.queue(includeDone));
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : 'تعذّر تحميل الطابور.');
    }
  }, [includeDone, router]);

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

  const canWork = me !== null && ['OWNER', 'ADMIN', 'FULFILLMENT'].includes(me.role);

  async function act(label: string, run: () => Promise<unknown>): Promise<void> {
    setError(null);
    setDone(null);
    try {
      await run();
      setDone(label);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر تنفيذ الإجراء.');
    }
  }

  const overdue =
    queue?.rows.filter((row) => row.overdue && row.state !== 'DELIVERED' && row.state !== 'FAILED')
      .length ?? 0;

  if (!me) return <main className="shell">…</main>;

  return (
    <main className="shell">
      <Nav me={me} current="queue" {...(queue ? { waiting: queue.waiting, overdue } : {})} />

      <div className="queue-head">
        <h1>طابور التسليم</h1>
        <p className="who">
          {queue ? `${String(queue.waiting)} سطراً في الانتظار` : '…'}
          {overdue > 0 ? <strong className="overdue-count"> · {overdue} متأخّر</strong> : null}
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={includeDone}
            onChange={(event) => setIncludeDone(event.target.checked)}
          />
          <span>اعرض المُسلَّم والمتعذّر</span>
        </label>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {done ? <p className="ok-note">{done}</p> : null}
      {!canWork ? (
        <p className="notice">
          دورك <strong>{me.role}</strong> لا يسمح بالعمل على الطابور.
        </p>
      ) : null}

      {queue && queue.rows.length === 0 ? (
        <p className="notice">لا شيء في الانتظار. كل الطلبات المدفوعة سُلّمت.</p>
      ) : null}

      <ul className="queue-list">
        {(queue?.rows ?? []).map((row) => (
          <QueueCard
            key={row.orderItemId}
            row={row}
            canWork={canWork}
            onFulfil={(secret, cost) =>
              void act(`سُلّم ${row.sku}`, () => api.fulfil(row.orderItemId, secret, cost))
            }
            onDeliver={() => void act(`أُرسل ${row.sku}`, () => api.deliver(row.orderItemId))}
            onFail={(reason) =>
              void act(`وُسم ${row.sku} كمتعذّر`, () => api.failLine(row.orderItemId, reason))
            }
          />
        ))}
      </ul>
    </main>
  );
}

function QueueCard({
  row,
  canWork,
  onFulfil,
  onDeliver,
  onFail,
}: {
  row: QueueRow;
  canWork: boolean;
  onFulfil: (secret: SecretInput, costUsd?: string) => void;
  onDeliver: () => void;
  onFail: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  // Account lines. Kept beside `code` rather than reusing it: a password typed
  // into a field labelled "key" is the mistake this whole split exists to stop.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [cost, setCost] = useState('');
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState<string>(FAIL_REASONS[0]);
  const [copied, setCopied] = useState<string | null>(null);

  const settled = row.state === 'DELIVERED' || row.state === 'FAILED';
  const isAccount = row.credentialKind === 'ACCOUNT_CREDENTIALS';

  async function copy(value: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // A blocked clipboard is not worth an error banner; the value is on
      // screen and selectable either way.
    }
  }

  return (
    <li className={`queue-card${row.overdue ? ' is-overdue' : ''}${settled ? ' is-settled' : ''}`}>
      <div className="queue-card-main">
        <p className="queue-order">
          <span dir="ltr">{row.orderNumber}</span>
          <span className={`pill ${statePill(row.state)}`}>{stateLabel(row.state)}</span>
          {row.overdue ? <span className="pill pill-blocked">متأخّر</span> : null}
        </p>

        <p className="queue-product">
          {row.productName}
          {row.qty > 1 ? <span className="meta"> × {row.qty}</span> : null}
        </p>
        <p className="slug" dir="ltr">
          {row.sku}
        </p>

        <dl className="queue-meta">
          <div>
            <dt>الانتظار</dt>
            <dd className={row.overdue ? 'is-late' : undefined}>
              {waitLabel(row.waitingSeconds)} / وُعد بـ{waitLabel(row.deliverySlaSeconds)}
            </dd>
          </div>
          <div>
            <dt>بريد الإيصال</dt>
            <dd dir="ltr">
              {row.email}
              <button
                type="button"
                className="linky"
                onClick={() => void copy(row.email, 'البريد')}
              >
                نسخ
              </button>
            </dd>
          </div>
          {/* The one field the supplier order cannot be placed without, so it
              sits on the row rather than a click away. */}
          {row.requiresActivationEmail ? (
            <div className="queue-activation">
              <dt>بريد التفعيل</dt>
              <dd dir="ltr">
                {row.activationEmail ?? '— لم يُسجّل —'}
                {row.activationEmail ? (
                  <button
                    type="button"
                    className="linky"
                    onClick={() => void copy(row.activationEmail ?? '', 'بريد التفعيل')}
                  >
                    نسخ
                  </button>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>

        {copied ? <p className="ok-note">نُسخ {copied}</p> : null}
      </div>

      {canWork && !settled ? (
        <div className="queue-actions">
          {/* A line that already has a key needs sending, not buying. Two
              different jobs, so two different buttons. */}
          {row.hasKey ? (
            <button type="button" className="btn-primary" onClick={onDeliver}>
              أرسل المفتاح
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={() => setOpen(!open)}>
              {open ? 'إلغاء' : isAccount ? 'أدخل بيانات الحساب' : 'ألصق كود المورّد'}
            </button>
          )}
          <button type="button" className="ghost" onClick={() => setFailing(!failing)}>
            تعذّر
          </button>
        </div>
      ) : null}

      {open ? (
        <form
          className="paste-form"
          onSubmit={(event) => {
            event.preventDefault();
            onFulfil(
              isAccount
                ? {
                    kind: 'ACCOUNT_CREDENTIALS',
                    username: username.trim(),
                    password: password.trim(),
                  }
                : { kind: 'ACTIVATION_KEY', key: code.trim() },
              cost.trim() || undefined,
            );
            setCode('');
            setUsername('');
            setPassword('');
            setCost('');
            setOpen(false);
          }}
        >
          {/* Two shapes, because the supplier sends two. An account pasted into
              one box would have to be split by guesswork somewhere, and the
              guess would be wrong on the passwords that contain a colon. */}
          {isAccount ? (
            <>
              <label className="grow">
                اسم المستخدم / البريد
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  dir="ltr"
                  required
                  minLength={3}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="account@example.com"
                />
              </label>
              <label className="grow">
                كلمة المرور
                {/* type=text on purpose: the person pasting it has to be able
                    to check it against what the supplier sent, and a masked
                    field is where a transposed character survives to the
                    customer. */}
                <input
                  type="text"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  dir="ltr"
                  required
                  minLength={4}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="كلمة المرور كما وردت"
                />
                <small>
                  يُشفّران معاً في الخزنة ويُرسَلان للعميل بعنوانَين منفصلَين في البريد. لن يُكتبا
                  في أي سجل.
                </small>
              </label>
            </>
          ) : (
            <label className="grow">
              كود المورّد
              <textarea
                value={code}
                onChange={(event) => setCode(event.target.value)}
                rows={3}
                dir="ltr"
                required
                minLength={4}
                // Nothing remembers this field. A browser that autofills a
                // licence key into the next order is a licence sold twice.
                autoComplete="off"
                spellCheck={false}
                placeholder="الصق الكود كما ورد من المورّد"
              />
              <small>
                يُشفّر في الخزنة ويُرسَل للعميل مباشرة. لن يُكتب في أي سجل، ولن يُعلَّم السطر
                مُسلَّماً إلا إذا خرج البريد فعلاً.
              </small>
            </label>
          )}
          <label>
            التكلفة (اختياري)
            <input
              type="text"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              placeholder="42.00"
              dir="ltr"
              pattern="\d+(\.\d{1,2})?"
            />
          </label>
          <button
            type="submit"
            disabled={
              isAccount
                ? username.trim().length < 3 || password.trim().length < 4
                : code.trim().length < 4
            }
          >
            حفظ وإرسال
          </button>
        </form>
      ) : null}

      {failing ? (
        <form
          className="paste-form"
          onSubmit={(event) => {
            event.preventDefault();
            onFail(reason);
            setFailing(false);
          }}
        >
          <label className="grow">
            السبب
            <select value={reason} onChange={(event) => setReason(event.target.value)}>
              {FAIL_REASONS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
            <small>سيُبلَّغ العميل بأن هذا البند تعذّر وأننا نتابعه.</small>
          </label>
          <button type="submit" className="ghost">
            تأكيد التعذّر
          </button>
        </form>
      ) : null}
    </li>
  );
}

function stateLabel(state: QueueRow['state']): string {
  switch (state) {
    case 'MANUAL_QUEUE':
      return 'يحتاج طلباً من المورّد';
    case 'AUTO_ASSIGNED':
      return 'مفتاح جاهز — يحتاج إرسالاً';
    case 'DELIVERED':
      return 'مُسلَّم';
    case 'FAILED':
      return 'متعذّر';
    default:
      return state;
  }
}

function statePill(state: QueueRow['state']): string {
  if (state === 'DELIVERED') return 'pill-published';
  if (state === 'FAILED') return 'pill-blocked';
  if (state === 'AUTO_ASSIGNED') return 'pill-ready';
  return 'pill-draft';
}

/** A wait in the units a person reads, not seconds. */
function waitLabel(seconds: number): string {
  if (seconds < 60) return 'أقل من دقيقة';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)} دقيقة`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return hours === 1 ? 'ساعة' : `${String(hours)} ساعات`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'يوم' : `${String(days)} أيام`;
}
