'use client';

import type {
  WhatsappPurpose,
  WhatsappSettings,
  WhatsappStatus,
  WhatsappTemplate,
} from '@da/contracts';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../../i18n/provider';
import { api } from '../../../lib/api';
import { messageOf, useStaff } from '../../content/shared';
import { Nav } from '../../nav';
import { MARKETING_ROLES } from '../page';
import {
  BackLink,
  type FieldErrors,
  SaveBar,
  TextField,
  useFeatureSettings,
} from '../retention-shared';

/**
 * واتساب — whether the Cloud API is connected, which approved template each
 * purpose uses, whether WhatsApp replaces email for customers who agreed to
 * it, a test send, and the last month on the channel.
 *
 * The connection is read from the server's environment and shown as yes or
 * no. No secret reaches this page: the status endpoint only has booleans to
 * give.
 */

const TEMPLATE_NAME = /^[a-z0-9_]*$/;
const LANGUAGE = /^[a-z]{2,3}(_[A-Z]{2})?$/;

/** Who may press "send test". The API refuses everyone else anyway. */
const TEST_ROLES = ['OWNER', 'ADMIN'];

export default function WhatsappPage() {
  const me = useStaff();
  const t = useT('marketingWhatsapp');
  const c = useT('common');
  const { stored, error, setError, note, setNote, saving, save } = useFeatureSettings(
    'whatsapp',
    me,
  );
  const [draft, setDraft] = useState<WhatsappSettings | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<WhatsappStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [testTo, setTestTo] = useState('');
  const [testPurpose, setTestPurpose] = useState<WhatsappPurpose>('cartRecovery');
  const [testLocale, setTestLocale] = useState<'ar' | 'en'>('ar');
  const [testBusy, setTestBusy] = useState(false);
  const [testNote, setTestNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (stored) setDraft(stored);
  }, [stored]);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.whatsappStatus());
      setStatusError(null);
    } catch (caught) {
      setStatusError(messageOf(caught, t('statsFailedLoad')));
    }
  }, [t]);

  useEffect(() => {
    if (me && MARKETING_ROLES.includes(me.role)) void loadStatus();
  }, [me, loadStatus]);

  if (!me) return <div className="admin-layout">{c('loading')}</div>;
  const allowed = MARKETING_ROLES.includes(me.role);
  const canTest = TEST_ROLES.includes(me.role);
  const dirty =
    draft !== null && stored !== null && JSON.stringify(draft) !== JSON.stringify(stored);

  function patch(next: Partial<WhatsappSettings>): void {
    setDraft((current) => (current ? { ...current, ...next } : current));
    setNote(null);
  }

  function patchTemplate(purpose: WhatsappPurpose, next: Partial<WhatsappTemplate>): void {
    setDraft((current) =>
      current ? { ...current, [purpose]: { ...current[purpose], ...next } } : current,
    );
    setNote(null);
  }

  function validate(value: WhatsappSettings): FieldErrors {
    const found: FieldErrors = {};
    for (const purpose of ['cartRecovery', 'renewal'] as const) {
      const template = value[purpose];
      if (!TEMPLATE_NAME.test(template.templateName.trim())) {
        found[`${purpose}.templateName`] = t('errTemplateName');
      }
      if (!LANGUAGE.test(template.languageAr.trim())) {
        found[`${purpose}.languageAr`] = t('errLanguage');
      }
      if (!LANGUAGE.test(template.languageEn.trim())) {
        found[`${purpose}.languageEn`] = t('errLanguage');
      }
    }
    return found;
  }

  async function submit(): Promise<void> {
    if (!draft) return;
    const found = validate(draft);
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      setError(Object.values(found).find(Boolean) ?? null);
      return;
    }
    const trimmed = (template: WhatsappTemplate): WhatsappTemplate => ({
      templateName: template.templateName.trim(),
      languageAr: template.languageAr.trim(),
      languageEn: template.languageEn.trim(),
    });
    await save({
      ...draft,
      cartRecovery: trimmed(draft.cartRecovery),
      renewal: trimmed(draft.renewal),
    });
  }

  async function sendTest(): Promise<void> {
    setTestBusy(true);
    setTestNote(null);
    try {
      const result = await api.whatsappTest({
        to: testTo.trim(),
        purpose: testPurpose,
        locale: testLocale,
      });
      setTestNote(
        result.ok
          ? { ok: true, text: t('testSent', { id: result.messageId ?? '—' }) }
          : { ok: false, text: t('testFailed', { error: result.error ?? '—' }) },
      );
      void loadStatus();
    } catch (caught) {
      setTestNote({ ok: false, text: messageOf(caught, c('actionFailed')) });
    } finally {
      setTestBusy(false);
    }
  }

  const savedTemplate = stored?.[testPurpose].templateName ?? '';

  return (
    <Nav me={me} current="marketing">
      <BackLink />
      <div className="queue-head">
        <h1>{t('title')}</h1>
        <p className="who">{t('lede')}</p>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}
      {!allowed ? <p className="notice">{t('noAccess')}</p> : null}

      {allowed ? (
        <section className="vault-section">
          <h2>{t('connectionTitle')}</h2>
          {statusError ? <p className="error">{statusError}</p> : null}
          {status ? (
            <>
              <p className={status.configured ? 'ok-note' : 'notice notice-warn'}>
                {status.configured ? t('connected') : t('notConnected')}
              </p>
              <table className="retention-table">
                <tbody>
                  {(
                    [
                      ['envAccessToken', status.accessToken],
                      ['envPhoneNumberId', status.phoneNumberId],
                      ['envAppSecret', status.appSecret],
                      ['envVerifyToken', status.verifyToken],
                    ] as const
                  ).map(([key, set]) => (
                    <tr key={key}>
                      <td dir="ltr">
                        <code>{t(key)}</code>
                      </td>
                      <td>
                        <span className={`pill ${set ? 'pill-published' : 'pill-draft'}`}>
                          {set ? t('envSet') : t('envMissing')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="meta">{t('secretsNote')}</p>

              <h3>{t('webhookTitle')}</h3>
              {status.webhookUrl ? (
                <p dir="ltr">
                  <code>{status.webhookUrl}</code>
                </p>
              ) : (
                <p className="notice">{t('webhookUnknown')}</p>
              )}
              <p className="lede-sm">{t('webhookHint')}</p>
            </>
          ) : !statusError ? (
            <p className="meta">{c('loading')}</p>
          ) : null}
        </section>
      ) : null}

      {allowed && draft ? (
        <section className="vault-section">
          <h2>{t('settingsTitle')}</h2>
          <label className="pay-enable">
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={saving}
              onChange={(event) => patch({ enabled: event.target.checked })}
            />
            <span>{t('enabled')}</span>
          </label>
          <label className="pay-enable">
            <input
              type="checkbox"
              checked={draft.preferWhatsapp}
              disabled={saving}
              onChange={(event) => patch({ preferWhatsapp: event.target.checked })}
            />
            <span>{t('preferWhatsapp')}</span>
          </label>
          <p className="lede-sm">{t('preferHint')}</p>

          {(['cartRecovery', 'renewal'] as const).map((purpose) => (
            <div key={purpose}>
              <h3>
                {purpose === 'cartRecovery' ? t('cartTemplateTitle') : t('renewalTemplateTitle')}
              </h3>
              <div className="retention-grid">
                <TextField
                  id={`wa-${purpose}-name`}
                  label={t('templateName')}
                  hint={errors[`${purpose}.templateName`] ?? t('templateHint')}
                  value={draft[purpose].templateName}
                  disabled={saving}
                  onChange={(templateName) => patchTemplate(purpose, { templateName })}
                />
                <TextField
                  id={`wa-${purpose}-ar`}
                  label={t('languageAr')}
                  {...(errors[`${purpose}.languageAr`]
                    ? { hint: errors[`${purpose}.languageAr`] }
                    : {})}
                  value={draft[purpose].languageAr}
                  disabled={saving}
                  onChange={(languageAr) => patchTemplate(purpose, { languageAr })}
                />
                <TextField
                  id={`wa-${purpose}-en`}
                  label={t('languageEn')}
                  {...(errors[`${purpose}.languageEn`]
                    ? { hint: errors[`${purpose}.languageEn`] }
                    : {})}
                  value={draft[purpose].languageEn}
                  disabled={saving}
                  onChange={(languageEn) => patchTemplate(purpose, { languageEn })}
                />
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {allowed ? (
        <section className="vault-section">
          <h2>{t('testTitle')}</h2>
          <p className="lede-sm">{t('testHint')}</p>
          {!canTest ? (
            <p className="notice">{t('testAdminOnly')}</p>
          ) : (
            <>
              <div className="retention-grid">
                <TextField
                  id="wa-test-to"
                  label={t('testTo')}
                  hint="+966501234567"
                  value={testTo}
                  disabled={testBusy}
                  onChange={setTestTo}
                />
                <label className="retention-field" htmlFor="wa-test-purpose">
                  <span className="retention-label">{t('testPurpose')}</span>
                  <select
                    id="wa-test-purpose"
                    value={testPurpose}
                    disabled={testBusy}
                    onChange={(event) => setTestPurpose(event.target.value as WhatsappPurpose)}
                  >
                    <option value="cartRecovery">{t('purposeCartRecovery')}</option>
                    <option value="renewal">{t('purposeRenewal')}</option>
                  </select>
                </label>
                <label className="retention-field" htmlFor="wa-test-locale">
                  <span className="retention-label">{t('testLocale')}</span>
                  <select
                    id="wa-test-locale"
                    value={testLocale}
                    disabled={testBusy}
                    onChange={(event) => setTestLocale(event.target.value === 'en' ? 'en' : 'ar')}
                  >
                    <option value="ar">{t('localeAr')}</option>
                    <option value="en">{t('localeEn')}</option>
                  </select>
                </label>
              </div>
              {!savedTemplate ? <p className="notice">{t('testNeedsSave')}</p> : null}
              <button
                type="button"
                disabled={testBusy || !testTo.trim() || !savedTemplate || !status?.configured}
                onClick={() => void sendTest()}
              >
                {testBusy ? c('busy') : t('testSend')}
              </button>
              {testNote ? (
                <p className={testNote.ok ? 'ok-note' : 'error'} role="status">
                  {testNote.text}
                </p>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {allowed && status ? (
        <section className="vault-section">
          <h2>{t('statsTitle', { days: status.stats.windowDays })}</h2>
          <div className="retention-kpis">
            {(
              [
                ['statsSent', status.stats.sent],
                ['statsDelivered', status.stats.delivered],
                ['statsRead', status.stats.read],
                ['statsFailed', status.stats.failed],
                ['statsOptOuts', status.stats.optOuts],
              ] as const
            ).map(([key, value]) => (
              <div key={key}>
                <span className="meta">{t(key)}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {allowed && draft ? (
        <SaveBar dirty={dirty} saving={saving} canSave={allowed} onSave={() => void submit()} />
      ) : null}
    </Nav>
  );
}
