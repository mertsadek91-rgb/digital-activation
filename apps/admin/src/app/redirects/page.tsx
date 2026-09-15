'use client';

import type { NotFoundRow, RedirectRow, RedirectsView, StaffMe } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../../lib/api';
import { Nav } from '../nav';

/**
 * The redirect map, and the 404s it did not cover.
 *
 * Two lists on one screen because they are two halves of one job. The
 * generated map covers every URL the WordPress export knew about; what it
 * cannot know is every link anybody else ever published — an old forum post, a
 * printed invoice, a partner's page — and those arrive as 404s. Each one is a
 * redirect waiting to be written, and writing it here takes a click rather
 * than a developer.
 *
 * The 404 list is the one that matters in the fortnight after a cutover, so it
 * is first, sorted by how often each path was asked for, and it shows the
 * referrer: a path with a referrer is somebody's link, and a path with none is
 * usually a crawler guessing.
 */
export default function RedirectsPage() {
  const router = useRouter();
  const [me, setMe] = useState<StaffMe | null>(null);
  const [view, setView] = useState<RedirectsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await api.redirects());
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : 'تعذّر تحميل التوجيهات.');
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

  if (!me) return <div className="admin-layout">…</div>;

  const canWrite = ['OWNER', 'ADMIN', 'CATALOG'].includes(me.role);

  async function act(label: string, run: () => Promise<unknown>): Promise<void> {
    setError(null);
    setNote(null);
    try {
      await run();
      setNote(label);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر تنفيذ الإجراء.');
    }
  }

  // Generated rows are ninety-odd and rarely interesting; hand-written ones and
  // anything that has actually been followed are what a person came to see.
  const redirects = view?.redirects ?? [];
  const interesting = redirects.filter((row) => row.source === 'manual' || row.hits > 0);
  const shown = showAll ? redirects : interesting;

  return (
    <Nav me={me} current="redirects" >

      <div className="queue-head">
        <h1>التوجيهات</h1>
        <p className="who">
          {view
            ? `${String(view.counts.active)} توجيهاً فعّالاً من ${String(view.counts.redirects)}`
            : '…'}
          {view && view.counts.unresolved404 > 0 ? (
            <strong className="overdue-count"> · {view.counts.unresolved404} مسار بلا جواب</strong>
          ) : null}
        </p>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}
      {!canWrite ? (
        <p className="notice">
          دورك <strong>{me.role}</strong> يسمح بالقراءة دون تعديل التوجيهات.
        </p>
      ) : null}

      <section className="vault-section">
        <h2>مسارات بلا جواب</h2>
        <p className="lede-sm">
          روابط طُلبت ولم تُوجد. المسار الذي جاء من رابط خارجي يستحق توجيهاً؛ الذي بلا مصدر غالباً
          زاحف يجرّب.
        </p>

        {view && view.notFound.length === 0 ? (
          <p className="notice">لا شيء. كل ما طُلب وُجد أو وُجّه.</p>
        ) : (
          <ul className="notfound-list">
            {(view?.notFound ?? []).map((row) => (
              <NotFoundCard
                key={row.id}
                row={row}
                canWrite={canWrite}
                onCreate={(to) =>
                  void act(`وُجّه ${row.path}`, () => api.createRedirect(row.path, to, 301))
                }
                onDismiss={() => void act(`أُهمل ${row.path}`, () => api.resolveNotFound(row.id))}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="vault-section">
        <h2>الخريطة</h2>
        <p className="lede-sm">
          المولَّدة من الموقع القديم تُعاد كتابتها كلّما أعدت توليد الخريطة؛ المكتوبة يدوياً لا
          تُمَس.
        </p>

        <div className="store-bar">
          <label className="check">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(event) => setShowAll(event.target.checked)}
            />
            <span>
              اعرض المولَّدة أيضاً ({String(redirects.length - interesting.length)} لم تُتبَع بعد)
            </span>
          </label>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>من</th>
                <th>إلى</th>
                <th className="num">زيارات</th>
                <th>المصدر</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <RedirectRowView
                  key={row.id}
                  row={row}
                  canWrite={canWrite}
                  onToggle={() =>
                    void act(row.isActive ? `أُوقف ${row.from}` : `فُعّل ${row.from}`, () =>
                      api.updateRedirect(row.id, { isActive: !row.isActive }),
                    )
                  }
                  onRetarget={(to) =>
                    void act(`عُدّل ${row.from}`, () => api.updateRedirect(row.id, { to }))
                  }
                />
              ))}
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="meta">
                    لا توجيه مكتوب يدوياً ولا مولَّد تم اتّباعه بعد.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </Nav>
  );
}

function NotFoundCard({
  row,
  canWrite,
  onCreate,
  onDismiss,
}: {
  row: NotFoundRow;
  canWrite: boolean;
  onCreate: (to: string) => void;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');

  return (
    <li className="notfound-row">
      <div>
        <p className="slug" dir="ltr">
          {row.path}
        </p>
        <p className="meta">
          {row.hits} مرّة · آخرها {row.lastSeenAt.slice(0, 16).replace('T', ' ')}
          {row.referer ? (
            <>
              {' · من '}
              <span dir="ltr">{row.referer}</span>
            </>
          ) : (
            ' · بلا مصدر'
          )}
        </p>
      </div>

      {canWrite ? (
        <div className="actions">
          <button type="button" onClick={() => setOpen(!open)}>
            {open ? 'إلغاء' : 'وجّهه'}
          </button>
          <button type="button" className="ghost" onClick={onDismiss}>
            أهمله
          </button>
        </div>
      ) : null}

      {open ? (
        <form
          className="paste-form"
          onSubmit={(event) => {
            event.preventDefault();
            onCreate(to.trim());
            setTo('');
            setOpen(false);
          }}
        >
          <label className="grow">
            إلى أين؟
            <input
              type="text"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              dir="ltr"
              required
              placeholder="/store/windows-11-pro"
            />
            <small>مسار في هذا الموقع. الرابط الكامل يُقبل ويُختصر إلى مساره.</small>
          </label>
          <button type="submit" disabled={to.trim().length < 2}>
            احفظ التوجيه
          </button>
        </form>
      ) : null}
    </li>
  );
}

function RedirectRowView({
  row,
  canWrite,
  onToggle,
  onRetarget,
}: {
  row: RedirectRow;
  canWrite: boolean;
  onToggle: () => void;
  onRetarget: (to: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [to, setTo] = useState(row.to);

  return (
    <>
      <tr className={row.isActive ? undefined : 'is-settled'}>
        <td>
          <span className="slug" dir="ltr">
            {row.from}
          </span>
        </td>
        <td>
          <span className="slug" dir="ltr">
            {row.to}
          </span>
          {row.code !== 301 ? <span className="meta"> · {row.code}</span> : null}
        </td>
        <td className="num">{row.hits}</td>
        <td>
          <span className={`pill ${row.source === 'manual' ? 'pill-ready' : 'pill-draft'}`}>
            {row.source === 'manual' ? 'يدوي' : 'مولَّد'}
          </span>
        </td>
        <td className="actions">
          {canWrite ? (
            <>
              <button type="button" className="ghost" onClick={() => setEditing(!editing)}>
                {editing ? 'إلغاء' : 'عدّل'}
              </button>
              <button type="button" className="ghost" onClick={onToggle}>
                {row.isActive ? 'أوقف' : 'فعّل'}
              </button>
            </>
          ) : null}
        </td>
      </tr>

      {editing ? (
        <tr className="drawer">
          <td colSpan={5}>
            <form
              className="paste-form"
              onSubmit={(event) => {
                event.preventDefault();
                onRetarget(to.trim());
                setEditing(false);
              }}
            >
              <label className="grow">
                الوجهة الجديدة
                <input
                  type="text"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  dir="ltr"
                  required
                />
              </label>
              <button type="submit" disabled={to.trim().length < 2 || to.trim() === row.to}>
                احفظ
              </button>
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}
