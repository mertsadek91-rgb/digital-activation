'use client';

import type { MarketingFeature, MarketingSettings } from '@da/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api, ApiError } from '../../lib/api';
import { messageOf, useStaff } from '../content/shared';
import { Nav } from '../nav';

/** Who may read and change marketing settings. OWNER passes the guard anyway. */
export const MARKETING_ROLES = ['OWNER', 'ADMIN', 'MARKETING'];

/**
 * The order the features are listed in: by what the research says they return
 * for this store, highest first, so the screen reads as a to-do list.
 */
const ORDER: MarketingFeature[] = [
  'trust',
  'renewals',
  'cartRecovery',
  'whatsapp',
  'offers',
  'reviewRequests',
  'business',
  'welcome',
  'seasonal',
  'referral',
  'socialProof',
];

/**
 * التسويق — every conversion feature, its state, and the way into its settings.
 *
 * Each feature starts off. The switch here flips `enabled` and keeps the rest
 * of the document as it is; the numbers behind a feature are set on its own
 * screen, where each field says what it does.
 */
export default function MarketingPage() {
  const router = useRouter();
  const me = useStaff();
  const t = useT('marketing');
  const c = useT('common');
  const [data, setData] = useState<MarketingSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<MarketingFeature | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.marketingSettings());
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
  const allowed = MARKETING_ROLES.includes(me.role);

  async function toggle(feature: MarketingFeature): Promise<void> {
    if (!data) return;
    const current = data[feature] as { enabled?: boolean };
    if (current.enabled === undefined) return;
    setBusy(feature);
    try {
      await api.setMarketingSettings(feature, {
        ...data[feature],
        enabled: !current.enabled,
      });
      await load();
    } catch (caught) {
      setError(messageOf(caught, c('actionFailed')));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Nav me={me} current="marketing">
      <div className="queue-head">
        <h1>{t('title')}</h1>
        <p className="who">{t('lede')}</p>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {!allowed ? <p className="notice">{t('noAccess')}</p> : null}

      {data && allowed ? (
        <div className="marketing-grid">
          {ORDER.map((feature) => {
            const settings = data[feature] as { enabled?: boolean };
            const switchable = settings.enabled !== undefined;
            const on = settings.enabled === true;
            return (
              <section key={feature} className={`marketing-card${on ? ' is-on' : ''}`}>
                <header>
                  <h2>{t(`${feature}Title`)}</h2>
                  {switchable ? (
                    <span className={`pill ${on ? 'pill-published' : 'pill-draft'}`}>
                      {on ? t('on') : t('off')}
                    </span>
                  ) : null}
                </header>
                <p>{t(`${feature}Body`)}</p>
                <div className="actions">
                  <Link href={`/marketing/${feature}`} className="button ghost">
                    {t('configure')}
                  </Link>
                  {switchable ? (
                    <button
                      type="button"
                      disabled={busy === feature}
                      onClick={() => void toggle(feature)}
                    >
                      {busy === feature ? c('busy') : on ? t('turnOff') : t('turnOn')}
                    </button>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
    </Nav>
  );
}
