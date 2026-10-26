'use client';

import {
  SUPPLIER_UPLOAD_MAX_BYTES,
  type SupplierRounding,
  type SupplierSourceView,
  type SupplierSyncResult,
} from '@da/contracts';
import { useRef, useState } from 'react';

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
  const [busy, setBusy] = useState<'save' | 'sync' | 'upload' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const [lastFile, setLastFile] = useState<{ fileName: string; data: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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
    if (!force) setLastFile(null);
    setBusy('sync');
    setError(null);
    setNote(null);
    try {
      // A refused upload is applied by sending the same file again with force.
      const result =
        force && lastFile
          ? await supplierApi.upload({ ...lastFile, force: true })
          : await supplierApi.sync(force);
      setRefused(result.status === 'REFUSED');
      const message = describeSync(result, t, force && lastFile !== null);
      if (result.status === 'OK' || result.status === 'UNCHANGED') setNote(message);
      else setError(message);
      onSynced();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  /** The supplier list as an .xlsx file, read exactly like the sheet (TASK-0133). */
  async function upload(file: File) {
    setError(null);
    setNote(null);
    setRefused(false);
    setLastFile(null);
    if (file.size > SUPPLIER_UPLOAD_MAX_BYTES) {
      setError(t('uploadTooLarge', { max: Math.round(SUPPLIER_UPLOAD_MAX_BYTES / 1024) }));
      return;
    }
    setBusy('upload');
    try {
      const sent = { fileName: file.name, data: await toBase64(file) };
      const result = await supplierApi.upload({ ...sent, force: false });
      if (result.status === 'REFUSED') setLastFile(sent);
      setRefused(result.status === 'REFUSED');
      const message = describeSync(result, t, true);
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
              {source.lastSyncError ? (
                <p className="error" role="alert" dir="auto">
                  {source.lastSyncError}
                </p>
              ) : null}
              <p className="meta">{t('uploadHint')}</p>
              {source.autoSync ? <p className="meta">{t('uploadAutoSyncOn')}</p> : null}
            </div>
            <div className="supplier-actions">
              <a className="as-button ghost" href={source.url} target="_blank" rel="noreferrer">
                {t('openSheet')}
              </a>
              <button type="button" disabled={busy !== null} onClick={() => void sync()}>
                {busy === 'sync' ? t('syncing') : t('syncNow')}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Cleared so choosing the same file again still fires.
                  event.target.value = '';
                  if (file) void upload(file);
                }}
              />
              <button
                type="button"
                className="ghost"
                disabled={busy !== null}
                onClick={() => fileInput.current?.click()}
              >
                {busy === 'upload' ? t('uploading') : t('uploadFile')}
              </button>
              {/* Only for a refusal seen on this page: after a reload the page no longer
                  knows whether it was the sheet or a file, and forcing would re-read the
                  sheet. Read or upload again to see the reason and force it. */}
              {isAdmin && refused ? (
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

      {error ? (
        <p className="error" role="alert" dir="auto">
          {error}
        </p>
      ) : null}
      {note ? (
        <p className="ok-note" role="status">
          {note}
        </p>
      ) : null}

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

/** A file's bytes as plain base64 (no `data:` prefix). */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function describeSync(
  result: SupplierSyncResult,
  t: ReturnType<typeof useT<'supplier'>>,
  fromFile = false,
): string {
  const params = {
    rows: result.rowCount,
    added: result.added,
    changed: result.changed,
    removed: result.removed,
    switched: result.stockSwitched,
    error: result.error ?? '',
  };
  if (fromFile && (result.status === 'OK' || result.status === 'UNCHANGED')) {
    return t(`file${result.status}`, params);
  }
  return t(`sync${result.status}`, params);
}
