'use client';

import type { RenewalSettings, RenewalStats } from '@da/contracts';
import { useEffect, useState } from 'react';

import { useT } from '../../../i18n/provider';
import { api } from '../../../lib/api';
import { messageOf, useStaff } from '../../content/shared';
import { Nav } from '../../nav';
import { MARKETING_ROLES } from '../page';
import {
  BackLink,
  type FieldErrors,
  LiftPanel,
  NumberField,
  SaveBar,
  TextField,
  numberError,
  useFeatureSettings,
  usd,
  wholeError,
} from '../retention-shared';

/**
 * تذكير التجديد — when reminders go, whether a renewal discount rides along,
 * and what the reminders have done in the last month.
 *
 * Numbers are edited as text and parsed on save, so a half-typed "1" on the
 * way to "14" is not rejected mid-keystroke; every field says what is wrong
 * with it in words before anything is sent.
 */
interface Draft {
  enabled: boolean;
  daysBefore: string;
  daysAfter: string;
  discountPercent: string;
  discountLicenceNumber: string;
  holdoutPercent: string;
}

function toDraft(settings: RenewalSettings): Draft {
  return {
    enabled: settings.enabled,
    daysBefore: settings.daysBefore.join(', '),
    daysAfter: String(settings.daysAfter),
    discountPercent: String(settings.discountPercent),
    discountLicenceNumber: settings.discountLicenceNumber,
    holdoutPercent: String(settings.holdoutPercent),
  };
}

function parseDays(raw: string): number[] | null {
  const parts = raw
    .split(/[,،\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 5) return null;
  const days = parts.map(Number);
  if (days.some((day) => !Number.isInteger(day) || day < 1 || day > 120)) return null;
  // Largest first, duplicates dropped: the order they are sent in.
  return [...new Set(days)].sort((a, b) => b - a);
}

export default function RenewalsPage() {
  const me = useStaff();
  const t = useT('marketingRetention');
  const c = useT('common');
  const { stored, error, setError, note, setNote, saving, save } = useFeatureSettings(
    'renewals',
    me,
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [stats, setStats] = useState<RenewalStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    if (stored) setDraft(toDraft(stored));
  }, [stored]);

  useEffect(() => {
    if (!me || !MARKETING_ROLES.includes(me.role)) return;
    void api
      .renewalStats()
      .then(setStats)
      .catch((caught: unknown) => setStatsError(messageOf(caught, t('statsFailed'))));
  }, [me, t]);

  if (!me) return <div className="admin-layout">{c('loading')}</div>;
  const allowed = MARKETING_ROLES.includes(me.role);

  const dirty =
    draft !== null && stored !== null && JSON.stringify(draft) !== JSON.stringify(toDraft(stored));

  function patch(next: Partial<Draft>): void {
    setDraft((current) => (current ? { ...current, ...next } : current));
    setNote(null);
  }

  function validate(value: Draft): { errors: FieldErrors; settings: RenewalSettings | null } {
    const found: FieldErrors = {
      daysBefore: parseDays(value.daysBefore) ? undefined : t('errDaysBefore'),
      daysAfter: wholeError(value.daysAfter, 0, 60, t),
      discountPercent: numberError(value.discountPercent, 0, 90, t),
      holdoutPercent: wholeError(value.holdoutPercent, 0, 50, t),
    };
    if (Object.values(found).some(Boolean)) return { errors: found, settings: null };
    return {
      errors: {},
      settings: {
        enabled: value.enabled,
        daysBefore: parseDays(value.daysBefore) ?? [],
        daysAfter: Number(value.daysAfter),
        discountPercent: Number(value.discountPercent),
        discountLicenceNumber: value.discountLicenceNumber.trim(),
        holdoutPercent: Number(value.holdoutPercent),
      },
    };
  }

  async function submit(): Promise<void> {
    if (!draft) return;
    const result = validate(draft);
    setErrors(result.errors);
    if (!result.settings) {
      setError(t('invalid'));
      return;
    }
    await save(result.settings);
  }

  const discountOn = draft ? Number(draft.discountPercent) > 0 : false;

  return (
    <Nav me={me} current="marketing">
      <BackLink />
      <div className="queue-head">
        <h1>{t('renewalsTitle')}</h1>
        <p className="who">{t('renewalsLede')}</p>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}
      {!allowed ? <p className="notice">{t('noAccess')}</p> : null}

      {allowed && draft ? (
        <section className="vault-section">
          <label className="pay-enable">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => patch({ enabled: event.target.checked })}
            />
            <span>{t('enabled')}</span>
          </label>
          <p className="lede-sm">{t('enabledHint')}</p>

          <div className="retention-grid">
            <NumberField
              id="r-days-before"
              label={t('daysBeforeLabel')}
              hint={t('daysBeforeHint')}
              value={draft.daysBefore}
              error={errors.daysBefore}
              disabled={saving}
              onChange={(daysBefore) => patch({ daysBefore })}
            />
            <NumberField
              id="r-days-after"
              label={t('daysAfterLabel')}
              hint={t('daysAfterHint')}
              value={draft.daysAfter}
              error={errors.daysAfter}
              disabled={saving}
              onChange={(daysAfter) => patch({ daysAfter })}
            />
            <NumberField
              id="r-discount"
              label={t('discountLabel')}
              hint={t('renewalDiscountHint')}
              value={draft.discountPercent}
              error={errors.discountPercent}
              disabled={saving}
              step="any"
              onChange={(discountPercent) => patch({ discountPercent })}
            />
            <TextField
              id="r-licence"
              label={t('licenceLabel')}
              hint={t('licenceHint')}
              value={draft.discountLicenceNumber}
              disabled={saving}
              onChange={(discountLicenceNumber) => patch({ discountLicenceNumber })}
            />
            <NumberField
              id="r-holdout"
              label={t('holdoutLabel')}
              hint={t('holdoutHint')}
              value={draft.holdoutPercent}
              error={errors.holdoutPercent}
              disabled={saving}
              onChange={(holdoutPercent) => patch({ holdoutPercent })}
            />
          </div>
          {discountOn && !draft.discountLicenceNumber.trim() ? (
            <p className="notice notice-warn">{t('licenceMissing')}</p>
          ) : null}
        </section>
      ) : null}

      {allowed ? (
        <section className="vault-section">
          <h2>{t('statsTitle')}</h2>
          {statsError ? <p className="error">{statsError}</p> : null}
          {stats ? (
            <>
              <p className="lede-sm">{t('statsWindow', { days: stats.windowDays })}</p>
              {stats.sentByOffset.length === 0 ? (
                <p className="notice">{t('statsEmpty')}</p>
              ) : (
                <table className="retention-table">
                  <thead>
                    <tr>
                      <th>{t('colReminder')}</th>
                      <th className="num">{t('colSent')}</th>
                      <th className="num">{t('colFailed')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.sentByOffset.map((row) => (
                      <tr key={row.offsetDays}>
                        <td>
                          {row.offsetDays >= 0
                            ? t('offsetBefore', { days: row.offsetDays })
                            : t('offsetAfter', { days: -row.offsetDays })}
                        </td>
                        <td className="num">{row.sent}</td>
                        <td className="num">{row.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="meta">{t('withCode', { count: stats.withCode })}</p>
              <div className="retention-kpis">
                <div>
                  <span className="meta">{t('renewedOrders')}</span>
                  <strong>{stats.renewedOrders}</strong>
                </div>
                <div>
                  <span className="meta">{t('renewedRevenue')}</span>
                  <strong dir="ltr">{usd(stats.renewedRevenueUsd, t.locale)}</strong>
                </div>
              </div>
              <LiftPanel lift={stats.lift} holdoutPercent={stored?.holdoutPercent ?? 0} />
            </>
          ) : !statsError ? (
            <p className="meta">{c('loading')}</p>
          ) : null}
        </section>
      ) : null}

      {allowed && draft ? (
        <SaveBar dirty={dirty} saving={saving} canSave={allowed} onSave={() => void submit()} />
      ) : null}
    </Nav>
  );
}
