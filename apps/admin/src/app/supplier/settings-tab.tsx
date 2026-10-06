'use client';

import type { SupplierRounding, SupplierSourceView, SupplierSyncResult } from '@da/contracts';
import { useState } from 'react';

import { useAdminLocale, useT } from '../../i18n/provider';
import { supplierApi } from '../../lib/supplier-api';

import { formatWhen } from './format';

const ROUNDINGS: SupplierRounding[] = ['CENTS', 'END_99', 'WHOLE'];

export function SettingsTab({
  source,
  isAdmin,
  onSaved,
  onSynced,
}: {
  source: SupplierSourceView | null;
  isAdmin: boolean;
  onSaved: (source: SupplierSourceView) => void;
  onSynced: () => void;
}) {
  const t = useT('supplier');
  const locale = useAdminLocale();
  const [name, setName] = useState(source?.name ?? 'Tikeys');
  const [url, setUrl] = useState(source?.url ?? '');
  const [markup, setMarkup] = useState(source ? String(Number(source.markupPercent)) : '50');
  const [rounding, setRounding] = useState<SupplierRounding>(source?.rounding ?? 'CENTS');
  const [autoSync, setAutoSync] = useState(source?.autoSync ?? true);
  const [busy, setBusy] = useState<'save' | 'sync' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy('save');
    setError(null);
    setNote(null);
    try {
      const saved = await supplierApi.setSource({
        name: name.trim() || 'Supplier',
        url: url.trim(),
        markupPercent: Number(markup),
        rounding,
        autoSync,
      });
      onSaved(saved);
      setNote(t('saved'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  async function sync(force = false) {
    if (force && !window.confirm(t('confirmForce'))) return;
    setBusy('sync');
    setError(null);
    setNote(null);
    try {
      const result = await supplierApi.sync(force);
      setRefused(result.status === 'REFUSED');
      const message = describeSync(result, t);
      if (result.status === 'OK' || result.status === 'UNCHANGED') setNote(message);
      else setError(message);
      onSynced();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="supplier-settings">
      <section className="card">
        <h2>{t('settingsHeading')}</h2>
        {!source ? <p className="notice">{t('notConnected')}</p> : null}
        {source && !source.readerConfigured ? <p className="notice">{t('readerMissing')}</p> : null}
        {!isAdmin ? <p className="notice">{t('adminOnly')}</p> : null}

        <form className="supplier-form" onSubmit={(event) => void save(event)}>
          <label className="field">
            <span>{t('fieldUrl')}</span>
            <input
              type="url"
              dir="ltr"
              required
              value={url}
              disabled={!isAdmin}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0"
            />
          </label>
          <div className="supplier-form-row">
            <label className="field">
              <span>{t('fieldName')}</span>
              <input
                value={name}
                disabled={!isAdmin}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="field">
              <span>{t('fieldMarkup')}</span>
              <input
                type="number"
                min={0}
                max={1000}
                step="0.01"
                dir="ltr"
                value={markup}
                disabled={!isAdmin}
                onChange={(event) => setMarkup(event.target.value)}
              />
              <small className="meta">{t('markupHint')}</small>
            </label>
            <label className="field">
              <span>{t('fieldRounding')}</span>
              <select
                value={rounding}
                disabled={!isAdmin}
                onChange={(event) => setRounding(event.target.value as SupplierRounding)}
              >
                {ROUNDINGS.map((value) => (
                  <option key={value} value={value}>
                    {t(`round${value}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="check supplier-check">
            <input
              type="checkbox"
              checked={autoSync}
              disabled={!isAdmin}
              onChange={(event) => setAutoSync(event.target.checked)}
            />
            <span>{t('fieldAutoSync')}</span>
          </label>
          {isAdmin ? (
            <div className="supplier-actions">
              <button type="submit" disabled={busy !== null}>
                {t('saveSettings')}
              </button>
            </div>
          ) : null}
        </form>
      </section>

      {source ? (
        <section className="card">
          <div className="supplier-sync">
            <div>
              <p>
                {source.lastSyncAt
                  ? t('lastSync', { when: formatWhen(source.lastSyncAt, locale) })
                  : t('neverSynced')}{' '}
                {source.lastSyncStatus ? (
                  <span className={`pill ${statusPill(source.lastSyncStatus)}`}>
                    {t(`status${source.lastSyncStatus}` as 'statusOK')}
                  </span>
                ) : null}
              </p>
              {source.sheetUpdatedLabel ? (
                <p className="meta">{t('sheetUpdated', { date: source.sheetUpdatedLabel })}</p>
              ) : null}
              {source.lastSyncError ? <p className="error">{source.lastSyncError}</p> : null}
            </div>
            <div className="supplier-actions">
              <a className="as-button ghost" href={source.url} target="_blank" rel="noreferrer">
                {t('openSheet')}
              </a>
              <button type="button" disabled={busy !== null} onClick={() => void sync()}>
                {busy === 'sync' ? t('syncing') : t('syncNow')}
              </button>
              {isAdmin && (refused || source.lastSyncStatus === 'REFUSED') ? (
                <button
                  type="button"
                  className="btn-danger-soft"
                  disabled={busy !== null}
                  onClick={() => void sync(true)}
                >
                  {t('syncForce')}
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}

      <section className="card supplier-rules">
        <h2>{t('rulesHeading')}</h2>
        <ul>
          <li>{t('rule1')}</li>
          <li>{t('rule2')}</li>
          <li>{t('rule3')}</li>
          <li>{t('rule4')}</li>
        </ul>
      </section>
    </div>
  );
}

export function statusPill(status: string): string {
  if (status === 'OK' || status === 'UNCHANGED') return 'pill-success';
  if (status === 'REFUSED') return 'pill-warning';
  if (status === 'RUNNING') return 'pill-info';
  return 'pill-danger';
}

function describeSync(result: SupplierSyncResult, t: ReturnType<typeof useT<'supplier'>>): string {
  const params = {
    rows: result.rowCount,
    added: result.added,
    changed: result.changed,
    removed: result.removed,
    switched: result.stockSwitched,
    error: result.error ?? '',
  };
  return t(`sync${result.status}`, params);
}
