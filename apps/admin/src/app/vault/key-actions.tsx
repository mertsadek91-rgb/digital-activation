'use client';

import type { RevealResult } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useT } from '../../i18n/provider';
import { api, ApiError, type KeyHistoryRow, refreshSession } from '../../lib/api';

export type KeyAction = 'reveal' | 'revoke' | 'replace' | 'history';

/**
 * What a person can do with one key, wherever it is listed: the order's
 * lines tab (read it without copying the order number to the vault), and a
 * variant's stock list in the vault (read, revoke, or replace a key that was
 * pasted wrong).
 *
 * Every act that touches the key's value or takes it out of circulation asks
 * for a reason first, and the API answers 403 when the session's TOTP
 * challenge is older than a quarter of an hour: this asks for a code and
 * repeats the act, rather than sending the person back to the login. The
 * value is shown once, in place, until hidden; it is never kept anywhere else.
 */
export function KeyActions({
  licenseKeyId,
  state,
  actions,
  onChanged,
  onError,
  onNote,
}: {
  licenseKeyId: string;
  state: string;
  /** Which acts to offer here. The API enforces the role either way. */
  actions: readonly KeyAction[];
  /** After a revoke or a replace, so the list around it reloads. */
  onChanged?: () => void;
  onError: (message: string | null) => void;
  onNote: (message: string) => void;
}) {
  const router = useRouter();
  const t = useT('vault');
  const c = useT('common');
  const [form, setForm] = useState<'reveal' | 'revoke' | 'replace' | null>(null);
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [stepUp, setStepUp] = useState(false);
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<RevealResult | null>(null);
  const [history, setHistory] = useState<KeyHistoryRow[] | null>(null);
  // Kept here, beside the key it is about: the page's own banner is cleared
  // by the reload a replacement triggers, and this one must be read.
  const [warning, setWarning] = useState<string | null>(null);

  const offers = (action: KeyAction): boolean => actions.includes(action);
  const canRevoke = offers('revoke') && state !== 'REVOKED';
  const canReplace = offers('replace') && state === 'AVAILABLE';

  function close(): void {
    setForm(null);
    setReason('');
    setCode('');
    setStepUp(false);
    setTotp('');
  }

  async function act(): Promise<void> {
    if (!form) return;
    if (reason.trim().length < 3) {
      onError(t('reasonFirst'));
      return;
    }
    setBusy(true);
    try {
      if (form === 'reveal') {
        setShown(await api.revealKey(licenseKeyId, reason.trim()));
      } else if (form === 'revoke') {
        await api.revokeKey(licenseKeyId, reason.trim());
        onNote(t('revoked'));
        onChanged?.();
      } else {
        const result = await api.replaceKey(licenseKeyId, code.trim(), reason.trim());
        // The server says which happened: both, or the new key in and the old
        // one sold meanwhile (then the order it went to needs a look).
        if (result.revoked) onNote(t('replaced'));
        else setWarning(result.message);
        onChanged?.();
      }
      onError(null);
      close();
    } catch (caught) {
      // A stale challenge is the expected refusal: ask for a code, then repeat.
      if (
        caught instanceof ApiError &&
        caught.status === 403 &&
        caught.code === 'step_up_required'
      ) {
        setStepUp(true);
        return;
      }
      onError(caught instanceof Error ? caught.message : t('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode(): Promise<void> {
    try {
      await api.stepUp(totp);
      setStepUp(false);
      setTotp('');
      await act();
    } catch (caught) {
      // 401 is a wrong code or a dead session; one refresh tells them apart.
      if (caught instanceof ApiError && caught.status === 401 && !(await refreshSession())) {
        router.push('/login');
        return;
      }
      onError(caught instanceof Error ? caught.message : t('stepUpBadCode'));
    }
  }

  return (
    <div className="key-actions">
      <div className="key-actions__buttons">
        {offers('reveal') && !shown ? (
          <button type="button" className="ghost" onClick={() => setForm('reveal')}>
            {t('readKey')}
          </button>
        ) : null}
        {canReplace ? (
          <button type="button" className="ghost" onClick={() => setForm('replace')}>
            {t('replaceKey')}
          </button>
        ) : null}
        {canRevoke ? (
          <button type="button" className="ghost danger" onClick={() => setForm('revoke')}>
            {t('revokeKey')}
          </button>
        ) : null}
        {offers('history') ? (
          <button
            type="button"
            className="linky"
            onClick={() => {
              if (history) {
                setHistory(null);
                return;
              }
              void api
                .keyHistory(licenseKeyId)
                .then(setHistory)
                .catch(() => onError(t('historyFailed')));
            }}
          >
            {t('history')}
          </button>
        ) : null}
      </div>

      {form && !stepUp ? (
        <form
          className="paste-form key-actions__form"
          onSubmit={(event) => {
            event.preventDefault();
            void act();
          }}
        >
          {form === 'replace' ? (
            <>
              <p className="meta">{t('replaceHint')}</p>
              <label>
                {t('replaceCode')}
                <input
                  type="text"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>
            </>
          ) : null}
          {form === 'revoke' ? <p className="notice">{t('revokeWarning')}</p> : null}
          <label className="reason-field">
            {form === 'reveal' ? t('reasonLabel') : t('actionReasonLabel')}
            <input
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                form === 'reveal' ? t('reasonPlaceholder') : t('actionReasonPlaceholder')
              }
              dir="auto"
              minLength={3}
              maxLength={200}
              required
              autoFocus
            />
            <small>{t('reasonNoKey')}</small>
          </label>
          <div className="key-actions__buttons">
            <button type="submit" disabled={busy || reason.trim().length < 3}>
              {busy
                ? c('busy')
                : form === 'reveal'
                  ? t('actionReveal')
                  : form === 'revoke'
                    ? t('actionRevoke')
                    : t('actionReplace')}
            </button>
            <button type="button" className="ghost" onClick={close}>
              {c('cancel')}
            </button>
          </div>
        </form>
      ) : null}

      {stepUp ? (
        <form
          className="paste-form stepup"
          onSubmit={(event) => {
            event.preventDefault();
            void confirmCode();
          }}
        >
          <label>
            {t('stepUpLabel')}
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={totp}
              onChange={(event) => setTotp(event.target.value.replace(/\D/g, ''))}
              className="code-input"
              dir="ltr"
              autoComplete="one-time-code"
              autoFocus
              required
            />{' '}
            <small>{t('stepUpHint')}</small>
          </label>
          <button type="submit" disabled={totp.length !== 6 || busy}>
            {t('stepUpSubmit')}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              close();
              onNote(t('revealCancelled'));
            }}
          >
            {c('cancel')}
          </button>
        </form>
      ) : null}

      {warning ? (
        <p className="notice" role="alert" dir="auto">
          {warning}{' '}
          <button type="button" className="linky" onClick={() => setWarning(null)}>
            {c('hide')}
          </button>
        </p>
      ) : null}

      {shown ? (
        <div className="revealed">
          {/* Labelled, not run together: reading a password back to a
              customer off a screen that does not say which half is which is
              how the wrong half gets read out. */}
          <div className="revealed-parts">
            {shown.kind === 'ACCOUNT_CREDENTIALS' ? (
              <>
                <p>
                  <span>{t('revealUsername')}</span>
                  <strong dir="ltr">{shown.username}</strong>
                </p>
                <p>
                  <span>{t('revealPassword')}</span>
                  <strong dir="ltr">{shown.password}</strong>
                </p>
              </>
            ) : (
              <p>
                <span>{t('revealKey')}</span>
                <strong dir="ltr">{shown.key}</strong>
              </p>
            )}
          </div>
          <button type="button" className="linky" onClick={() => setShown(null)}>
            {c('hide')}
          </button>
        </div>
      ) : null}

      {history ? (
        <ul className="key-history">
          {history.map((entry, index) => (
            <li key={`${entry.createdAt}-${String(index)}`}>
              <span dir="ltr">
                {entry.action} · {entry.createdAt.slice(0, 16).replace('T', ' ')}
              </span>
              {entry.reason ? (
                <span className="meta" dir="auto">
                  {' '}
                  — {t('historyReason', { reason: entry.reason })}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
