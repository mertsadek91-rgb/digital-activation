'use client';

import type { AdminReferralList } from '@da/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../../i18n/provider';
import { growthApi } from '../../../lib/growth-api';
import { messageOf, useStaff } from '../../content/shared';
import { Nav } from '../../nav';
import { GROWTH_ROLES, NumberField, useFeatureSettings } from '../growth-settings';

const STATUS_TONE: Record<AdminReferralList['rows'][number]['status'], string> = {
  ISSUED: 'pill-draft',
  PENDING: 'pill-ready',
  REWARDED: 'pill-published',
  VOID: 'pill-blocked',
};

/**
 * Referrals: the programme's numbers, and every referred friend with where
 * their referral stands.
 *
 * A row with flags (a shared IP, a shared private email domain) is not paid by
 * the daily sweep until somebody here approves it — or rejects it, which voids
 * it. Everything else pays itself once the refund window has passed.
 */
export default function ReferralMarketingPage() {
  const me = useStaff();
  const t = useT('marketingReferral');
  const m = useT('marketing');
  const c = useT('common');
  const allowed = me ? GROWTH_ROLES.includes(me.role) : false;
  const { draft, patch, save, saving, saved, error } = useFeatureSettings('referral', allowed);
  const [list, setList] = useState<AdminReferralList | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await growthApi.referrals());
      setListError(null);
    } catch (caught) {
      setListError(messageOf(caught, c('actionFailed')));
    }
  }, [c]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  async function act(id: string, action: 'approve' | 'reject'): Promise<void> {
    setBusy(id);
    try {
      if (action === 'approve') await growthApi.approveReferral(id);
      else await growthApi.rejectReferral(id);
      await load();
    } catch (caught) {
      setListError(messageOf(caught, c('actionFailed')));
    } finally {
      setBusy(null);
    }
  }

  if (!me) return <div className="admin-layout">{c('loading')}</div>;

  return (
    <Nav me={me} current="marketing">
      <div className="queue-head">
        <p className="meta">
          <Link href="/marketing">{m('title')}</Link>
        </p>
        <h1>{m('referralTitle')}</h1>
        <p className="who">{t('lede')}</p>
      </div>

      {!allowed ? <p className="notice">{m('noAccess')}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {draft ? (
        <form
          className="promo-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => patch({ enabled: event.target.checked })}
            />
            <span>{t('enabled')}</span>
          </label>
          <NumberField
            label={t('friendPercent')}
            hint={t('friendPercentHint')}
            value={draft.friendPercent}
            min={0}
            max={90}
            onChange={(friendPercent) => patch({ friendPercent })}
          />
          <NumberField
            label={t('referrerRewardUsd')}
            hint={t('referrerRewardHint')}
            value={draft.referrerRewardUsd}
            min={0}
            max={500}
            step={0.5}
            onChange={(referrerRewardUsd) => patch({ referrerRewardUsd })}
          />
          <NumberField
            label={t('clearAfterDays')}
            hint={t('clearAfterDaysHint')}
            value={draft.clearAfterDays}
            min={0}
            max={60}
            onChange={(clearAfterDays) => patch({ clearAfterDays })}
          />
          <label className="field">
            <span>{t('licenceNumber')}</span>
            <input
              dir="ltr"
              value={draft.licenceNumber}
              maxLength={100}
              onChange={(event) => patch({ licenceNumber: event.target.value })}
            />
            <small>{t('licenceNumberHint')}</small>
          </label>
          <div className="actions">
            <button type="submit" disabled={saving}>
              {saving ? c('busy') : c('save')}
            </button>
            {saved ? <span className="ok-note">{t('saved')}</span> : null}
          </div>
        </form>
      ) : null}

      {allowed ? (
        <section className="vault-section">
          <h2>{t('listTitle')}</h2>
          {listError ? <p className="error">{listError}</p> : null}
          {list ? (
            <>
              <dl className="growth-figures">
                <div>
                  <dt>{t('totalReferrers')}</dt>
                  <dd>{list.totals.referrers}</dd>
                </div>
                <div>
                  <dt>{t('totalIssued')}</dt>
                  <dd>{list.totals.issued}</dd>
                </div>
                <div>
                  <dt>{t('totalPending')}</dt>
                  <dd>{list.totals.pending}</dd>
                </div>
                <div>
                  <dt>{t('totalRewarded')}</dt>
                  <dd>{list.totals.rewarded}</dd>
                </div>
                <div>
                  <dt>{t('totalVoid')}</dt>
                  <dd>{list.totals.void}</dd>
                </div>
                <div>
                  <dt>{t('totalFlagged')}</dt>
                  <dd>{list.totals.flagged}</dd>
                </div>
                <div>
                  <dt>{t('totalFriendDiscount')}</dt>
                  <dd dir="ltr">${list.totals.friendDiscountUsd}</dd>
                </div>
                <div>
                  <dt>{t('totalRewards')}</dt>
                  <dd dir="ltr">${list.totals.rewardUsd}</dd>
                </div>
              </dl>

              {list.rows.length === 0 ? (
                <p className="notice">{t('none')}</p>
              ) : (
                <div className="table-scroll">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>{t('colStatus')}</th>
                        <th>{t('colReferrer')}</th>
                        <th>{t('colFriend')}</th>
                        <th>{t('colOrder')}</th>
                        <th className="num">{t('colDiscount')}</th>
                        <th className="num">{t('colReward')}</th>
                        <th>{t('colFlags')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {list.rows.map((row) => {
                        const open = row.status === 'ISSUED' || row.status === 'PENDING';
                        return (
                          <tr key={row.id}>
                            <td>
                              <span className={`pill ${STATUS_TONE[row.status]}`}>
                                {t(`status${row.status}`)}
                              </span>
                              {row.voidReason ? (
                                <div className="meta" dir="ltr">
                                  {row.voidReason}
                                </div>
                              ) : null}
                            </td>
                            <td>
                              <span dir="ltr">{row.referrerEmail}</span>
                              <div className="meta" dir="ltr">
                                {row.code}
                              </div>
                            </td>
                            <td dir="ltr">{row.friendEmail ?? c('none')}</td>
                            <td>
                              {row.orderNumber ? (
                                <>
                                  <span dir="ltr">{row.orderNumber}</span>
                                  <div className="meta">{row.orderStatus}</div>
                                </>
                              ) : (
                                c('none')
                              )}
                            </td>
                            <td className="num" dir="ltr">
                              {row.friendDiscountUsd ? `$${row.friendDiscountUsd}` : c('none')}
                            </td>
                            <td className="num" dir="ltr">
                              {row.rewardUsd ? `$${row.rewardUsd}` : c('none')}
                            </td>
                            <td dir="ltr">
                              {row.flags.length > 0 ? row.flags.join(', ') : c('none')}
                            </td>
                            <td>
                              {open ? (
                                <div className="actions">
                                  {row.status === 'PENDING' && row.flags.length > 0 ? (
                                    <button
                                      type="button"
                                      className="ghost"
                                      disabled={busy === row.id}
                                      onClick={() => void act(row.id, 'approve')}
                                    >
                                      {t('approve')}
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="ghost"
                                    disabled={busy === row.id}
                                    onClick={() => {
                                      if (window.confirm(t('rejectConfirm'))) {
                                        void act(row.id, 'reject');
                                      }
                                    }}
                                  >
                                    {t('reject')}
                                  </button>
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </section>
      ) : null}
    </Nav>
  );
}
