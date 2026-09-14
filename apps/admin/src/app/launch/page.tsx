'use client';

import type { LaunchCheck, LaunchReadiness, StaffMe } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../../lib/api';
import { Nav } from '../nav';

/**
 * What stands between this store and its first order.
 *
 * The panel had nine screens, each answering its own question well, and none
 * answering the one somebody opening a store that has not sold anything yet
 * actually asks. The default page goes to the supplier queue — right for a
 * running shop, where every line in it is a customer who has paid, and exactly
 * nothing before the first sale, when the queue is empty by definition and
 * says nothing about why.
 *
 * Every signal on this page already existed and was readable one screen at a
 * time. Gathering them is the whole contribution: nobody should have to visit
 * four screens and know which four.
 *
 * Blockers first and separately, because the distinction is the point. With no
 * payment method the checkout has nothing to show and no order can be placed
 * however good the catalog is. A thin catalog is a different kind of problem,
 * and a list that mixed them is a list nobody finishes.
 */
const SEVERITY_PILL: Record<LaunchCheck['severity'], string> = {
  blocker: 'pill-blocked',
  warning: 'pill-draft',
  ready: 'pill-published',
};

const SEVERITY_LABEL: Record<LaunchCheck['severity'], string> = {
  blocker: 'مانع',
  warning: 'تنبيه',
  ready: 'جاهز',
};

export default function LaunchPage() {
  const router = useRouter();
  const [me, setMe] = useState<StaffMe | null>(null);
  const [data, setData] = useState<LaunchReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.launch());
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : 'تعذّر قراءة حالة المتجر.');
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

  const blockers = (data?.checks ?? []).filter((check) => check.severity === 'blocker');
  const warnings = (data?.checks ?? []).filter((check) => check.severity === 'warning');
  const ready = (data?.checks ?? []).filter((check) => check.severity === 'ready');

  return (
    <main className="shell">
      <Nav me={me} current="launch" />

      <div className="queue-head">
        <h1>حالة المتجر</h1>
        <p className="who">
          {data
            ? data.canSell
              ? 'المتجر يستطيع استقبال طلب الآن.'
              : `${String(blockers.length)} مانع يقف بين المتجر وأول طلب.`
            : '…'}
        </p>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {/*
        The headline answer, stated once and plainly. Everything below it is
        the detail behind this sentence.
      */}
      {data ? (
        <p className={`launch-verdict${data.canSell ? ' is-ready' : ''}`}>
          {data.canSell
            ? 'يمكن شراء منتج من هذا المتجر الآن: هناك طريقة دفع معروضة ومنتج منشور والخزنة تستجيب.'
            : 'لا يمكن إتمام عملية شراء الآن. الموانع أدناه تُصلَح كلٌّ منها في شاشة واحدة.'}
        </p>
      ) : null}

      {blockers.length > 0 ? (
        <section className="vault-section">
          <h2>موانع</h2>
          <ul className="launch-list">
            {blockers.map((check) => (
              <CheckRow key={check.key} check={check} onGo={(path) => router.push(path)} />
            ))}
          </ul>
        </section>
      ) : null}

      {warnings.length > 0 ? (
        <section className="vault-section">
          <h2>تنبيهات</h2>
          <p className="lede-sm">
            لا يمنع أيٌّ منها البيع. كلٌّ منها شيء يُكلِّف لاحقاً أكثر ممّا يُكلِّف الآن.
          </p>
          <ul className="launch-list">
            {warnings.map((check) => (
              <CheckRow key={check.key} check={check} onGo={(path) => router.push(path)} />
            ))}
          </ul>
        </section>
      ) : null}

      {ready.length > 0 ? (
        <section className="vault-section">
          <h2>جاهز</h2>
          <ul className="launch-list">
            {ready.map((check) => (
              <CheckRow key={check.key} check={check} onGo={(path) => router.push(path)} />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function CheckRow({ check, onGo }: { check: LaunchCheck; onGo: (path: string) => void }) {
  return (
    <li className={`launch-row is-${check.severity}`}>
      <div>
        <p className="launch-title">
          <span className={`pill ${SEVERITY_PILL[check.severity]}`}>
            {SEVERITY_LABEL[check.severity]}
          </span>
          <strong>{check.title}</strong>
        </p>
        {/* Left to right where it is a list of provider reasons, which are
            mostly Latin names with Arabic sentences hanging off them. */}
        <p className="launch-detail">{check.detail}</p>
      </div>

      {/* Only where the fix is in this panel. A button that goes nowhere is
          worse than a sentence that says where to go. */}
      {check.fix ? (
        <button type="button" onClick={() => onGo(check.fix ?? '/')}>
          افتح الشاشة
        </button>
      ) : null}
    </li>
  );
}
