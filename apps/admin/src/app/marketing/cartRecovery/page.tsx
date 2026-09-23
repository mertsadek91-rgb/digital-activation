'use client';

import type { CartRecoverySettings, CartRecoveryStats } from '@da/contracts';
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
 * السلال المتروكة — the ladder's rungs, the code a discounted rung mints,
 * quiet hours, and what the ladder has recovered in the last month.
 */
const MAX_STEPS = 4;

interface StepDraft {
  afterHours: string;
  discountPercent: string;
}

interface Draft {
  enabled: boolean;
  steps: StepDraft[];
  codeValidHours: string;
  discountLicenceNumber: string;
  quietFromHour: string;
  quietToHour: string;
  holdoutPercent: string;
}

function toDraft(settings: CartRecoverySettings): Draft {
  return {
    enabled: settings.enabled,
    steps: settings.steps.map((step) => ({
      afterHours: String(step.afterHours),
      discountPercent: String(step.discountPercent),
    })),
    codeValidHours: String(settings.codeValidHours),
    discountLicenceNumber: settings.discountLicenceNumber,
    quietFromHour: String(settings.quietFromHour),
    quietToHour: String(settings.quietToHour),
    holdoutPercent: String(settings.holdoutPercent),
  };
}

export default function CartRecoveryPage() {
  const me = useStaff();
  const t = useT('marketingRetention');
  const c = useT('common');
  const { stored, error, setError, note, setNote, saving, save } = useFeatureSettings(
    'cartRecovery',
    me,
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [stats, setStats] = useState<CartRecoveryStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    if (stored) setDraft(toDraft(stored));
  }, [stored]);

  useEffect(() => {
    if (!me || !MARKETING_ROLES.includes(me.role)) return;
    void api
      .cartRecoveryStats()
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

  function patchStep(index: number, next: Partial<StepDraft>): void {
    setDraft((current) =>
      current
        ? {
            ...current,
            steps: current.steps.map((step, at) => (at === index ? { ...step, ...next } : step)),
          }
        : current,
    );
    setNote(null);
  }

  function validate(value: Draft): { errors: FieldErrors; settings: CartRecoverySettings | null } {
    const found: FieldErrors = {
      codeValidHours: wholeError(value.codeValidHours, 1, 720, t),
      quietFromHour: wholeError(value.quietFromHour, 0, 23, t),
      quietToHour: wholeError(value.quietToHour, 0, 23, t),
      holdoutPercent: wholeError(value.holdoutPercent, 0, 50, t),
      steps: value.steps.length === 0 ? t('errNoSteps') : undefined,
    };
    let previous = 0;
    value.steps.forEach((step, index) => {
      const hours = numberError(step.afterHours, 0.5, 240, t) ? t('errAfterHours') : undefined;
      found[`step${String(index)}.afterHours`] = hours;
      found[`step${String(index)}.discountPercent`] = numberError(step.discountPercent, 0, 90, t);
      // Saved in the order they are sent, so the screen reads as the ladder.
      if (!hours) {
        const current = Number(step.afterHours);
        if (current <= previous) found[`step${String(index)}.afterHours`] = t('errStepOrder');
        previous = current;
      }
    });
    if (Object.values(found).some(Boolean)) return { errors: found, settings: null };
    return {
      errors: {},
      settings: {
        enabled: value.enabled,
        steps: value.steps.map((step) => ({
          afterHours: Number(step.afterHours),
          discountPercent: Number(step.discountPercent),
        })),
        codeValidHours: Number(value.codeValidHours),
        discountLicenceNumber: value.discountLicenceNumber.trim(),
        quietFromHour: Number(value.quietFromHour),
        quietToHour: Number(value.quietToHour),
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

  const discountOn = draft ? draft.steps.some((step) => Number(step.discountPercent) > 0) : false;

  return (
    <Nav me={me} current="marketing">
      <BackLink />
      <div className="queue-head">
        <h1>{t('cartTitle')}</h1>
        <p className="who">{t('cartLede')}</p>
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

          <h2>{t('stepsTitle')}</h2>
          <p className="lede-sm">{t('stepsHint')}</p>
          {errors.steps ? <p className="retention-error">{errors.steps}</p> : null}
          <div className="retention-steps">
            {draft.steps.map((step, index) => (
              <div className="retention-step" key={index}>
                <strong>{t('stepLabel', { n: index + 1 })}</strong>
                <NumberField
                  id={`c-step-${String(index)}-hours`}
                  label={t('afterHoursLabel')}
                  value={step.afterHours}
                  error={errors[`step${String(index)}.afterHours`]}
                  disabled={saving}
                  step="any"
                  onChange={(afterHours) => patchStep(index, { afterHours })}
                />
                <NumberField
                  id={`c-step-${String(index)}-discount`}
                  label={t('stepDiscountLabel')}
                  value={step.discountPercent}
                  error={errors[`step${String(index)}.discountPercent`]}
                  disabled={saving}
                  step="any"
                  onChange={(discountPercent) => patchStep(index, { discountPercent })}
                />
                <button
                  type="button"
                  className="ghost"
                  disabled={saving}
                  onClick={() => patch({ steps: draft.steps.filter((_, at) => at !== index) })}
                >
                  {t('removeStep')}
                </button>
              </div>
            ))}
          </div>
          {draft.steps.length < MAX_STEPS ? (
            <button
              type="button"
              className="ghost"
              disabled={saving}
              onClick={() => {
                const last = Number(draft.steps[draft.steps.length - 1]?.afterHours ?? 0);
                const next = Number.isFinite(last) && last > 0 ? Math.min(240, last * 2) : 1;
                patch({
                  steps: [...draft.steps, { afterHours: String(next), discountPercent: '0' }],
                });
              }}
            >
              {t('addStep')}
            </button>
          ) : null}

          <div className="retention-grid">
            <NumberField
              id="c-code-hours"
              label={t('codeValidHoursLabel')}
              hint={t('codeValidHoursHint')}
              value={draft.codeValidHours}
              error={errors.codeValidHours}
              disabled={saving}
              onChange={(codeValidHours) => patch({ codeValidHours })}
            />
            <TextField
              id="c-licence"
              label={t('licenceLabel')}
              hint={t('licenceHint')}
              value={draft.discountLicenceNumber}
              disabled={saving}
              onChange={(discountLicenceNumber) => patch({ discountLicenceNumber })}
            />
            <NumberField
              id="c-quiet-from"
              label={t('quietFromLabel')}
              hint={t('quietHint', { zone: stats?.timeZone ?? '…' })}
              value={draft.quietFromHour}
              error={errors.quietFromHour}
              disabled={saving}
              onChange={(quietFromHour) => patch({ quietFromHour })}
            />
            <NumberField
              id="c-quiet-to"
              label={t('quietToLabel')}
              value={draft.quietToHour}
              error={errors.quietToHour}
              disabled={saving}
              onChange={(quietToHour) => patch({ quietToHour })}
            />
            <NumberField
              id="c-holdout"
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
              {stats.sentByStage.every((row) => row.sent + row.heldOut === 0) ? (
                <p className="notice">{t('statsEmpty')}</p>
              ) : (
                <table className="retention-table">
                  <thead>
                    <tr>
                      <th>{t('colStep')}</th>
                      <th className="num">{t('colSent')}</th>
                      <th className="num">{t('colHeldOut')}</th>
                      <th className="num">{t('colClicked')}</th>
                      <th className="num">{t('colWithCode')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.sentByStage.map((row, index) => (
                      <tr key={row.stage}>
                        <td>{t('stepLabel', { n: index + 1 })}</td>
                        <td className="num">{row.sent}</td>
                        <td className="num">{row.heldOut}</td>
                        <td className="num">{row.clicked}</td>
                        <td className="num">{row.withCode}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="retention-kpis">
                <div>
                  <span className="meta">{t('recoveredOrders')}</span>
                  <strong>{stats.recoveredOrders}</strong>
                </div>
                <div>
                  <span className="meta">{t('recoveredRevenue')}</span>
                  <strong dir="ltr">{usd(stats.recoveredRevenueUsd, t.locale)}</strong>
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
